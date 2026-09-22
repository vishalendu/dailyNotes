use crate::{
    library::Libraries,
    storage::{err, Result},
};
use fastembed::{
    InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Emitter;

const VERSION: &str = "minilm-1110a243-f32-mean-v1";
#[derive(Clone, Serialize)]
pub struct Status {
    pub state: String,
    pub message: String,
    pub progress: f64,
    pub loaded: bool,
}
enum Job {
    Wake,
    Retry,
    Index,
    Query(String, mpsc::SyncSender<Result<Vec<f32>>>),
}
pub struct Embeddings {
    tx: mpsc::Sender<Job>,
    pub status: Arc<Mutex<Status>>,
    cancel: Arc<AtomicBool>,
}
#[derive(Deserialize)]
struct Manifest {
    revision: String,
    files: Vec<ModelFile>,
}
#[derive(Deserialize)]
struct ModelFile {
    name: String,
    url: String,
    size: u64,
    sha256: String,
}

impl Embeddings {
    pub fn start(root: PathBuf, libraries: Arc<Mutex<Libraries>>, app: tauri::AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(Status {
            state: "checking".into(),
            message: "Checking local model".into(),
            progress: 0.,
            loaded: false,
        }));
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_status = status.clone();
        let worker_cancel = cancel.clone();
        std::thread::spawn(move || {
            let report = |state: &str, message: String, progress: f64, loaded: bool| {
                let s = Status {
                    state: state.into(),
                    message,
                    progress,
                    loaded,
                };
                *worker_status.lock().unwrap() = s.clone();
                let _ = app.emit("model-status", s);
            };
            let manifest: Manifest = serde_json::from_str(include_str!("../model-manifest.json"))
                .expect("model manifest");
            let folder = root.join(&manifest.revision);
            let download = || download(&folder, &manifest, &worker_cancel, &report);
            let mut ready = match download() {
                Ok(()) => true,
                Err(e) => {
                    report("unavailable", e, 0., false);
                    false
                }
            };
            let mut model: Option<TextEmbedding> = None;
            let mut last_query: Option<Instant> = None;
            let mut retry_after = Instant::now();
            loop {
                let due = pending_deadline(&libraries);
                let mut timeout = Duration::from_secs(86_400);
                if ready {
                    if let Some(timestamp) = due {
                        timeout = Duration::from_secs(
                            (timestamp - chrono::Utc::now().timestamp()).max(0) as u64,
                        )
                        .max(retry_after.saturating_duration_since(Instant::now()));
                    }
                }
                if let Some(last) = last_query {
                    timeout = timeout.min(Duration::from_secs(60).saturating_sub(last.elapsed()));
                }
                let job = rx.recv_timeout(timeout);
                let force = matches!(&job, Ok(Job::Index));
                match job {
                    Ok(Job::Retry) => {
                        worker_cancel.store(false, Ordering::Relaxed);
                        ready = match download() {
                            Ok(()) => true,
                            Err(e) => {
                                report("unavailable", e, 0., false);
                                false
                            }
                        };
                    }
                    Ok(Job::Query(text, reply)) => {
                        let result = (|| {
                            if !ready {
                                return Err("Meaning search needs the model download. Keyword search is ready.".into());
                            }
                            if model.is_none() {
                                report("loading", "Loading meaning search".into(), 1., false);
                                model = Some(load(&folder)?);
                            }
                            let vectors = model
                                .as_mut()
                                .unwrap()
                                .embed(vec![text], Some(1))
                                .map_err(err)?;
                            report("ready", "Meaning search ready".into(), 1., true);
                            Ok(vectors.into_iter().next().ok_or("Empty embedding")?)
                        })();
                        last_query = Some(Instant::now());
                        let _ = reply.send(result);
                    }
                    Ok(Job::Wake) => {}
                    Ok(Job::Index) | Err(mpsc::RecvTimeoutError::Timeout) => {
                        if force {
                            if let Ok(mut manager) = libraries.lock() {
                                if let Some(lib) = manager.current.as_mut() {
                                    let _ =
                                        lib.store.conn.execute("UPDATE pending SET since=0", []);
                                }
                            }
                        }
                        if last_query.is_some_and(|t| t.elapsed() >= Duration::from_secs(60)) {
                            model = None;
                            last_query = None;
                            if ready {
                                report("ready", "Model on disk · unloaded".into(), 1., false);
                            }
                        }
                        if ready
                            && due.is_some_and(|timestamp| {
                                force || timestamp <= chrono::Utc::now().timestamp()
                            })
                            && Instant::now() >= retry_after
                        {
                            let result = (|| {
                                if model.is_none() {
                                    report(
                                        "loading",
                                        "Loading model for pending notes".into(),
                                        1.,
                                        false,
                                    );
                                    model = Some(load(&folder)?);
                                }
                                report("indexing", "Updating meaning search".into(), 1., true);
                                // One note per turn permits interactive requests between indexing batches.
                                index_one(&libraries, model.as_mut().unwrap())
                            })();
                            match result {
                                Ok(()) => {
                                    let _ = app.emit("index-updated", ());
                                }
                                Err(e) => {
                                    report("error", e, 1., false);
                                    retry_after = Instant::now() + Duration::from_secs(600);
                                    model = None;
                                }
                            }
                            if pending_deadline(&libraries)
                                .is_none_or(|next| next > chrono::Utc::now().timestamp())
                                && last_query.is_none()
                            {
                                model = None;
                                report("ready", "Model on disk · unloaded".into(), 1., false);
                            }
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        Self { tx, status, cancel }
    }
    pub fn wake(&self) {
        let _ = self.tx.send(Job::Wake);
    }
    pub fn action(&self, action: &str) -> Result<()> {
        match action {
            "retry" => {
                self.cancel.store(false, Ordering::Relaxed);
                self.tx.send(Job::Retry).map_err(err)?;
            }
            "cancel" => self.cancel.store(true, Ordering::Relaxed),
            "index" => self.tx.send(Job::Index).map_err(err)?,
            _ => return Err("Unknown model action".into()),
        }
        Ok(())
    }
    pub fn query(&self, text: String) -> Result<Vec<f32>> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.tx.send(Job::Query(text, tx)).map_err(err)?;
        rx.recv_timeout(Duration::from_secs(90)).map_err(err)?
    }
}
fn pending_deadline(libraries: &Arc<Mutex<Libraries>>) -> Option<i64> {
    libraries
        .lock()
        .ok()?
        .current
        .as_ref()?
        .store
        .conn
        .query_row("SELECT min(since)+600 FROM pending", [], |r| {
            r.get::<_, Option<i64>>(0)
        })
        .ok()
        .flatten()
}
fn download(
    folder: &Path,
    manifest: &Manifest,
    cancel: &AtomicBool,
    report: &impl Fn(&str, String, f64, bool),
) -> Result<()> {
    fs::create_dir_all(folder).map_err(err)?;
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(err)?;
    let total: u64 = manifest.files.iter().map(|f| f.size).sum();
    let mut complete = 0;
    for file in &manifest.files {
        if cancel.load(Ordering::Relaxed) {
            return Err("Model download paused. Retry whenever you're ready.".into());
        }
        let path = folder.join(&file.name);
        if let Ok(bytes) = fs::read(&path) {
            if bytes.len() as u64 == file.size
                && format!("{:x}", Sha256::digest(&bytes)) == file.sha256
            {
                complete += file.size;
                continue;
            }
        }
        let mut response = client
            .get(&file.url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(err)?;
        let temporary = path.with_extension("download");
        let mut output = fs::File::create(&temporary).map_err(err)?;
        let mut hash = Sha256::new();
        let mut size = 0;
        let mut buffer = [0; 65536];
        let mut last_report = Instant::now() - Duration::from_secs(1);
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("Model download paused. Choose Retry to restart.".into());
            }
            let n = response.read(&mut buffer).map_err(err)?;
            if n == 0 {
                break;
            }
            size += n as u64;
            if size > file.size {
                return Err("Model file exceeded its verified size".into());
            }
            hash.update(&buffer[..n]);
            output.write_all(&buffer[..n]).map_err(err)?;
            if last_report.elapsed() > Duration::from_millis(250) {
                report(
                    "downloading",
                    format!(
                        "Downloading local model · {}%",
                        (complete + size) * 100 / total
                    ),
                    (complete + size) as f64 / total as f64,
                    false,
                );
                last_report = Instant::now();
            }
        }
        if size != file.size || format!("{:x}", hash.finalize()) != file.sha256 {
            return Err("Model checksum failed. Retry the download.".into());
        }
        output.sync_all().map_err(err)?;
        drop(output);
        if path.exists() {
            fs::remove_file(&path).map_err(err)?;
        }
        fs::rename(temporary, &path).map_err(err)?;
        complete += size;
    }
    report("ready", "Model on disk · unloaded".into(), 1., false);
    Ok(())
}
fn load(folder: &Path) -> Result<TextEmbedding> {
    let read = |name| fs::read(folder.join(name)).map_err(err);
    let files = TokenizerFiles {
        tokenizer_file: read("tokenizer.json")?,
        config_file: read("config.json")?,
        special_tokens_map_file: read("special_tokens_map.json")?,
        tokenizer_config_file: read("tokenizer_config.json")?,
    };
    TextEmbedding::try_new_from_user_defined(
        UserDefinedEmbeddingModel::new(read("model.onnx")?, files).with_pooling(Pooling::Mean),
        InitOptionsUserDefined::new()
            .with_max_length(256)
            .with_intra_threads(2),
    )
    .map_err(err)
}
fn index_one(libraries: &Arc<Mutex<Libraries>>, model: &mut TextEmbedding) -> Result<()> {
    let job = {
        let mut m = libraries.lock().map_err(err)?;
        let lib = match m.current.as_mut() {
            Some(l) => l,
            None => return Ok(()),
        };
        let version: Option<String> = lib
            .store
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key='embedding_version'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if version.as_deref() != Some(VERSION) {
            lib.store
                .conn
                .execute_batch(
                    "DELETE FROM chunks; INSERT OR IGNORE INTO pending SELECT id,0 FROM notes;",
                )
                .map_err(err)?;
            lib.store
                .conn
                .execute(
                    "INSERT OR REPLACE INTO settings VALUES('embedding_version',?1)",
                    [VERSION],
                )
                .map_err(err)?;
        }
        let row=lib.store.conn.query_row("SELECT n.id,n.revision,n.body FROM pending p JOIN notes n ON n.id=p.note_id ORDER BY p.since LIMIT 1",[],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?))).optional().map_err(err)?;
        row.map(|r| (lib.path.clone(), lib.store.id().unwrap_or_default(), r))
    };
    let Some((path, id, (note_id, revision, body))) = job else {
        return Ok(());
    };
    let mut tokenizer = model.tokenizer.clone();
    tokenizer.with_truncation(None).map_err(err)?;
    let encoding = tokenizer.encode(body.as_str(), false).map_err(err)?;
    let offsets = encoding.get_offsets();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < offsets.len() {
        let end = (start + 200).min(offsets.len());
        let a = offsets[start].0;
        let b = offsets[end - 1].1;
        if a < b {
            chunks.push((
                body[..a].encode_utf16().count(),
                body[a..b].replace('\u{fffc}', " "),
            ));
        }
        if end == offsets.len() {
            break;
        }
        start = end - 32;
    }
    let texts: Vec<_> = chunks.iter().map(|(_, t)| t.as_str()).collect();
    let vectors = if texts.is_empty() {
        vec![]
    } else {
        model.embed(texts, Some(8)).map_err(err)?
    };
    let mut m = libraries.lock().map_err(err)?;
    let Some(lib) = m.current.as_mut() else {
        return Ok(());
    };
    if lib.path != path || lib.store.id()? != id {
        return Ok(());
    }
    let tx = lib.store.conn.transaction().map_err(err)?;
    let current: Option<i64> = tx
        .query_row("SELECT revision FROM notes WHERE id=?1", [note_id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?;
    if current != Some(revision) {
        return Ok(());
    }
    tx.execute("DELETE FROM chunks WHERE note_id=?1", [note_id])
        .map_err(err)?;
    for ((offset, text), vector) in chunks.into_iter().zip(vectors) {
        let bytes: Vec<u8> = vector.into_iter().flat_map(f32::to_le_bytes).collect();
        tx.execute(
            "INSERT INTO chunks(note_id,revision,offset,text,vector) VALUES(?1,?2,?3,?4,?5)",
            rusqlite::params![note_id, revision, offset, text, bytes],
        )
        .map_err(err)?;
    }
    tx.execute("DELETE FROM pending WHERE note_id=?1", [note_id])
        .map_err(err)?;
    tx.commit().map_err(err)
}

#[cfg(test)]
mod smoke {
    use super::*;
    use crate::storage::{register_vectors, Note, Search};
    #[test]
    #[ignore = "Downloads the pinned 91 MB model; run explicitly for an inference smoke check"]
    fn model_smoke() {
        register_vectors();
        let manifest: Manifest =
            serde_json::from_str(include_str!("../model-manifest.json")).unwrap();
        let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../models/smoke")
            .join(&manifest.revision);
        download(
            &folder,
            &manifest,
            &AtomicBool::new(false),
            &|_, message, _, _| eprintln!("{message}"),
        )
        .unwrap();
        let mut model = load(&folder).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let mut manager = Libraries::new(temp.path().join("settings")).unwrap();
        manager
            .switch(temp.path().join("notes.sqlite"), true)
            .unwrap();
        for (day,body) in [("2026-09-18","The release failed because our container could not start. Fixed the deployment configuration."),("2026-09-17","Bought tomatoes and basil for a pasta dinner.")]{manager.active().unwrap().store.save(&Note{content:None,day:day.into(),body:body.into(),revision:0,archived:false,attachments:vec![],updated_at:String::new()}).unwrap();}
        let libraries = Arc::new(Mutex::new(manager));
        index_one(&libraries, &mut model).unwrap();
        index_one(&libraries, &mut model).unwrap();
        let vector = model
            .embed(vec!["deployment problems"], Some(1))
            .unwrap()
            .remove(0);
        assert_eq!(vector.len(), 384);
        let hits = libraries
            .lock()
            .unwrap()
            .active()
            .unwrap()
            .store
            .search(
                &Search {
                    query: "deployment problems".into(),
                    archived: false,
                    days: None,
                    mode: "meaning".into(),
                    newest: false,
                    limit: 20,
                },
                Some(&vector),
            )
            .unwrap();
        assert_eq!(hits[0].day, "2026-09-18");
        drop(model);
        eprintln!("Verified model download, local inference, saved chunk indexing, semantic retrieval, and session release.");
    }
}
