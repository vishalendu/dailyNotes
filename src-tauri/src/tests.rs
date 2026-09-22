use crate::{library::Libraries, storage::*};
use base64::{engine::general_purpose::STANDARD, Engine};

fn note(day: &str, body: &str) -> Note {
    Note {
        content: None,
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
        .execute_batch("DROP TABLE page_bookmarks; DROP TABLE bookmarks; ALTER TABLE notes DROP COLUMN content_blob; ALTER TABLE notes DROP COLUMN content_version; PRAGMA user_version=1;")
        .unwrap();
    drop(db);
    let db = Store::open(&path, false).unwrap();
    assert_eq!(db.note(&day).unwrap().body, "No remaining tasks");
    assert!(db.bookmarks(&day).unwrap().is_empty());
    assert_eq!(
        db.conn
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
}

#[test]
fn rich_document_storage_and_migration() {
    use serde_json::{json, Value};
    register_vectors();
    let fixture: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/rich-document.json")).unwrap();
    let doc = fixture["content"].clone();
    let (body, attachments) = crate::document::project(&doc).unwrap();
    assert_eq!(body, fixture["body"].as_str().unwrap());
    assert_eq!(
        serde_json::to_value(&attachments).unwrap(),
        fixture["attachments"]
    );
    let compressed = crate::document::encode(&doc).unwrap();
    assert_eq!(crate::document::decode(&compressed, 1).unwrap(), doc);
    assert!(compressed.len() < serde_json::to_vec(&doc).unwrap().len());
    assert!(crate::document::decode(&compressed, 99).is_err());
    assert!(crate::document::decode(b"bad gzip", 1).is_err());
    let mut unsafe_doc = doc.clone();
    unsafe_doc["content"][1]["content"][2]["marks"][0]["attrs"]["href"] =
        json!("javascript:alert(1)");
    assert!(crate::document::project(&unsafe_doc).is_err());
    unsafe_doc = doc.clone();
    unsafe_doc["content"][4]["content"][1]["attrs"]["src"] = json!("https://tracker.example/image");
    assert!(crate::document::project(&unsafe_doc).is_err());
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rich.sqlite");
    let mut db = Store::open(&path, true).unwrap();
    let day = chrono::Local::now().date_naive().to_string();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    assert_eq!(
        db.add_image(&STANDARD.encode(png.into_inner())).unwrap().id,
        1
    );
    let mut rich = note(&day, &body);
    rich.content = Some(doc.clone());
    rich.attachments = attachments;
    let saved = db.save(&rich).unwrap();
    assert_eq!(saved.content, Some(doc.clone()));
    db.conn.execute("DELETE FROM pending", []).unwrap();
    let vector = vec![0_u8; 1536];
    db.conn.execute("INSERT INTO chunks(note_id,revision,offset,text,vector) SELECT id,revision,0,body,?1 FROM notes",[vector]).unwrap();
    let mut formatted = saved.clone();
    formatted.content.as_mut().unwrap()["content"][0]["attrs"]["level"] = json!(3);
    formatted.content.as_mut().unwrap()["content"][0]["attrs"]["lineHeight"] = json!(1.2);
    formatted.content.as_mut().unwrap()["content"][0]["content"][0]["marks"] =
        json!([{"type":"textStyle","attrs":{"fontFamily":"Missing Font", "fontSize":"18px"}}]);
    let styled = formatted.content.as_ref().unwrap();
    let encoded = crate::document::encode(styled).unwrap();
    assert!(crate::document::decode(&encoded, 1).is_err());
    assert_eq!(crate::document::decode(&encoded, 2).unwrap(), *styled);
    let mut bad = styled.clone();
    bad["content"][0]["content"][0]["marks"][0]["attrs"]["fontFamily"] = json!("Arial; color:red");
    assert!(crate::document::project(&bad).is_err());
    bad = styled.clone();
    bad["content"][0]["attrs"]["lineHeight"] = json!(100);
    assert!(crate::document::project(&bad).is_err());
    let updated = db.save(&formatted).unwrap();
    assert_eq!(
        db.conn
            .query_row("SELECT count(*) FROM pending", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.conn
            .query_row("SELECT revision FROM chunks", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        updated.revision
    );
    assert!(db.save(&saved).is_err());
    assert_eq!(
        db.collection_hits("todos", "First", Some(7), false, None, 101)
            .unwrap()
            .len(),
        1
    );
    let backup = dir.path().join("backup.sqlite");
    db.backup(&backup).unwrap();
    assert_eq!(
        Store::open(&backup, false)
            .unwrap()
            .note(&day)
            .unwrap()
            .content,
        updated.content
    );
    drop(db);
    let db = Store::open(&path, false).unwrap();
    assert_eq!(db.note(&day).unwrap().content, updated.content);
    db.conn.pragma_update(None, "user_version", 3).unwrap();
    drop(db);
    let db = Store::open(&path, false).unwrap();
    assert_eq!(db.note(&day).unwrap().content, updated.content);
    let pre_v4 = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|f| f.ok())
        .find(|f| {
            f.file_name().to_string_lossy().contains("pre-v4")
                && f.path().extension().is_some_and(|e| e == "sqlite")
        })
        .unwrap();
    let backup_conn = rusqlite::Connection::open(pre_v4.path()).unwrap();
    assert_eq!(
        backup_conn
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    // A shipped v2 library has no structured columns. Legacy text/images stay unchanged.
    db.conn.execute_batch("ALTER TABLE notes DROP COLUMN content_blob; ALTER TABLE notes DROP COLUMN content_version; PRAGMA user_version=2;").unwrap();
    drop(db);
    let db = Store::open(&path, false).unwrap();
    let legacy = db.note(&day).unwrap();
    assert_eq!(legacy.body, body);
    assert_eq!(legacy.attachments, rich.attachments);
    assert!(legacy.content.is_none());
    assert!(std::fs::read_dir(dir.path()).unwrap().any(|f| f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("pre-v3")));
}

#[test]
fn installed_font_discovery() {
    let fonts = tauri::async_runtime::block_on(crate::commands::installed_fonts()).unwrap();
    assert!(
        !fonts.is_empty(),
        "Expected installed fonts on the test machine"
    );
    assert!(fonts
        .windows(2)
        .all(|pair| pair[0].to_lowercase() <= pair[1].to_lowercase()));
}
