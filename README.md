# Store Manager

A desktop inventory management app built with **Tauri v2**, **React**, **LanceDB**, and **Framer Motion**.  
Products are created by photographing their packaging — Tesseract OCR reads the wrapper and fills in fields automatically.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js ≥ 18 | [nodejs.org](https://nodejs.org) |
| Xcode CLI (macOS) | `xcode-select --install` |

> Rust is installed automatically by `start.command` if missing.

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
npm run tauri build   # production build
npm run dev           # frontend only (no Tauri shell)
```

---

## First-time Configuration

No API keys required — all OCR runs locally via Tesseract.

The `start.command` script installs Tesseract automatically on macOS.
On Linux: `sudo apt install tesseract-ocr libtesseract-dev`

---

## Chat Commands

Type any of these into the chat box, or click a suggestion chip.

### Browsing

| Command | What it does |
|---------|-------------|
| `list products` | Show all products as flip tiles |
| `search [term]` | Filter by name or brand |
| `show stats` | Inventory value, buy-sell balance, warnings |
| `low stock` | Products with on-hand qty < 10 |
| `expiring` | Products expiring within 90 days |

### Adding Products

| Command | What it does |
|---------|-------------|
| `add product` | Opens image uploader (max 2 images) |

After uploading, Tesseract OCR reads the packaging and extracts:
- Brand, product name, source language
- Manufacture date, expiry date

You then fill in buy price, sell price, and starting quantity before saving.

### Updating Inventory

| Command | What it does |
|---------|-------------|
| `sold 5 [product name]` | `soldQty += 5`, `onHand -= 5` |
| `sell 3 units of [product]` | Same |
| `bought 10 [product name]` | `onHand += 10` |
| `received 20 [product name]` | Same as bought |
| `restock 8 [product name]` | Same as bought |
| `set quantity [product] to 50` | Set on-hand to exact value |
| `set sold [product] to 30` | Set sold count to exact value |

### Removing

| Command | What it does |
|---------|-------------|
| `delete [product name]` | Permanently removes the product |

### Help

| Command | What it does |
|---------|-------------|
| `help` | Full command reference inside the app |
| `readme` | Opens this command guide inside the app |

---

## Product Fields

Every product stores these fields in LanceDB:

| Field | Source | Description |
|-------|--------|-------------|
| `id` | Auto | UUID, generated on save |
| `brand` | AI | Extracted from packaging |
| `name` | AI | Full product name as printed |
| `sourceLanguage` | AI | Language on the wrapper |
| `manufactureDate` | AI | `YYYY-MM` / `YYYY-MM-DD` / `N/A` |
| `expiryDate` | AI | Same format |
| `imageLocation` | File picker | Original file names of uploaded images |
| `quantity` | User | On-hand stock units |
| `soldQuantity` | User / commands | Total units sold |
| `buyPrice` | User | Cost per unit |
| `sellPrice` | User | Retail price per unit |
| `buySellAmt` | Computed | `(sellPrice × sold) − (buyPrice × total)` — starts negative |

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
│  🌐 Japanese     │    │  Sold       8    │
└──────────────────┘    │  Buy      $2.50  │
                        │  Sell     $4.99  │
                        │  Mfg  2024-03    │
                        │  Exp  2025-06    │
                        │  ─────────────── │
                        │  Buy-sell -$5.00 │
                        │  📁 front.jpg    │
                        └──────────────────┘
```

---

## Architecture

```
storeManager/
├── src/                        # React + TypeScript frontend
│   ├── App.tsx                 # Chat shell
│   ├── components/
│   │   ├── ProductTile.tsx     # Flip card (Framer Motion 3D)
│   │   ├── ImageUploader.tsx   # 2-slot image picker
│   │   ├── ProductConfirm.tsx  # AI result review form
│   │   ├── ChatInput.tsx       # Input + autocomplete dropdown
│   │   └── SuggestionChips.tsx # Quick-action chips
│   ├── lib/
│   │   ├── db.ts               # Tauri invoke wrappers
│   │   ├── ocr.ts              # Tesseract OCR + heuristic parsing
│   │   └── commands.ts         # Chat command parser
│   └── types.ts                # Shared interfaces
│
└── src-tauri/                  # Rust backend
    └── src/lib.rs              # LanceDB + Tauri commands
        ├── get_products
        ├── add_product
        ├── update_product      # delete + reinsert (quantity updates)
        ├── delete_product
        ├── search_products
        └── extract_text_from_image  # Tesseract OCR
```
