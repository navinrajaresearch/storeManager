export interface Supplier {
  id: string;
  name: string;
  phone: string;
}

export interface Product {
  id: string;               // UUID, auto-generated
  brand: string;            // extracted from packaging
  sourceLanguage: string;   // language detected on packaging (OCR only, not shown in UI)
  name: string;             // product name
  category: string;         // product category, defaults to "Food & Beverage"
  supplierId: string;       // FK to suppliers.id, empty string = none
  manufactureDate: string;  // "YYYY-MM" | "YYYY-MM-DD" | "N/A"
  expiryDate: string;       // "YYYY-MM" | "YYYY-MM-DD" | "N/A"
  imageLocation: string[];  // original file names of uploaded images (max 2)
  quantity: number;         // on-hand stock
  soldQuantity: number;
  buyPrice: number;         // per unit
  sellPrice: number;        // per unit
  images: string[];         // data-URL blobs for display (max 2)
  salesHistory: string;     // "YYYY-MM-DD:qty,YYYY-MM-DD:qty,..." — last 30 days, or ""
}

/**
 * buy_sell_amt = (sellPrice × soldQuantity) − (buyPrice × totalUnits)
 * where totalUnits = quantity + soldQuantity
 * Starts negative (we paid to buy stock before selling anything).
 */
export function calcBuySellAmt(p: Product): number {
  const totalBought = p.quantity + p.soldQuantity;
  return p.sellPrice * p.soldQuantity - p.buyPrice * totalBought;
}

export type NewProduct = Omit<Product, "id"> & { rawText?: string };

// ── Employee ──────────────────────────────────────────────────────────────────

export interface Employee {
  id: string;
  name: string;
  photo: string;              // data-URL or ""
  salary: number;             // rate — monthly amount OR hourly rate
  salaryType: "monthly" | "hourly";
  dob: string;                // "YYYY-MM-DD" or "N/A"
  joiningDate: string;        // "YYYY-MM-DD"
  mobileNumber: string;       // contact number
  checkInDays: number;        // total days checked in
  lastCheckIn: string;        // "YYYY-MM-DD" or "N/A"
  checkInHistory: string;     // comma-separated dates "YYYY-MM-DD,YYYY-MM-DD,..." or ""
  salaryHistory: string;      // JSON string: [{"date":"YYYY-MM-DD","salary":50000,"salaryType":"monthly"}] or ""
}

/** Normalise any employee's pay to a monthly equivalent (hourly × 176 hrs). */
export function monthlyEquivalent(e: Employee): number {
  return e.salaryType === "hourly" ? e.salary * 176 : e.salary;
}

export type NewEmployee = Omit<Employee, "id">;

export const CATEGORIES = [
  "Food & Beverage",
  "Electronics",
  "Clothing",
  "Home & Garden",
  "Sports",
  "Books",
  "Toys",
  "Health & Beauty",
  "Automotive",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

// ── Chat ──────────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  products?: Product[];
  employees?: Employee[];
  widget?: "image_upload" | "employee_form" | "employee_edit" | "product_edit" | "report" | "employee_report" | "salary_report" | "salary_picker" | "product_chart" | "report_menu" | "search_disambig" | "product_trend" | "calculator" | "supplier_report" | "sell";
  sellingProduct?: Product;
  reportSubtype?: string;
  chartPeriod?: string;
  pendingProduct?: Partial<NewProduct>;
  editingEmployee?: Employee;
  editingProduct?: Product;
  searchQuery?: string;
  quickCommands?: string[];  // clickable command chips shown below the bubble
  loading?: boolean;
  ocrLoading?: boolean;
}

// ── Commands / suggestions ────────────────────────────────────────────────────

export const COMMAND_TEMPLATES = [
  "list products",
  "add product",
  "show stats",
  "low stock",
  "expiring",
  "search ",
  "sold ",
  "bought ",
  "received ",
  "restock ",
  "set quantity ",
  "set sold ",
  "delete ",
  "list employees",
  "add employee",
  "check in ",
  "who checked in today",
  "who checked in this week",
  "checked in last ",
  "employee stats",
  "search employees ",
  "set salary ",
  "delete employee ",
  "generate report",
  "product chart",
  "employee report",
  "salary today",
  "monthly salary",
  "company spend",
  "reports",
  "help",
  "readme",
] as const;

export const SUGGESTION_CHIPS = [
  { label: "List products",  cmd: "list products"   },
  { label: "Add product",    cmd: "add product"     },
  { label: "Employees",      cmd: "list employees"  },
  { label: "Reports",        cmd: "reports"         },
  { label: "Calculator",     cmd: "calculator"      },
] as const;
