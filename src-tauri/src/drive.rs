use reqwest::Client;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

const DRIVE_FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";
const BACKUP_FILE_NAME: &str = "storemanager.db";

// ── Internal helpers ──────────────────────────────────────────────────────────

async fn find_backup_id(token: &str) -> Result<Option<String>, String> {
    let client = Client::new();
    let resp: serde_json::Value = client
        .get(DRIVE_FILES_URL)
        .bearer_auth(token)
        .query(&[
            ("q", format!("name='{}' and trashed=false", BACKUP_FILE_NAME).as_str()),
            ("spaces", "appDataFolder"),
            ("fields", "files(id)"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(resp["files"]
        .as_array()
        .and_then(|f| f.first())
        .and_then(|f| f["id"].as_str())
        .map(|s| s.to_string()))
}

pub async fn upload_binary(token: &str, data: Vec<u8>) -> Result<(), String> {
    let client = Client::new();

    match find_backup_id(token).await? {
        Some(file_id) => {
            // PATCH existing file with new content
            client
                .patch(format!("{}/{}?uploadType=media", DRIVE_UPLOAD_URL, file_id))
                .bearer_auth(token)
                .header("Content-Type", "application/x-sqlite3")
                .body(data)
                .send()
                .await
                .map_err(|e| e.to_string())?;
        }
        None => {
            // Create new file using multipart upload
            let meta = format!(
                r#"{{"name":"{}","parents":["appDataFolder"]}}"#,
                BACKUP_FILE_NAME
            );
            let boundary = "sm_drive_boundary_7f3a";
            let mut body: Vec<u8> = Vec::new();

            // Metadata part
            body.extend_from_slice(
                format!(
                    "--{}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n",
                    boundary, meta
                )
                .as_bytes(),
            );
            // Data part
            body.extend_from_slice(
                format!(
                    "--{}\r\nContent-Type: application/x-sqlite3\r\n\r\n",
                    boundary
                )
                .as_bytes(),
            );
            body.extend_from_slice(&data);
            body.extend_from_slice(format!("\r\n--{}--", boundary).as_bytes());

            client
                .post(format!("{}?uploadType=multipart", DRIVE_UPLOAD_URL))
                .bearer_auth(token)
                .header(
                    "Content-Type",
                    format!("multipart/related; boundary={}", boundary),
                )
                .body(body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub async fn download_binary(token: &str) -> Result<Option<Vec<u8>>, String> {
    let file_id = match find_backup_id(token).await? {
        None => return Ok(None),
        Some(id) => id,
    };
    let client = Client::new();
    let bytes = client
        .get(format!("{}/{}?alt=media", DRIVE_FILES_URL, file_id))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(bytes.to_vec()))
}

// ── CQRS command batch helpers ────────────────────────────────────────────────

/// Upload any named file to appDataFolder; returns the Drive file_id.
async fn upload_named_file(token: &str, name: &str, content_type: &str, data: Vec<u8>) -> Result<String, String> {
    let client = Client::new();
    let meta = format!(r#"{{"name":"{}","parents":["appDataFolder"]}}"#, name);
    let boundary = "sm_boundary_x9q1";
    let mut body: Vec<u8> = Vec::new();
    body.extend_from_slice(
        format!("--{}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n", boundary, meta).as_bytes(),
    );
    body.extend_from_slice(
        format!("--{}\r\nContent-Type: {}\r\n\r\n", boundary, content_type).as_bytes(),
    );
    body.extend_from_slice(&data);
    body.extend_from_slice(format!("\r\n--{}--", boundary).as_bytes());

    let resp: serde_json::Value = client
        .post(format!("{}?uploadType=multipart", DRIVE_UPLOAD_URL))
        .bearer_auth(token)
        .header("Content-Type", format!("multipart/related; boundary={}", boundary))
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    resp["id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "upload: no id in response".to_string())
}

/// Upload a command batch as a named file in appDataFolder.
pub async fn upload_command_batch(token: &str, file_name: &str, data: Vec<u8>) -> Result<(), String> {
    upload_named_file(token, file_name, "text/plain", data).await.map(|_| ())
}

/// Delete a Drive file by ID. A 404 is treated as success (already gone).
pub async fn delete_drive_file(token: &str, file_id: &str) -> Result<(), String> {
    let client = Client::new();
    let status = client
        .delete(format!("{}/{}", DRIVE_FILES_URL, file_id))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .status();
    if !status.is_success() && status.as_u16() != 404 {
        return Err(format!("delete_drive_file: HTTP {}", status));
    }
    Ok(())
}

// ── Cleanup lock ──────────────────────────────────────────────────────────────

const LOCK_FILE_NAME: &str = "cleanup.lock";
const LOCK_TIMEOUT_SECS: u64 = 300; // 5 minutes — after this the lock is considered stale

/// Try to acquire the nightly cleanup lock.
///
/// Returns `Some(file_id)` if we now hold the lock, or `None` if another device
/// holds a fresh lock (caller should retry after `LOCK_TIMEOUT_SECS`).
pub async fn try_acquire_cleanup_lock(token: &str) -> Result<Option<String>, String> {
    let client = Client::new();

    // Look for an existing lock file
    let resp: serde_json::Value = client
        .get(DRIVE_FILES_URL)
        .bearer_auth(token)
        .query(&[
            ("q", format!("name='{}' and trashed=false", LOCK_FILE_NAME).as_str()),
            ("spaces", "appDataFolder"),
            ("fields", "files(id)"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(files) = resp["files"].as_array() {
        for f in files {
            let lock_id = match f["id"].as_str() {
                Some(id) => id.to_string(),
                None => continue,
            };
            // Read the lock file to get when it was taken
            let content = download_command_file(token, &lock_id).await.unwrap_or_default();
            let locked_at: u64 = content.trim().parse().unwrap_or(0);
            let age = now_secs().saturating_sub(locked_at);
            if age < LOCK_TIMEOUT_SECS {
                // Fresh lock — another device is cleaning up right now
                return Ok(None);
            }
            // Stale lock — device that set it must have crashed; take it over
            let _ = delete_drive_file(token, &lock_id).await;
        }
    }

    // No active lock — write ours (content = unix timestamp so others can check age)
    let content = now_secs().to_string();
    let lock_id = upload_named_file(token, LOCK_FILE_NAME, "text/plain", content.into_bytes()).await?;
    Ok(Some(lock_id))
}

/// Release the cleanup lock (delete the lock file).
pub async fn release_cleanup_lock(token: &str, file_id: &str) -> Result<(), String> {
    delete_drive_file(token, file_id).await
}

/// Return Drive file_ids of cmd_* files old enough to be deleted.
///
/// Age is read from the filename itself (format: `cmd_{device_id}_{unix_ts}_{uuid}.jsonl`),
/// so no extra Drive metadata request is needed. Files using the old 3-part format
/// (before this feature) are skipped rather than deleted.
pub async fn list_stale_command_files(token: &str, min_age_secs: u64) -> Result<Vec<String>, String> {
    let now = now_secs();
    let files = list_command_files(token).await?;
    let stale = files
        .into_iter()
        .filter_map(|(name, id)| {
            // Expected: cmd_{device_uuid}_{unix_ts}_{batch_uuid}.jsonl
            // UUIDs contain hyphens but no underscores, so split('_') → 4 parts
            let stem = name.strip_suffix(".jsonl")?;
            let parts: Vec<&str> = stem.split('_').collect();
            if parts.len() != 4 { return None; } // old-format file — skip
            let file_ts: u64 = parts[2].parse().ok()?;
            let age = now.saturating_sub(file_ts);
            if age >= min_age_secs { Some(id) } else { None }
        })
        .collect();
    Ok(stale)
}

/// List all cmd_*.jsonl files in appDataFolder. Returns Vec<(file_name, file_id)>
pub async fn list_command_files(token: &str) -> Result<Vec<(String, String)>, String> {
    let client = Client::new();
    let resp: serde_json::Value = client
        .get(DRIVE_FILES_URL)
        .bearer_auth(token)
        .query(&[
            ("q", "name contains 'cmd_' and trashed=false"),
            ("spaces", "appDataFolder"),
            ("fields", "files(id,name)"),
            ("pageSize", "1000"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(resp["files"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|f| {
            let name = f["name"].as_str()?.to_string();
            let id = f["id"].as_str()?.to_string();
            Some((name, id))
        })
        .collect())
}

/// Download a command batch file by Drive file ID, return as String
pub async fn download_command_file(token: &str, file_id: &str) -> Result<String, String> {
    let client = Client::new();
    let text = client
        .get(format!("{}/{}?alt=media", DRIVE_FILES_URL, file_id))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(text)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Push: snapshot the local DB with VACUUM INTO, upload to Drive appDataFolder.
#[tauri::command]
pub async fn drive_push(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let session = crate::auth::load_session(&app_data).ok_or("Not logged in")?;
    let session = crate::auth::ensure_valid_token(&app_data, session).await?;

    // Snapshot under lock (fast — WAL checkpoint + copy)
    let temp_path = app_data.join("store_push_snap.db");
    {
        let db = state.db.lock().await;
        let temp_str = temp_path.to_str().ok_or("invalid path")?;
        db.execute_batch(&format!("VACUUM INTO '{}'", temp_str))
            .map_err(|e| format!("Snapshot failed: {}", e))?;
    }

    // Upload without holding the DB lock
    let data = std::fs::read(&temp_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&temp_path);
    upload_binary(&session.access_token, data).await
}

/// Pull: download DB from Drive, replace local data via ATTACH DATABASE.
#[tauri::command]
pub async fn drive_pull(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let session = crate::auth::load_session(&app_data).ok_or("Not logged in")?;
    let session = crate::auth::ensure_valid_token(&app_data, session).await?;

    // Download without holding the lock
    let data = match download_binary(&session.access_token).await? {
        None => return Ok(false), // No remote backup yet — first device setup
        Some(d) => d,
    };

    let temp_path = app_data.join("store_pull_snap.db");
    std::fs::write(&temp_path, &data).map_err(|e| e.to_string())?;

    // Replace all data under lock
    {
        let db = state.db.lock().await;
        let temp_str = temp_path.to_str().ok_or("invalid path")?;
        // Escape single quotes in path (safety)
        let safe_path = temp_str.replace('\'', "''");
        db.execute_batch(&format!(
            "ATTACH DATABASE '{}' AS remote;
             DELETE FROM products;
             DELETE FROM employees;
             DELETE FROM suppliers;
             INSERT INTO products SELECT * FROM remote.products;
             INSERT INTO employees SELECT * FROM remote.employees;
             INSERT INTO suppliers SELECT * FROM remote.suppliers;
             DETACH DATABASE remote;",
            safe_path
        ))
        .map_err(|e| format!("Restore failed: {}", e))?;
    }

    let _ = std::fs::remove_file(&temp_path);
    Ok(true)
}
