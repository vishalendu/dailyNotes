use crate::{
    embeddings::Status,
    images::ImageResult,
    library::{Libraries, LibraryInfo},
    storage::{err, Hit, Note, Result, Search, Stats},
    AppState,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};

async fn with_store<T: Send + 'static>(
    libs: Arc<Mutex<Libraries>>,
    f: impl FnOnce(&mut Libraries) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = libs.lock().map_err(err)?;
        f(&mut guard)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn library_info(state: State<'_, AppState>) -> Result<LibraryInfo> {
    with_store(state.libraries.clone(), |m| m.info()).await
}
#[tauri::command]
pub async fn choose_library(
    path: String,
    create: bool,
    state: State<'_, AppState>,
) -> Result<LibraryInfo> {
    let result = with_store(state.libraries.clone(), move |m| {
        m.switch(PathBuf::from(path), create)
    })
    .await;
    state.embeddings.wake();
    result
}
#[tauri::command]
pub async fn get_note(day: String, library_id: String, state: State<'_, AppState>) -> Result<Note> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.note(&day)
    })
    .await
}
#[tauri::command]
pub async fn note_neighbors(
    day: String,
    archived: bool,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<(Option<String>, Option<String>)> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.neighbors(&day, archived)
    })
    .await
}
#[tauri::command]
pub async fn save_note(note: Note, library_id: String, state: State<'_, AppState>) -> Result<Note> {
    let result = with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.save(&note)
    })
    .await;
    state.embeddings.wake();
    result
}
#[tauri::command]
pub async fn search_notes(
    search: Search,
    library_id: String,
    app: tauri::AppHandle,
) -> Result<Vec<Hit>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let embedding = if search.mode != "keywords" && !search.query.trim().is_empty() {
            Some(state.embeddings.query(search.query.clone())?)
        } else {
            None
        };
        let result = state
            .libraries
            .lock()
            .map_err(err)?
            .assert_id(&library_id)?
            .store
            .search(&search, embedding.as_deref());
        result
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn add_image(
    data: String,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<ImageResult> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.add_image(&data)
    })
    .await
}
#[tauri::command]
pub async fn get_image(
    id: i64,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<ImageResult> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.image(id)
    })
    .await
}
#[tauri::command]
pub async fn library_stats(state: State<'_, AppState>) -> Result<Stats> {
    with_store(state.libraries.clone(), |m| {
        let l = m.active()?;
        l.store.stats(&l.path)
    })
    .await
}
#[tauri::command]
pub async fn archive_notes(
    days: u32,
    preview: bool,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<i64> {
    with_store(state.libraries.clone(), move |m| {
        let l = m.assert_id(&library_id)?;
        let count = l.store.archive(days, preview)?;
        if !preview {
            l.store
                .conn
                .execute(
                    "UPDATE settings SET value=?1 WHERE key='archive_days'",
                    [days.to_string()],
                )
                .map_err(err)?;
        }
        Ok(count)
    })
    .await
}
#[tauri::command]
pub async fn restore_note(
    day: String,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.restore(&day)
    })
    .await
}
#[tauri::command]
pub async fn backup_library(
    path: String,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.backup(&PathBuf::from(path))
    })
    .await
}
#[tauri::command]
pub async fn move_library(
    folder: String,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<LibraryInfo> {
    let result = with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?;
        m.move_to(folder.into())
    })
    .await;
    state.embeddings.wake();
    result
}
#[tauri::command]
pub async fn set_background(enabled: bool, state: State<'_, AppState>) -> Result<()> {
    with_store(state.libraries.clone(), move |m| m.background(enabled)).await
}
#[tauri::command]
pub fn model_status(state: State<'_, AppState>) -> Status {
    state.embeddings.status.lock().unwrap().clone()
}
#[tauri::command]
pub fn model_action(action: String, state: State<'_, AppState>) -> Result<()> {
    state.embeddings.action(&action)
}
#[tauri::command]
pub fn finish_close(quit: bool, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<()> {
    if quit || !state.libraries.lock().map_err(err)?.preferences.background {
        app.exit(0);
    } else if let Some(w) = app.get_webview_window("main") {
        w.hide().map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn export_note(
    folder: String,
    note: Note,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    with_store(state.libraries.clone(), move |m| {
        let l = m.assert_id(&library_id)?;
        let folder =
            PathBuf::from(folder).join(format!("DailyNotes-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).map_err(err)?;
        std::fs::write(
            folder.join(format!("{}.txt", note.day)),
            note.body.replace('\u{fffc}', "[image]"),
        )
        .map_err(err)?;
        for a in note.attachments {
            let (mime, bytes): (String, Vec<u8>) = l
                .store
                .conn
                .query_row("SELECT mime,bytes FROM images WHERE id=?1", [a.id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .map_err(err)?;
            std::fs::write(
                folder.join(format!(
                    "image-{}.{}",
                    a.offset,
                    if mime == "image/jpeg" { "jpg" } else { "png" }
                )),
                bytes,
            )
            .map_err(err)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn bookmarks(
    day: String,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::collections::Bookmark>> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.bookmarks(&day)
    })
    .await
}
#[tauri::command]
pub async fn create_bookmark(
    name: String,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<i64> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.create_bookmark(&name)
    })
    .await
}
#[tauri::command]
pub async fn assign_bookmarks(
    day: String,
    ids: Vec<i64>,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.assign_bookmarks(&day, &ids)
    })
    .await
}
#[derive(serde::Deserialize)]
pub struct CollectionSearch {
    kind: String,
    query: String,
    days: Option<u32>,
    archived: bool,
    bookmark_id: Option<i64>,
    limit: usize,
}
#[tauri::command]
pub async fn collection_hits(
    search: CollectionSearch,
    library_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Hit>> {
    with_store(state.libraries.clone(), move |m| {
        m.assert_id(&library_id)?.store.collection_hits(
            &search.kind,
            &search.query,
            search.days,
            search.archived,
            search.bookmark_id,
            search.limit,
        )
    })
    .await
}
