use crate::storage::{err, valid_day, Hit, Result, Store};
use chrono::{Duration, Local};
use rusqlite::params;
use serde::Serialize;

#[derive(Serialize)]
pub struct Bookmark {
    pub id: i64,
    pub name: String,
    pub assigned: bool,
}

impl Store {
    pub fn bookmarks(&self, day: &str) -> Result<Vec<Bookmark>> {
        valid_day(day)?;
        let mut stmt = self.conn.prepare("SELECT b.id,b.name,EXISTS(SELECT 1 FROM page_bookmarks p WHERE p.bookmark_id=b.id AND p.day=?1) FROM bookmarks b ORDER BY b.name COLLATE NOCASE").map_err(err)?;
        let rows = stmt
            .query_map([day], |r| {
                Ok(Bookmark {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    assigned: r.get(2)?,
                })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }
    pub fn create_bookmark(&self, name: &str) -> Result<i64> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err("Use a bookmark name of 1–80 characters, without line breaks.".into());
        }
        self.conn
            .execute(
                "INSERT INTO bookmarks(name) VALUES(?1) ON CONFLICT(name) DO NOTHING",
                [name],
            )
            .map_err(err)?;
        self.conn
            .query_row(
                "SELECT id FROM bookmarks WHERE name=?1 COLLATE NOCASE",
                [name],
                |r| r.get(0),
            )
            .map_err(err)
    }
    pub fn assign_bookmarks(&mut self, day: &str, ids: &[i64]) -> Result<()> {
        valid_day(day)?;
        if ids.len() > 1000 {
            return Err("Too many bookmarks on one page.".into());
        }
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute("DELETE FROM page_bookmarks WHERE day=?1", [day])
            .map_err(err)?;
        for id in ids {
            tx.execute(
                "INSERT OR IGNORE INTO page_bookmarks(day,bookmark_id) VALUES(?1,?2)",
                params![day, id],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn collection_hits(
        &self,
        kind: &str,
        query: &str,
        days: Option<u32>,
        archived: bool,
        bookmark_id: Option<i64>,
        limit: usize,
    ) -> Result<Vec<Hit>> {
        let today = Local::now().date_naive();
        let from = match days {
            Some(n) if (1..=365_000).contains(&n) => {
                (today - Duration::days((n - 1) as i64)).to_string()
            }
            Some(_) => return Err("Enter 1 to 365000 days.".into()),
            None => "0000-01-01".into(),
        };
        let end = if days.is_some() {
            today.to_string()
        } else {
            "9999-12-31".into()
        };
        let limit = limit.clamp(1, 10001);
        let query = query.to_lowercase();
        let mut hits = Vec::new();
        let sql = match kind {
            "todos" => "SELECT n.day,n.body,n.is_archived FROM notes n JOIN notes_fts f ON f.rowid=n.id WHERE notes_fts MATCH 'todo' AND n.is_archived=?1 AND n.day>=?2 AND n.day<=?3 ORDER BY n.day DESC",
            "bookmarks" => "SELECT DISTINCT p.day,COALESCE(n.body,''),COALESCE(n.is_archived,0) FROM page_bookmarks p LEFT JOIN notes n ON n.day=p.day WHERE COALESCE(n.is_archived,0)=?1 AND p.day>=?2 AND p.day<=?3 AND (?4 IS NULL OR p.bookmark_id=?4) ORDER BY p.day DESC",
            _ => return Err("Unknown collection.".into()),
        };
        let mut stmt = self.conn.prepare(sql).map_err(err)?;
        let mut rows = if kind == "todos" {
            stmt.query(params![archived, from, end])
        } else {
            stmt.query(params![archived, from, end, bookmark_id])
        }
        .map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            let day: String = row.get(0).map_err(err)?;
            let body: String = row.get(1).map_err(err)?;
            let archived = row.get(2).map_err(err)?;
            if kind == "bookmarks" {
                if body.to_lowercase().contains(&query) {
                    hits.push(Hit {
                        day,
                        snippet: body.chars().take(240).collect(),
                        archived,
                        offset: 0,
                        score: 0.0,
                    });
                }
            } else {
                let mut offset = 0;
                for line in body.split_inclusive('\n') {
                    if has_todo(line) && line.to_lowercase().contains(&query) {
                        hits.push(Hit {
                            day: day.clone(),
                            snippet: line.trim().chars().take(500).collect(),
                            archived,
                            offset,
                            score: 0.0,
                        });
                        if hits.len() == limit {
                            break;
                        }
                    }
                    offset += line.encode_utf16().count();
                }
            }
            if hits.len() == limit {
                break;
            }
        }
        Ok(hits)
    }
}
fn has_todo(line: &str) -> bool {
    let word = |c: char| c.is_alphanumeric() || c == '_';
    line.match_indices('#').any(|(i, _)| {
        let rest = &line[i + 1..];
        rest.get(..4)
            .is_some_and(|tag| tag.eq_ignore_ascii_case("todo"))
            && !line[..i].chars().next_back().is_some_and(word)
            && !rest[4.min(rest.len())..].chars().next().is_some_and(word)
    })
}
