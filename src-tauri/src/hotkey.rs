use crate::{
    storage::{err, Result},
    AppState,
};
use serde::Serialize;
use std::{
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const DEFAULT: &str = "Control+Alt+Space";
#[derive(Clone, Serialize)]
pub struct Status {
    pub shortcut: String,
    pub registered: bool,
    pub error: Option<String>,
}
pub struct Hotkey {
    status: Mutex<Status>,
    available: bool,
}

fn parse(value: &str) -> Result<Option<Shortcut>> {
    if value.is_empty() {
        return Ok(None);
    }
    let shortcut = Shortcut::from_str(value).map_err(err)?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(
            "Include Control, Alt, or Super with the key (for example Control+Alt+Space).".into(),
        );
    }
    Ok(Some(shortcut))
}
pub fn setup(app: &tauri::AppHandle) {
    let shortcut = app
        .state::<AppState>()
        .libraries
        .lock()
        .unwrap()
        .preferences
        .shortcut
        .clone()
        .unwrap_or_else(|| DEFAULT.into());
    let pressed = AtomicBool::new(false);
    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, _, event| {
            if event.state() == ShortcutState::Released {
                pressed.store(false, Ordering::Relaxed);
                return;
            }
            if pressed.swap(true, Ordering::Relaxed) {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                if window.is_focused().unwrap_or(false) {
                    let _ = window.emit("request-hide", ());
                } else {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("focus-editor", ());
                }
            }
        })
        .build();
    let init = app.plugin(plugin).map_err(err);
    let available = init.is_ok();
    let result = init.and_then(|_| {
        if let Some(key) = parse(&shortcut)? {
            app.global_shortcut().register(key).map_err(err)?;
        }
        Ok(())
    });
    app.manage(Hotkey {
        available,
        status: Mutex::new(Status {
            registered: result.is_ok() && !shortcut.is_empty(),
            shortcut,
            error: result.err(),
        }),
    });
}
#[tauri::command]
pub async fn hotkey_status(state: tauri::State<'_, Hotkey>) -> Result<Status> {
    Ok(state.status.lock().map_err(err)?.clone())
}
#[tauri::command]
pub async fn set_hotkey(shortcut: String, app: tauri::AppHandle) -> Result<Status> {
    // Plugin registration dispatches to the main thread; keep this command asynchronous.
    let state = app.state::<Hotkey>();
    let mut status = state.status.lock().map_err(err)?;
    if !state.available {
        return Err(status
            .error
            .clone()
            .unwrap_or_else(|| "Global shortcuts are unavailable on this desktop.".into()));
    }
    let value = shortcut.trim();
    let new = parse(value)?;
    let old = if status.registered {
        parse(&status.shortcut)?
    } else {
        None
    };
    if new != old {
        if let Some(key) = new {
            app.global_shortcut().register(key).map_err(|e| {
                format!("Could not register shortcut: {e}. Try another combination.")
            })?;
        }
    }
    let saved = app
        .state::<AppState>()
        .libraries
        .lock()
        .map_err(err)?
        .shortcut(value.into());
    if let Err(e) = saved {
        if new != old {
            if let Some(key) = new {
                let _ = app.global_shortcut().unregister(key);
            }
        }
        return Err(e);
    }
    if new != old {
        if let Some(key) = old {
            if let Err(e) = app.global_shortcut().unregister(key) {
                if let Some(key) = new {
                    let _ = app.global_shortcut().unregister(key);
                }
                let _ = app
                    .state::<AppState>()
                    .libraries
                    .lock()
                    .map_err(err)?
                    .shortcut(status.shortcut.clone());
                return Err(err(e));
            }
        }
    }
    *status = Status {
        shortcut: value.into(),
        registered: new.is_some(),
        error: None,
    };
    Ok(status.clone())
}
#[tauri::command]
pub fn hide_window(app: tauri::AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(err)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcut_validation() {
        assert!(parse(DEFAULT).unwrap().is_some());
        assert!(parse("").unwrap().is_none());
        assert!(parse("A").is_err());
        assert!(parse("Shift+A").is_err());
        assert!(parse("Control+Alt+DefinitelyNotAKey").is_err());
        assert_eq!(parse("Ctrl+Alt+Space").unwrap(), parse(DEFAULT).unwrap());
    }
}
