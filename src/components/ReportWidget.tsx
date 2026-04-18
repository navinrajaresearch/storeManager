import { useState } from "react";
import { Copy, Download, Check, TrendingUp, TrendingDown, AlertTriangle, Clock, Mail, MessageCircle } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Product, Supplier } from "../types";
import { calcBuySellAmt } from "../types";

interface Props {
  products: Product[];
  suppliers?: Supplier[];
}

// ── Formatters ────────────────────────────────────────────────────────────────

function supplierName(product: Product, suppliers: Supplier[]): string {
  if (!product.supplierId) return "";
  return suppliers.find((s) => s.id === product.supplierId)?.name ?? "";
}

function toWhatsApp(products: Product[], suppliers: Supplier[]): string {
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const stockValue = products.reduce((s, p) => s + p.buyPrice * p.quantity, 0);
  const buySell    = products.reduce((s, p) => s + calcBuySellAmt(p), 0);
  const low        = products.filter((p) => p.quantity < 10);
  const in90       = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const expiring   = products.filter((p) => {
    if (p.expiryDate === "N/A") return false;
    const d = new Date(p.expiryDate);
    return !isNaN(d.getTime()) && d <= in90;
  });

  const sign = buySell >= 0 ? "+" : "";
  const lines: string[] = [
    `📦 *Inventory Report*`,
    `_${today} · ${products.length} product${products.length !== 1 ? "s" : ""}_`,
    ``,
    `💰 Stock value: ₹${stockValue.toFixed(2)}`,
    `📊 Buy-sell balance: ${sign}₹${buySell.toFixed(2)}`,
    low.length      ? `⚠️ Low stock: ${low.length} item${low.length > 1 ? "s" : ""}` : `✅ All items well-stocked`,
    expiring.length ? `⏰ Expiring soon: ${expiring.length} item${expiring.length > 1 ? "s" : ""}` : "",
    ``,
    `*Products:*`,
  ].filter((l) => l !== undefined);

  products.forEach((p, i) => {
    const flags: string[] = [];
    if (p.quantity === 0)          flags.push("🚫 Out of stock");
    else if (p.quantity < 10)      flags.push("⚠️ Low stock");
    if (p.expiryDate !== "N/A") {
      const d = new Date(p.expiryDate);
      if (!isNaN(d.getTime()) && d <= in90) flags.push("⏰ Exp " + p.expiryDate);
    }
    const sName = supplierName(p, suppliers);
    lines.push(
      `${i + 1}. *${p.name}*${p.brand ? " · " + p.brand : ""}${sName ? ` · ${sName}` : ""}`,
      `   Stock: ${p.quantity} · Sold: ${p.soldQuantity} · ₹${p.buyPrice.toFixed(2)}→₹${p.sellPrice.toFixed(2)}`,
      ...(flags.length ? [`   ${flags.join(" · ")}`] : []),
      ``,
    );
  });

  return lines.join("\n").trimEnd();
}

function toCsv(products: Product[], suppliers: Supplier[]): string {
  const header = "Name,Brand,Supplier,Category,Quantity,Sold,Buy Price,Sell Price,Manufacture Date,Expiry Date,Stock Value,Buy-Sell Amount";
  const rows = products.map((p) => {
    const bsa = calcBuySellAmt(p);
    const sName = supplierName(p, suppliers);
    return [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.brand.replace(/"/g, '""')}"`,
      `"${sName}"`,
      `"${p.category}"`,
      p.quantity,
      p.soldQuantity,
      p.buyPrice.toFixed(2),
      p.sellPrice.toFixed(2),
      p.manufactureDate,
      p.expiryDate,
      (p.buyPrice * p.quantity).toFixed(2),
      bsa.toFixed(2),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

function toPlainText(products: Product[]): string {
  const today = new Date().toLocaleDateString("en-GB");
  const pad   = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const header = `INVENTORY REPORT — ${today}\n${"─".repeat(68)}\n`;
  const col    = `${pad("Product", 24)} ${pad("Brand", 14)} Qty  Sold  Buy    Sell\n${"─".repeat(68)}\n`;
  const rows   = products.map((p) =>
    `${pad(p.name, 24)} ${pad(p.brand, 14)} ${String(p.quantity).padStart(3)}  ${String(p.soldQuantity).padStart(4)}  ₹${p.buyPrice.toFixed(2).padStart(5)}  ₹${p.sellPrice.toFixed(2).padStart(5)}`
  ).join("\n");
  return header + col + rows;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReportWidget({ products, suppliers = [] }: Props) {
  const [copied, setCopied] = useState(false);

  function shareWhatsApp() {
    const text = toWhatsApp(products, suppliers);
    openUrl(`whatsapp://send?text=${encodeURIComponent(text)}`);
  }

  function shareEmail() {
    const date    = new Date().toLocaleDateString("en-GB");
    const subject = encodeURIComponent(`Inventory Report — ${date}`);
    const body    = encodeURIComponent(toPlainText(products));
    openUrl(`mailto:?subject=${subject}&body=${body}`);
  }

  async function copyText() {
    await navigator.clipboard.writeText(toWhatsApp(products, suppliers));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadCsv() {
    const csv  = toCsv(products, suppliers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `inventory-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const stockValue = products.reduce((s, p) => s + p.buyPrice * p.quantity, 0);
  const buySell    = products.reduce((s, p) => s + calcBuySellAmt(p), 0);
  const low        = products.filter((p) => p.quantity < 10).length;
  const in90       = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const expiring   = products.filter((p) => {
    if (p.expiryDate === "N/A") return false;
    const d = new Date(p.expiryDate);
    return !isNaN(d.getTime()) && d <= in90;
  }).length;

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          <p className="text-[10px] text-amber-500 uppercase tracking-wide">Stock value</p>
          <p className="text-sm font-bold text-amber-700">₹{stockValue.toFixed(2)}</p>
        </div>
        <div className={`border rounded-xl px-3 py-2 ${buySell >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: buySell >= 0 ? "#10b981" : "#ef4444" }}>Buy-sell</p>
          <p className={`text-sm font-bold flex items-center gap-1 ${buySell >= 0 ? "text-emerald-700" : "text-red-600"}`}>
            {buySell >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {buySell >= 0 ? "+" : ""}₹{buySell.toFixed(2)}
          </p>
        </div>
        {low > 0 && (
          <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <div>
              <p className="text-[10px] text-orange-400 uppercase tracking-wide">Low stock</p>
              <p className="text-sm font-bold text-orange-600">{low} item{low > 1 ? "s" : ""}</p>
            </div>
          </div>
        )}
        {expiring > 0 && (
          <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-3 py-2 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-[10px] text-yellow-500 uppercase tracking-wide">Expiring</p>
              <p className="text-sm font-bold text-yellow-700">{expiring} item{expiring > 1 ? "s" : ""}</p>
            </div>
          </div>
        )}
      </div>

      {/* Product list preview */}
      <div className="border border-amber-100 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
        {products.map((p, i) => {
          const sName = supplierName(p, suppliers);
          return (
          <div key={p.id} className={`flex items-center justify-between px-3 py-2 text-xs ${i % 2 === 0 ? "bg-white" : "bg-amber-50/40"}`}>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-gray-800 truncate block">{p.name}</span>
              <div className="flex gap-1.5 items-center">
                {p.brand && <span className="text-[10px] text-gray-400">{p.brand}</span>}
                {sName && <span className="text-[10px] text-violet-500">· {sName}</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-2">
              <span className="text-gray-600">×{p.quantity}</span>
              <span className="text-gray-400 ml-1.5">₹{p.sellPrice.toFixed(2)}</span>
            </div>
          </div>
        ); })}
      </div>

      {/* Share buttons */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <button
            onClick={shareWhatsApp}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            WhatsApp
          </button>
          <button
            onClick={shareEmail}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            Email
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={copyText}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs font-medium transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied!" : "Copy text"}
          </button>
          <button
            onClick={downloadCsv}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-xs font-medium transition-colors"
          >
            <Download className="w-3 h-3" />
            Download CSV
          </button>
        </div>
      </div>

    </div>
  );
}
