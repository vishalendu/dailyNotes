use crate::{library::Libraries, storage::*};
use base64::{engine::general_purpose::STANDARD, Engine};

fn note(day: &str, body: &str) -> Note {
    Note {
        day: day.into(),
        body: body.into(),
        revision: 0,
        archived: false,
        attachments: vec![],
        updated_at: String::new(),
    }
}
fn search(query: &str, archived: bool) -> Search {
    Search {
        query: query.into(),
        archived,
        days: None,
        mode: "keywords".into(),
        newest: false,
        limit: 21,
    }
}

#[test]
fn existing_note_navigation() {
    register_vectors();
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(&dir.path().join("notes.sqlite"), true).unwrap();
    assert_eq!(db.neighbors("2026-09-18", false).unwrap(), (None, None));
    db.save(&note("2026-09-18", "First note")).unwrap();
    db.save(&note("2026-09-17", "")).unwrap();
    assert_eq!(db.neighbors("2026-09-18", false).unwrap(), (None, None));
    db.save(&note("2026-09-12", "Earlier note")).unwrap();
    assert_eq!(
        db.neighbors("2026-09-18", false).unwrap(),
        (Some("2026-09-12".into()), None)
    );
    assert_eq!(
        db.neighbors("2026-09-12", false).unwrap(),
        (None, Some("2026-09-18".into()))
    );
    db.conn
        .execute("UPDATE notes SET is_archived=1 WHERE day='2026-09-12'", [])
        .unwrap();
    assert_eq!(db.neighbors("2026-09-18", false).unwrap(), (None, None));
    assert_eq!(
        db.neighbors("2026-09-18", true).unwrap(),
        (Some("2026-09-12".into()), None)
    );
}

#[test]
fn storage_smoke() {
    register_vectors();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.sqlite");
    let mut db = Store::open(&path, true).unwrap();
    let today = chrono::Local::now().date_naive().to_string();
    let saved = db
        .save(&note(&today, "Container deployment failed 👋"))
        .unwrap();
    assert_eq!(saved.revision, 1);
    assert!(db.save(&note(&today, "stale overwrite")).is_err());
    let mut edited = saved;
    edited.body = "Fixed container deployment".into();
    db.save(&edited).unwrap();
    assert!(db
        .search(&search("failed", false), None)
        .unwrap()
        .is_empty());
    assert_eq!(
        db.search(&search("deployment", false), None).unwrap().len(),
        1
    );
    for query in ["\"", "' OR 1=1 --", "a:b", "deploy*", ""] {
        db.search(&search(query, false), None).unwrap();
    }
    let older = (chrono::Local::now().date_naive() - chrono::Duration::days(91)).to_string();
    db.save(&note(&older, "Deployment timeout last quarter"))
        .unwrap();
    assert_eq!(db.archive(90, true).unwrap(), 1);
    assert_eq!(db.archive(90, false).unwrap(), 1);
    assert_eq!(
        db.search(&search("deployment", false), None).unwrap().len(),
        1
    );
    assert_eq!(
        db.search(&search("deployment", true), None).unwrap().len(),
        1
    );
    let mut recent = search("deployment", false);
    recent.days = Some(1);
    assert_eq!(db.search(&recent, None).unwrap()[0].day, today);
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let image = db.add_image(&STANDARD.encode(png.get_ref())).unwrap();
    assert_eq!(
        db.add_image(&STANDARD.encode(png.get_ref())).unwrap().id,
        image.id
    );
    let mut current = db.note(&today).unwrap();
    current.body = "👋 \u{fffc}".into();
    current.attachments = vec![Attachment {
        offset: 3,
        id: image.id,
    }];
    db.save(&current).unwrap();
    let mut invalid = db.note(&today).unwrap();
    invalid.attachments[0].offset = 2;
    assert!(db.save(&invalid).is_err());
    let backup = dir.path().join("backup.sqlite");
    db.backup(&backup).unwrap();
    drop(db);
    let restored = Store::open(&backup, false).unwrap();
    assert_eq!(restored.note(&today).unwrap().attachments[0].id, image.id);
    assert_eq!(restored.image(image.id).unwrap().width, 2);
    restored.restore(&older).unwrap();
    assert_eq!(
        restored
            .search(&search("deployment", false), None)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn vector_scope_and_library_move_smoke() {
    register_vectors();
    let temp = tempfile::tempdir().unwrap();
    let mut manager = Libraries::new(temp.path().join("app")).unwrap();
    let path = temp.path().join("original.sqlite");
    manager.switch(path.clone(), true).unwrap();
    let id = manager.active().unwrap().store.id().unwrap();
    {
        let db = &mut manager.active().unwrap().store;
        db.save(&note("2020-01-01", "Old release failure")).unwrap();
        db.save(&note("2026-09-18", "New release failure")).unwrap();
        let mut vector = vec![0f32; 384];
        vector[0] = 1.;
        let bytes: Vec<_> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
        db.conn.execute("INSERT INTO chunks(note_id,revision,offset,text,vector) SELECT id,revision,0,body,?1 FROM notes",[bytes]).unwrap();
        db.conn
            .execute("UPDATE notes SET is_archived=1 WHERE day='2020-01-01'", [])
            .unwrap();
        let mut options = search("release", false);
        options.mode = "meaning".into();
        assert_eq!(
            db.search(&options, Some(&vector)).unwrap()[0].day,
            "2026-09-18"
        );
        options.archived = true;
        assert_eq!(
            db.search(&options, Some(&vector)).unwrap()[0].day,
            "2020-01-01"
        );
    }
    manager.move_to(temp.path().join("moved")).unwrap();
    assert_eq!(manager.active().unwrap().store.id().unwrap(), id);
    assert!(path.exists());
    assert!(manager
        .switch(temp.path().join("missing.sqlite"), false)
        .is_err());
    assert_eq!(manager.active().unwrap().store.id().unwrap(), id);
    drop(manager);
    let restarted = Libraries::new(temp.path().join("app")).unwrap();
    assert!(restarted.info().unwrap().path.unwrap().contains("moved"));
}

#[test]
fn todos_bookmarks_and_migration() {
    register_vectors();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("collections.sqlite");
    let mut db = Store::open(&path, true).unwrap();
    let today = chrono::Local::now().date_naive();
    let day = today.to_string();
    let old = (today - chrono::Duration::days(7)).to_string();
    let boundary = (today - chrono::Duration::days(6)).to_string();
    let body = "👋 context\n#TODO Deploy service\nCall customer #todo\ntodo plain\n#todoLater ignored\nx#todo ignored\n#tödö ignored";
    let saved = db.save(&note(&day, body)).unwrap();
    db.save(&note(&boundary, "#ToDo Boundary task")).unwrap();
    db.save(&note(&old, "#todo Old task")).unwrap();
    let hits = db
        .collection_hits("todos", "", Some(7), false, None, 101)
        .unwrap();
    assert_eq!(hits.len(), 3);
    assert_eq!(hits[0].offset, "👋 context\n".encode_utf16().count());
    assert_eq!(hits[2].day, boundary);
    assert_eq!(
        db.collection_hits("todos", "DEPLOY", Some(7), false, None, 101)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        db.collection_hits("todos", "", None, false, None, 101)
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        db.collection_hits("todos", "", None, false, None, 1)
            .unwrap()
            .len(),
        1
    );
    assert!(db
        .collection_hits("todos", "", Some(0), false, None, 101)
        .is_err());
    let work = db.create_bookmark(" Work ").unwrap();
    assert_eq!(work, db.create_bookmark("work").unwrap());
    let project = db.create_bookmark("Project Alpha").unwrap();
    assert!(db.create_bookmark("  ").is_err());
    db.assign_bookmarks(&day, &[work, project]).unwrap();
    db.assign_bookmarks(&old, &[work]).unwrap();
    assert_eq!(
        db.bookmarks(&day)
            .unwrap()
            .iter()
            .filter(|b| b.assigned)
            .count(),
        2
    );
    assert_eq!(
        db.collection_hits("bookmarks", "", None, false, None, 101)
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        db.collection_hits("bookmarks", "", Some(7), false, Some(work), 101)
            .unwrap()
            .len(),
        1
    );
    assert!(db.assign_bookmarks(&day, &[999999]).is_err());
    assert_eq!(
        db.bookmarks(&day)
            .unwrap()
            .iter()
            .filter(|b| b.assigned)
            .count(),
        2
    );
    db.conn
        .execute("UPDATE notes SET is_archived=1 WHERE day=?1", [&old])
        .unwrap();
    assert_eq!(
        db.collection_hits("bookmarks", "", None, true, Some(work), 101)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        db.collection_hits("todos", "", None, true, None, 101)
            .unwrap()
            .len(),
        1
    );
    db.assign_bookmarks(&day, &[project]).unwrap();
    assert_eq!(
        db.bookmarks(&day)
            .unwrap()
            .iter()
            .filter(|b| b.assigned)
            .count(),
        1
    );
    let empty = (today - chrono::Duration::days(2)).to_string();
    db.assign_bookmarks(&empty, &[project]).unwrap();
    assert!(db
        .collection_hits("bookmarks", "", None, false, Some(project), 101)
        .unwrap()
        .iter()
        .any(|h| h.day == empty));
    let backup = dir.path().join("backup.sqlite");
    db.backup(&backup).unwrap();
    assert_eq!(
        Store::open(&backup, false)
            .unwrap()
            .bookmarks(&day)
            .unwrap()
            .iter()
            .filter(|b| b.assigned)
            .count(),
        1
    );
    let mut edited = saved;
    edited.body = "No remaining tasks".into();
    db.save(&edited).unwrap();
    assert!(db
        .collection_hits("todos", "", Some(1), false, None, 101)
        .unwrap()
        .is_empty());
    drop(db);
    let db = Store::open(&path, false).unwrap();
    assert_eq!(db.bookmarks(&day).unwrap().len(), 2);
    // Simulate the previous shipped schema and verify existing notes survive upgrading.
    db.conn
        .execute_batch("DROP TABLE page_bookmarks; DROP TABLE bookmarks; PRAGMA user_version=1;")
        .unwrap();
    drop(db);
    let db = Store::open(&path, false).unwrap();
    assert_eq!(db.note(&day).unwrap().body, "No remaining tasks");
    assert!(db.bookmarks(&day).unwrap().is_empty());
    assert_eq!(
        db.conn
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
}
