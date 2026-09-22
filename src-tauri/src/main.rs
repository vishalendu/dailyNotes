#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod collections;
mod commands;
mod document;
mod embeddings;
mod hotkey;
mod images;
mod library;
mod storage;
#[cfg(test)]
mod tests;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub struct AppState {
    pub libraries: Arc<Mutex<library::Libraries>>,
    pub embeddings: embeddings::Embeddings,
}

fn main() {
    storage::register_vectors();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let libraries = Arc::new(Mutex::new(
                library::Libraries::new(data_dir.clone()).map_err(std::io::Error::other)?,
            ));
            let embeddings = embeddings::Embeddings::start(
                data_dir.join("Models"),
                libraries.clone(),
                app.handle().clone(),
            );
            app.manage(AppState {
                libraries,
                embeddings,
            });
            hotkey::setup(app.handle());
            let menu = tauri::menu::Menu::with_items(
                app,
                &[
                    &tauri::menu::MenuItem::with_id(
                        app,
                        "open",
                        "Open Daily Notes",
                        true,
                        None::<&str>,
                    )?,
                    &tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
                ],
            )?;
            let mut tray = tauri::tray::TrayIconBuilder::new()
                .tooltip("Daily Notes")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        if event.id.as_ref() == "quit" {
                            let _ = w.emit("request-quit", ());
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            if tray.build(app).is_err() {
                let _ = app
                    .state::<AppState>()
                    .libraries
                    .lock()
                    .unwrap()
                    .background(false);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hotkey::hotkey_status,
            hotkey::set_hotkey,
            hotkey::hide_window,
            commands::library_info,
            commands::clipboard_text,
            commands::installed_fonts,
            commands::choose_library,
            commands::get_note,
            commands::bookmarks,
            commands::create_bookmark,
            commands::assign_bookmarks,
            commands::collection_hits,
            commands::note_neighbors,
            commands::save_note,
            commands::search_notes,
            commands::add_image,
            commands::get_image,
            commands::library_stats,
            commands::archive_notes,
            commands::restore_note,
            commands::backup_library,
            commands::move_library,
            commands::set_background,
            commands::model_status,
            commands::model_action,
            commands::finish_close,
            commands::export_note
        ])
        .build(tauri::generate_context!())
        .expect("Could not start Daily Notes")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested {
                api, code: None, ..
            } = event
            {
                api.prevent_exit();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit("request-quit", ());
                }
            }
        });
}
