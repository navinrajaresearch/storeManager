// Semantic intent classifier — TF-IDF cosine similarity, fully offline.
// No model downloads, zero latency. Works as a fallback when regex fails.

export type Intent =
  | "report"
  | "sell"
  | "restock"
  | "set_quantity"
  | "set_sold"
  | "set_sell_price"
  | "set_buy_price"
  | "list_products"
  | "add_product"
  | "search_products"
  | "stats"
  | "low_stock"
  | "expiring"
  | "delete_product"
  | "list_employees"
  | "add_employee"
  | "checkin"
  | "attendance_today"
  | "attendance_week"
  | "attendance_days"
  | "employee_stats"
  | "search_employees"
  | "set_salary"
  | "delete_employee"
  | "help";

export interface SemanticMatch {
  intent: Intent;
  confidence: number; // 0–1
}

// ── Training examples per intent ──────────────────────────────────────────────
// More examples = better recall. Keep phrasing natural and varied.

const EXAMPLES: Record<Intent, string[]> = {
  sell: [
    "sold 5 iphone",
    "sell 3 kit kat",
    "selling 2 headphones",
    "i just sold five iphones",
    "we sold 3 units of chocolate",
    "mark 4 as sold",
    "dispatched 10 units of milk",
    "customer took 2 chocolates",
    "moved out 5 items",
    "sale recorded 3 phones",
    "i sold some snacks today",
    "sold off 2 remaining phones",
    "3 units went out the door",
    "sold some products",
  ],
  restock: [
    "bought 10 iphone",
    "received 20 kit kat",
    "restock 5 headphones",
    "restocked 15 units",
    "added 30 chocolates",
    "got 10 new phones in stock",
    "purchased 5 items",
    "stock arrived 20 units",
    "incoming 15 products",
    "new delivery of 10 chocolates",
    "added inventory 5 phones",
    "received a shipment of 20",
    "top up 10 ketchup",
    "replenished stock 25 units",
  ],
  set_quantity: [
    "set quantity iphone to 50",
    "set stock of kit kat to 20",
    "update quantity headphones to 15",
    "change on hand iphone to 30",
    "quantity iphone is now 40",
    "set inventory level to 25",
    "correct stock count to 18",
    "fix quantity milk to 12",
  ],
  set_sold: [
    "set sold iphone to 30",
    "set sold quantity of kit kat to 10",
    "update sold count to 20",
    "sold total headphones is 15",
    "correct sold units to 8",
  ],
  set_sell_price: [
    "set sell price iphone to 15",
    "change selling price of kit kat to 20",
    "update sell price headphones to 25",
    "can i change the product sell price to 15",
    "change the sell price to 10",
    "update selling price of milk to 5",
    "set the price we sell iphone for to 30",
    "selling price iphone 20",
    "change price iphone to 15",
    "how do i update the sell price",
  ],
  set_buy_price: [
    "set buy price iphone to 10",
    "change buying price of kit kat to 8",
    "update buy price headphones to 18",
    "change the buy price to 7",
    "update buying price of milk to 3",
    "set the cost price iphone to 12",
    "buying price iphone 9",
    "set purchase price to 6",
    "change cost of product to 10",
  ],
  list_products: [
    "list products",
    "show all products",
    "show products",
    "list all items",
    "display inventory",
    "what products do i have",
    "show me my stock",
    "show inventory",
    "all products",
    "what items are in stock",
    "view all stock",
    "inventory list",
  ],
  add_product: [
    "add product",
    "add new product",
    "create product",
    "new product",
    "add an item",
    "add item to inventory",
    "add to stock",
    "register product",
    "scan new product",
    "i want to add a product",
  ],
  search_products: [
    "search iphone",
    "find kit kat",
    "look up headphones",
    "search for chocolate",
    "find product milk",
    "look for snacks",
    "find items matching phone",
    "search stock for milk",
    "lookup product",
  ],
  stats: [
    "show stats",
    "statistics",
    "overview",
    "show statistics",
    "inventory overview",
    "how is the stock",
    "summary",
    "dashboard",
    "what are my stats",
    "give me an overview",
    "inventory summary",
  ],
  low_stock: [
    "low stock",
    "show low stock",
    "items running low",
    "what needs restocking",
    "stock running out",
    "almost out of stock",
    "low inventory",
    "show items below threshold",
    "what is running low",
    "items with low quantity",
  ],
  expiring: [
    "expiring",
    "expiry soon",
    "expiring soon",
    "products about to expire",
    "what expires soon",
    "check expiry dates",
    "near expiry items",
    "expiring products",
    "items that expire soon",
    "what will expire",
  ],
  delete_product: [
    "delete iphone",
    "remove kit kat",
    "delete product headphones",
    "remove item chocolate",
    "get rid of milk",
    "delete this product",
    "remove product from inventory",
    "discard iphone",
  ],
  list_employees: [
    "list employees",
    "show employees",
    "show all staff",
    "list staff",
    "show team",
    "who works here",
    "all employees",
    "staff list",
    "team members",
    "show me the team",
    "employee list",
  ],
  add_employee: [
    "add employee",
    "new employee",
    "add staff member",
    "hire someone",
    "add team member",
    "create employee",
    "register employee",
    "onboard new employee",
    "add a new person to the team",
  ],
  checkin: [
    "check in john",
    "mark john as present",
    "john is here today",
    "john checked in",
    "attendance for john",
    "john arrived",
    "log presence for john",
    "mark present sarah",
    "clock in mike",
    "john is in today",
  ],
  attendance_today: [
    "who checked in today",
    "attendance today",
    "who is present today",
    "today attendance",
    "who came in today",
    "present today",
    "todays attendance",
    "check in today report",
    "who is in today",
  ],
  attendance_week: [
    "who checked in this week",
    "attendance this week",
    "this week attendance",
    "who was present this week",
    "weekly attendance",
    "checked in this week",
    "show this weeks attendance",
  ],
  attendance_days: [
    "checked in last 7 days",
    "attendance last 7 days",
    "past 7 days attendance",
    "who came in last week",
    "attendance last 30 days",
    "checked in past 14 days",
    "show attendance last n days",
  ],
  employee_stats: [
    "employee stats",
    "staff stats",
    "employee statistics",
    "staff overview",
    "headcount overview",
    "salary overview",
    "team stats",
    "employee summary",
    "payroll summary",
  ],
  search_employees: [
    "search employees john",
    "find employee sarah",
    "look up staff john",
    "search staff for mike",
    "find team member",
    "search employee by name",
  ],
  set_salary: [
    "set salary john to 5000",
    "update salary of sarah to 3000",
    "change salary mike to 4500",
    "salary john is now 6000",
    "pay john 5000 per month",
    "update pay for sarah",
  ],
  delete_employee: [
    "delete employee john",
    "remove employee sarah",
    "fire john",
    "remove staff member mike",
    "delete team member",
    "offboard john",
    "let go of sarah",
  ],
  report: [
    "generate report",
    "export report",
    "export inventory",
    "generate inventory report",
    "export product list",
    "share inventory",
    "send product list",
    "export for email",
    "export for whatsapp",
    "share via email",
    "share via whatsapp",
    "download product list",
    "create report",
    "inventory report",
  ],
  help: [
    "help",
    "what can you do",
    "show commands",
    "how do i use this",
    "commands",
    "what commands are available",
    "guide",
    "instructions",
    "what should i type",
    "how does this work",
  ],
};

// ── Tokenizer ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "a", "an", "the", "is", "it", "in", "of", "for", "to", "and", "or",
  "do", "i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
  "this", "that", "with", "from", "as", "at", "by", "on", "be", "was",
  "are", "some", "now", "new", "can", "just", "all", "also", "into",
  "how", "what", "who", "has", "have", "give", "want",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// ── IDF computation ───────────────────────────────────────────────────────────

function buildIdf(): Map<string, number> {
  const allExamples = Object.values(EXAMPLES).flat();
  const N = allExamples.length;
  const df = new Map<string, number>();

  for (const ex of allExamples) {
    for (const token of new Set(tokenize(ex))) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1); // smoothed IDF
  }
  return idf;
}

function tfIdfVec(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  const vec = new Map<string, number>();
  for (const [t, count] of tf) {
    vec.set(t, (count / tokens.length) * (idf.get(t) ?? 1));
  }
  return vec;
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [t, va] of a) {
    dot += va * (b.get(t) ?? 0);
    normA += va * va;
  }
  for (const [, vb] of b) normB += vb * vb;
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Lazy-built index ──────────────────────────────────────────────────────────
// Centroids are averaged TF-IDF vectors across all examples for each intent.

type Index = {
  idf: Map<string, number>;
  centroids: Map<Intent, Map<string, number>>;
};

let _index: Index | null = null;

function getIndex(): Index {
  if (_index) return _index;

  const idf = buildIdf();
  const centroids = new Map<Intent, Map<string, number>>();

  for (const [intent, examples] of Object.entries(EXAMPLES) as [Intent, string[]][]) {
    const sum = new Map<string, number>();
    for (const ex of examples) {
      for (const [t, v] of tfIdfVec(tokenize(ex), idf)) {
        sum.set(t, (sum.get(t) ?? 0) + v);
      }
    }
    for (const [t, v] of sum) sum.set(t, v / examples.length);
    centroids.set(intent, sum);
  }

  _index = { idf, centroids };
  return _index;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns the best-matching intent and a 0–1 confidence score. */
export function semanticMatch(input: string): SemanticMatch {
  const { idf, centroids } = getIndex();
  const tokens = tokenize(input);
  if (!tokens.length) return { intent: "help", confidence: 0 };

  const vec = tfIdfVec(tokens, idf);
  let best: Intent = "help";
  let bestScore = -1;

  for (const [intent, centroid] of centroids) {
    const score = cosineSim(vec, centroid);
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }

  return { intent: best, confidence: bestScore };
}

/** Returns the top-k matches sorted by confidence. */
export function topMatches(input: string, k = 3): SemanticMatch[] {
  const { idf, centroids } = getIndex();
  const tokens = tokenize(input);
  if (!tokens.length) return [];

  const vec = tfIdfVec(tokens, idf);
  const scores: SemanticMatch[] = [];

  for (const [intent, centroid] of centroids) {
    scores.push({ intent, confidence: cosineSim(vec, centroid) });
  }

  return scores.sort((a, b) => b.confidence - a.confidence).slice(0, k);
}

// ── Argument extractor ────────────────────────────────────────────────────────
// Once we know the intent, pull structured args out of the raw input.

export function extractArgs(input: string, intent: Intent): Record<string, string> {
  const t = input.trim();

  switch (intent) {
    case "sell":
    case "restock": {
      // "sold 5 iphone" / "i just sold five iphones" / "sold iphone 5"
      const m = /(\d+)\s+(?:units?\s+of\s+)?([a-z].+)$/i.exec(t);
      if (m) return { amount: m[1], product: m[2].trim() };
      // Number at end: "sell iphone 5"
      const m2 = /([a-z].+?)\s+(\d+)$/i.exec(t);
      if (m2) return { amount: m2[2], product: m2[1].replace(/^(?:sold?|selling|bought|received?|restock(?:ed)?|add(?:ed)?)\s+/i, "").trim() };
      return {};
    }

    case "set_quantity": {
      const m = /(.+?)\s+to\s+(\d+)$/i.exec(t);
      if (!m) return {};
      const product = m[1]
        .replace(/^set\s+(?:quantity|stock|on[\s-]?hand)\s+(?:of\s+)?/i, "")
        .trim();
      return { product, value: m[2] };
    }

    case "set_sold": {
      const m = /(.+?)\s+to\s+(\d+)$/i.exec(t);
      if (!m) return {};
      const product = m[1]
        .replace(/^set\s+sold(?:\s+quantity)?\s+(?:of\s+)?/i, "")
        .trim();
      return { product, value: m[2] };
    }

    case "set_sell_price":
    case "set_buy_price": {
      const m = /(\d+(?:\.\d+)?)\s*$/i.exec(t);
      if (!m) return {};
      const value = m[1];
      // Extract product name — strip common price-change phrasing
      const product = t
        .replace(/(\d+(?:\.\d+)?)\s*$/, "")
        .replace(/^(?:can\s+i\s+)?(?:set|change|update)\s+(?:the\s+)?(?:sell(?:ing)?|buy(?:ing)?|cost|purchase)\s+price\s+(?:of\s+(?:the\s+)?)?/i, "")
        .replace(/\s+to\s*$/, "")
        .trim();
      return product ? { product, value } : { value };
    }

    case "search_products": {
      const m = /(?:search|find|look\s*(?:up|for))\s+(?:product\s+)?(.+)$/i.exec(t);
      return m ? { query: m[1].trim() } : {};
    }

    case "delete_product": {
      const m = /(?:delete|remove|get\s+rid\s+of|discard)(?:\s+(?:this\s+)?product)?\s+(.+)$/i.exec(t);
      return m ? { product: m[1].trim() } : {};
    }

    case "checkin": {
      const m = /(?:check[\s-]?in|mark|present|arriv(?:ed?)|attendance\s+for|log\s+presence\s+for|clock\s+in)\s+(.+)$/i.exec(t);
      return m ? { name: m[1].trim() } : {};
    }

    case "attendance_days": {
      const m = /(\d+)\s+days?/i.exec(t);
      return { days: m ? m[1] : "7" };
    }

    case "search_employees": {
      const m = /(?:search|find|look\s*(?:up|for))\s+(?:employees?\s+|staff\s+|team\s+member\s+)?(.+)$/i.exec(t);
      return m ? { query: m[1].trim() } : {};
    }

    case "set_salary": {
      const m = /(.+?)\s+to\s+(\d+(?:\.\d+)?)$/i.exec(t);
      if (!m) return {};
      const name = m[1]
        .replace(/^set\s+salary\s+(?:of\s+|for\s+)?/i, "")
        .replace(/^update\s+(?:salary|pay)\s+(?:of\s+|for\s+)?/i, "")
        .replace(/^change\s+salary\s+/i, "")
        .trim();
      return { name, amount: m[2] };
    }

    case "delete_employee": {
      const m = /(?:delete|remove|fire|offboard|let\s+go\s+of)(?:\s+(?:employee|staff\s+member|team\s+member))?\s+(.+)$/i.exec(t);
      return m ? { name: m[1].trim() } : {};
    }

    default:
      return {};
  }
}

// ── Human-readable intent labels (for "Did you mean?" messages) ───────────────

export const INTENT_LABEL: Record<Intent, string> = {
  sell:              "sold [qty] [product]",
  restock:           "bought [qty] [product]",
  set_quantity:      "set quantity [product] to [n]",
  set_sold:          "set sold [product] to [n]",
  set_sell_price:    "set sell price [product] to [amount]",
  set_buy_price:     "set buy price [product] to [amount]",
  list_products:     "list products",
  add_product:       "add product",
  search_products:   "search [product]",
  stats:             "show stats",
  low_stock:         "low stock",
  expiring:          "expiring",
  delete_product:    "delete [product]",
  list_employees:    "list employees",
  add_employee:      "add employee",
  checkin:           "check in [name]",
  attendance_today:  "who checked in today",
  attendance_week:   "who checked in this week",
  attendance_days:   "checked in last [n] days",
  employee_stats:    "employee stats",
  search_employees:  "search employees [name]",
  set_salary:        "set salary [name] to [amount]",
  delete_employee:   "delete employee [name]",
  report:            "generate report",
  help:              "help",
};
