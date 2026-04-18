import type { ChatMessage, Product, Employee } from "../types";
import { calcBuySellAmt, monthlyEquivalent } from "../types";
import { getProducts, searchProducts, deleteProduct, updateProduct } from "./db";
import { getEmployees, deleteEmployee, checkinEmployee, updateEmployee } from "./employeeDb";
import { nanoid } from "../utils/nanoid";
import { semanticMatch, topMatches, extractArgs, INTENT_LABEL } from "./ai";

export type CommandResult = Pick<ChatMessage, "text" | "products" | "employees" | "widget" | "reportSubtype" | "chartPeriod" | "editingEmployee" | "searchQuery" | "sellingProduct">;

// ── Product name matching ─────────────────────────────────────────────────────

function findProduct(products: Product[], query: string): Product | "none" | "ambiguous" {
  const q = query.toLowerCase().trim();
  // 1. exact name match
  const exact = products.filter((p) => p.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  // 2. brand + name match
  const branded = products.filter(
    (p) => `${p.brand} ${p.name}`.toLowerCase() === q
  );
  if (branded.length === 1) return branded[0];
  // 3. name contains query
  const contains = products.filter((p) => p.name.toLowerCase().includes(q));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) return "ambiguous";
  // 4. query contains name (short names)
  const reverse = products.filter((p) => q.includes(p.name.toLowerCase()));
  if (reverse.length === 1) return reverse[0];
  if (reverse.length > 1) return "ambiguous";
  return "none";
}

function ambiguousMsg(products: Product[], query: string): string {
  const q = query.toLowerCase();
  const matches = products.filter(
    (p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase())
  );
  const names = matches.slice(0, 5).map((p) => `**${p.name}**`).join(", ");
  return `Multiple products match "${query}": ${names}. Be more specific.`;
}

// ── Employee helpers ──────────────────────────────────────────────────────────

function findEmployee(employees: Employee[], query: string): Employee | "none" | "ambiguous" {
  const q = query.toLowerCase().trim();
  const exact = employees.filter((e) => e.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const contains = employees.filter((e) => e.name.toLowerCase().includes(q));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) return "ambiguous";
  return "none";
}

function ambiguousEmployeeMsg(employees: Employee[], query: string): string {
  const q = query.toLowerCase();
  const matches = employees.filter((e) => e.name.toLowerCase().includes(q));
  const names = matches.slice(0, 5).map((e) => `**${e.name}**`).join(", ");
  return `Multiple employees match "${query}": ${names}. Be more specific.`;
}

function tenureYears(joiningDate: string): string {
  if (!joiningDate || joiningDate === "N/A") return "";
  const diff = Date.now() - new Date(joiningDate).getTime();
  const yrs = diff / (365.25 * 24 * 60 * 60 * 1000);
  return yrs >= 1 ? `${yrs.toFixed(1)} yrs` : `${Math.round(yrs * 12)} mo`;
}

// ── Quantity update helpers ───────────────────────────────────────────────────

async function processSold(rawAmount: string, productQuery: string): Promise<CommandResult> {
  const amount = parseInt(rawAmount, 10);
  if (isNaN(amount) || amount <= 0) return { text: "Amount must be a positive number." };

  const products = await getProducts();
  const match = findProduct(products, productQuery);
  if (match === "none") return { text: `No product found matching **"${productQuery}"**.` };
  if (match === "ambiguous") return { text: ambiguousMsg(products, productQuery) };

  if (match.quantity < amount) {
    return {
      text: `Cannot mark **${amount}** unit${amount > 1 ? "s" : ""} sold — only **${match.quantity}** on hand for **${match.name}**.`,
    };
  }

  // Update sales history for trend tracking
  const today = new Date().toISOString().slice(0, 10);
  const entries = (match.salesHistory || "").split(",").filter(Boolean);
  const idx = entries.findIndex((e) => e.startsWith(today + ":"));
  if (idx >= 0) {
    const prev = parseInt(entries[idx].split(":")[1]) || 0;
    entries[idx] = `${today}:${prev + amount}`;
  } else {
    entries.push(`${today}:${amount}`);
  }
  entries.sort();
  if (entries.length > 30) entries.splice(0, entries.length - 30);
  const salesHistory = entries.join(",");

  const updated: Product = {
    ...match,
    quantity:     match.quantity - amount,
    soldQuantity: match.soldQuantity + amount,
    salesHistory,
  };

  const saved = await updateProduct(updated);
  const bsa = calcBuySellAmt(saved);
  const bsaSign = bsa >= 0 ? "+" : "";

  return {
    text: `Sold **${amount}** unit${amount > 1 ? "s" : ""} of **${saved.name}**.\nOn hand: **${saved.quantity}** · Sold total: **${saved.soldQuantity}** · Buy-sell: **${bsaSign}₹${bsa.toFixed(2)}**`,
    products: [saved],
  };
}

async function processBought(rawAmount: string, productQuery: string): Promise<CommandResult> {
  const amount = parseInt(rawAmount, 10);
  if (isNaN(amount) || amount <= 0) return { text: "Amount must be a positive number." };

  const products = await getProducts();
  const match = findProduct(products, productQuery);
  if (match === "none") return { text: `No product found matching **"${productQuery}"**.` };
  if (match === "ambiguous") return { text: ambiguousMsg(products, productQuery) };

  const updated: Product = {
    ...match,
    quantity: match.quantity + amount,
  };

  const saved = await updateProduct(updated);
  const bsa = calcBuySellAmt(saved);
  const bsaSign = bsa >= 0 ? "+" : "";

  return {
    text: `Restocked **${amount}** unit${amount > 1 ? "s" : ""} of **${saved.name}**.\nOn hand: **${saved.quantity}** · Buy-sell: **${bsaSign}₹${bsa.toFixed(2)}**`,
    products: [saved],
  };
}

async function processSetField(
  field: "quantity" | "soldQuantity",
  rawValue: string,
  productQuery: string
): Promise<CommandResult> {
  const value = parseInt(rawValue, 10);
  if (isNaN(value) || value < 0) return { text: "Value must be a non-negative number." };

  const products = await getProducts();
  const match = findProduct(products, productQuery);
  if (match === "none") return { text: `No product found matching **"${productQuery}"**.` };
  if (match === "ambiguous") return { text: ambiguousMsg(products, productQuery) };

  const updated: Product = { ...match, [field]: value };
  const saved = await updateProduct(updated);
  const label = field === "quantity" ? "On-hand quantity" : "Sold quantity";

  return {
    text: `**${label}** for **${saved.name}** set to **${value}**.`,
    products: [saved],
  };
}

async function processSetPrice(
  field: "buyPrice" | "sellPrice",
  rawValue: string,
  productQuery: string
): Promise<CommandResult> {
  const value = parseFloat(rawValue);
  if (isNaN(value) || value < 0) return { text: "Price must be a non-negative number." };

  const products = await getProducts();
  const match = findProduct(products, productQuery);
  if (match === "none") return { text: `No product found matching **"${productQuery}"**.` };
  if (match === "ambiguous") return { text: ambiguousMsg(products, productQuery) };

  const updated: Product = { ...match, [field]: value };
  const saved = await updateProduct(updated);
  const label = field === "sellPrice" ? "Sell price" : "Buy price";

  return {
    text: `**${label}** for **${saved.name}** updated to **₹${value.toFixed(2)}**.`,
    products: [saved],
  };
}

// ── Main command dispatcher ────────────────────────────────────────────────────

export async function processCommand(input: string): Promise<CommandResult> {
  const t = input.trim().toLowerCase();

  // ── sell (open sell widget) ───────────────────────────────────────────────
  // "sell", "sell Kit Kat" (no number = open widget; with number goes to processSold below)
  if (t === "sell") {
    const products = await getProducts();
    const available = products.filter((p) => p.quantity > 0);
    if (!available.length) return { text: "No products with stock available to sell." };
    return {
      text: "Which product are you selling?",
      widget: "sell",
      products: available,
    };
  }
  {
    const m = /^sell\s+([^\d].*)$/i.exec(input.trim());
    if (m) {
      const products = await getProducts();
      const available = products.filter((p) => p.quantity > 0);
      if (!available.length) return { text: "No products with stock available to sell." };
      const match = findProduct(products, m[1].trim());
      const pre = match !== "none" && match !== "ambiguous" ? match : undefined;
      if (match === "ambiguous") return { text: ambiguousMsg(products, m[1].trim()) };
      return {
        text: pre ? `Selling **${pre.name}** — enter quantity and price.` : "Which product are you selling?",
        widget: "sell",
        products: available,
        ...(pre ? { sellingProduct: pre } : {}),
      };
    }
  }

  // ── sold N [product] ──────────────────────────────────────────────────────
  // "sold 5 iPhone", "sell 3 units of Kit Kat", "selling 2 headphones"
  {
    const m = /^(?:sold?|selling)\s+(\d+)\s+(?:units?\s+of\s+)?(.+)$/i.exec(input.trim());
    if (m) return processSold(m[1], m[2].trim());
  }

  // ── bought/received/restocked N [product] ────────────────────────────────
  // "bought 10 iPhone", "received 20 Kit Kat", "restock 5 headphones"
  {
    const m = /^(?:bought|received?|restocked?|restock|added?)\s+(\d+)\s+(?:units?\s+of\s+)?(.+)$/i.exec(input.trim());
    if (m) return processBought(m[1], m[2].trim());
  }

  // ── set quantity [product] to N ───────────────────────────────────────────
  // "set quantity iPhone to 50", "set stock of iPhone to 50"
  {
    const m = /^set\s+(?:quantity|stock|on[\s-]?hand)\s+(?:of\s+)?(.+?)\s+to\s+(\d+)$/i.exec(input.trim());
    if (m) return processSetField("quantity", m[2], m[1].trim());
  }

  // ── set sold [product] to N ───────────────────────────────────────────────
  // "set sold iPhone to 30", "set sold quantity of iPhone to 30"
  {
    const m = /^set\s+sold(?:\s+quantity)?\s+(?:of\s+)?(.+?)\s+to\s+(\d+)$/i.exec(input.trim());
    if (m) return processSetField("soldQuantity", m[2], m[1].trim());
  }

  // ── set sell price [product] to N ────────────────────────────────────────
  // "set sell price iPhone to 15", "change selling price of Kit Kat to 20"
  {
    const m = /(?:set|change|update)\s+sell(?:ing)?\s+price\s+(?:of\s+)?(.+?)\s+to\s+(\d+(?:\.\d+)?)$/i.exec(input.trim());
    if (m) return processSetPrice("sellPrice", m[2], m[1].trim());
  }

  // ── set buy price [product] to N ─────────────────────────────────────────
  // "set buy price iPhone to 10", "change buying price of Kit Kat to 8"
  {
    const m = /(?:set|change|update)\s+buy(?:ing)?\s+price\s+(?:of\s+)?(.+?)\s+to\s+(\d+(?:\.\d+)?)$/i.exec(input.trim());
    if (m) return processSetPrice("buyPrice", m[2], m[1].trim());
  }

  // ── trending products ─────────────────────────────────────────────────────
  if (/trending\s+products?|top\s+selling|best\s+sellers?/i.test(t)) {
    const products = await getProducts();
    if (!products.length) return { text: "No products yet." };
    return { text: "Pick a period to see trending products.", widget: "product_trend", products };
  }

  // ── unpopular products ─────────────────────────────────────────────────────
  if (/unpopular\s+products?|slow\s+moving|not\s+moving|stale\s+stock|stuck\s+stock/i.test(t)) {
    const products = await getProducts();
    if (!products.length) return { text: "No products yet." };
    return { text: "Pick a period to see unpopular products.", widget: "product_trend", products };
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (/^(list|show)\s*(all\s*)?products?$/.test(t) || t === "ls") {
    const products = await getProducts();
    return products.length
      ? { text: `Showing **${products.length}** product${products.length > 1 ? "s" : ""}.`, products }
      : { text: "No products yet. Try **add product** to get started." };
  }

  // ── add ───────────────────────────────────────────────────────────────────
  if (/^add\s*(a\s*)?(\bnew\b\s*)?product$/.test(t)) {
    return {
      text: "Upload up to **2 product images** (front & back of the wrapper). I'll read the packaging and fill in brand, name, dates, and language automatically.",
      widget: "image_upload",
    };
  }

  // ── search products [query] (direct) ─────────────────────────────────────
  {
    const m = /^(?:search|find)\s+products?\s+(.+)$/i.exec(input.trim());
    if (m) {
      const query = m[1].trim();
      const products = await searchProducts(query);
      return products.length
        ? { text: `Found **${products.length}** product${products.length > 1 ? "s" : ""} for "${query}".`, products }
        : { text: `No products matched **"${query}"**.` };
    }
  }

  // ── search employees [query] (direct) ─────────────────────────────────────
  {
    const m = /^(?:search|find)\s+employees?\s+(.+)$/i.exec(input.trim());
    if (m) {
      const query = m[1].trim();
      const employees = (await getEmployees()).filter((e) =>
        e.name.toLowerCase().includes(query.toLowerCase())
      );
      return employees.length
        ? { text: `Found **${employees.length}** employee${employees.length > 1 ? "s" : ""} for "${query}".`, employees }
        : { text: `No employees matched **"${query}"**.` };
    }
  }

  // ── search / find — ask what kind ─────────────────────────────────────────
  if (t.startsWith("search ") || t.startsWith("find ")) {
    const query = input.trim().replace(/^(search|find)\s+/i, "");
    if (!query) return { text: "What should I search for? e.g. **search Nestlé**" };
    return { text: `Looking for "**${query}**" — what are you searching for?`, widget: "search_disambig", searchQuery: query };
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  if (/^(show\s*)?(stats?|statistics|overview)$/.test(t)) {
    const products = await getProducts();
    return { text: buildStats(products) };
  }

  // ── low stock ─────────────────────────────────────────────────────────────
  if (/^(show\s*)?low[\s-]?stock(\s*items?)?$/.test(t)) {
    const products = await getProducts();
    const low = products.filter((p) => p.quantity < 10);
    return low.length
      ? { text: `**${low.length}** item${low.length > 1 ? "s" : ""} with low stock (qty < 10).`, products: low }
      : { text: "All items are well-stocked (qty ≥ 10)." };
  }

  // ── expiring soon ─────────────────────────────────────────────────────────
  if (/^expir(ing|y)(\s*soon)?$/.test(t)) {
    const products = await getProducts();
    const in90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const soon = products.filter((p) => {
      if (p.expiryDate === "N/A") return false;
      const d = new Date(p.expiryDate);
      return !isNaN(d.getTime()) && d <= in90;
    });
    return soon.length
      ? { text: `**${soon.length}** product${soon.length > 1 ? "s" : ""} expiring within 90 days.`, products: soon }
      : { text: "No products expiring within the next 90 days." };
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (t.startsWith("delete ") || t.startsWith("remove ")) {
    const name = input.trim().replace(/^(delete|remove)\s+/i, "");
    const products = await getProducts();
    const match = findProduct(products, name);
    if (match === "none") return { text: `No product named **"${name}"** found.` };
    if (match === "ambiguous") return { text: ambiguousMsg(products, name) };
    await deleteProduct(match.id);
    return { text: `Deleted **${match.name}**.` };
  }

  // ── list employees ────────────────────────────────────────────────────────
  if (/^(list|show)\s*(all\s*)?employees?$/.test(t) || t === "staff" || t === "team") {
    const employees = await getEmployees();
    return employees.length
      ? { text: `**${employees.length}** employee${employees.length > 1 ? "s" : ""} on record.`, employees }
      : { text: "No employees yet. Try **add employee** to get started." };
  }

  // ── add employee ──────────────────────────────────────────────────────────
  if (/^add\s*(a\s*)?(new\s*)?employee$/.test(t)) {
    return {
      text: "Fill in the employee details below.",
      widget: "employee_form",
    };
  }

  // ── attendance queries ────────────────────────────────────────────────────
  // "who checked in today", "attendance today", "checked in last 7 days", etc.
  {
    // "last N days" / "past N days"
    const m = /(?:checked?\s*in|attendance|present)\s+(?:last|past)\s+(\d+)\s+days?/i.exec(input.trim());
    if (m) {
      const n = parseInt(m[1], 10);
      const cutoff = new Date(Date.now() - (n - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const employees = await getEmployees();
      const found = employees.filter((e) => e.lastCheckIn !== "N/A" && e.lastCheckIn >= cutoff);
      return found.length
        ? { text: `**${found.length}** employee${found.length > 1 ? "s" : ""} checked in within the last **${n} day${n > 1 ? "s" : ""}**.`, employees: found }
        : { text: `Nobody has checked in within the last **${n} day${n > 1 ? "s" : ""}**.` };
    }
  }

  {
    // "this week" / "checked in this week"
    const isWeekQuery = /(?:checked?\s*in|attendance|present).*\bthis\s+week\b/i.test(input) ||
      /\bthis\s+week(?:'s)?\s+(?:attendance|check[\s-]?in)/i.test(input);
    if (isWeekQuery) {
      const day = new Date().getDay(); // 0=Sun
      const startOfWeek = new Date(Date.now() - day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const employees = await getEmployees();
      const found = employees.filter((e) => e.lastCheckIn !== "N/A" && e.lastCheckIn >= startOfWeek);
      return found.length
        ? { text: `**${found.length}** employee${found.length > 1 ? "s" : ""} checked in this week.`, employees: found }
        : { text: "Nobody has checked in this week yet." };
    }
  }

  {
    // "today" / "attendance today" / "who checked in today"
    const isTodayQuery = /(?:checked?\s*in|attendance|present).*\btoday\b/i.test(input) ||
      /\btoday'?s?\s+(?:attendance|check[\s-]?in)/i.test(input) ||
      /\bwho(?:\s+is|\s+are)?\s+(?:checked?\s*in|present|in\s+today)/i.test(input);
    if (isTodayQuery) {
      const today = new Date().toISOString().slice(0, 10);
      const employees = await getEmployees();
      const found = employees.filter((e) => e.lastCheckIn === today);
      const absent = employees.filter((e) => e.lastCheckIn !== today);
      const absentLine = absent.length
        ? `\nNot yet in: ${absent.map((e) => `**${e.name}**`).join(", ")}`
        : "";
      return found.length
        ? { text: `**${found.length}** of ${employees.length} checked in today.${absentLine}`, employees: found }
        : { text: `Nobody has checked in today yet.${absentLine}` };
    }
  }

  // ── check in [name] [N hours] ─────────────────────────────────────────────
  // supports: "check in alice", "check in alice 4", "check in alice 4h", "check in alice 4 hours"
  {
    const m = /^check[\s-]?in\s+(.+)$/i.exec(input.trim());
    if (m) {
      let nameQuery = m[1].trim();
      let hours: number | undefined;

      // Try to peel off a trailing hours value: "alice 4", "alice 4h", "alice 4 hours"
      const hoursM = /^(.*?)\s+(\d+(?:\.\d+)?)\s*(?:h(?:ours?|rs?)?)?\s*$/i.exec(nameQuery);
      if (hoursM && parseFloat(hoursM[2]) > 0) {
        nameQuery = hoursM[1].trim();
        hours = parseFloat(hoursM[2]);
      }

      const employees = await getEmployees();
      const match = findEmployee(employees, nameQuery);
      if (match === "none") return { text: `No employee found matching **"${nameQuery}"**.` };
      if (match === "ambiguous") return { text: ambiguousEmployeeMsg(employees, nameQuery) };

      const today = new Date().toISOString().slice(0, 10);
      if (match.lastCheckIn === today) {
        return { text: `**${match.name}** already checked in today (${today}).`, employees: [match] };
      }

      // Hourly employees must have hours
      if (match.salaryType === "hourly" && hours === undefined) {
        return {
          text: `**${match.name}** is paid hourly. How many hours did they work today?\nTry: \`check in ${match.name} 6\` or use the tile check-in button.`,
        };
      }

      const updated = await checkinEmployee(match.id, hours);
      const hoursNote = match.salaryType === "hourly" && hours !== undefined
        ? ` (${hours} hr${hours !== 1 ? "s" : ""})` : "";
      return {
        text: `Checked in **${updated.name}**${hoursNote} — day **${updated.checkInDays}** total.`,
        employees: [updated],
      };
    }
  }

  // ── check in (no name) ────────────────────────────────────────────────────
  if (/^check[\s-]?in$/.test(t)) {
    const employees = await getEmployees();
    if (!employees.length) return { text: "No employees on record yet." };
    const names = employees.map((e) => `**${e.name}**`).join(", ");
    return { text: `Who is checking in? Try: \`check in [name]\`\nEmployees: ${names}` };
  }

  // ── employee stats ────────────────────────────────────────────────────────
  if (/^employee[\s-]?stats?$/.test(t) || t === "staff stats") {
    const employees = await getEmployees();
    return { text: buildEmployeeStats(employees) };
  }

  // ── search employees ──────────────────────────────────────────────────────
  if (/^search\s+employees?\s+/i.test(input.trim())) {
    const q = input.trim().replace(/^search\s+employees?\s+/i, "").toLowerCase();
    const employees = await getEmployees();
    const found = employees.filter((e) => e.name.toLowerCase().includes(q));
    return found.length
      ? { text: `Found **${found.length}** employee${found.length > 1 ? "s" : ""} matching "${q}".`, employees: found }
      : { text: `No employee found matching **"${q}"**.` };
  }

  // ── set salary type [name] to hourly|monthly ─────────────────────────────
  // "set salary navin to hourly", "set navin to monthly", "change navin salary type to hourly"
  {
    const m = /^(?:set|change|switch|update)\s+(?:salary\s+(?:type\s+)?(?:of\s+)?|salary\s+)?(.+?)\s+(?:salary\s+)?(?:type\s+)?to\s+(\w+)$/i.exec(input.trim());
    if (m) {
      const typeWord = m[2].toLowerCase();
      const salaryType: "hourly" | "monthly" | null =
        /^ho?u?r/.test(typeWord) ? "hourly" :
        /^mo?n/.test(typeWord)   ? "monthly" : null;
      if (salaryType) {
        const employees = await getEmployees();
        const match = findEmployee(employees, m[1].trim());
        if (match === "none") return { text: `No employee found matching **"${m[1].trim()}"**.` };
        if (match === "ambiguous") return { text: ambiguousEmployeeMsg(employees, m[1].trim()) };
        const updated = await updateEmployee({ ...match, salaryType });
        const rateLabel = salaryType === "hourly" ? `₹${updated.salary.toFixed(2)}/hr` : `₹${updated.salary.toFixed(2)}/mo`;
        return {
          text: `**${updated.name}** switched to **${salaryType}** pay — current rate ${rateLabel}.`,
          employees: [updated],
        };
      }
    }
  }

  // ── set salary [name] to [amount] ─────────────────────────────────────────
  {
    const m = /^set\s+salary\s+(?:of\s+)?(.+?)\s+to\s+(\d+(?:\.\d+)?)$/i.exec(input.trim());
    if (m) {
      const employees = await getEmployees();
      const match = findEmployee(employees, m[1].trim());
      if (match === "none") return { text: `No employee found matching **"${m[1].trim()}"**.` };
      if (match === "ambiguous") return { text: ambiguousEmployeeMsg(employees, m[1].trim()) };
      const salary = parseFloat(m[2]);
      const updated = await updateEmployee({ ...match, salary });
      const suffix = updated.salaryType === "hourly" ? "/hr" : "/mo";
      return {
        text: `Salary for **${updated.name}** updated to **₹${salary.toFixed(2)}${suffix}**.`,
        employees: [updated],
      };
    }
  }

  // ── edit employee [name] ──────────────────────────────────────────────────
  // "edit navin", "edit navin's details", "update employee navin", "modify alice"
  {
    const m = /^(?:edit|update|modify|change\s+details?(?:\s+of)?|edit\s+details?(?:\s+of)?)\s+(?:employee\s+)?(.+?)(?:'s\s+details?)?$/i.exec(input.trim());
    if (m) {
      const employees = await getEmployees();
      const match = findEmployee(employees, m[1].trim());
      if (match === "none") return { text: `No employee found matching **"${m[1].trim()}"**.` };
      if (match === "ambiguous") return { text: ambiguousEmployeeMsg(employees, m[1].trim()) };
      return {
        text: `Editing **${match.name}** — update any fields and save.`,
        widget: "employee_edit",
        editingEmployee: match,
      };
    }
  }

  // ── delete employee [name] ────────────────────────────────────────────────
  if (/^(delete|remove)\s+employee\s+/i.test(input.trim())) {
    const name = input.trim().replace(/^(delete|remove)\s+employee\s+/i, "");
    const employees = await getEmployees();
    const match = findEmployee(employees, name);
    if (match === "none") return { text: `No employee named **"${name}"** found.` };
    if (match === "ambiguous") return { text: ambiguousEmployeeMsg(employees, name) };
    await deleteEmployee(match.id);
    return { text: `Removed employee **${match.name}** from records.` };
  }

  // ── employee report (all employees) ──────────────────────────────────────
  if (/^(?:employee|staff|all\s+employee|all\s+staff)\s+report$|^report\s+(?:all\s+)?(?:employees?|staff)$/i.test(t)) {
    const employees = await getEmployees();
    if (!employees.length) return { text: "No employees on record yet." };
    return {
      text: `Employee report — **${employees.length}** staff member${employees.length !== 1 ? "s" : ""}.`,
      widget: "employee_report",
      employees,
      reportSubtype: "all",
    };
  }

  // ── salary today / salary report ─────────────────────────────────────────
  if (/salary\s+(?:due\s+)?today|today'?s?\s+salary|daily\s+salary\s+report|salary\s+for\s+today|salary\s+report|salary\s+last\s+\d+\s+days?/i.test(t)) {
    const allEmployees = await getEmployees();
    if (!allEmployees.length) return { text: "No employees on record yet." };
    return {
      text: "Pick a period to calculate salary payout.",
      widget: "salary_picker",
      employees: allEmployees,
    };
  }

  // ── salary this month ─────────────────────────────────────────────────────
  if (/monthly\s+salary|salary\s+(?:for\s+(?:the\s+)?)?month|salary\s+report\s+month|month(?:ly)?\s+payroll/i.test(t)) {
    const employees = await getEmployees();
    if (!employees.length) return { text: "No employees on record yet." };
    const total = employees.reduce((s, e) => s + monthlyEquivalent(e), 0);
    const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    return {
      text: `Monthly salary for **${month}** — **₹${total.toFixed(2)}** total across **${employees.length}** employee${employees.length !== 1 ? "s" : ""}.`,
      widget: "salary_report",
      employees,
      reportSubtype: "salary_month",
    };
  }

  // ── company employee spend ────────────────────────────────────────────────
  if (/company\s+spend|(?:total\s+)?(?:spend|spent|cost|expense)\s+(?:on\s+)?employee|employee\s+(?:cost|expense|budget)/i.test(t)) {
    const employees = await getEmployees();
    if (!employees.length) return { text: "No employees on record yet." };
    const total = employees.reduce((s, e) => s + monthlyEquivalent(e), 0);
    return {
      text: `Company employee spend — **₹${total.toFixed(2)}/month** · **₹${(total * 12).toFixed(2)}/year** across **${employees.length}** staff.`,
      widget: "salary_report",
      employees,
      reportSubtype: "company_spend",
    };
  }

  // ── product chart / sales chart ───────────────────────────────────────────
  {
    const isWeek  = /product\s+(?:sales?|report|chart)\s+(?:this\s+)?week|weekly\s+(?:sales?|product\s+report)/i.test(t);
    const isMonth = /product\s+(?:sales?|report|chart)\s+(?:this\s+)?month|monthly\s+(?:sales?|product\s+report)/i.test(t);
    const isYear  = /product\s+(?:sales?|report|chart)\s+(?:this\s+)?year|yearly\s+(?:sales?|product\s+report)/i.test(t);
    const isChart = /^(?:product\s+)?(?:sales?\s+)?chart$|^product\s+(?:sales?|analytics|report\s+chart)$/i.test(t);
    if (isWeek || isMonth || isYear || isChart) {
      const products = await getProducts();
      if (!products.length) return { text: "No products in inventory yet." };
      const period = isWeek ? "week" : isMonth ? "month" : isYear ? "year" : undefined;
      return {
        text: `Product analytics — **${products.length}** product${products.length !== 1 ? "s" : ""}.`,
        widget: "product_chart",
        products,
        chartPeriod: period,
      };
    }
  }

  // ── supplier report ───────────────────────────────────────────────────────
  if (/supplier\s+report|supplier\s+spend|spend\s+(?:by|per)\s+supplier|supplier\s+overview/i.test(t)) {
    const products = await getProducts();
    if (!products.length) return { text: "No products in inventory yet." };
    return {
      text: `Supplier report — **${products.length}** product${products.length !== 1 ? "s" : ""}.`,
      widget: "supplier_report",
      products,
    };
  }

  // ── inventory report ──────────────────────────────────────────────────────
  if (/^(?:inventory|stock|product)\s+report$/i.test(t)) {
    const products = await getProducts();
    if (!products.length) return { text: "No products in inventory yet." };
    return { text: `Inventory report — **${products.length}** product${products.length !== 1 ? "s" : ""}.`, widget: "report", products };
  }

  // ── report menu (picker) ──────────────────────────────────────────────────
  if (/^(?:list|show|what|available)\s+reports?$|^reports?$/i.test(t) ||
      /^(?:generate|export|show|create)?\s*report$/.test(t) ||
      t === "export") {
    return {
      text: "Which report would you like?",
      widget: "report_menu",
    };
  }

  // ── calculator ────────────────────────────────────────────────────────────
  if (t === "calculator" || t === "calc" || t === "calculate") {
    return { text: "", widget: "calculator" };
  }

  // ── help ──────────────────────────────────────────────────────────────────
  if (t === "help" || t === "?") {
    return {
      text: [
        "**Available commands:**",
        "",
        "_Inventory_",
        "• `list products` · `add product` · `show stats`",
        "• `low stock` · `expiring`",
        "• `sold 5 [product]` — record a sale",
        "• `bought 10 [product]` — restock",
        "• `set quantity [product] to 20` — set stock",
        "• `set sell price [product] to 25` — update sell price",
        "• `set buy price [product] to 15` — update cost price",
        "• `search products [query]` · `delete [product]`",
        "",
        "_Employees_",
        "• `list employees` · `add employee`",
        "• `check in [name]` — mark attendance (monthly staff)",
        "• `check in [name] 6` — mark attendance with hours (hourly staff)",
        "• `who checked in today` · `who checked in this week`",
        "• `checked in last 7 days` — any number of days",
        "• `employee stats` — headcount & salary overview",
        "• `set salary [name] to [amount]` — update pay",
        "• `set salary [name] to hourly/monthly` — switch type",
        "• `edit employee [name]` — edit details",
        "• `delete employee [name]` · `search employees [query]`",
        "",
        "_Reports_",
        "• `reports` — open report picker",
        "• `calculator` — basic calculator (+  −  ×  ÷)",
        "• `inventory report` · `product chart`",
        "• `trending products` · `unpopular products`",
        "• `supplier report` — spend pie chart + supplier overview",
        "• `employee report` · `salary report`",
        "• `salary today` · `monthly salary` · `company spend`",
      ].join("\n"),
    };
  }

  // ── Semantic fallback ────────────────────────────────────────────────────────
  // Regex didn't match — try to infer intent from natural language.
  const best = semanticMatch(input);
  const args = extractArgs(input, best.intent);

  if (best.confidence >= 0.4) {
    // High confidence: attempt to dispatch
    switch (best.intent) {
      case "sell":
        if (args.amount && args.product) return processSold(args.amount, args.product);
        break;
      case "restock":
        if (args.amount && args.product) return processBought(args.amount, args.product);
        break;
      case "set_quantity":
        if (args.product && args.value) return processSetField("quantity", args.value, args.product);
        break;
      case "set_sold":
        if (args.product && args.value) return processSetField("soldQuantity", args.value, args.product);
        break;
      case "set_sell_price":
        if (args.product && args.value) return processSetPrice("sellPrice", args.value, args.product);
        if (args.value) return { text: `Which product's sell price should I set to **₹${parseFloat(args.value).toFixed(2)}**? e.g. \`set sell price iPhone to ${args.value}\`` };
        break;
      case "set_buy_price":
        if (args.product && args.value) return processSetPrice("buyPrice", args.value, args.product);
        if (args.value) return { text: `Which product's buy price should I set to **₹${parseFloat(args.value).toFixed(2)}**? e.g. \`set buy price iPhone to ${args.value}\`` };
        break;
      case "list_products": {
        const products = await getProducts();
        return products.length
          ? { text: `Showing **${products.length}** product${products.length > 1 ? "s" : ""}.`, products }
          : { text: "No products yet. Try **add product** to get started." };
      }
      case "add_product":
        return {
          text: "Upload up to **2 product images** (front & back of the wrapper). I'll read the packaging and fill in brand, name, dates, and language automatically.",
          widget: "image_upload",
        };
      case "search_products": {
        if (!args.query) break;
        const products = await searchProducts(args.query);
        return products.length
          ? { text: `Found **${products.length}** result${products.length > 1 ? "s" : ""} for "${args.query}".`, products }
          : { text: `No products matched **"${args.query}"**.` };
      }
      case "stats": {
        const products = await getProducts();
        return { text: buildStats(products) };
      }
      case "low_stock": {
        const products = await getProducts();
        const low = products.filter((p) => p.quantity < 10);
        return low.length
          ? { text: `**${low.length}** item${low.length > 1 ? "s" : ""} with low stock (qty < 10).`, products: low }
          : { text: "All items are well-stocked (qty ≥ 10)." };
      }
      case "expiring": {
        const products = await getProducts();
        const in90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        const soon = products.filter((p) => {
          if (p.expiryDate === "N/A") return false;
          const d = new Date(p.expiryDate);
          return !isNaN(d.getTime()) && d <= in90;
        });
        return soon.length
          ? { text: `**${soon.length}** product${soon.length > 1 ? "s" : ""} expiring within 90 days.`, products: soon }
          : { text: "No products expiring within the next 90 days." };
      }
      case "delete_product": {
        if (!args.product) break;
        const products = await getProducts();
        const match = findProduct(products, args.product);
        if (match === "none") return { text: `No product named **"${args.product}"** found.` };
        if (match === "ambiguous") return { text: ambiguousMsg(products, args.product) };
        await deleteProduct(match.id);
        return { text: `Deleted **${match.name}**.` };
      }
      case "list_employees": {
        const employees = await getEmployees();
        return employees.length
          ? { text: `**${employees.length}** employee${employees.length > 1 ? "s" : ""} on record.`, employees }
          : { text: "No employees yet. Try **add employee** to get started." };
      }
      case "add_employee":
        return { text: "Fill in the employee details below.", widget: "employee_form" };
      case "checkin": {
        if (!args.name) break;
        const employees = await getEmployees();
        const match = findEmployee(employees, args.name);
        if (match === "none") return { text: `No employee found matching **"${args.name}"**.` };
        if (match === "ambiguous") return { text: ambiguousEmployeeMsg(employees, args.name) };
        const today = new Date().toISOString().slice(0, 10);
        if (match.lastCheckIn === today)
          return { text: `**${match.name}** already checked in today (${today}).`, employees: [match] };
        if (match.salaryType === "hourly") {
          return { text: `**${match.name}** is paid hourly. How many hours did they work today?\nTry: \`check in ${match.name} 6\`` };
        }
        const updated = await checkinEmployee(match.id);
        return { text: `Checked in **${updated.name}** — day **${updated.checkInDays}** total.`, employees: [updated] };
      }
      case "attendance_today": {
        const today = new Date().toISOString().slice(0, 10);
        const employees = await getEmployees();
        const found = employees.filter((e) => e.lastCheckIn === today);
        const absent = employees.filter((e) => e.lastCheckIn !== today);
        const absentLine = absent.length ? `\nNot yet in: ${absent.map((e) => `**${e.name}**`).join(", ")}` : "";
        return found.length
          ? { text: `**${found.length}** of ${employees.length} checked in today.${absentLine}`, employees: found }
          : { text: `Nobody has checked in today yet.${absentLine}` };
      }
      case "attendance_week": {
        const day = new Date().getDay();
        const startOfWeek = new Date(Date.now() - day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const employees = await getEmployees();
        const found = employees.filter((e) => e.lastCheckIn !== "N/A" && e.lastCheckIn >= startOfWeek);
        return found.length
          ? { text: `**${found.length}** employee${found.length > 1 ? "s" : ""} checked in this week.`, employees: found }
          : { text: "Nobody has checked in this week yet." };
      }
      case "attendance_days": {
        const n = parseInt(args.days ?? "7", 10);
        const cutoff = new Date(Date.now() - (n - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const employees = await getEmployees();
        const found = employees.filter((e) => e.lastCheckIn !== "N/A" && e.lastCheckIn >= cutoff);
        return found.length
          ? { text: `**${found.length}** employee${found.length > 1 ? "s" : ""} checked in within the last **${n} day${n > 1 ? "s" : ""}**.`, employees: found }
          : { text: `Nobody has checked in within the last **${n} day${n > 1 ? "s" : ""}**.` };
      }
      case "employee_stats": {
        const employees = await getEmployees();
        return { text: buildEmployeeStats(employees) };
      }
      case "search_employees": {
        if (!args.query) break;
        const employees = await getEmployees();
        const q = args.query.toLowerCase();
        const found = employees.filter((e) => e.name.toLowerCase().includes(q));
        return found.length
          ? { text: `Found **${found.length}** employee${found.length > 1 ? "s" : ""} matching "${args.query}".`, employees: found }
          : { text: `No employee found matching **"${args.query}"**.` };
      }
      case "set_salary": {
        if (!args.name || !args.amount) break;
        const employees = await getEmployees();
        const match = findEmployee(employees, args.name);
        if (match === "none") return { text: `No employee found matching **"${args.name}"**.` };
        if (match === "ambiguous") return { text: ambiguousEmployeeMsg(employees, args.name) };
        const salary = parseFloat(args.amount);
        const updated = await updateEmployee({ ...match, salary });
        return { text: `Salary for **${updated.name}** updated to **₹${salary.toFixed(2)}**.`, employees: [updated] };
      }
      case "delete_employee": {
        if (!args.name) break;
        const employees = await getEmployees();
        const match = findEmployee(employees, args.name);
        if (match === "none") return { text: `No employee named **"${args.name}"** found.` };
        if (match === "ambiguous") return { text: ambiguousEmployeeMsg(employees, args.name) };
        await deleteEmployee(match.id);
        return { text: `Removed employee **${match.name}** from records.` };
      }
      case "report":
        return { text: "Which report would you like?", widget: "report_menu" };
      case "employee_report" as string: {
        const employees = await getEmployees();
        if (!employees.length) return { text: "No employees on record yet." };
        return { text: `Employee report — **${employees.length}** staff member${employees.length !== 1 ? "s" : ""}.`, widget: "employee_report", employees, reportSubtype: "all" };
      }
      case "salary_today" as string: {
        const allEmployees = await getEmployees();
        if (!allEmployees.length) return { text: "No employees on record yet." };
        return { text: "Pick a period to calculate salary payout.", widget: "salary_picker", employees: allEmployees };
      }
      case "salary_month" as string: {
        const allEmployees = await getEmployees();
        if (!allEmployees.length) return { text: "No employees on record yet." };
        return { text: "Pick a period to calculate salary payout.", widget: "salary_picker", employees: allEmployees };
      }
      case "product_chart" as string: {
        const products = await getProducts();
        if (!products.length) return { text: "No products in inventory yet." };
        return { text: `Product analytics — **${products.length}** product${products.length !== 1 ? "s" : ""}.`, widget: "product_chart", products };
      }
      case "help":
        return {
          text: [
            "**Available commands:**",
            "",
            "_Inventory_",
            "• `list products` · `add product` · `show stats`",
            "• `low stock` · `expiring`",
            "• `sold 5 [product]` — record a sale",
            "• `bought 10 [product]` — restock",
            "• `set quantity [product] to 20` — set stock",
            "• `set sell price [product] to 25` — update sell price",
            "• `set buy price [product] to 15` — update cost price",
            "• `search products [query]` · `delete [product]`",
            "",
            "_Employees_",
            "• `list employees` · `add employee`",
            "• `check in [name]` — mark attendance (monthly staff)",
            "• `check in [name] 6` — mark attendance with hours (hourly staff)",
            "• `who checked in today` · `who checked in this week`",
            "• `checked in last 7 days` — any number of days",
            "• `employee stats` — headcount & salary overview",
            "• `set salary [name] to [amount]` — update pay",
            "• `set salary [name] to hourly/monthly` — switch type",
            "• `edit employee [name]` — edit details",
            "• `delete employee [name]` · `search employees [query]`",
            "",
            "_Reports_",
            "• `reports` — open report picker",
            "• `inventory report` · `product chart`",
            "• `trending products` · `unpopular products`",
            "• `supplier report` — spend pie chart + supplier overview",
            "• `employee report` · `salary report`",
            "• `salary today` · `monthly salary` · `company spend`",
          ].join("\n"),
        };
    }
  }

  // Medium confidence: show "Did you mean?" suggestions
  if (best.confidence >= 0.2) {
    const tops = topMatches(input, 2).filter((m) => m.confidence >= 0.2);
    const suggestions = tops.map((m) => `\`${INTENT_LABEL[m.intent]}\``).join(" or ");
    return {
      text: `Not sure what you mean. Did you mean ${suggestions}?\nType **help** to see all commands.`,
    };
  }

  return {
    text: `I don't recognise **"${input}"**. Type **help** to see available commands.`,
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function buildStats(products: Product[]): string {
  if (!products.length) return "No products in inventory yet.";

  const stockValue   = products.reduce((s, p) => s + p.buyPrice * p.quantity, 0);
  const totalBuySell = products.reduce((s, p) => s + calcBuySellAmt(p), 0);
  const low          = products.filter((p) => p.quantity < 10).length;
  const in90         = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const expiring     = products.filter((p) => {
    if (p.expiryDate === "N/A") return false;
    const d = new Date(p.expiryDate);
    return !isNaN(d.getTime()) && d <= in90;
  }).length;

  const plSign = totalBuySell >= 0 ? "+" : "";
  return [
    `**Inventory overview** — ${products.length} SKU${products.length > 1 ? "s" : ""}`,
    `• Stock value (cost): **₹${stockValue.toFixed(2)}**`,
    `• Buy-sell balance: **${plSign}₹${totalBuySell.toFixed(2)}**${totalBuySell < 0 ? " ← still buying in" : " ✓ profitable"}`,
    low      ? `• ⚠️  **${low}** low-stock item${low > 1 ? "s" : ""}` : "• All items well-stocked",
    expiring ? `• ⏰  **${expiring}** expiring within 90 days` : "",
  ].filter(Boolean).join("\n");
}

// ── Employee stats ────────────────────────────────────────────────────────────

function buildEmployeeStats(employees: Employee[]): string {
  if (!employees.length) return "No employees on record yet.";

  const totalSalary = employees.reduce((s, e) => s + monthlyEquivalent(e), 0);
  const avgSalary   = totalSalary / employees.length;
  const today       = new Date().toISOString().slice(0, 10);
  const checkedInToday = employees.filter((e) => e.lastCheckIn === today).length;
  const longest = employees.reduce((a, b) =>
    new Date(a.joiningDate) < new Date(b.joiningDate) ? a : b
  );

  return [
    `**Employee overview** — ${employees.length} staff member${employees.length > 1 ? "s" : ""}`,
    `• Total monthly salary: **₹${totalSalary.toFixed(2)}**`,
    `• Avg salary: **₹${avgSalary.toFixed(2)}**`,
    `• Checked in today: **${checkedInToday}** / ${employees.length}`,
    `• Longest-serving: **${longest.name}** (${tenureYears(longest.joiningDate)})`,
  ].join("\n");
}

export { nanoid };
