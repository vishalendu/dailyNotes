use crate::storage::{err, Result, Store};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct Preferences {
    pub library: Option<PathBuf>,
    #[serde(default)]
    pub background: bool,
    #[serde(default)]
    pub shortcut: Option<String>,
}
pub struct Library {
    pub store: Store,
    pub path: PathBuf,
    pub _lock: File,
}
pub struct Libraries {
    pub current: Option<Library>,
    pub data_dir: PathBuf,
    pub preferences: Preferences,
    pub startup_error: Option<String>,
}
#[derive(Serialize)]
pub struct LibraryInfo {
    pub path: Option<String>,
    pub id: Option<String>,
    pub error: Option<String>,
    pub background: bool,
    pub default_folder: String,
    pub archive_days: u32,
}

impl Libraries {
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&data_dir).map_err(err)?;
        let pref_path = data_dir.join("settings.json");
        let (preferences, startup_error) = if pref_path.exists() {
            match fs::read(&pref_path)
                .map_err(err)
                .and_then(|b| serde_json::from_slice(&b).map_err(err))
            {
                Ok(p) => (p, None),
                Err(e) => (
                    Preferences::default(),
                    Some(format!("Settings could not be read: {e}")),
                ),
            }
        } else {
            (Preferences::default(), None)
        };
        let mut manager = Self {
            current: None,
            data_dir,
            preferences,
            startup_error,
        };
        if let Some(path) = manager.preferences.library.clone() {
            match Self::load(&path, false) {
                Ok(lib) => manager.current = Some(lib),
                Err(e) => manager.startup_error = Some(e),
            }
        }
        Ok(manager)
    }
    fn load(path: &Path, create: bool) -> Result<Library> {
        if let Some(parent) = path.parent() {
            if create {
                fs::create_dir_all(parent).map_err(err)?;
            }
        }
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path.with_extension("sqlite.lock"))
            .map_err(err)?;
        lock.try_lock_exclusive().map_err(|_| {
            "This library is already open in another application instance.".to_string()
        })?;
        let store = Store::open(path, create)?;
        Ok(Library {
            store,
            path: path.into(),
            _lock: lock,
        })
    }
    fn persist(&self, prefs: &Preferences) -> Result<()> {
        let temp = self.data_dir.join("settings.json.tmp");
        fs::write(&temp, serde_json::to_vec_pretty(prefs).map_err(err)?).map_err(err)?;
        File::open(&temp).and_then(|f| f.sync_all()).map_err(err)?;
        fs::rename(temp, self.data_dir.join("settings.json")).map_err(err)
    }
    pub fn info(&self) -> Result<LibraryInfo> {
        let archive_days = self
            .current
            .as_ref()
            .and_then(|l| {
                l.store
                    .conn
                    .query_row(
                        "SELECT value FROM settings WHERE key='archive_days'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
            })
            .and_then(|s| s.parse().ok())
            .unwrap_or(90);
        Ok(LibraryInfo {
            path: self.current.as_ref().map(|l| l.path.display().to_string()),
            id: self.current.as_ref().map(|l| l.store.id()).transpose()?,
            error: self.startup_error.clone(),
            background: self.preferences.background,
            default_folder: self.data_dir.join("Library").display().to_string(),
            archive_days,
        })
    }
    pub fn switch(&mut self, path: PathBuf, create: bool) -> Result<LibraryInfo> {
        if create && path.exists() {
            return Err("A library already exists here. Use Open existing library.".into());
        }
        if self.current.as_ref().is_some_and(|l| l.path == path) {
            return self.info();
        }
        let lib = Self::load(&path, create)?;
        let mut preferences = self.preferences.clone();
        preferences.library = Some(path);
        self.persist(&preferences)?;
        self.preferences = preferences;
        self.current = Some(lib);
        self.startup_error = None;
        self.info()
    }
    pub fn active(&mut self) -> Result<&mut Library> {
        self.current.as_mut().ok_or("Choose a library first".into())
    }
    pub fn assert_id(&mut self, id: &str) -> Result<&mut Library> {
        let l = self.active()?;
        if l.store.id()? != id {
            return Err("Library changed. Operation cancelled.".into());
        }
        Ok(l)
    }
    pub fn move_to(&mut self, folder: PathBuf) -> Result<LibraryInfo> {
        fs::create_dir_all(&folder).map_err(err)?;
        let dest = folder.join("DailyNotes.sqlite");
        if dest.exists() {
            return Err("Destination already contains a library.".into());
        }
        let temp = folder.join(format!(".daily-notes-{}.sqlite", uuid::Uuid::new_v4()));
        self.active()?.store.backup(&temp)?;
        fs::rename(&temp, &dest).map_err(err)?;
        self.switch(dest, false)
    }
    pub fn background(&mut self, enabled: bool) -> Result<()> {
        let mut p = self.preferences.clone();
        p.background = enabled;
        self.persist(&p)?;
        self.preferences = p;
        Ok(())
    }
    pub fn shortcut(&mut self, value: String) -> Result<()> {
        let mut p = self.preferences.clone();
        p.shortcut = Some(value);
        self.persist(&p)?;
        self.preferences = p;
        Ok(())
    }
}
