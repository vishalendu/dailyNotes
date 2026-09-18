use chrono::{Local, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, time::Duration};

pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
const APP_ID: i64 = 0x444e4f54;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Attachment {
    pub offset: usize,
    pub id: i64,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Note {
    pub day: String,
    pub body: String,
    pub revision: i64,
    pub archived: bool,
    pub attachments: Vec<Attachment>,
    pub updated_at: String,
}
#[derive(Clone, Serialize, Debug)]
pub struct Hit {
    pub day: String,
    pub snippet: String,
    pub archived: bool,
    pub score: f64,
    pub offset: usize,
}
#[derive(Clone, Deserialize)]
pub struct Search {
    pub query: String,
    pub archived: bool,
    pub days: Option<u32>,
    pub mode: String,
    pub newest: bool,
    pub limit: usize,
}
#[derive(Serialize)]
pub struct Stats {
    pub active: i64,
    pub archived: i64,
    pub pending: i64,
    pub bytes: u64,
}
pub struct Store {
    pub conn: Connection,
}

pub fn valid_day(day: &str) -> Result<()> {
    let d = NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(err)?;
    if d.format("%Y-%m-%d").to_string() != day {
        return Err("Invalid calendar date".into());
    }
    Ok(())
}
pub fn cutoff(days: u32) -> Result<String> {
    if days == 0 || days > 365_000 {
        return Err("Enter 1 to 365000 days".into());
    }
    Ok((Local::now().date_naive() - chrono::Duration::days(days as i64)).to_string())
}
pub fn fts_query(input: &str) -> String {
    input
        .split_whitespace()
        .filter_map(|part| {
            let prefix = part.ends_with('*');
            let clean = part.trim_end_matches('*').replace('"', "\"\"");
            clean
                .chars()
                .any(char::is_alphanumeric)
                .then(|| format!("\"{clean}\"{}", if prefix { "*" } else { "" }))
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

impl Store {
    pub fn open(path: &Path, create: bool) -> Result<Self> {
        let exists = path.exists();
        if !exists && !create {
            return Err("Library not found. Reconnect the folder or choose a library.".into());
        }
        let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
            | if create {
                rusqlite::OpenFlags::SQLITE_OPEN_CREATE
            } else {
                rusqlite::OpenFlags::empty()
            };
        let conn = Connection::open_with_flags(path, flags).map_err(err)?;
        let app: i64 = conn
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .map_err(err)?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if exists && (app != APP_ID || !(1..=2).contains(&version)) {
            return Err("This is not a supported Daily Notes library. Nothing was changed.".into());
        }
        conn.busy_timeout(Duration::from_secs(3)).map_err(err)?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )
        .map_err(err)?;
        if !exists {
            conn.execute_batch(include_str!("schema.sql"))
                .map_err(err)?;
            conn.pragma_update(None, "application_id", APP_ID)
                .map_err(err)?;
            conn.pragma_update(None, "user_version", 1).map_err(err)?;
            conn.execute(
                "INSERT INTO settings VALUES('library_id',?1)",
                [uuid::Uuid::new_v4().to_string()],
            )
            .map_err(err)?;
        }
        let check: String = conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(err)?;
        if check != "ok" {
            return Err(format!(
                "Library integrity check failed: {check}. Open a backup."
            ));
        }
        if version < 2 {
            if exists {
                let backup =
                    path.with_extension(format!("pre-v2-{}.sqlite", Utc::now().timestamp_millis()));
                if backup.exists() {
                    return Err(
                        "Migration backup already exists; reopen the library to retry.".into(),
                    );
                }
                conn.backup("main", &backup, None).map_err(err)?;
            }
            conn.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE bookmarks(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE);
                CREATE TABLE page_bookmarks(day TEXT NOT NULL,bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,PRIMARY KEY(day,bookmark_id));
                CREATE INDEX page_bookmarks_by_bookmark ON page_bookmarks(bookmark_id,day);
                PRAGMA user_version=2;
                COMMIT;").map_err(err)?;
        }
        Ok(Self { conn })
    }
    pub fn id(&self) -> Result<String> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key='library_id'",
                [],
                |r| r.get(0),
            )
            .map_err(err)
    }
    pub fn neighbors(&self, day: &str, archived: bool) -> Result<(Option<String>, Option<String>)> {
        valid_day(day)?;
        self.conn.query_row(
            "SELECT (SELECT day FROM notes WHERE is_archived=?2 AND day<?1 AND body<>'' ORDER BY day DESC LIMIT 1),
                    (SELECT day FROM notes WHERE is_archived=?2 AND day>?1 AND body<>'' ORDER BY day LIMIT 1)",
            params![day, archived],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(err)
    }
    pub fn note(&self, day: &str) -> Result<Note> {
        valid_day(day)?;
        let mut note = self
            .conn
            .query_row(
                "SELECT body,revision,is_archived,updated_at FROM notes WHERE day=?1",
                [day],
                |r| {
                    Ok(Note {
                        day: day.into(),
                        body: r.get(0)?,
                        revision: r.get(1)?,
                        archived: r.get(2)?,
                        updated_at: r.get(3)?,
                        attachments: vec![],
                    })
                },
            )
            .optional()
            .map_err(err)?
            .unwrap_or(Note {
                day: day.into(),
                body: String::new(),
                revision: 0,
                archived: false,
                attachments: vec![],
                updated_at: String::new(),
            });
        let mut stmt = self.conn.prepare("SELECT offset,image_id FROM note_images WHERE note_id=(SELECT id FROM notes WHERE day=?1) ORDER BY offset").map_err(err)?;
        note.attachments = stmt
            .query_map([day], |r| {
                Ok(Attachment {
                    offset: r.get(0)?,
                    id: r.get(1)?,
                })
            })
            .map_err(err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(err)?;
        Ok(note)
    }
    pub fn save(&mut self, note: &Note) -> Result<Note> {
        valid_day(&note.day)?;
        if note.body.len() > 5 * 1024 * 1024 {
            return Err("A daily note can contain up to 5 MiB of text.".into());
        }
        let utf16: Vec<_> = note.body.encode_utf16().collect();
        let mut offsets = std::collections::HashSet::new();
        for a in &note.attachments {
            if utf16.get(a.offset) != Some(&0xfffc) || !offsets.insert(a.offset) {
                return Err("Invalid image position; note was not changed.".into());
            }
        }
        if utf16.iter().filter(|c| **c == 0xfffc).count() != offsets.len() {
            return Err("An image reference is missing; note was not changed.".into());
        }
        let tx = self.conn.transaction().map_err(err)?;
        let previous: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,body FROM notes WHERE day=?1",
                [&note.day],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if previous.as_ref().map(|x| x.0).unwrap_or(0) != note.revision {
            return Err("This note changed elsewhere. Reload before saving.".into());
        }
        if previous.is_none() && note.body.is_empty() {
            return Ok(note.clone());
        }
        let now = Utc::now().to_rfc3339();
        tx.execute("INSERT INTO notes(day,body,revision,created_at,updated_at) VALUES(?1,?2,1,?3,?3) ON CONFLICT(day) DO UPDATE SET body=excluded.body,revision=notes.revision+1,updated_at=excluded.updated_at",params![note.day,note.body,now]).map_err(err)?;
        let id: i64 = tx
            .query_row("SELECT id FROM notes WHERE day=?1", [&note.day], |r| {
                r.get(0)
            })
            .map_err(err)?;
        tx.execute("DELETE FROM note_images WHERE note_id=?1", [id])
            .map_err(err)?;
        for a in &note.attachments {
            tx.execute(
                "INSERT INTO note_images VALUES(?1,?2,?3)",
                params![id, a.offset, a.id],
            )
            .map_err(err)?;
        }
        tx.execute("DELETE FROM chunks WHERE note_id=?1", [id])
            .map_err(err)?;
        tx.execute(
            "INSERT INTO pending(note_id,since) VALUES(?1,?2) ON CONFLICT(note_id) DO NOTHING",
            params![id, Utc::now().timestamp()],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        self.note(&note.day)
    }
    pub fn archive(&mut self, days: u32, preview: bool) -> Result<i64> {
        let cutoff = cutoff(days)?;
        if preview {
            return self
                .conn
                .query_row(
                    "SELECT count(*) FROM notes WHERE is_archived=0 AND day<?1",
                    [cutoff],
                    |r| r.get(0),
                )
                .map_err(err);
        }
        self.conn
            .execute(
                "UPDATE notes SET is_archived=1 WHERE is_archived=0 AND day<?1",
                [cutoff],
            )
            .map(|n| n as i64)
            .map_err(err)
    }
    pub fn restore(&self, day: &str) -> Result<()> {
        self.conn
            .execute("UPDATE notes SET is_archived=0 WHERE day=?1", [day])
            .map_err(err)?;
        Ok(())
    }
    pub fn stats(&self, path: &Path) -> Result<Stats> {
        let count = |sql| {
            self.conn
                .query_row(sql, [], |r| r.get::<_, i64>(0))
                .map_err(err)
        };
        Ok(Stats {
            active: count("SELECT count(*) FROM notes WHERE is_archived=0")?,
            archived: count("SELECT count(*) FROM notes WHERE is_archived=1")?,
            pending: count("SELECT count(*) FROM pending")?,
            bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        })
    }
    pub fn search(&self, search: &Search, embedding: Option<&[f32]>) -> Result<Vec<Hit>> {
        if search.query.len() > 4000 {
            return Err("Search query is too long".into());
        }
        let lower = match search.days {
            Some(d) => {
                cutoff(d)?;
                cutoff(d.saturating_sub(1).max(1)).map(|s| {
                    if d == 1 {
                        Local::now().date_naive().to_string()
                    } else {
                        s
                    }
                })?
            }
            None => "0001-01-01".into(),
        };
        let upper = if search.days.is_some() {
            Local::now().date_naive().to_string()
        } else {
            "9999-12-31".into()
        };
        let limit = search.limit.clamp(1, 10_000);
        let candidate_limit = if search.newest {
            10_000
        } else {
            (limit * 8).max(200).min(10_000)
        };
        let query = fts_query(&search.query);
        let mut matches: HashMap<String, Hit> = HashMap::new();
        if search.mode != "meaning" || search.query.trim().is_empty() {
            let sql = if query.is_empty() {
                "SELECT day,substr(body,1,180),is_archived,0 FROM notes WHERE is_archived=?1 AND day BETWEEN ?2 AND ?3 ORDER BY day DESC LIMIT ?4"
            } else {
                "SELECT n.day,snippet(notes_fts,0,'','',' … ',32),n.is_archived,0 FROM notes_fts JOIN notes n ON n.id=notes_fts.rowid WHERE n.is_archived=?1 AND n.day BETWEEN ?2 AND ?3 AND notes_fts MATCH ?5 ORDER BY rank LIMIT ?4"
            };
            let mut stmt = self.conn.prepare(sql).map_err(err)?;
            let map = |r: &rusqlite::Row| {
                Ok(Hit {
                    day: r.get(0)?,
                    snippet: r.get::<_, String>(1)?.replace('\u{fffc}', "[image]"),
                    archived: r.get(2)?,
                    score: 0.,
                    offset: r.get(3)?,
                })
            };
            let rows = if query.is_empty() {
                stmt.query_map(params![search.archived, lower, upper, candidate_limit], map)
            } else {
                stmt.query_map(
                    params![search.archived, lower, upper, candidate_limit, query],
                    map,
                )
            }
            .map_err(err)?;
            for (rank, row) in rows.enumerate() {
                let mut hit = row.map_err(err)?;
                hit.score = 1. / (61. + rank as f64);
                matches.insert(hit.day.clone(), hit);
            }
        }
        if let Some(vector) = embedding {
            let bytes: Vec<u8> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
            // ponytail: exact vector scan over eligible chunks; add ANN only if measured latency requires it.
            let mut stmt=self.conn.prepare("SELECT n.day,c.text,n.is_archived,c.offset,vec_distance_cosine(c.vector,?4) AS distance FROM chunks c JOIN notes n ON n.id=c.note_id WHERE n.is_archived=?1 AND n.day BETWEEN ?2 AND ?3 AND c.revision=n.revision ORDER BY distance LIMIT ?5").map_err(err)?;
            let rows = stmt
                .query_map(
                    params![search.archived, lower, upper, bytes, candidate_limit * 8],
                    |r| {
                        Ok((
                            Hit {
                                day: r.get(0)?,
                                snippet: r.get(1)?,
                                archived: r.get(2)?,
                                offset: r.get(3)?,
                                score: 0.,
                            },
                            r.get::<_, f64>(4)?,
                        ))
                    },
                )
                .map_err(err)?;
            let mut seen = std::collections::HashSet::new();
            for row in rows {
                let (mut hit, distance) = row.map_err(err)?;
                if distance > 0.85 || !seen.insert(hit.day.clone()) {
                    continue;
                }
                let score = 1. / (60. + seen.len() as f64);
                hit.snippet = hit.snippet.chars().take(240).collect();
                if let Some(old) = matches.get_mut(&hit.day) {
                    old.score += score;
                    old.offset = hit.offset;
                } else {
                    hit.score = score;
                    matches.insert(hit.day.clone(), hit);
                }
            }
        }
        let mut result: Vec<_> = matches.into_values().collect();
        result.sort_by(|a, b| {
            if search.newest || search.query.trim().is_empty() {
                b.day.cmp(&a.day)
            } else {
                b.score.total_cmp(&a.score).then(b.day.cmp(&a.day))
            }
        });
        result.truncate(limit);
        Ok(result)
    }
    pub fn backup(&self, path: &Path) -> Result<()> {
        if path.exists() {
            return Err("Destination already exists. Choose a new filename.".into());
        }
        self.conn.backup("main", path, None).map_err(err)?;
        let dest = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(err)?;
        let check: String = dest
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .map_err(err)?;
        let broken: bool = dest
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if check != "ok" || broken {
            return Err("Backup verification failed; original is unchanged.".into());
        }
        Ok(())
    }
}

pub fn register_vectors() {
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut std::ffi::c_char,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> std::ffi::c_int,
        >(
            sqlite_vec::sqlite3_vec_init as *const ()
        )));
    }
}
