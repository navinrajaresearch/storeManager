use std::sync::Arc;
use std::io::{BufRead, BufReader, Write};
use base64::{engine::general_purpose, Engine as _};

use arrow_array::{
    ArrayRef, FixedSizeListArray, Float32Array, Float64Array, Int32Array, RecordBatch,
    RecordBatchIterator, StringArray,
};
use arrow_schema::{DataType, Field, Schema};
use futures::TryStreamExt;
use lancedb::{connect, Connection};
use lancedb::query::ExecutableQuery;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

const VECTOR_DIM: i32 = 64;
const TABLE_NAME: &str = "products_v3";
const EMPLOYEE_TABLE: &str = "employees_v1";

// ── Domain ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Product {
    pub id: String,
    pub brand: String,
    #[serde(rename = "sourceLanguage")]
    pub source_language: String,
    pub name: String,
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
    pub sales_history: String,  // "YYYY-MM-DD:qty,YYYY-MM-DD:qty,..." — last 30 days
}

/// Wraps a long-lived PaddleOCR Python daemon process.
/// The daemon reads image paths from stdin and writes RESULT_START/RESULT_END blocks.
struct PaddleDaemon {
    stdin:  std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

impl PaddleDaemon {
    /// Scan one image; returns the extracted text or an error string.
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

pub struct AppState {
    pub db: Mutex<Connection>,
    /// PaddleOCR daemon — spawned in a background thread at startup so the
    /// app window opens immediately. None until the model finishes loading.
    paddle: Arc<Mutex<Option<PaddleDaemon>>>,
}

// ── Employee domain ───────────────────────────────────────────────────────────

fn default_salary_type() -> String { "monthly".to_string() }
fn default_empty_string() -> String { String::new() }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Employee {
    pub id: String,
    pub name: String,
    /// data-URL of the employee photo (may be empty string)
    pub photo: String,
    pub salary: f64,
    /// "monthly" or "hourly"
    #[serde(rename = "salaryType", default = "default_salary_type")]
    pub salary_type: String,
    /// "YYYY-MM-DD" or "N/A"
    pub dob: String,
    #[serde(rename = "joiningDate")]
    pub joining_date: String,
    /// Mobile / contact number (free-form string)
    #[serde(rename = "mobileNumber")]
    pub mobile_number: String,
    /// Total number of days the employee has checked in
    #[serde(rename = "checkInDays")]
    pub check_in_days: i32,
    /// Date of the last check-in "YYYY-MM-DD" or "N/A"
    #[serde(rename = "lastCheckIn")]
    pub last_check_in: String,
    /// Comma-separated list of check-in dates "YYYY-MM-DD,YYYY-MM-DD,..."
    #[serde(rename = "checkInHistory", default = "default_empty_string")]
    pub check_in_history: String,
    /// JSON array of salary history entries: [{"date":"YYYY-MM-DD","salary":50000,"salaryType":"monthly"}]
    #[serde(rename = "salaryHistory", default = "default_empty_string")]
    pub salary_history: String,
}

// ── Arrow schema ──────────────────────────────────────────────────────────────

fn product_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id",               DataType::Utf8,    false),
        Field::new("brand",            DataType::Utf8,    false),
        Field::new("source_language",  DataType::Utf8,    false),
        Field::new("name",             DataType::Utf8,    false),
        Field::new("manufacture_date", DataType::Utf8,    false),
        Field::new("expiry_date",      DataType::Utf8,    false),
        Field::new("image_location",   DataType::Utf8,    false), // JSON array
        Field::new("quantity",         DataType::Int32,   false),
        Field::new("sold_quantity",    DataType::Int32,   false),
        Field::new("buy_price",        DataType::Float64, false),
        Field::new("sell_price",       DataType::Float64, false),
        Field::new("images_json",      DataType::Utf8,    false), // JSON array of data-URLs
        Field::new("sales_history",    DataType::Utf8,    false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                VECTOR_DIM,
            ),
            true,
        ),
    ]))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn pseudo_vector(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; VECTOR_DIM as usize];
    for (i, c) in text.chars().enumerate() {
        let idx = (i + c as usize) % VECTOR_DIM as usize;
        v[idx] += (c as u8) as f32 / 255.0;
    }
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-8);
    v.iter_mut().for_each(|x| *x /= norm);
    v
}

fn to_json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".into())
}

fn from_json(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn products_to_batch(products: &[Product]) -> Result<RecordBatch, String> {
    let schema = product_schema();

    macro_rules! utf8 {
        ($expr:expr) => {
            Arc::new(StringArray::from(
                products.iter().map($expr).collect::<Vec<_>>(),
            )) as ArrayRef
        };
    }

    let ids          = utf8!(|p| p.id.as_str());
    let brands       = utf8!(|p| p.brand.as_str());
    let langs        = utf8!(|p| p.source_language.as_str());
    let names        = utf8!(|p| p.name.as_str());
    let mfg_dates    = utf8!(|p| p.manufacture_date.as_str());
    let exp_dates    = utf8!(|p| p.expiry_date.as_str());
    let img_locs: ArrayRef = Arc::new(StringArray::from(
        products.iter().map(|p| to_json(&p.image_location)).collect::<Vec<_>>(),
    ));
    let quantities: ArrayRef = Arc::new(Int32Array::from(
        products.iter().map(|p| p.quantity).collect::<Vec<_>>(),
    ));
    let sold_qtys: ArrayRef = Arc::new(Int32Array::from(
        products.iter().map(|p| p.sold_quantity).collect::<Vec<_>>(),
    ));
    let buy_prices: ArrayRef = Arc::new(Float64Array::from(
        products.iter().map(|p| p.buy_price).collect::<Vec<_>>(),
    ));
    let sell_prices: ArrayRef = Arc::new(Float64Array::from(
        products.iter().map(|p| p.sell_price).collect::<Vec<_>>(),
    ));
    let images_json: ArrayRef = Arc::new(StringArray::from(
        products.iter().map(|p| to_json(&p.images)).collect::<Vec<_>>(),
    ));
    let sales_histories = utf8!(|p| p.sales_history.as_str());

    let flat: Vec<f32> = products
        .iter()
        .flat_map(|p| pseudo_vector(&format!("{} {} {}", p.brand, p.name, p.source_language)))
        .collect();
    let float_arr = Arc::new(Float32Array::from(flat));
    let vectors: ArrayRef = Arc::new(
        FixedSizeListArray::try_new(
            Arc::new(Field::new("item", DataType::Float32, true)),
            VECTOR_DIM,
            float_arr,
            None,
        )
        .map_err(|e| e.to_string())?,
    );

    RecordBatch::try_new(
        schema,
        vec![
            ids, brands, langs, names, mfg_dates, exp_dates,
            img_locs, quantities, sold_qtys, buy_prices, sell_prices,
            images_json, sales_histories, vectors,
        ],
    )
    .map_err(|e| e.to_string())
}

async fn open_or_create(db: &Connection) -> Result<lancedb::Table, String> {
    let names = db.table_names().execute().await.map_err(|e| e.to_string())?;
    if names.contains(&TABLE_NAME.to_string()) {
        let table = db.open_table(TABLE_NAME).execute().await.map_err(|e| e.to_string())?;

        // Migration: add sales_history column if missing
        let has_sales_history = table.schema().await
            .map(|s| s.column_with_name("sales_history").is_some())
            .unwrap_or(false);

        if !has_sales_history {
            // Read existing rows inline (NOT via fetch_all to avoid recursion)
            let existing: Vec<Product> = {
                let batches: Vec<RecordBatch> = table
                    .query()
                    .execute()
                    .await
                    .map_err(|e| e.to_string())?
                    .try_collect()
                    .await
                    .map_err(|e| e.to_string())?;
                let mut rows = Vec::new();
                for batch in batches {
                    macro_rules! sp {
                        ($col:expr) => {
                            batch.column_by_name($col).unwrap()
                                .as_any().downcast_ref::<StringArray>().unwrap()
                        };
                    }
                    let ids       = sp!("id");
                    let brands    = sp!("brand");
                    let langs     = sp!("source_language");
                    let names_col = sp!("name");
                    let mfg       = sp!("manufacture_date");
                    let exp       = sp!("expiry_date");
                    let img_locs  = sp!("image_location");
                    let imgs      = sp!("images_json");
                    let qtys  = batch.column_by_name("quantity").unwrap()
                        .as_any().downcast_ref::<Int32Array>().unwrap();
                    let sold  = batch.column_by_name("sold_quantity").unwrap()
                        .as_any().downcast_ref::<Int32Array>().unwrap();
                    let buy   = batch.column_by_name("buy_price").unwrap()
                        .as_any().downcast_ref::<Float64Array>().unwrap();
                    let sell  = batch.column_by_name("sell_price").unwrap()
                        .as_any().downcast_ref::<Float64Array>().unwrap();
                    for i in 0..batch.num_rows() {
                        rows.push(Product {
                            id:               ids.value(i).to_string(),
                            brand:            brands.value(i).to_string(),
                            source_language:  langs.value(i).to_string(),
                            name:             names_col.value(i).to_string(),
                            manufacture_date: mfg.value(i).to_string(),
                            expiry_date:      exp.value(i).to_string(),
                            image_location:   from_json(img_locs.value(i)),
                            quantity:         qtys.value(i),
                            sold_quantity:    sold.value(i),
                            buy_price:        buy.value(i),
                            sell_price:       sell.value(i),
                            images:           from_json(imgs.value(i)),
                            sales_history:    String::new(),
                        });
                    }
                }
                rows
            };

            // Drop the old table and recreate with the new schema
            db.drop_table(TABLE_NAME).await.map_err(|e| e.to_string())?;
            let schema = product_schema();
            let empty = RecordBatch::new_empty(schema.clone());
            let reader = RecordBatchIterator::new(vec![Ok(empty)].into_iter(), schema);
            let new_table = db
                .create_table(TABLE_NAME, Box::new(reader))
                .execute()
                .await
                .map_err(|e| e.to_string())?;

            // Re-insert the existing products with sales_history defaulted to ""
            if !existing.is_empty() {
                let batch = products_to_batch(&existing)?;
                let schema = batch.schema();
                let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
                new_table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;
            }

            return Ok(new_table);
        }

        Ok(table)
    } else {
        let schema = product_schema();
        let empty = RecordBatch::new_empty(schema.clone());
        let reader = RecordBatchIterator::new(vec![Ok(empty)].into_iter(), schema);
        db.create_table(TABLE_NAME, Box::new(reader))
            .execute()
            .await
            .map_err(|e| e.to_string())
    }
}

async fn fetch_all(db: &Connection) -> Result<Vec<Product>, String> {
    let table = open_or_create(db).await?;

    let batches: Vec<RecordBatch> = table
        .query()
        .execute()
        .await
        .map_err(|e| e.to_string())?
        .try_collect()
        .await
        .map_err(|e| e.to_string())?;

    let mut products = Vec::new();
    for batch in batches {
        macro_rules! s {
            ($col:expr) => {
                batch
                    .column_by_name($col)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .unwrap()
            };
        }
        let ids       = s!("id");
        let brands    = s!("brand");
        let langs     = s!("source_language");
        let names     = s!("name");
        let mfg       = s!("manufacture_date");
        let exp       = s!("expiry_date");
        let img_locs  = s!("image_location");
        let qtys      = batch.column_by_name("quantity").unwrap().as_any().downcast_ref::<Int32Array>().unwrap();
        let sold      = batch.column_by_name("sold_quantity").unwrap().as_any().downcast_ref::<Int32Array>().unwrap();
        let buy       = batch.column_by_name("buy_price").unwrap().as_any().downcast_ref::<Float64Array>().unwrap();
        let sell      = batch.column_by_name("sell_price").unwrap().as_any().downcast_ref::<Float64Array>().unwrap();
        let imgs      = s!("images_json");
        let sales_hist = batch.column_by_name("sales_history")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

        for i in 0..batch.num_rows() {
            products.push(Product {
                id:               ids.value(i).to_string(),
                brand:            brands.value(i).to_string(),
                source_language:  langs.value(i).to_string(),
                name:             names.value(i).to_string(),
                manufacture_date: mfg.value(i).to_string(),
                expiry_date:      exp.value(i).to_string(),
                image_location:   from_json(img_locs.value(i)),
                quantity:         qtys.value(i),
                sold_quantity:    sold.value(i),
                buy_price:        buy.value(i),
                sell_price:       sell.value(i),
                images:           from_json(imgs.value(i)),
                sales_history:    sales_hist.map(|a| a.value(i)).unwrap_or("").to_string(),
            });
        }
    }

    Ok(products)
}

// ── Employee Arrow schema + helpers ──────────────────────────────────────────

fn employee_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id",                 DataType::Utf8,    false),
        Field::new("name",               DataType::Utf8,    false),
        Field::new("photo",              DataType::Utf8,    false),
        Field::new("salary",             DataType::Float64, false),
        Field::new("salary_type",        DataType::Utf8,    false),
        Field::new("dob",                DataType::Utf8,    false),
        Field::new("joining_date",       DataType::Utf8,    false),
        Field::new("mobile_number",      DataType::Utf8,    false),
        Field::new("check_in_days",      DataType::Int32,   false),
        Field::new("last_check_in",      DataType::Utf8,    false),
        Field::new("check_in_history",   DataType::Utf8,    false),
        Field::new("salary_history",     DataType::Utf8,    false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                VECTOR_DIM,
            ),
            true,
        ),
    ]))
}

fn employees_to_batch(employees: &[Employee]) -> Result<RecordBatch, String> {
    let schema = employee_schema();

    macro_rules! utf8e {
        ($expr:expr) => {
            Arc::new(StringArray::from(
                employees.iter().map($expr).collect::<Vec<_>>(),
            )) as ArrayRef
        };
    }

    let ids              = utf8e!(|e| e.id.as_str());
    let names            = utf8e!(|e| e.name.as_str());
    let photos           = utf8e!(|e| e.photo.as_str());
    let salaries: ArrayRef = Arc::new(Float64Array::from(
        employees.iter().map(|e| e.salary).collect::<Vec<_>>(),
    ));
    let salary_types     = utf8e!(|e| e.salary_type.as_str());
    let dobs             = utf8e!(|e| e.dob.as_str());
    let joins            = utf8e!(|e| e.joining_date.as_str());
    let mobiles          = utf8e!(|e| e.mobile_number.as_str());
    let checkins: ArrayRef = Arc::new(Int32Array::from(
        employees.iter().map(|e| e.check_in_days).collect::<Vec<_>>(),
    ));
    let last_ci          = utf8e!(|e| e.last_check_in.as_str());
    let check_in_history = utf8e!(|e| e.check_in_history.as_str());
    let salary_history   = utf8e!(|e| e.salary_history.as_str());

    let flat: Vec<f32> = employees
        .iter()
        .flat_map(|e| pseudo_vector(&e.name))
        .collect();
    let float_arr = Arc::new(Float32Array::from(flat));
    let vectors: ArrayRef = Arc::new(
        FixedSizeListArray::try_new(
            Arc::new(Field::new("item", DataType::Float32, true)),
            VECTOR_DIM,
            float_arr,
            None,
        )
        .map_err(|e| e.to_string())?,
    );

    RecordBatch::try_new(
        schema,
        vec![ids, names, photos, salaries, salary_types, dobs, joins, mobiles, checkins, last_ci, check_in_history, salary_history, vectors],
    )
    .map_err(|e| e.to_string())
}

async fn open_or_create_employees(db: &Connection) -> Result<lancedb::Table, String> {
    let table_names = db.table_names().execute().await.map_err(|e| e.to_string())?;
    if table_names.contains(&EMPLOYEE_TABLE.to_string()) {
        let table = db.open_table(EMPLOYEE_TABLE).execute().await.map_err(|e| e.to_string())?;
        // Migrate: if the table is missing check_in_history (added in this version), rebuild it
        // with the new schema. This handles both old schemas (no salary_type) and intermediate
        // schemas (has salary_type but no check_in_history).
        let schema_now = table.schema().await.map_err(|e| e.to_string())?;
        let has_check_in_history = schema_now.column_with_name("check_in_history").is_some();
        if !has_check_in_history {
            // Determine which optional columns the old table has so we can read safely.
            let has_salary_type = schema_now.column_with_name("salary_type").is_some();

            // Read all existing rows directly from the old-schema table (avoids recursion).
            let existing: Vec<Employee> = {
                let batches: Vec<RecordBatch> = table
                    .query()
                    .execute()
                    .await
                    .map_err(|e| e.to_string())?
                    .try_collect()
                    .await
                    .map_err(|e| e.to_string())?;
                let mut rows = Vec::new();
                for batch in batches {
                    macro_rules! se {
                        ($col:expr) => {
                            batch.column_by_name($col).unwrap()
                                .as_any().downcast_ref::<StringArray>().unwrap()
                        };
                    }
                    let ids     = se!("id");
                    let names   = se!("name");
                    let photos  = se!("photo");
                    let dobs    = se!("dob");
                    let joins   = se!("joining_date");
                    let mobiles = se!("mobile_number");
                    let last_ci = se!("last_check_in");
                    let salaries = batch.column_by_name("salary").unwrap()
                        .as_any().downcast_ref::<Float64Array>().unwrap();
                    let checkins = batch.column_by_name("check_in_days").unwrap()
                        .as_any().downcast_ref::<Int32Array>().unwrap();
                    // salary_type may not exist in the oldest schema
                    let salary_types = if has_salary_type {
                        batch.column_by_name("salary_type")
                            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                    } else {
                        None
                    };
                    for i in 0..batch.num_rows() {
                        let salary_type = salary_types
                            .map(|a| a.value(i))
                            .filter(|s| !s.is_empty())
                            .unwrap_or("monthly")
                            .to_string();
                        rows.push(Employee {
                            id:               ids.value(i).to_string(),
                            name:             names.value(i).to_string(),
                            photo:            photos.value(i).to_string(),
                            salary:           salaries.value(i),
                            salary_type,
                            dob:              dobs.value(i).to_string(),
                            joining_date:     joins.value(i).to_string(),
                            mobile_number:    mobiles.value(i).to_string(),
                            check_in_days:    checkins.value(i),
                            last_check_in:    last_ci.value(i).to_string(),
                            check_in_history: String::new(),
                            salary_history:   String::new(),
                        });
                    }
                }
                rows
            };
            // Drop and recreate the table with the new schema.
            db.drop_table(EMPLOYEE_TABLE).await.map_err(|e| e.to_string())?;
            let schema = employee_schema();
            let empty = RecordBatch::new_empty(schema.clone());
            let reader = RecordBatchIterator::new(vec![Ok(empty)].into_iter(), schema);
            let new_table = db
                .create_table(EMPLOYEE_TABLE, Box::new(reader))
                .execute()
                .await
                .map_err(|e| e.to_string())?;
            // Re-insert existing employees with new fields defaulted to empty.
            if !existing.is_empty() {
                let batch = employees_to_batch(&existing)?;
                let schema = batch.schema();
                let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
                new_table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;
            }
            return Ok(new_table);
        }
        Ok(table)
    } else {
        let schema = employee_schema();
        let empty = RecordBatch::new_empty(schema.clone());
        let reader = RecordBatchIterator::new(vec![Ok(empty)].into_iter(), schema);
        db.create_table(EMPLOYEE_TABLE, Box::new(reader))
            .execute()
            .await
            .map_err(|e| e.to_string())
    }
}

async fn fetch_all_employees(db: &Connection) -> Result<Vec<Employee>, String> {
    let table = open_or_create_employees(db).await?;

    let batches: Vec<RecordBatch> = table
        .query()
        .execute()
        .await
        .map_err(|e| e.to_string())?
        .try_collect()
        .await
        .map_err(|e| e.to_string())?;

    let mut employees = Vec::new();
    for batch in batches {
        macro_rules! se {
            ($col:expr) => {
                batch
                    .column_by_name($col)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .unwrap()
            };
        }
        let ids      = se!("id");
        let names    = se!("name");
        let photos   = se!("photo");
        let dobs     = se!("dob");
        let joins    = se!("joining_date");
        let mobiles  = se!("mobile_number");
        let last_ci  = se!("last_check_in");
        let salaries = batch.column_by_name("salary").unwrap()
            .as_any().downcast_ref::<Float64Array>().unwrap();
        let checkins = batch.column_by_name("check_in_days").unwrap()
            .as_any().downcast_ref::<Int32Array>().unwrap();
        // salary_type / check_in_history / salary_history — may be absent in old rows; use fallbacks
        let salary_types = batch.column_by_name("salary_type")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let check_in_histories = batch.column_by_name("check_in_history")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let salary_histories = batch.column_by_name("salary_history")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

        for i in 0..batch.num_rows() {
            let salary_type = salary_types
                .map(|a| a.value(i))
                .filter(|s| !s.is_empty())
                .unwrap_or("monthly")
                .to_string();
            let check_in_history = check_in_histories
                .and_then(|a| Some(a.value(i)))
                .unwrap_or("")
                .to_string();
            let salary_history = salary_histories
                .and_then(|a| Some(a.value(i)))
                .unwrap_or("")
                .to_string();
            employees.push(Employee {
                id:               ids.value(i).to_string(),
                name:             names.value(i).to_string(),
                photo:            photos.value(i).to_string(),
                salary:           salaries.value(i),
                salary_type,
                dob:              dobs.value(i).to_string(),
                joining_date:     joins.value(i).to_string(),
                mobile_number:    mobiles.value(i).to_string(),
                check_in_days:    checkins.value(i),
                last_check_in:    last_ci.value(i).to_string(),
                check_in_history,
                salary_history,
            });
        }
    }
    Ok(employees)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_products(state: State<'_, AppState>) -> Result<Vec<Product>, String> {
    fetch_all(&*state.db.lock().await).await
}

#[tauri::command]
async fn add_product(state: State<'_, AppState>, product: Product) -> Result<Product, String> {
    let db = state.db.lock().await;
    let table = open_or_create(&db).await?;

    let mut p = product;
    p.images.truncate(2);
    p.image_location.truncate(2);
    p.id = Uuid::new_v4().to_string();

    let batch = products_to_batch(&[p.clone()])?;
    let schema = batch.schema();
    let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
    table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;
    Ok(p)
}

/// Replace a product in-place (delete old row by id, insert updated row).
#[tauri::command]
async fn update_product(state: State<'_, AppState>, product: Product) -> Result<Product, String> {
    let db = state.db.lock().await;
    let table = open_or_create(&db).await?;

    // Remove the existing row first
    table
        .delete(&format!("id = '{}'", product.id))
        .await
        .map_err(|e| e.to_string())?;

    // Re-insert the updated row (preserves id, updates all fields)
    let batch = products_to_batch(&[product.clone()])?;
    let schema = batch.schema();
    let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
    table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;

    Ok(product)
}

#[tauri::command]
async fn delete_product(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    let table = open_or_create(&db).await?;
    table.delete(&format!("id = '{}'", id)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_products(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<Product>, String> {
    let q = query.to_lowercase();
    let all = fetch_all(&*state.db.lock().await).await?;
    Ok(all
        .into_iter()
        .filter(|p| {
            p.name.to_lowercase().contains(&q)
                || p.brand.to_lowercase().contains(&q)
                || p.source_language.to_lowercase().contains(&q)
        })
        .collect())
}

// ── Employee commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn get_employees(state: State<'_, AppState>) -> Result<Vec<Employee>, String> {
    fetch_all_employees(&*state.db.lock().await).await
}

#[tauri::command]
async fn add_employee(state: State<'_, AppState>, employee: Employee) -> Result<Employee, String> {
    let db = state.db.lock().await;
    let table = open_or_create_employees(&db).await?;
    let mut e = employee;
    e.id = Uuid::new_v4().to_string();
    let batch = employees_to_batch(&[e.clone()])?;
    let schema = batch.schema();
    let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
    table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;
    Ok(e)
}

#[tauri::command]
async fn update_employee(state: State<'_, AppState>, employee: Employee) -> Result<Employee, String> {
    let db = state.db.lock().await;
    let table = open_or_create_employees(&db).await?;
    table.delete(&format!("id = '{}'", employee.id)).await.map_err(|e| e.to_string())?;
    let batch = employees_to_batch(&[employee.clone()])?;
    let schema = batch.schema();
    let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
    table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;
    Ok(employee)
}

#[tauri::command]
async fn delete_employee(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    let table = open_or_create_employees(&db).await?;
    table.delete(&format!("id = '{}'", id)).await.map_err(|e| e.to_string())
}

/// Record one check-in for a given employee on `date` ("YYYY-MM-DD").
/// For hourly employees, `hours` stores actual hours worked as "YYYY-MM-DD:8.5".
/// For monthly employees the entry is just "YYYY-MM-DD".
/// Idempotent: if already checked in today, returns unchanged employee.
#[tauri::command]
async fn checkin_employee(
    state: State<'_, AppState>,
    id: String,
    date: String,
    hours: Option<f64>,
) -> Result<Employee, String> {
    let db = state.db.lock().await;
    let all = fetch_all_employees(&db).await?;
    let emp = all
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "Employee not found".to_string())?;

    // Idempotent — only count a new day
    if emp.last_check_in == date {
        return Ok(emp);
    }

    // Build the entry: "YYYY-MM-DD:hours" for hourly, "YYYY-MM-DD" for monthly
    let entry = if emp.salary_type == "hourly" {
        let h = hours.unwrap_or(8.0);
        format!("{}:{}", date, h)
    } else {
        date.clone()
    };

    // Append entry, deduplicate by date prefix, keep only most recent 30 days
    let new_check_in_history = {
        let mut entries: Vec<String> = emp.check_in_history
            .split(',')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();
        let date_prefix = format!("{}:", date);
        let already = entries.iter().any(|e| e == &date || e.starts_with(&date_prefix));
        if !already {
            entries.push(entry);
        }
        // Sort by date (first 10 chars) and keep last 30
        entries.sort_by(|a, b| a[..10.min(a.len())].cmp(&b[..10.min(b.len())]));
        if entries.len() > 30 {
            entries = entries[entries.len() - 30..].to_vec();
        }
        entries.join(",")
    };

    let updated = Employee {
        check_in_days:    emp.check_in_days + 1,
        last_check_in:    date,
        check_in_history: new_check_in_history,
        ..emp
    };

    let table = open_or_create_employees(&db).await?;
    table.delete(&format!("id = '{}'", updated.id)).await.map_err(|e| e.to_string())?;
    let batch = employees_to_batch(&[updated.clone()])?;
    let schema = batch.schema();
    let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
    table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;
    Ok(updated)
}

// Python helper script embedded at compile time
const PADDLE_SCRIPT: &str = include_str!("../ocr_paddle.py");

/// Write the bundled PaddleOCR helper to a stable temp path (once per process).
fn ensure_paddle_script() -> std::path::PathBuf {
    let path = std::env::temp_dir().join("sm_paddle_ocr.py");
    // Always overwrite so updates to the script are picked up after an app upgrade
    let _ = std::fs::write(&path, PADDLE_SCRIPT);
    path
}

/// Resolve the best available Python 3 binary.
/// Prefers the project .venv (where PaddleOCR is installed by setup scripts).
fn python_bin() -> String {
    // .venv sub-path differs by platform
    #[cfg(target_os = "windows")]
    let venv_python: &[&str] = &[".venv", "Scripts", "python.exe"];
    #[cfg(not(target_os = "windows"))]
    let venv_python: &[&str] = &[".venv", "bin", "python3"];

    // Walk up from the exe and from CWD (up to 4 levels) looking for .venv.
    // This covers: installed app, tauri dev (CWD = src-tauri), and project root.
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

    // macOS: Homebrew fallbacks (Apple Silicon then Intel)
    #[cfg(target_os = "macos")]
    {
        if std::path::Path::new("/opt/homebrew/bin/python3").exists() {
            return "/opt/homebrew/bin/python3".to_string();
        }
        if std::path::Path::new("/usr/local/bin/python3").exists() {
            return "/usr/local/bin/python3".to_string();
        }
    }

    // Windows: check common user-install locations
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

/// Spawn the PaddleOCR daemon and wait for DAEMON_READY.
/// Returns None if Python/PaddleOCR is unavailable.
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

    // Wait for the ready signal (model loading happens here)
    let mut line = String::new();
    daemon.stdout.read_line(&mut line).ok()?;
    if line.trim() == "DAEMON_READY" {
        Some(daemon)
    } else {
        None
    }
}

/// Tesseract fallback — run each language model independently and combine.
/// Running all languages together (eng+tam+tel) causes cross-script garbling
/// where a single output line contains mixed Latin + Tamil + Telugu characters.
fn try_tesseract(img_path: &str) -> Result<String, String> {
    let mut all_lines: Vec<String> = Vec::new();
    for lang in &["eng", "tam", "tel", "hin"] {
        let text_opt = tesseract::Tesseract::new(None, Some(lang)).ok()
            .and_then(|t| t.set_image(img_path).ok())
            .and_then(|mut t| t.get_text().ok());
        if let Some(text) = text_opt {
            for line in text.lines() {
                let line = line.trim().to_string();
                if line.len() > 1 && !all_lines.contains(&line) {
                    all_lines.push(line);
                }
            }
        }
    }
    if all_lines.is_empty() {
        Err("no text extracted".to_string())
    } else {
        Ok(all_lines.join("\n"))
    }
}

/// Extract text from a data-URL image.
/// Uses the long-lived PaddleOCR daemon (fast after first load); falls back to Tesseract.
#[tauri::command]
async fn extract_text_from_image(
    data_url: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Decode base64 payload
    let comma = data_url.find(',').ok_or("invalid data-URL: no comma")?;
    let b64 = &data_url[comma + 1..];
    let bytes = general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;

    // Derive correct file extension from MIME type
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

    // Try PaddleOCR daemon → Tesseract fallback
    let text = {
        let paddle = Arc::clone(&state.paddle);
        let img = img_path.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = paddle.blocking_lock();
            if let Some(daemon) = guard.as_mut() {
                match daemon.ocr(&img) {
                    Ok(t) if !t.is_empty() => Ok(t),
                    _ => try_tesseract(&img),
                }
            } else {
                try_tesseract(&img)
            }
        })
        .await
        .map_err(|e| e.to_string())??
    };

    let _ = std::fs::remove_file(&path);
    Ok(text)
}

// ── Export / Import ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct ExportBundle {
    version: u32,
    products: Vec<Product>,
    employees: Vec<Employee>,
}

/// Serialise the entire database to a JSON string.
#[tauri::command]
async fn export_data(state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.lock().await;
    let products  = fetch_all(&db).await?;
    let employees = fetch_all_employees(&db).await?;
    serde_json::to_string(&ExportBundle { version: 1, products, employees })
        .map_err(|e| e.to_string())
}

/// Replace the entire database with data from a previously exported JSON string.
#[tauri::command]
async fn import_data(state: State<'_, AppState>, json: String) -> Result<(), String> {
    let bundle: ExportBundle = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let db = state.db.lock().await;

    // ── Products ──────────────────────────────────────────────────────────────
    let table_names = db.table_names().execute().await.map_err(|e| e.to_string())?;
    if table_names.contains(&TABLE_NAME.to_string()) {
        db.drop_table(TABLE_NAME).await.map_err(|e| e.to_string())?;
    }
    let schema = product_schema();
    let empty  = RecordBatch::new_empty(schema.clone());
    let reader = RecordBatchIterator::new(vec![Ok(empty)].into_iter(), schema);
    let prod_table = db.create_table(TABLE_NAME, Box::new(reader))
        .execute().await.map_err(|e| e.to_string())?;
    if !bundle.products.is_empty() {
        let batch  = products_to_batch(&bundle.products)?;
        let schema = batch.schema();
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
        prod_table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;
    }

    // ── Employees ─────────────────────────────────────────────────────────────
    if table_names.contains(&EMPLOYEE_TABLE.to_string()) {
        db.drop_table(EMPLOYEE_TABLE).await.map_err(|e| e.to_string())?;
    }
    let schema = employee_schema();
    let empty  = RecordBatch::new_empty(schema.clone());
    let reader = RecordBatchIterator::new(vec![Ok(empty)].into_iter(), schema);
    let emp_table = db.create_table(EMPLOYEE_TABLE, Box::new(reader))
        .execute().await.map_err(|e| e.to_string())?;
    if !bundle.employees.is_empty() {
        let batch  = employees_to_batch(&bundle.employees)?;
        let schema = batch.schema();
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
        emp_table.add(Box::new(reader)).execute().await.map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir")
                .join("store.lancedb");

            let db = tauri::async_runtime::block_on(async {
                connect(db_path.to_str().unwrap())
                    .execute()
                    .await
                    .expect("failed to connect to LanceDB")
            });

            // Spawn PaddleOCR daemon in a background OS thread so the app window
            // opens immediately. The daemon loads the model (~5-8s) while the user
            // is already looking at the UI.
            let paddle: Arc<Mutex<Option<PaddleDaemon>>> = Arc::new(Mutex::new(None));
            let paddle_bg = Arc::clone(&paddle);
            std::thread::spawn(move || {
                if let Some(d) = spawn_paddle_daemon() {
                    paddle_bg.blocking_lock().replace(d);
                }
            });
            app.manage(AppState { db: Mutex::new(db), paddle });
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
            export_data,
            import_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
