use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

use reqwest::Client;
use serde::{Deserialize, Serialize};

const SCOPES: &str = "https://www.googleapis.com/auth/drive.appdata email profile";

// ── Helpers ───────────────────────────────────────────────────────────────────

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ── OAuth Credentials (stored in app data, entered once via setup screen) ─────

#[derive(Debug, Serialize, Deserialize)]
struct Credentials {
    client_id: String,
    client_secret: String,
}

fn credentials_path(app_data: &Path) -> std::path::PathBuf {
    app_data.join("oauth_credentials.json")
}

fn load_credentials(app_data: &Path) -> Result<Credentials, String> {
    let text = std::fs::read_to_string(credentials_path(app_data))
        .map_err(|_| "not_configured".to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

// ── Session ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub email: String,
    pub name: String,
    pub picture: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

fn session_path(app_data: &Path) -> std::path::PathBuf {
    app_data.join("session.json")
}

pub fn load_session(app_data: &Path) -> Option<Session> {
    let text = std::fs::read_to_string(session_path(app_data)).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_session(app_data: &Path, s: &Session) -> Result<(), String> {
    let text = serde_json::to_string(s).map_err(|e| e.to_string())?;
    std::fs::write(session_path(app_data), text).map_err(|e| e.to_string())
}

pub fn clear_session(app_data: &Path) {
    let _ = std::fs::remove_file(session_path(app_data));
}

// ── Token management ──────────────────────────────────────────────────────────

pub async fn ensure_valid_token(app_data: &Path, session: Session) -> Result<Session, String> {
    if session.expires_at > now_secs() + 60 {
        return Ok(session);
    }
    let creds = load_credentials(app_data)?;
    let client = Client::new();
    let resp: serde_json::Value = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", creds.client_id.as_str()),
            ("client_secret", creds.client_secret.as_str()),
            ("refresh_token", session.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = resp["error"].as_str() {
        return Err(format!(
            "Token refresh failed: {} — {}",
            err,
            resp["error_description"].as_str().unwrap_or("")
        ));
    }

    let access_token = resp["access_token"]
        .as_str()
        .ok_or("no access_token")?
        .to_string();
    let expires_in = resp["expires_in"].as_u64().unwrap_or(3600);
    let updated = Session {
        access_token,
        expires_at: now_secs() + expires_in,
        ..session
    };
    save_session(app_data, &updated)?;
    Ok(updated)
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

pub async fn do_oauth_flow(app_data: &Path) -> Result<Session, String> {
    let creds = load_credentials(app_data)?;

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    let state_token = uuid::Uuid::new_v4().to_string();
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?response_type=code\
         &client_id={}\
         &redirect_uri={}\
         &scope={}\
         &state={}\
         &access_type=offline\
         &prompt=consent",
        url_encode(&creds.client_id),
        url_encode(&redirect_uri),
        url_encode(SCOPES),
        state_token,
    );

    open::that(&auth_url).map_err(|e| format!("Could not open browser: {}", e))?;

    let code = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;

        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
        let request = String::from_utf8_lossy(&buf[..n]);

        let body = b"<html><body style='font-family:system-ui;text-align:center;padding-top:80px'>\
            <h2 style='color:#16a34a'>&#10003; Signed in!</h2>\
            <p>You can close this tab and return to Store Manager.</p></body></html>";
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .as_bytes(),
        );
        let _ = stream.write_all(body);

        let line = request.lines().next().unwrap_or("");
        let query = line
            .split('?')
            .nth(1)
            .unwrap_or("")
            .split(' ')
            .next()
            .unwrap_or("");
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            if kv.next() == Some("code") {
                return Ok(kv.next().unwrap_or("").to_string());
            }
        }
        Err("Authorization code not found in callback".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let client = Client::new();
    let token_resp: serde_json::Value = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code.as_str()),
            ("client_id", creds.client_id.as_str()),
            ("client_secret", creds.client_secret.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = token_resp["error"].as_str() {
        return Err(format!(
            "Token exchange failed: {} — {}",
            err,
            token_resp["error_description"].as_str().unwrap_or("")
        ));
    }

    let access_token = token_resp["access_token"]
        .as_str()
        .ok_or("no access_token")?
        .to_string();
    let refresh_token = token_resp["refresh_token"]
        .as_str()
        .ok_or("no refresh_token — ensure offline access is enabled")?
        .to_string();
    let expires_in = token_resp["expires_in"].as_u64().unwrap_or(3600);

    let user_resp: serde_json::Value = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let session = Session {
        email: user_resp["email"].as_str().unwrap_or("").to_string(),
        name: user_resp["name"].as_str().unwrap_or("").to_string(),
        picture: user_resp["picture"].as_str().unwrap_or("").to_string(),
        access_token,
        refresh_token,
        expires_at: now_secs() + expires_in,
    };

    save_session(app_data, &session)?;
    Ok(session)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Check whether OAuth credentials have been configured (setup screen complete).
#[tauri::command]
pub async fn check_credentials(app: tauri::AppHandle) -> Result<bool, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(load_credentials(&app_data).is_ok())
}

/// Save OAuth credentials entered by the user on the setup screen.
#[tauri::command]
pub async fn save_credentials(
    app: tauri::AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let creds = Credentials { client_id, client_secret };
    let text = serde_json::to_string(&creds).map_err(|e| e.to_string())?;
    std::fs::write(credentials_path(&app_data), text).map_err(|e| e.to_string())
}

/// Start the Google OAuth flow — opens the browser, waits for callback.
#[tauri::command]
pub async fn start_oauth(app: tauri::AppHandle) -> Result<Session, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    do_oauth_flow(&app_data).await
}

/// Return the cached session (refreshing the token if needed), or null if not logged in.
#[tauri::command]
pub async fn get_session(app: tauri::AppHandle) -> Result<Option<Session>, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    match load_session(&app_data) {
        None => Ok(None),
        Some(s) => Ok(Some(ensure_valid_token(&app_data, s).await?)),
    }
}

/// Clear the local session (log out).
#[tauri::command]
pub async fn sign_out(app: tauri::AppHandle) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    clear_session(&app_data);
    Ok(())
}
