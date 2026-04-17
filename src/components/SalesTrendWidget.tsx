import { useState } from "react";
import { TrendingUp, TrendingDown, Download, Share2 } from "lucide-react";
import type { Product } from "../types";

interface Props {
  products: Product[];
}

function parseSalesHistory(raw: string): { date: string; qty: number }[] {
  if (!raw) return [];
  return raw
    .split(",")
    .filter(Boolean)
    .map((e) => {
      const [date, qty] = e.split(":");
      return { date, qty: parseInt(qty) || 0 };
    });
}

function getSalesInPeriod(product: Product, startDate: string, endDate: string): number {
  return parseSalesHistory(product.salesHistory)
    .filter((e) => e.date >= startDate && e.date <= endDate)
    .reduce((s, e) => s + e.qty, 0);
}

function getPeriodDates(days: number): { startDate: string; endDate: string } {
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().slice(0, 10);
  return { startDate, endDate };
}

function StatusBadge({ status }: { status: "Never sold" | "No recent sales" | "Slow" }) {
  const colors = {
    "Never sold":      "bg-red-100 text-red-700 border-red-200",
    "No recent sales": "bg-amber-100 text-amber-700 border-amber-200",
    "Slow":            "bg-yellow-100 text-yellow-700 border-yellow-200",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors[status]}`}>
      {status}
    </span>
  );
}

// ── Trending view ─────────────────────────────────────────────────────────────

function TrendingView({ products, days }: { products: Product[]; days: number }) {
  const { startDate, endDate } = getPeriodDates(days);

  const ranked = products
    .map((p) => ({ product: p, sold: getSalesInPeriod(p, startDate, endDate) }))
    .filter(({ sold }) => sold > 0)
    .sort((a, b) => b.sold - a.sold);

  if (!ranked.length) {
    return (
      <p className="text-xs text-gray-500 text-center py-4">
        No sales recorded in this period.
      </p>
    );
  }

  // Prepare CSV + WhatsApp data
  const csvRows = [
    ["Product", "Brand", "Units Sold", "Revenue (₹)"],
    ...ranked.map(({ product: p, sold }) => [
      p.name,
      p.brand,
      String(sold),
      (sold * p.sellPrice).toFixed(2),
    ]),
  ];

  function downloadCsv() {
    const csv = csvRows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trending-products-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function shareWhatsApp() {
    const lines = [
      `*Trending Products — Last ${days} day${days > 1 ? "s" : ""}*`,
      "",
      ...ranked.map(
        ({ product: p, sold }, i) =>
          `${i + 1}. *${p.name}* (${p.brand}) — ${sold} unit${sold > 1 ? "s" : ""} · ₹${(sold * p.sellPrice).toFixed(2)}`
      ),
    ];
    const url = `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2 pr-3">#</th>
              <th className="text-left pb-2 pr-3">Product</th>
              <th className="text-left pb-2 pr-3">Brand</th>
              <th className="text-right pb-2 pr-3">Units Sold</th>
              <th className="text-right pb-2">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ product: p, sold }, i) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="py-1.5 pr-3 text-gray-400 font-medium">{i + 1}</td>
                <td className="py-1.5 pr-3 font-semibold text-gray-800 max-w-[120px] truncate">{p.name}</td>
                <td className="py-1.5 pr-3 text-gray-500 max-w-[80px] truncate">{p.brand}</td>
                <td className="py-1.5 pr-3 text-right font-semibold text-emerald-700">{sold}</td>
                <td className="py-1.5 text-right text-gray-700">₹{(sold * p.sellPrice).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={shareWhatsApp}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-50 hover:bg-green-100 border border-green-200 text-green-700 font-medium transition-colors"
        >
          <Share2 className="w-3 h-3" />
          WhatsApp
        </button>
        <button
          onClick={downloadCsv}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 font-medium transition-colors"
        >
          <Download className="w-3 h-3" />
          CSV
        </button>
      </div>
    </div>
  );
}

// ── Unpopular view ─────────────────────────────────────────────────────────────

type WorriedStatus = "Never sold" | "No recent sales" | "Slow";

interface WorriedProduct {
  product: Product;
  soldInPeriod: number;
  status: WorriedStatus;
  sortKey: number; // 0=Never sold, 1=No recent sales, 2=Slow
}

function UnpopularView({ products, days }: { products: Product[]; days: number }) {
  const { startDate, endDate } = getPeriodDates(days);

  const worried: WorriedProduct[] = products
    .filter((p) => p.quantity > 0)
    .map((p) => {
      const sold = getSalesInPeriod(p, startDate, endDate);
      const rate = sold / p.quantity;
      if (sold === 0 && p.soldQuantity === 0) {
        return { product: p, soldInPeriod: sold, status: "Never sold" as WorriedStatus, sortKey: 0 };
      }
      if (sold === 0 && p.soldQuantity > 0) {
        return { product: p, soldInPeriod: sold, status: "No recent sales" as WorriedStatus, sortKey: 1 };
      }
      if (rate < 0.1) {
        return { product: p, soldInPeriod: sold, status: "Slow" as WorriedStatus, sortKey: 2 };
      }
      return null;
    })
    .filter((x): x is WorriedProduct => x !== null)
    .sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return b.product.quantity - a.product.quantity;
    });

  if (!worried.length) {
    return (
      <p className="text-xs text-gray-500 text-center py-4">
        All products are moving well!
      </p>
    );
  }

  const csvRows = [
    ["Product", "Brand", "Stock", "Sales in Period", "Status"],
    ...worried.map(({ product: p, soldInPeriod, status }) => [
      p.name,
      p.brand,
      String(p.quantity),
      String(soldInPeriod),
      status,
    ]),
  ];

  function downloadCsv() {
    const csv = csvRows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `unpopular-products-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function shareWhatsApp() {
    const lines = [
      `*Unpopular Products — Last ${days} day${days > 1 ? "s" : ""}*`,
      "",
      ...worried.map(
        ({ product: p, soldInPeriod, status }) =>
          `• *${p.name}* — Stock: ${p.quantity} · Sold: ${soldInPeriod} · ${status}`
      ),
    ];
    const url = `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2 pr-3">Product</th>
              <th className="text-right pb-2 pr-3">Stock</th>
              <th className="text-right pb-2 pr-3">Sales</th>
              <th className="text-left pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {worried.map(({ product: p, soldInPeriod, status }) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="py-1.5 pr-3">
                  <p className="font-semibold text-gray-800 max-w-[120px] truncate">{p.name}</p>
                  <p className="text-[10px] text-gray-400 truncate max-w-[120px]">{p.brand}</p>
                </td>
                <td className="py-1.5 pr-3 text-right font-semibold text-gray-700">{p.quantity}</td>
                <td className="py-1.5 pr-3 text-right text-gray-500">{soldInPeriod}</td>
                <td className="py-1.5">
                  <StatusBadge status={status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={shareWhatsApp}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-50 hover:bg-green-100 border border-green-200 text-green-700 font-medium transition-colors"
        >
          <Share2 className="w-3 h-3" />
          WhatsApp
        </button>
        <button
          onClick={downloadCsv}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 font-medium transition-colors"
        >
          <Download className="w-3 h-3" />
          CSV
        </button>
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function SalesTrendWidget({ products }: Props) {
  const [view, setView] = useState<"picker" | "trending" | "unpopular">("picker");
  const [days, setDays] = useState(7);

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Period picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Last</span>
        <input
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(e) => {
            const v = Math.max(1, Math.min(30, parseInt(e.target.value) || 1));
            setDays(v);
            if (view !== "picker") {
              // Re-trigger the same view with new days
            }
          }}
          className="w-14 text-xs text-center border border-amber-200 rounded-lg px-2 py-1.5 bg-amber-50 text-amber-800 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
        <span className="text-xs text-gray-500 font-medium">days</span>
        <button
          onClick={() => setView("trending")}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
            view === "trending"
              ? "bg-emerald-100 border-emerald-300 text-emerald-700"
              : "bg-white border-emerald-200 text-emerald-600 hover:bg-emerald-50"
          }`}
        >
          <TrendingUp className="w-3 h-3" />
          Trending
        </button>
        <button
          onClick={() => setView("unpopular")}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
            view === "unpopular"
              ? "bg-red-100 border-red-300 text-red-700"
              : "bg-white border-red-200 text-red-500 hover:bg-red-50"
          }`}
        >
          <TrendingDown className="w-3 h-3" />
          Unpopular
        </button>
      </div>

      {/* Results */}
      {view === "picker" && (
        <p className="text-xs text-gray-400 text-center py-2">
          Set the period and pick a report above.
        </p>
      )}
      {view === "trending" && (
        <div>
          <p className="text-[10px] text-emerald-500 uppercase tracking-wider font-semibold mb-2">
            Top selling — last {days} day{days > 1 ? "s" : ""}
          </p>
          <TrendingView products={products} days={days} />
        </div>
      )}
      {view === "unpopular" && (
        <div>
          <p className="text-[10px] text-red-400 uppercase tracking-wider font-semibold mb-2">
            Products to watch — last {days} day{days > 1 ? "s" : ""}
          </p>
          <UnpopularView products={products} days={days} />
        </div>
      )}
    </div>
  );
}
