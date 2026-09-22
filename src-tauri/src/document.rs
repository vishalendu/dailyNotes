use crate::storage::{err, Attachment, Result};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde_json::Value;
use std::io::{Read, Write};
const MAX: usize = 10 * 1024 * 1024;

pub fn safe_link(s: &str) -> bool {
    let s = s.trim().to_ascii_lowercase();
    !s.chars().any(char::is_control)
        && ["https://", "http://", "mailto:"]
            .iter()
            .any(|p| s.starts_with(p))
}
pub fn project(doc: &Value) -> Result<(String, Vec<Attachment>)> {
    project_version(doc, 2)
}
fn project_version(doc: &Value, version: i64) -> Result<(String, Vec<Attachment>)> {
    struct Walk {
        version: i64,
        body: String,
        images: Vec<Attachment>,
        blocks: usize,
        count: usize,
        offset: usize,
    }
    impl Walk {
        fn visit(&mut self, n: &Value, parent: &str, depth: usize) -> Result<()> {
            self.count += 1;
            if depth > 32 || self.count > 100_000 {
                return Err("Document is too complex.".into());
            }
            let obj = n.as_object().ok_or("Invalid document node")?;
            if obj
                .keys()
                .any(|k| !["type", "attrs", "content", "marks", "text"].contains(&k.as_str()))
            {
                return Err("Unsupported document field".into());
            }
            let t = n["type"].as_str().ok_or("Missing node type")?;
            let block = [
                "paragraph",
                "heading",
                "codeBlock",
                "blockquote",
                "bulletList",
                "orderedList",
            ]
            .contains(&t);
            let inline = ["text", "hardBreak", "image"].contains(&t);
            let valid = match parent {
                "" => t == "doc",
                "doc" | "blockquote" | "listItem" => block,
                "bulletList" | "orderedList" => t == "listItem",
                "paragraph" | "heading" => inline,
                "codeBlock" => t == "text",
                _ => false,
            };
            if !valid {
                return Err(format!("Unsupported document structure: {parent}/{t}"));
            }
            let allowed: &[&str] = match t {
                "heading" if self.version >= 2 => &["level", "lineHeight", "paragraphSpacing"],
                "paragraph" if self.version >= 2 => &["lineHeight", "paragraphSpacing"],
                "heading" => &["level"],
                "orderedList" => &["start"],
                "image" => &["imageId", "alt"],
                "codeBlock" => &["language"],
                _ => &[],
            };
            if let Some(attrs) = n.get("attrs") {
                let attrs = attrs.as_object().ok_or("Invalid node attributes")?;
                if attrs.keys().any(|k| !allowed.contains(&k.as_str())) {
                    return Err("Unsupported node attributes".into());
                }
            }
            for (key, valid) in [
                (
                    "lineHeight",
                    n["attrs"]["lineHeight"]
                        .as_f64()
                        .is_some_and(|v| v.is_finite() && (1.0..=2.0).contains(&v)),
                ),
                (
                    "paragraphSpacing",
                    n["attrs"]["paragraphSpacing"]
                        .as_u64()
                        .is_some_and(|v| [0, 4, 8, 12].contains(&v)),
                ),
            ] {
                if n["attrs"].get(key).is_some() && !valid {
                    return Err("Invalid paragraph spacing".into());
                }
            }
            if t == "heading"
                && !n["attrs"]["level"]
                    .as_u64()
                    .is_some_and(|x| (1..=3).contains(&x))
            {
                return Err("Unsupported heading level".into());
            }
            if t == "orderedList"
                && n["attrs"].get("start").is_some()
                && !n["attrs"]["start"]
                    .as_u64()
                    .is_some_and(|x| (1..=1_000_000_000).contains(&x))
            {
                return Err("Invalid list start".into());
            }
            for key in ["alt", "language"] {
                if let Some(v) = n["attrs"].get(key) {
                    if !v.is_null() && !v.as_str().is_some_and(|s| s.len() <= 500) {
                        return Err("Invalid text attribute".into());
                    }
                }
            }
            if let Some(marks) = n.get("marks") {
                let marks = marks.as_array().ok_or("Invalid marks")?;
                if t != "text" || parent == "codeBlock" {
                    if !marks.is_empty() {
                        return Err("Marks are not supported here".into());
                    }
                }
                let mut seen = std::collections::HashSet::new();
                for m in marks {
                    let mt = m["type"].as_str().ok_or("Invalid mark")?;
                    if !(["bold", "italic", "strike", "code", "link"].contains(&mt)
                        || (self.version >= 2 && mt == "textStyle"))
                        || !seen.insert(mt)
                    {
                        return Err("Unsupported mark".into());
                    }
                    if m.as_object()
                        .ok_or("Invalid mark")?
                        .keys()
                        .any(|k| k != "type" && k != "attrs")
                    {
                        return Err("Invalid mark field".into());
                    }
                    if mt == "link" {
                        let a = m["attrs"].as_object().ok_or("Missing link attributes")?;
                        if a.keys().any(|k| k != "href")
                            || !a.get("href").and_then(Value::as_str).is_some_and(safe_link)
                        {
                            return Err("Unsafe link".into());
                        }
                    } else if mt == "textStyle" {
                        let a = m["attrs"]
                            .as_object()
                            .ok_or("Missing text style attributes")?;
                        if a.keys()
                            .any(|k| !["fontFamily", "fontSize"].contains(&k.as_str()))
                        {
                            return Err("Unsupported text style".into());
                        }
                        if let Some(f) = a.get("fontFamily") {
                            let f = f.as_str().ok_or("Invalid font family")?;
                            if f.is_empty()
                                || f.chars().count() > 100
                                || f.chars()
                                    .any(|c| c.is_control() || "\"'\\;,<>{}".contains(c))
                            {
                                return Err("Invalid font family".into());
                            }
                        }
                        if let Some(v) = a.get("fontSize") {
                            if !v
                                .as_str()
                                .is_some_and(|s| (12..=24).any(|n| s == format!("{n}px")))
                            {
                                return Err("Invalid font size".into());
                            }
                        }
                    } else if m.get("attrs").is_some() {
                        return Err("Unsupported mark attributes".into());
                    }
                }
            }
            if ["paragraph", "heading", "codeBlock"].contains(&t) {
                if self.blocks > 0 {
                    self.body.push('\n');
                    self.offset += 1;
                }
                self.blocks += 1;
            }
            match t {
                "text" => {
                    let s = n["text"].as_str().ok_or("Missing text")?;
                    if s.is_empty() || s.contains('\u{fffc}') {
                        return Err("Invalid text node".into());
                    }
                    self.body.push_str(s);
                    self.offset += s.encode_utf16().count();
                }
                "hardBreak" => {
                    self.body.push('\n');
                    self.offset += 1;
                }
                "image" => {
                    let id = n["attrs"]["imageId"]
                        .as_i64()
                        .filter(|x| *x > 0)
                        .ok_or("Invalid image ID")?;
                    self.images.push(Attachment {
                        offset: self.offset,
                        id,
                    });
                    self.body.push('\u{fffc}');
                    self.offset += 1;
                }
                _ => {}
            }
            if t != "text" && n.get("text").is_some() {
                return Err("Unexpected node text".into());
            }
            let children = match n.get("content") {
                Some(v) => v.as_array().ok_or("Invalid node content")?.as_slice(),
                None => &[],
            };
            if inline && !children.is_empty() {
                return Err("Inline node cannot have children".into());
            }
            if ["doc", "blockquote", "bulletList", "orderedList", "listItem"].contains(&t)
                && children.is_empty()
            {
                return Err("Empty block container".into());
            }
            if t == "listItem" && children[0]["type"] != "paragraph" {
                return Err("List items must start with a paragraph".into());
            }
            for child in children {
                self.visit(child, t, depth + 1)?;
            }
            if self.body.len() > 5 * 1024 * 1024 {
                return Err("Note exceeds 5 MiB of text".into());
            }
            Ok(())
        }
    }
    let mut w = Walk {
        version,
        body: String::new(),
        images: vec![],
        blocks: 0,
        count: 0,
        offset: 0,
    };
    w.visit(doc, "", 0)?;
    Ok((w.body, w.images))
}
pub fn encode(doc: &Value) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec(doc).map_err(err)?;
    if bytes.len() > MAX {
        return Err("Document exceeds 10 MiB".into());
    }
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&bytes).map_err(err)?;
    encoder.finish().map_err(err)
}
pub fn decode(bytes: &[u8], version: i64) -> Result<Value> {
    if ![1, 2].contains(&version) {
        return Err(
            "Unsupported rich document version. Use a newer app or export a recovery copy.".into(),
        );
    }
    if bytes.len() > MAX {
        return Err("Document exceeds size limit".into());
    }
    let mut raw = Vec::new();
    GzDecoder::new(bytes)
        .take(MAX as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(err)?;
    if raw.len() > MAX {
        return Err("Document exceeds decompression limit".into());
    }
    let doc = serde_json::from_slice(&raw).map_err(err)?;
    project_version(&doc, version)?;
    Ok(doc)
}
