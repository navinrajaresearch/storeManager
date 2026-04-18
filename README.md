# Store Manager

A desktop inventory management app built with **Tauri v2**, **React**, **SQLite**, and **fastembed**.  
Products are created by photographing their packaging — PaddleOCR reads the wrapper and fills in fields automatically.  
Search is powered by local semantic embeddings (AllMiniLML6V2Q) — fully offline after first launch.  
Data syncs across devices via **Google Drive** using a CQRS event-log architecture.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js ≥ 18 | [nodejs.org](https://nodejs.org) |
| Xcode CLI (macOS) | `xcode-select --install` |

> Rust and ONNX Runtime are installed automatically by `start.command` if missing.

---

## Run — one click

**macOS Finder:** double-click `start.command`

**Terminal / any OS:**

```bash
npm start
```

That single command installs dependencies and launches the app.

---

## Other commands

```bash
npm run tauri build   # production build (.dmg / .exe)
npm run dev           # frontend only (no Tauri shell)
```

---

## First-time notes

- On first launch, a **one-time setup screen** guides you to create a Google Cloud project and paste your OAuth credentials. This takes ~5 minutes and only needs to be done once per installation.
- On each subsequent launch, you sign in with Google — your data syncs automatically across all devices sharing the same Google account.
- No third-party API keys required — OCR and search run fully offline.
- On first launch, the embedding model (~23 MB) is downloaded from HuggingFace and cached. Every subsequent launch is instant.
- `start.command` installs PaddleOCR automatically into a local `.venv`.

---

## Architecture — Frontend

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React + TypeScript (src/)                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                       App.tsx                                │   │
│  │  Auth gate:  "setup" → "unauthenticated" → Session          │   │
│  │  Chat state machine: messages[], employees[], products[]     │   │
│  │  30-second push interval  |  focus-triggered pull           │   │
│  └───────────┬──────────────────────────────────────────────────┘   │
│              │ renders                                              │
│   ┌──────────▼──────────────────────────────────────┐              │
│   │              Chat Panel                         │              │
│   │  ┌──────────────────┐  ┌──────────────────────┐ │              │
│   │  │  SetupScreen     │  │  LoginScreen         │ │              │
│   │  │  (one-time GCP)  │  │  (Google OAuth btn)  │ │              │
│   │  └──────────────────┘  └──────────────────────┘ │              │
│   │  ┌──────────────────────────────────────────────┐│              │
│   │  │           Message Stream                    ││              │
│   │  │  ProductTile  EmployeeTile  ReportWidgets   ││              │
│   │  │  ProductConfirm  EmployeeForm  Calculator   ││              │
│   │  └──────────────────────────────────────────────┘│              │
│   │  ┌──────────────────────────────────────────────┐│              │
│   │  │  ChatInput + SuggestionChips + Autocomplete  ││              │
│   │  └──────────────────────────────────────────────┘│              │
│   └─────────────────────────────────────────────────┘              │
│                                                                     │
│  lib/                                                               │
│  ├── commands.ts     chat command dispatcher → invoke Rust          │
│  ├── ai.ts           semantic intent matching (offline)             │
│  ├── db.ts           product Tauri invoke wrappers                  │
│  ├── employeeDb.ts   employee Tauri invoke wrappers                 │
│  ├── supplierDb.ts   supplier Tauri invoke wrappers                 │
│  ├── auth.ts         OAuth + Drive + event-log invoke wrappers      │
│  └── ocr.ts          image prep + OCR result parsing                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Architecture — Backend

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Rust (src-tauri/src/)                           │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  lib.rs — Tauri command handlers                             │   │
│  │                                                              │   │
│  │  Products                  Employees         Suppliers       │   │
│  │  get_products              get_employees     get_suppliers    │   │
│  │  add_product               add_employee      add_supplier     │   │
│  │  update_product            update_employee   delete_supplier  │   │
│  │  delete_product            delete_employee                    │   │
│  │  search_products           checkin_employee                   │   │
│  │  (cosine similarity)                                          │   │
│  │                                                              │   │
│  │  Sync                      Shared helpers                    │   │
│  │  push_events               log_command()  ← called by all   │   │
│  │  pull_events               apply_command() ← replays events  │   │
│  └───────────────────────────────┬──────────────────────────────┘   │
│                                  │                                  │
│  ┌───────────────────────────────▼──────────────────────────────┐   │
│  │  auth.rs — OAuth 2.0 loopback flow                           │   │
│  │                                                              │   │
│  │  check_credentials   → reads oauth_credentials.json         │   │
│  │  save_credentials    → writes oauth_credentials.json        │   │
│  │  start_oauth         → do_oauth_flow()                       │   │
│  │    bind random TCP port → build auth URL → open browser      │   │
│  │    wait for /callback → exchange code → fetch userinfo       │   │
│  │    save session.json                                         │   │
│  │  get_session         → load + ensure_valid_token()           │   │
│  │  sign_out            → remove session.json                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  drive.rs — Google Drive appDataFolder                       │   │
│  │                                                              │   │
│  │  drive_push   → upload store.db snapshot                    │   │
│  │  drive_pull   → download + restore store.db                  │   │
│  │  upload_command_batch(token, name, data: Vec<u8>)            │   │
│  │  list_command_files(token) → Vec<(name, file_id)>            │   │
│  │  download_command_file(token, file_id) → JSONL string        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐    │
│  │  SQLite      │   │  fastembed       │   │  Python daemon   │    │
│  │  store.db    │   │  AllMiniLML6V2Q  │   │  ocr_paddle.py   │    │
│  │  WAL mode    │   │  384-dim vectors │   │  PP-OCRv5 mobile │    │
│  │  VACUUM INTO │   │  cosine search   │   │  stdin/stdout IPC│    │
│  └──────────────┘   └──────────────────┘   └──────────────────┘    │
│                                                                     │
│  App data dir (~Library/Application Support/store-manager/)        │
│  ├── store.db              SQLite database                          │
│  ├── session.json          access + refresh token + user profile    │
│  └── oauth_credentials.json  client_id + client_secret             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Architecture — Data Sync (CQRS Event Log)

```
Device A (e.g. MacBook)                    Google Drive
┌─────────────────────────┐               ┌──────────────────────────────┐
│  User action            │               │  appDataFolder/              │
│  add_product / checkin  │               │                              │
│         │               │               │  cmd_devA_uuid1.jsonl        │
│         ▼               │    push       │  {"op":"add_product",...}    │
│  SQLite write           │──────────────▶│  {"op":"checkin",...}        │
│         │               │               │                              │
│         ▼               │               │  cmd_devA_uuid2.jsonl        │
│  log_command()          │               │  (next 30-second batch)      │
│  command_log table      │               │                              │
│  (unpushed rows)        │               │  cmd_devB_uuid9.jsonl  ◀─────┼──── Device B
│                         │               │  {"op":"update_product",...} │
│  30s interval           │    pull       │                              │
│  push_events() →        │◀─────────────│                              │
│  collect unpushed →     │               └──────────────────────────────┘
│  serialize JSONL →      │
│  upload named file →    │               Device B (e.g. Work Mac)
│  mark pushed            │               ┌─────────────────────────────┐
│                         │               │                             │
│  On login / focus       │    pull       │  pull_events()              │
│  pull_events() →        │◀─────────────│  list cmd_* files           │
│  list Drive files →     │               │  skip own device ID         │
│  skip own device →      │               │  skip applied_batches       │
│  download new batches → │               │  download + replay JSONL    │
│  apply_command() →      │               │  apply_command() →          │
│  UPSERT to SQLite       │               │  UPSERT to SQLite           │
│  (preserves images,     │               │  (preserves images,         │
│   embeddings locally)   │               │   embeddings locally)       │
└─────────────────────────┘               └─────────────────────────────┘

Conflict resolution: last-write-wins by timestamp
Images & embeddings: always device-local — never travel over Drive
Per-device files: each device writes only its own cmd_{deviceId}_{uuid}.jsonl
```

---

## Architecture — Google Setup Workflow

```
Phase 1 — Developer: Register app with Google (one-time, ~5 min)
─────────────────────────────────────────────────────────────────
  You                          Google Cloud Console
  │                            │
  ├─ Create project ──────────▶│
  ├─ Enable Google Drive API ─▶│
  ├─ Create OAuth 2.0 Client ─▶│  (Desktop app type)
  │    └─ Download / copy      │
  │       Client ID            │
  │       Client Secret        │
  ├─ OAuth consent screen ────▶│  (Testing mode, up to 100 users)
  │    └─ Add test users       │  (each Gmail that needs access)
  └─ Done ────────────────────▶│


Phase 2 — First launch: SetupScreen (one-time per device)
──────────────────────────────────────────────────────────
  App starts
  │
  └─ check_credentials() → false
       │
       ▼
  SetupScreen shown
  │  7-step guide displayed
  │  User pastes Client ID + Client Secret
  │
  └─ save_credentials()
       └─ writes oauth_credentials.json to app data dir
            │
            ▼
       LoginScreen shown


Phase 3 — Sign in: OAuth 2.0 Loopback (per device, persists until sign-out)
─────────────────────────────────────────────────────────────────────────────
  User clicks "Sign in with Google"
  │
  └─ start_oauth() [Rust]
       │
       ├─ bind random TCP port (e.g. 52341)
       ├─ build auth URL with client_id, redirect_uri, scopes
       │    scopes: drive.appdata + email + profile
       │
       ├─ open browser ──────────────────────▶ accounts.google.com
       │                                            │
       │                                            │ User consents
       │                                            ▼
       ├─ TCP listener receives callback ─────────── GET /callback?code=…
       ├─ serve "Signed in!" HTML page
       │
       ├─ POST /token (code exchange) ──────▶ oauth2.googleapis.com
       │    ← access_token + refresh_token
       │
       ├─ GET /userinfo ────────────────────▶ googleapis.com
       │    ← email, name, picture
       │
       └─ save session.json (tokens + profile)
            │
            ▼
       Main app shown + pull_events() runs


Phase 4 — Runtime: Token lifecycle + sync
──────────────────────────────────────────
  Every API call
  │
  └─ ensure_valid_token()
       ├─ token valid (expires_at > now + 60s) → use as-is
       └─ token expired →
            POST /token (grant_type=refresh_token)
            ← new access_token
            save updated session.json

  Every 30 seconds (background interval)
  └─ push_events()
       collect unpushed command_log rows
       serialize → JSONL
       upload → Drive cmd_{deviceId}_{uuid}.jsonl
       mark rows pushed

  On window focus (visibilitychange)
  └─ pull_events()
       list Drive cmd_* files
       skip own device + already-applied batches
       download + replay each new batch
       UPSERT to local SQLite
```

---

## High-Level Workflows

### 1. Product Lifecycle

```
User types "add product"
        │
        ▼
ImageUploader (up to 2 images)
        │
        ▼
extract_text_from_image [Rust → Python OCR daemon]
        │  PP-OCRv5 reads packaging text
        ▼
ProductConfirm form (OCR pre-filled: brand, name, mfg, expiry)
        │  User edits + fills price, qty, category, supplier
        ▼
add_product [Rust]
  ├── embed name+brand (fastembed, 384-dim)
  ├── INSERT into SQLite products table
  └── log_command("add_product", json_payload)
        │
        ▼ (30s later)
push_events → Drive cmd file uploaded
        │
        ▼ (other devices on focus)
pull_events → apply_command("add_product") → UPSERT
```

### 2. Employee Lifecycle

```
add employee → EmployeeForm → add_employee → log_command

check in [name]
  ├── Monthly: skip if already checked in today
  ├── Hourly: replace today's entry with new hours
  │           increment check_in_days only on first check-in
  └── log_command("checkin_employee", {...})

Salary report → SalaryPeriodWidget
  ├── Monthly employees: count check_in_days in range × daily rate
  ├── Hourly employees: sum hours from checkInHistory entries in range
  └── Click employee name → drill-down table (per-day breakdown)
```

### 3. Inventory Reports

```
"salary report" / "inventory report" / "supplier report" / etc.
        │
        ▼
ReportMenuWidget → user picks report type + date range
        │
        ▼
Widget queries local SQLite data (already in React state)
        │
        ▼
Rendered in chat as interactive widget
  ├── Share via WhatsApp / email (native share sheet)
  └── Export as CSV (inventory report)
```

### 4. Semantic Search

```
User types "search [query]"
        │
        ▼
ai.ts — embed query text (fastembed, in-browser WASM)
        │
        ▼
search_products [Rust]
  ├── load all product embeddings from SQLite
  ├── compute cosine similarity vs query embedding
  └── return top-N results sorted by score
        │
        ▼
ProductTile results rendered in chat
```

### 5. OCR — Photo to Product

```
User selects image file(s)
        │
        ▼
ImageUploader → Tauri readBinaryFile → base64 encode
        │
        ▼
extract_text_from_image [Rust]
  ├── write image to temp file
  ├── send path to Python daemon via stdin
  └── read JSON result from daemon stdout
        │
        ▼
Python ocr_paddle.py (long-running process)
  ├── PP-OCRv5 mobile inference (ONNX, fully offline)
  └── returns { brand, name, manufactureDate, expiryDate, sourceLanguage }
        │
        ▼
ocr.ts parses result → ProductConfirm form pre-filled
```

### 6. Google Drive Sync

```
Push (every 30 seconds, background)
  App → collect command_log WHERE pushed = 0
  → serialize rows as JSONL (one JSON object per line)
  → upload to Drive appDataFolder as cmd_{deviceId}_{uuid}.jsonl
  → mark rows pushed = 1

Pull (on login + on window focus)
  App → list Drive files matching cmd_*
  → filter out own deviceId prefix
  → filter out file names in applied_batches table
  → for each new file: download JSONL
    → parse each line → apply_command()
    → UPSERT entities in SQLite (preserving local images + embeddings)
  → record file name in applied_batches
```

### 7. Auth Token Lifecycle

```
Session stored in session.json:
  { email, name, picture, access_token, refresh_token, expires_at }

Every API call (push/pull/Drive ops):
  ensure_valid_token()
    ├── expires_at > now + 60s  → return existing token
    └── expired →
          POST https://oauth2.googleapis.com/token
          { client_id, client_secret, refresh_token, grant_type: refresh_token }
          ← new access_token + expires_in
          update session.json

Sign out:
  sign_out() → delete session.json → app returns to LoginScreen
```

---

## Chat Commands

Type any of these into the chat box, or click a suggestion chip.

### Products — browsing

| Command | What it does |
|---------|-------------|
| `list products` | Show all products as flip tiles |
| `search [term]` | Semantic search by name, brand, or concept |
| `show stats` | Inventory value, buy-sell balance, warnings |
| `low stock` | Products with on-hand qty < 10 |
| `expiring` | Products expiring within 90 days |

### Products — adding

| Command | What it does |
|---------|-------------|
| `add product` | Opens image uploader (max 2 images) |

After uploading, PaddleOCR reads the packaging and extracts brand, product name, manufacture date, and expiry date. You then choose a category, optionally assign a supplier, and fill in buy price, sell price, and quantity before saving.

### Products — updating inventory

| Command | What it does |
|---------|-------------|
| `sold 5 [product]` | `soldQty += 5`, `onHand -= 5` |
| `bought 10 [product]` | `onHand += 10` |
| `received 20 [product]` | Same as bought |
| `restock 8 [product]` | Same as bought |
| `set quantity [product] to 50` | Set on-hand to exact value |
| `set sold [product] to 30` | Set sold count to exact value |
| `set sell price [product] to 25` | Update retail price |
| `set buy price [product] to 15` | Update cost price |
| `delete [product]` | Permanently remove product |

### Employees

| Command | What it does |
|---------|-------------|
| `list employees` | Show all staff as flip tiles |
| `add employee` | Open employee form |
| `check in [name]` | Mark attendance for today |
| `who checked in today` | Today's attendance list |
| `who checked in this week` | This week's attendance |
| `checked in last 7 days` | Any number of days |
| `employee stats` | Headcount, salary overview |
| `set salary [name] to [amount]` | Update pay rate |
| `set salary [name] to hourly/monthly` | Switch pay type |
| `edit employee [name]` | Edit employee details |
| `delete employee [name]` | Remove employee |
| `search employees [query]` | Find by name |

### Reports

| Command | What it does |
|---------|-------------|
| `reports` | Open the report picker |
| `inventory report` | Full product list — share via WhatsApp, email, or CSV |
| `product chart` | Revenue & stock value by category (pie chart) |
| `trending products` | Best-selling products over a chosen period |
| `unpopular products` | Slow-moving products over a chosen period |
| `supplier report` | Spend per supplier (pie chart) + stock/alert overview |
| `employee report` | All staff — salary, tenure, attendance |
| `salary report` | Pick a date range and calculate payout per employee |
| `monthly salary` | Month-to-date payroll total |
| `company spend` | Total monthly & annual payroll breakdown |
| `calculator` | Basic calculator (+ − × ÷) |

### Help

| Command | What it does |
|---------|-------------|
| `help` | Full command reference inside the app |
| `readme` | Opens this command guide inside the app |

---

## Data Model

All data is stored in a local SQLite database (`store.db`).

### Product fields

| Field | Source | Description |
|-------|--------|-------------|
| `id` | Auto | UUID, generated on save |
| `brand` | OCR | Extracted from packaging |
| `name` | OCR | Full product name as printed |
| `category` | User (OCR default) | Product category, defaults to "Food & Beverage" |
| `supplierId` | User | FK to suppliers table; empty = no supplier |
| `manufactureDate` | OCR | `YYYY-MM` / `YYYY-MM-DD` / `N/A` |
| `expiryDate` | OCR | Same format |
| `imageLocation` | File picker | Original file names of uploaded images (max 2) |
| `images_json` | Auto | Base64-encoded image data — device-local only, never synced |
| `quantity` | User | On-hand stock units |
| `soldQuantity` | User / commands | Total units sold |
| `buyPrice` | User | Cost per unit (₹) |
| `sellPrice` | User | Retail price per unit (₹) |
| `salesHistory` | Auto | `YYYY-MM-DD:qty,...` — last 30 days of daily sales |
| `buySellAmt` | Computed | `(sellPrice × sold) − (buyPrice × total bought)` |
| `embedding` | Auto | 384-dim semantic vector (AllMiniLML6V2Q) — device-local only, never synced |
| `sourceLanguage` | OCR internal | Language detected on wrapper — not shown in UI |

### Supplier fields

| Field | Source | Description |
|-------|--------|-------------|
| `id` | Auto | UUID |
| `name` | User | Supplier / vendor name |
| `phone` | User | Contact number (optional) |

### Employee fields

| Field | Source | Description |
|-------|--------|-------------|
| `id` | Auto | UUID |
| `name` | User | Full name |
| `salary` | User | Rate — monthly amount or hourly rate |
| `salaryType` | User | `"monthly"` or `"hourly"` |
| `dob` | User | `YYYY-MM-DD` / `N/A` |
| `joiningDate` | User | `YYYY-MM-DD` |
| `mobileNumber` | User | Contact number |
| `checkInDays` | Auto | Total days checked in |
| `lastCheckIn` | Auto | `YYYY-MM-DD` of most recent check-in |
| `checkInHistory` | Auto | Comma-separated check-in entries; hourly entries include hours: `YYYY-MM-DD:HH.HH` |
| `salaryHistory` | Auto | JSON array of `{date, salary, salaryType}` — tracks pay changes |

### Sync tables

| Table | Purpose |
|-------|---------|
| `command_log` | Every write operation as a JSON payload; `pushed` flag tracks upload status |
| `applied_batches` | Drive file names already replayed — prevents double-applying |

---

## Product Tile

Each tile in the chat flips on click:

```
FRONT                    BACK
┌──────────────────┐    ┌──────────────────┐
│  [product image] │    │  Brand           │
│                  │    │  Product name    │
│  brand           │    │  ─────────────── │
│  product name    │    │  On hand   50    │
│                  │    │  Sold       8    │
└──────────────────┘    │  Buy      ₹2.50  │
                        │  Sell     ₹4.99  │
                        │  Mfg  2024-03    │
                        │  Exp  2025-06    │
                        │  ─────────────── │
                        │  Buy-sell -₹5.00 │
                        │  🏪 Supplier Co  │
                        │  📁 front.jpg    │
                        └──────────────────┘
```

---

## Cost — Is Google Drive free?

Yes. The app uses the **Drive appDataFolder** which is a hidden, app-private folder in your Google Drive. It counts against your Google Drive storage quota (free tier is 15 GB). The sync files are tiny text (JSONL event logs), typically a few kilobytes per day of use. You will not hit storage limits under normal use.

No billing, no credit card, no Google Cloud fees after setup. The GCP project is only needed to create OAuth credentials — the API calls themselves are free within Google's standard quotas.
