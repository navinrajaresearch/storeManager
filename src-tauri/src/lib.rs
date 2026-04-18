mod auth;
mod drive;

use std::sync::Arc;
use std::io::{BufRead, BufReader, Write};
use base64::{engine::general_purpose, Engine as _};
use serde_json::json;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Domain ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Product {
    pub id: String,
    pub brand: String,
    #[serde(rename = "sourceLanguage")]
    pub source_language: String,
    pub name: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(rename = "supplierId", default = "default_empty_supplier")]
    pub supplier_id: String,
    #[serde(rename = "manufactureDate")]
    pub manufacture_date: String,
    #[serde(rename = "expiryDate")]
    pub expiry_date: String,
    /// JSON-encoded Vec<String> of original image file names (max 2)
    #[serde(rename = "imageLocation")]
    pub image_location: Vec<String>,
    pub quantity: i32,
    #[serde(rename = "soldQuantity")]
    pub sold_quantity: i32,
    #[serde(rename = "buyPrice")]
    pub buy_price: f64,
    #[serde(rename = "sellPrice")]
    pub sell_price: f64,
    /// JSON-encoded Vec<String> of data-URL blobs for display (max 2)
    pub images: Vec<String>,
    #[serde(rename = "salesHistory", default)]
    pub sales_history: String,
}

fn default_category() -> String { "Food & Beverage".to_string() }
fn default_empty_supplier() -> String { String::new() }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Supplier {
    pub id: String,
    pub name: String,
    pub phone: String,
}
fn default_salary_type() -> String { "monthly".to_string() }
fn default_empty_string() -> String { String::new() }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Employee {
    pub id: String,
    pub name: String,
    pub photo: String,
    pub salary: f64,
    #[serde(rename = "salaryType", default = "default_salary_type")]
    pub salary_type: String,
    pub dob: String,
    #[serde(rename = "joiningDate")]
    pub joining_date: String,
    #[serde(rename = "mobileNumber")]
    pub mobile_number: String,
    #[serde(rename = "checkInDays")]
    pub check_in_days: i32,
    #[serde(rename = "lastCheckIn")]
    pub last_check_in: String,
    #[serde(rename = "checkInHistory", default = "default_empty_string")]
    pub check_in_history: String,
    #[serde(rename = "salaryHistory", default = "default_empty_string")]
    pub salary_history: String,
}

// ── PaddleOCR daemon ──────────────────────────────────────────────────────────

struct PaddleDaemon {
    stdin:  std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

impl PaddleDaemon {
    fn ocr(&mut self, img_path: &str) -> Result<String, String> {
        writeln!(self.stdin, "{}", img_path).map_err(|e| e.to_string())?;
        self.stdin.flush().map_err(|e| e.to_string())?;
        let mut lines: Vec<String> = Vec::new();
        let mut collecting = false;
        loop {
            let mut line = String::new();
            self.stdout.read_line(&mut line).map_err(|e| e.to_string())?;
            let trimmed = line.trim_end_matches('\n').trim_end_matches('\r');
            if trimmed == "RESULT_START" {
                collecting = true;
            } else if trimmed == "RESULT_END" {
                break;
            } else if let Some(msg) = trimmed.strip_prefix("RESULT_ERROR ") {
                return Err(msg.to_string());
            } else if collecting {
                lines.push(trimmed.to_string());
            }
        }
        Ok(lines.join("\n"))
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

pub struct AppState {
    pub db:        Mutex<Connection>,
    pub embedder:  Arc<Mutex<TextEmbedding>>,
    paddle:        Arc<Mutex<Option<PaddleDaemon>>>,
    pub device_id: String,
}

// ── DB init ───────────────────────────────────────────────────────────────────

fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("
        PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS products (
            id               TEXT PRIMARY KEY,
            brand            TEXT NOT NULL DEFAULT '',
            source_language  TEXT NOT NULL DEFAULT '',
            name             TEXT NOT NULL DEFAULT '',
            category         TEXT NOT NULL DEFAULT 'Food & Beverage',
            manufacture_date TEXT NOT NULL DEFAULT '',
            expiry_date      TEXT NOT NULL DEFAULT '',
            image_location   TEXT NOT NULL DEFAULT '[]',
            quantity         INTEGER NOT NULL DEFAULT 0,
            sold_quantity    INTEGER NOT NULL DEFAULT 0,
            buy_price        REAL NOT NULL DEFAULT 0.0,
            sell_price       REAL NOT NULL DEFAULT 0.0,
            images_json      TEXT NOT NULL DEFAULT '[]',
            sales_history    TEXT NOT NULL DEFAULT '',
            supplier_id      TEXT NOT NULL DEFAULT '',
            embedding        BLOB
        );

        CREATE TABLE IF NOT EXISTS suppliers (
            id    TEXT PRIMARY KEY,
            name  TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS command_log (
            id        TEXT PRIMARY KEY,
            ts        TEXT NOT NULL,
            device_id TEXT NOT NULL,
            cmd       TEXT NOT NULL,
            args      TEXT NOT NULL,
            pushed    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS applied_batches (
            id TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS employees (
            id               TEXT PRIMARY KEY,
            name             TEXT NOT NULL DEFAULT '',
            photo            TEXT NOT NULL DEFAULT '',
            salary           REAL NOT NULL DEFAULT 0.0,
            salary_type      TEXT NOT NULL DEFAULT 'monthly',
            dob              TEXT NOT NULL DEFAULT 'N/A',
            joining_date     TEXT NOT NULL DEFAULT '',
            mobile_number    TEXT NOT NULL DEFAULT '',
            check_in_days    INTEGER NOT NULL DEFAULT 0,
            last_check_in    TEXT NOT NULL DEFAULT 'N/A',
            check_in_history TEXT NOT NULL DEFAULT '',
            salary_history   TEXT NOT NULL DEFAULT ''
        );
    ").map_err(|e| e.to_string())
}

// ── Vector helpers ────────────────────────────────────────────────────────────

fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn blob_to_vec(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na < 1e-8 || nb < 1e-8 { 0.0 } else { dot / (na * nb) }
}

fn embed_text(embedder: &TextEmbedding, text: &str) -> Result<Vec<f32>, String> {
    embedder
        .embed(vec![text.to_string()], None)
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "embedding returned empty".into())
}

// ── Row mappers ───────────────────────────────────────────────────────────────

fn row_to_product(row: &rusqlite::Row<'_>) -> rusqlite::Result<Product> {
    Ok(Product {
        id:               row.get(0)?,
        brand:            row.get(1)?,
        source_language:  row.get(2)?,
        name:             row.get(3)?,
        category:         row.get::<_, String>(4).unwrap_or_else(|_| "Food & Beverage".into()),
        supplier_id:      row.get::<_, String>(5).unwrap_or_default(),
        manufacture_date: row.get(6)?,
        expiry_date:      row.get(7)?,
        image_location:   serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or_default(),
        quantity:         row.get(9)?,
        sold_quantity:    row.get(10)?,
        buy_price:        row.get(11)?,
        sell_price:       row.get(12)?,
        images:           serde_json::from_str(&row.get::<_, String>(13)?).unwrap_or_default(),
        sales_history:    row.get(14)?,
    })
}

fn row_to_employee(row: &rusqlite::Row<'_>) -> rusqlite::Result<Employee> {
    Ok(Employee {
        id:               row.get(0)?,
        name:             row.get(1)?,
        photo:            row.get(2)?,
        salary:           row.get(3)?,
        salary_type:      row.get::<_, String>(4).unwrap_or_else(|_| "monthly".into()),
        dob:              row.get(5)?,
        joining_date:     row.get(6)?,
        mobile_number:    row.get(7)?,
        check_in_days:    row.get(8)?,
        last_check_in:    row.get(9)?,
        check_in_history: row.get(10).unwrap_or_default(),
        salary_history:   row.get(11).unwrap_or_default(),
    })
}

// ── Product commands ──────────────────────────────────────────────────────────

#[tauri::command]
async fn get_products(state: State<'_, AppState>) -> Result<Vec<Product>, String> {
    let db = state.db.lock().await;
    let mut stmt = db.prepare(
        "SELECT id, brand, source_language, name, category, supplier_id, manufacture_date, expiry_date,
         image_location, quantity, sold_quantity, buy_price, sell_price,
         images_json, sales_history FROM products",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_product).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_product(state: State<'_, AppState>, product: Product) -> Result<Product, String> {
    let mut p = product;
    p.images.truncate(2);
    p.image_location.truncate(2);
    p.id = Uuid::new_v4().to_string();

    let embedding = {
        let embedder = state.embedder.lock().await;
        embed_text(&embedder, &format!("{} {} {}", p.brand, p.name, p.source_language))?
    };

    let db = state.db.lock().await;
    db.execute(
        "INSERT INTO products (id, brand, source_language, name, category, supplier_id, manufacture_date, expiry_date,
         image_location, quantity, sold_quantity, buy_price, sell_price, images_json,
         sales_history, embedding) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![
            p.id, p.brand, p.source_language, p.name, p.category, p.supplier_id,
            p.manufacture_date, p.expiry_date,
            serde_json::to_string(&p.image_location).unwrap_or_else(|_| "[]".into()),
            p.quantity, p.sold_quantity, p.buy_price, p.sell_price,
            serde_json::to_string(&p.images).unwrap_or_else(|_| "[]".into()),
            p.sales_history,
            vec_to_blob(&embedding),
        ],
    ).map_err(|e| e.to_string())?;
    let p_for_log = Product { images: vec![], ..p.clone() };
    log_command(&*db, &state.device_id, "ADD_PRODUCT", serde_json::to_value(&p_for_log).unwrap_or_default())?;
    Ok(p)
}

#[tauri::command]
async fn update_product(state: State<'_, AppState>, product: Product) -> Result<Product, String> {
    let embedding = {
        let embedder = state.embedder.lock().await;
        embed_text(&embedder, &format!("{} {} {}", product.brand, product.name, product.source_language))?
    };

    let db = state.db.lock().await;
    db.execute(
        "UPDATE products SET brand=?2, source_language=?3, name=?4, category=?5, supplier_id=?6,
         manufacture_date=?7, expiry_date=?8, image_location=?9, quantity=?10, sold_quantity=?11,
         buy_price=?12, sell_price=?13, images_json=?14, sales_history=?15, embedding=?16
         WHERE id=?1",
        params![
            product.id, product.brand, product.source_language, product.name, product.category, product.supplier_id,
            product.manufacture_date, product.expiry_date,
            serde_json::to_string(&product.image_location).unwrap_or_else(|_| "[]".into()),
            product.quantity, product.sold_quantity, product.buy_price, product.sell_price,
            serde_json::to_string(&product.images).unwrap_or_else(|_| "[]".into()),
            product.sales_history,
            vec_to_blob(&embedding),
        ],
    ).map_err(|e| e.to_string())?;
    let p_for_log = Product { images: vec![], ..product.clone() };
    log_command(&*db, &state.device_id, "UPDATE_PRODUCT", serde_json::to_value(&p_for_log).unwrap_or_default())?;
    Ok(product)
}

#[tauri::command]
async fn delete_product(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    db.execute("DELETE FROM products WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log_command(&*db, &state.device_id, "DELETE_PRODUCT", json!({"id": id}))?;
    Ok(())
}

/// Semantic search: embed the query, rank products by cosine similarity.
/// Falls back to substring match for products that have no embedding yet.
#[tauri::command]
async fn search_products(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<Product>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return get_products(state).await;
    }

    let query_vec = {
        let embedder = state.embedder.lock().await;
        embed_text(&embedder, &q)?
    };

    let db = state.db.lock().await;
    let mut stmt = db.prepare(
        "SELECT id, brand, source_language, name, category, manufacture_date, expiry_date,
         image_location, quantity, sold_quantity, buy_price, sell_price,
         images_json, sales_history, embedding FROM products",
    ).map_err(|e| e.to_string())?;

    let ql = q.to_lowercase();
    let mut scored: Vec<(f32, Product)> = stmt
        .query_map([], |row| {
            let product = row_to_product(row)?;
            let blob: Option<Vec<u8>> = row.get(15)?;
            Ok((product, blob))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(p, blob)| {
            let score = if let Some(b) = blob {
                cosine_similarity(&query_vec, &blob_to_vec(&b))
            } else {
                // no embedding yet — fall back to substring score
                let haystack = format!("{} {} {}", p.name, p.brand, p.source_language).to_lowercase();
                if haystack.contains(&ql) { 0.5 } else { 0.0 }
            };
            (score, p)
        })
        .filter(|(score, _)| *score > 0.25)
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored.into_iter().take(20).map(|(_, p)| p).collect())
}

// ── Employee commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn get_employees(state: State<'_, AppState>) -> Result<Vec<Employee>, String> {
    let db = state.db.lock().await;
    let mut stmt = db.prepare(
        "SELECT id, name, photo, salary, salary_type, dob, joining_date, mobile_number,
         check_in_days, last_check_in, check_in_history, salary_history FROM employees",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_employee).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_employee(state: State<'_, AppState>, employee: Employee) -> Result<Employee, String> {
    let mut e = employee;
    e.id = Uuid::new_v4().to_string();
    let db = state.db.lock().await;
    db.execute(
        "INSERT INTO employees (id, name, photo, salary, salary_type, dob, joining_date,
         mobile_number, check_in_days, last_check_in, check_in_history, salary_history)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            e.id, e.name, e.photo, e.salary, e.salary_type, e.dob,
            e.joining_date, e.mobile_number, e.check_in_days, e.last_check_in,
            e.check_in_history, e.salary_history,
        ],
    ).map_err(|e| e.to_string())?;
    log_command(&*db, &state.device_id, "ADD_EMPLOYEE", serde_json::to_value(&e).unwrap_or_default())?;
    Ok(e)
}

#[tauri::command]
async fn update_employee(state: State<'_, AppState>, employee: Employee) -> Result<Employee, String> {
    let db = state.db.lock().await;
    db.execute(
        "UPDATE employees SET name=?2, photo=?3, salary=?4, salary_type=?5, dob=?6,
         joining_date=?7, mobile_number=?8, check_in_days=?9, last_check_in=?10,
         check_in_history=?11, salary_history=?12 WHERE id=?1",
        params![
            employee.id, employee.name, employee.photo, employee.salary, employee.salary_type,
            employee.dob, employee.joining_date, employee.mobile_number,
            employee.check_in_days, employee.last_check_in,
            employee.check_in_history, employee.salary_history,
        ],
    ).map_err(|e| e.to_string())?;
    log_command(&*db, &state.device_id, "UPDATE_EMPLOYEE", serde_json::to_value(&employee).unwrap_or_default())?;
    Ok(employee)
}

#[tauri::command]
async fn delete_employee(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    db.execute("DELETE FROM employees WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log_command(&*db, &state.device_id, "DELETE_EMPLOYEE", json!({"id": id}))?;
    Ok(())
}

#[tauri::command]
async fn checkin_employee(
    state: State<'_, AppState>,
    id: String,
    date: String,
    hours: Option<f64>,
) -> Result<Employee, String> {
    let all = get_employees(state.clone()).await?;
    let emp = all
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "Employee not found".to_string())?;

    // For monthly employees already checked in today, nothing to do.
    // For hourly employees already checked in today, allow updating the hours.
    let is_update = emp.last_check_in == date;
    if is_update && emp.salary_type != "hourly" {
        return Ok(emp);
    }

    let entry = if emp.salary_type == "hourly" {
        format!("{}:{}", date, hours.unwrap_or(0.0))
    } else {
        date.clone()
    };

    let new_check_in_history = {
        let mut entries: Vec<String> = emp.check_in_history
            .split(',')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();
        let date_prefix = format!("{}:", date);
        // Remove existing entry for today (so we can replace it with updated hours)
        entries.retain(|e| e != &date && !e.starts_with(&date_prefix));
        entries.push(entry);
        entries.sort_by(|a, b| a[..10.min(a.len())].cmp(&b[..10.min(b.len())]));
        if entries.len() > 30 {
            entries = entries[entries.len() - 30..].to_vec();
        }
        entries.join(",")
    };

    // check_in_days only increments on first check-in for the day
    let updated = Employee {
        check_in_days:    if is_update { emp.check_in_days } else { emp.check_in_days + 1 },
        last_check_in:    date,
        check_in_history: new_check_in_history,
        ..emp
    };

    update_employee(state.clone(), updated.clone()).await?;
    {
        let db = state.db.lock().await;
        log_command(&*db, &state.device_id, "CHECKIN_EMPLOYEE", serde_json::to_value(&updated).unwrap_or_default())?;
    }
    Ok(updated)
}

// ── OCR ───────────────────────────────────────────────────────────────────────

const PADDLE_SCRIPT: &str = include_str!("../ocr_paddle.py");

fn ensure_paddle_script() -> std::path::PathBuf {
    let path = std::env::temp_dir().join("sm_paddle_ocr.py");
    let _ = std::fs::write(&path, PADDLE_SCRIPT);
    path
}

fn python_bin() -> String {
    #[cfg(target_os = "windows")]
    let venv_python: &[&str] = &[".venv", "Scripts", "python.exe"];
    #[cfg(not(target_os = "windows"))]
    let venv_python: &[&str] = &[".venv", "bin", "python3"];

    let search_roots: Vec<std::path::PathBuf> = [
        std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())),
        std::env::current_dir().ok(),
    ]
    .into_iter()
    .flatten()
    .flat_map(|root| {
        let mut dirs = vec![root.clone()];
        let mut cur = root;
        for _ in 0..4 {
            if let Some(p) = cur.parent() {
                dirs.push(p.to_path_buf());
                cur = p.to_path_buf();
            }
        }
        dirs
    })
    .collect();

    for root in search_roots {
        let candidate = venv_python.iter().fold(root, |p, seg| p.join(seg));
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }

    #[cfg(target_os = "macos")]
    {
        if std::path::Path::new("/opt/homebrew/bin/python3").exists() {
            return "/opt/homebrew/bin/python3".to_string();
        }
        if std::path::Path::new("/usr/local/bin/python3").exists() {
            return "/usr/local/bin/python3".to_string();
        }
    }

    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        for ver in &["Python312", "Python311", "Python310", "Python39"] {
            let p = format!("{}\\Programs\\Python\\{}\\python.exe", local, ver);
            if std::path::Path::new(&p).exists() {
                return p;
            }
        }
        return "python".to_string();
    }

    "python3".to_string()
}

fn spawn_paddle_daemon() -> Option<PaddleDaemon> {
    let script = ensure_paddle_script();
    let mut child = std::process::Command::new(python_bin())
        .arg(&script)
        .arg("--daemon")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    let stdin  = child.stdin.take()?;
    let stdout = BufReader::new(child.stdout.take()?);
    let mut daemon = PaddleDaemon { stdin, stdout };

    let mut line = String::new();
    daemon.stdout.read_line(&mut line).ok()?;
    if line.trim() == "DAEMON_READY" { Some(daemon) } else { None }
}

#[tauri::command]
async fn extract_text_from_image(
    data_url: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let comma = data_url.find(',').ok_or("invalid data-URL: no comma")?;
    let b64 = &data_url[comma + 1..];
    let bytes = general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;

    let mime_end = data_url.find(';').unwrap_or(comma);
    let mime = &data_url[5..mime_end];
    let ext = match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp"               => "webp",
        "image/bmp"                => "bmp",
        "image/tiff"               => "tiff",
        "image/gif"                => "gif",
        _                          => "png",
    };
    let path = std::env::temp_dir().join(format!("ocr_{}.{}", Uuid::new_v4(), ext));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let img_path = path.to_string_lossy().to_string();

    let paddle = Arc::clone(&state.paddle);
    let img = img_path.clone();
    let text = tokio::task::spawn_blocking(move || {
        let mut guard = paddle.blocking_lock();
        if let Some(daemon) = guard.as_mut() {
            daemon.ocr(&img).unwrap_or_else(|_| String::new())
        } else {
            String::new()
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&path);
    if text.is_empty() {
        Err("no text extracted".into())
    } else {
        Ok(text)
    }
}

// ── Supplier commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn get_suppliers(state: State<'_, AppState>) -> Result<Vec<Supplier>, String> {
    let db = state.db.lock().await;
    let mut stmt = db.prepare("SELECT id, name, phone FROM suppliers ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Supplier { id: row.get(0)?, name: row.get(1)?, phone: row.get(2)? })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_supplier(state: State<'_, AppState>, supplier: Supplier) -> Result<Supplier, String> {
    let mut s = supplier;
    s.id = Uuid::new_v4().to_string();
    let db = state.db.lock().await;
    db.execute(
        "INSERT INTO suppliers (id, name, phone) VALUES (?1, ?2, ?3)",
        params![s.id, s.name, s.phone],
    ).map_err(|e| e.to_string())?;
    log_command(&*db, &state.device_id, "ADD_SUPPLIER", serde_json::to_value(&s).unwrap_or_default())?;
    Ok(s)
}

#[tauri::command]
async fn delete_supplier(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    // Clear supplier reference from products first
    db.execute("UPDATE products SET supplier_id='' WHERE supplier_id=?1", params![id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM suppliers WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log_command(&*db, &state.device_id, "DELETE_SUPPLIER", json!({"id": id}))?;
    Ok(())
}

// ── Export / Import ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct ExportBundle {
    version:   u32,
    products:  Vec<Product>,
    employees: Vec<Employee>,
}

#[tauri::command]
async fn export_data(state: State<'_, AppState>) -> Result<String, String> {
    let products  = get_products(state.clone()).await?;
    let employees = get_employees(state.clone()).await?;
    serde_json::to_string(&ExportBundle { version: 2, products, employees })
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_data(state: State<'_, AppState>, json: String) -> Result<(), String> {
    let bundle: ExportBundle = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    {
        let db = state.db.lock().await;
        db.execute_batch("DELETE FROM products; DELETE FROM employees;")
            .map_err(|e| e.to_string())?;
    }

    for p in bundle.products {
        add_product(state.clone(), p).await?;
    }
    for e in bundle.employees {
        add_employee(state.clone(), e).await?;
    }
    Ok(())
}

// ── CQRS command log helpers ──────────────────────────────────────────────────

fn log_command(
    db: &Connection,
    device_id: &str,
    cmd: &str,
    args: serde_json::Value,
) -> Result<(), String> {
    let id = Uuid::new_v4().to_string();
    let ts = {
        let d = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        format!("{}", d.as_millis())
    };
    db.execute(
        "INSERT INTO command_log (id, ts, device_id, cmd, args) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            id, ts, device_id, cmd,
            serde_json::to_string(&args).map_err(|e| e.to_string())?
        ],
    ).map_err(|e| e.to_string()).map(|_| ())
}

fn apply_command(
    db: &Connection,
    cmd: &str,
    args: &serde_json::Value,
) -> Result<(), String> {
    match cmd {
        "ADD_PRODUCT" | "UPDATE_PRODUCT" | "SELL_PRODUCT" => {
            let id = args["id"].as_str().unwrap_or("");
            let brand = args["brand"].as_str().unwrap_or("");
            let source_language = args["sourceLanguage"].as_str().unwrap_or("");
            let name = args["name"].as_str().unwrap_or("");
            let category = args["category"].as_str().unwrap_or("Food & Beverage");
            let supplier_id = args["supplierId"].as_str().unwrap_or("");
            let manufacture_date = args["manufactureDate"].as_str().unwrap_or("N/A");
            let expiry_date = args["expiryDate"].as_str().unwrap_or("N/A");
            let image_location = serde_json::to_string(&args["imageLocation"]).unwrap_or_else(|_| "[]".into());
            let quantity = args["quantity"].as_i64().unwrap_or(0) as i32;
            let sold_quantity = args["soldQuantity"].as_i64().unwrap_or(0) as i32;
            let buy_price = args["buyPrice"].as_f64().unwrap_or(0.0);
            let sell_price = args["sellPrice"].as_f64().unwrap_or(0.0);
            let sales_history = args["salesHistory"].as_str().unwrap_or("");
            db.execute(
                "INSERT INTO products (id, brand, source_language, name, category, supplier_id,
                 manufacture_date, expiry_date, image_location, quantity, sold_quantity,
                 buy_price, sell_price, images_json, sales_history, embedding)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,
                   COALESCE((SELECT images_json FROM products WHERE id=?1), '[]'),
                   ?14,
                   COALESCE((SELECT embedding FROM products WHERE id=?1), X''))
                 ON CONFLICT(id) DO UPDATE SET
                   brand=excluded.brand, source_language=excluded.source_language,
                   name=excluded.name, category=excluded.category,
                   supplier_id=excluded.supplier_id,
                   manufacture_date=excluded.manufacture_date, expiry_date=excluded.expiry_date,
                   image_location=excluded.image_location, quantity=excluded.quantity,
                   sold_quantity=excluded.sold_quantity, buy_price=excluded.buy_price,
                   sell_price=excluded.sell_price, sales_history=excluded.sales_history",
                rusqlite::params![
                    id, brand, source_language, name, category, supplier_id,
                    manufacture_date, expiry_date, image_location,
                    quantity, sold_quantity, buy_price, sell_price, sales_history,
                ],
            ).map_err(|e| e.to_string())?;
        }
        "DELETE_PRODUCT" => {
            let id = args["id"].as_str().unwrap_or("");
            db.execute("DELETE FROM products WHERE id=?1", rusqlite::params![id])
                .map_err(|e| e.to_string())?;
        }
        "ADD_EMPLOYEE" | "UPDATE_EMPLOYEE" | "CHECKIN_EMPLOYEE" => {
            let id = args["id"].as_str().unwrap_or("");
            let name = args["name"].as_str().unwrap_or("");
            let photo = args["photo"].as_str().unwrap_or("");
            let salary = args["salary"].as_f64().unwrap_or(0.0);
            let salary_type = args["salaryType"].as_str().unwrap_or("monthly");
            let dob = args["dob"].as_str().unwrap_or("N/A");
            let joining_date = args["joiningDate"].as_str().unwrap_or("N/A");
            let mobile_number = args["mobileNumber"].as_str().unwrap_or("");
            let check_in_days = args["checkInDays"].as_i64().unwrap_or(0) as i32;
            let last_check_in = args["lastCheckIn"].as_str().unwrap_or("N/A");
            let check_in_history = args["checkInHistory"].as_str().unwrap_or("");
            let salary_history = args["salaryHistory"].as_str().unwrap_or("[]");
            db.execute(
                "INSERT INTO employees (id, name, photo, salary, salary_type, dob, joining_date,
                 mobile_number, check_in_days, last_check_in, check_in_history, salary_history)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
                 ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name, photo=excluded.photo, salary=excluded.salary,
                   salary_type=excluded.salary_type, dob=excluded.dob,
                   joining_date=excluded.joining_date, mobile_number=excluded.mobile_number,
                   check_in_days=excluded.check_in_days, last_check_in=excluded.last_check_in,
                   check_in_history=excluded.check_in_history, salary_history=excluded.salary_history",
                rusqlite::params![
                    id, name, photo, salary, salary_type, dob, joining_date,
                    mobile_number, check_in_days, last_check_in, check_in_history, salary_history,
                ],
            ).map_err(|e| e.to_string())?;
        }
        "DELETE_EMPLOYEE" => {
            let id = args["id"].as_str().unwrap_or("");
            db.execute("DELETE FROM employees WHERE id=?1", rusqlite::params![id])
                .map_err(|e| e.to_string())?;
        }
        "ADD_SUPPLIER" => {
            let id = args["id"].as_str().unwrap_or("");
            let name = args["name"].as_str().unwrap_or("");
            let phone = args["phone"].as_str().unwrap_or("");
            db.execute(
                "INSERT OR IGNORE INTO suppliers (id, name, phone) VALUES (?1,?2,?3)",
                rusqlite::params![id, name, phone],
            ).map_err(|e| e.to_string())?;
        }
        "DELETE_SUPPLIER" => {
            let id = args["id"].as_str().unwrap_or("");
            db.execute("DELETE FROM suppliers WHERE id=?1", rusqlite::params![id])
                .map_err(|e| e.to_string())?;
        }
        _ => {} // unknown command type, ignore
    }
    Ok(())
}

#[tauri::command]
async fn push_events(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let session = match auth::load_session(&app_data) {
        None => return Ok(0),
        Some(s) => auth::ensure_valid_token(&app_data, s).await?,
    };

    #[derive(serde::Serialize, serde::Deserialize)]
    struct LogRow { id: String, ts: String, device_id: String, cmd: String, args: String }

    let rows: Vec<LogRow> = {
        let db = state.db.lock().await;
        let mut stmt = db
            .prepare("SELECT id, ts, device_id, cmd, args FROM command_log WHERE pushed = 0 ORDER BY ts")
            .map_err(|e| e.to_string())?;
        let result = stmt.query_map([], |row| {
            Ok(LogRow {
                id: row.get(0)?, ts: row.get(1)?,
                device_id: row.get(2)?, cmd: row.get(3)?, args: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
        result
    };

    if rows.is_empty() { return Ok(0); }

    let count = rows.len() as u32;
    let jsonl = rows.iter()
        .filter_map(|r| serde_json::to_string(r).ok())
        .collect::<Vec<_>>()
        .join("\n");

    let batch_id = Uuid::new_v4().to_string();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Embed unix timestamp so cleanup can determine file age from name alone.
    // Format: cmd_{device_id}_{unix_ts}_{batch_uuid}.jsonl
    let file_name = format!("cmd_{}_{}_{}.jsonl", state.device_id, ts, batch_id);
    drive::upload_command_batch(&session.access_token, &file_name, jsonl.into_bytes()).await?;

    {
        let db = state.db.lock().await;
        db.execute("UPDATE command_log SET pushed = 1 WHERE pushed = 0", [])
            .map_err(|e| e.to_string())?;
    }

    Ok(count)
}

#[tauri::command]
async fn pull_events(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let session = match auth::load_session(&app_data) {
        None => return Ok(0),
        Some(s) => auth::ensure_valid_token(&app_data, s).await?,
    };

    let all_files = drive::list_command_files(&session.access_token).await?;

    let to_apply: Vec<(String, String)> = {
        let db = state.db.lock().await;
        all_files.into_iter()
            .filter(|(name, _)| !name.contains(&state.device_id))
            .filter(|(name, _)| {
                db.query_row(
                    "SELECT 1 FROM applied_batches WHERE id = ?1",
                    rusqlite::params![name],
                    |_| Ok(()),
                ).is_err()
            })
            .collect()
    };

    if to_apply.is_empty() { return Ok(0); }

    #[derive(serde::Deserialize)]
    struct LogRow { id: String, cmd: String, args: String }

    let mut total_applied = 0u32;

    for (file_name, file_id) in &to_apply {
        let jsonl = drive::download_command_file(&session.access_token, file_id).await?;

        for line in jsonl.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let row: LogRow = match serde_json::from_str(line) {
                Ok(r) => r,
                Err(_) => continue,
            };

            let args: serde_json::Value = serde_json::from_str(&row.args).unwrap_or_default();

            {
                let db = state.db.lock().await;
                if db.query_row(
                    "SELECT 1 FROM applied_batches WHERE id = ?1",
                    rusqlite::params![&row.id],
                    |_| Ok(()),
                ).is_ok() { continue; }

                apply_command(&db, &row.cmd, &args)?;

                db.execute(
                    "INSERT OR IGNORE INTO applied_batches (id) VALUES (?1)",
                    rusqlite::params![&row.id],
                ).map_err(|e| e.to_string())?;
            }
            total_applied += 1;
        }

        let db = state.db.lock().await;
        db.execute(
            "INSERT OR IGNORE INTO applied_batches (id) VALUES (?1)",
            rusqlite::params![file_name],
        ).map_err(|e| e.to_string())?;
    }

    Ok(total_applied)
}

// ── Local periodic housekeeping ───────────────────────────────────────────────

/// Runs every 5 minutes from the frontend. Removes data that is no longer needed
/// from the local SQLite database:
///
/// 1. `command_log` rows that have been pushed to Drive (`pushed = 1`).
///    Once uploaded they serve no local purpose.
///
/// 2. `applied_batches` rows whose filename encodes a timestamp older than 48 hours.
///    The nightly Drive cleanup deletes files after 24 h, so by 48 h the entry is
///    stale and we will never see that file again.
///    Rows using the old 3-part filename format (no embedded timestamp) are left alone.
///
/// Returns the total number of rows deleted.
#[tauri::command]
async fn local_cleanup(state: State<'_, AppState>) -> Result<u32, String> {
    let db = state.db.lock().await;

    // 1. Delete all pushed command_log rows
    let pushed_deleted = db
        .execute("DELETE FROM command_log WHERE pushed = 1", [])
        .map_err(|e| e.to_string())? as u32;

    // 2. Prune applied_batches rows whose embedded timestamp is > 48 hours old.
    //    Filename format: cmd_{device_uuid}_{unix_ts}_{batch_uuid}.jsonl
    //    UUIDs have no underscores, so split('_') yields exactly 4 parts.
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(48 * 3600);

    let batch_ids: Vec<String> = {
        let mut stmt = db
            .prepare("SELECT id FROM applied_batches")
            .map_err(|e| e.to_string())?;
        stmt.query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|name: &String| {
                // parse timestamp from 3rd segment of the filename stem
                let stem = name.strip_suffix(".jsonl").unwrap_or(name.as_str());
                let parts: Vec<&str> = stem.split('_').collect();
                if parts.len() != 4 { return false; } // old format — keep
                parts[2].parse::<u64>().map_or(false, |ts| ts < cutoff)
            })
            .collect()
    };

    let mut batches_deleted = 0u32;
    for id in &batch_ids {
        if db
            .execute("DELETE FROM applied_batches WHERE id = ?1", rusqlite::params![id])
            .is_ok()
        {
            batches_deleted += 1;
        }
    }

    Ok(pushed_deleted + batches_deleted)
}

// ── Nightly Drive log cleanup ─────────────────────────────────────────────────

/// Delete cmd_*.jsonl files from Drive that are older than 24 hours.
///
/// Uses a `cleanup.lock` file as a distributed lock so only one device runs the
/// cleanup at a time. Returns `Err("cleanup_locked")` if another device currently
/// holds the lock; the frontend should retry after 5 minutes.
#[tauri::command]
async fn cleanup_drive_logs(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let session = match auth::load_session(&app_data) {
        None => return Ok(0),
        Some(s) => auth::ensure_valid_token(&app_data, s).await?,
    };

    // Acquire the distributed lock — returns None if another device holds it
    let lock_id = match drive::try_acquire_cleanup_lock(&session.access_token).await? {
        Some(id) => id,
        None => return Err("cleanup_locked".to_string()),
    };

    // Delete command files older than 24 hours
    let stale = drive::list_stale_command_files(&session.access_token, 24 * 60 * 60)
        .await
        .unwrap_or_default();
    let mut deleted = 0u32;
    for file_id in &stale {
        if drive::delete_drive_file(&session.access_token, file_id).await.is_ok() {
            deleted += 1;
        }
    }

    // Always release the lock, even if some deletes failed
    let _ = drive::release_cleanup_lock(&session.access_token, &lock_id).await;

    Ok(deleted)
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let db_path = app_data_dir.join("store.db");

            let conn = Connection::open(&db_path).expect("failed to open SQLite database");
            init_db(&conn).expect("failed to initialise database schema");

            let device_id_path = app_data_dir.join("device_id.txt");
            let device_id = std::fs::read_to_string(&device_id_path)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    let id = Uuid::new_v4().to_string();
                    let _ = std::fs::write(&device_id_path, &id);
                    id
                });
            // Migrations: add new columns to existing databases (silently ignored if already exist)
            let _ = conn.execute_batch(
                "ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'Food & Beverage';"
            );
            let _ = conn.execute_batch(
                "ALTER TABLE products ADD COLUMN supplier_id TEXT NOT NULL DEFAULT '';"
            );

            // Load the embedding model in a background thread so the UI appears immediately.
            // AllMiniLML6V2Q is downloaded once (~23 MB) and cached; subsequent runs are instant.
            let embedder: Arc<Mutex<TextEmbedding>> = Arc::new(Mutex::new(
                TextEmbedding::try_new(
                    InitOptions::new(EmbeddingModel::AllMiniLML6V2Q)
                        .with_show_download_progress(false),
                )
                .expect("failed to initialise embedding model"),
            ));

            let paddle: Arc<Mutex<Option<PaddleDaemon>>> = Arc::new(Mutex::new(None));
            let paddle_bg = Arc::clone(&paddle);
            std::thread::spawn(move || {
                if let Some(d) = spawn_paddle_daemon() {
                    paddle_bg.blocking_lock().replace(d);
                }
            });

            app.manage(AppState { db: Mutex::new(conn), embedder, paddle, device_id });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_products,
            add_product,
            update_product,
            delete_product,
            search_products,
            extract_text_from_image,
            get_employees,
            add_employee,
            update_employee,
            delete_employee,
            checkin_employee,
            get_suppliers,
            add_supplier,
            delete_supplier,
            export_data,
            import_data,
            auth::check_credentials,
            auth::save_credentials,
            auth::start_oauth,
            auth::get_session,
            auth::sign_out,
            drive::drive_push,
            drive::drive_pull,
            push_events,
            pull_events,
            local_cleanup,
            cleanup_drive_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
