import { useState } from "react";
import { Download, Copy, Check, MessageCircle, Mail, TrendingUp, TrendingDown, Package } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Product } from "../types";
import { calcBuySellAmt } from "../types";

interface Props {
  products: Product[];
  chartPeriod?: string;
}

// Mirrors ProductTile.tsx detectCategory
function detectCategory(brand: string, name: string): string {
  const text = `${brand} ${name}`.toLowerCase();
  if (/laptop|phone|tv|camera|headphone|electronic|cpu|gpu/.test(text)) return "Electronics";
  if (/shirt|dress|jacket|pant|shoe|cloth|wear/.test(text)) return "Clothing";
  if (/food|drink|beverage|snack|tea|coffee|juice/.test(text)) return "Food & Beverage";
  if (/home|garden|furniture|decor/.test(text)) return "Home & Garden";
  if (/sport|gym|fitness|ball|bike/.test(text)) return "Sports";
  if (/book|novel|magazine/.test(text)) return "Books";
  if (/toy|game|puzzle/.test(text)) return "Toys";
  if (/beauty|skincare|shampoo|cosmetic|health|medicine/.test(text)) return "Health & Beauty";
  if (/car|auto|vehicle|motor/.test(text)) return "Automotive";
  return "Other";
}

const CAT_COLORS: Record<string, string> = {
  Electronics: "#6366f1",
  Clothing: "#ec4899",
  "Food & Beverage": "#f59e0b",
  "Home & Garden": "#10b981",
  Sports: "#f97316",
  Books: "#8b5cf6",
  Toys: "#eab308",
  "Health & Beauty": "#f43f5e",
  Automotive: "#06b6d4",
  Other: "#6b7280",
};

interface Segment {
  label: string;
  value: number;
  color: string;
  percentage: number;
}

function computeSegments(products: Product[], mode: "revenue" | "stock"): Segment[] {
  const map: Record<string, number> = {};
  for (const p of products) {
    const cat = detectCategory(p.brand, p.name);
    const value = mode === "revenue" ? p.sellPrice * p.soldQuantity : p.buyPrice * p.quantity;
    map[cat] = (map[cat] ?? 0) + value;
  }
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  if (total === 0) return [];
  return Object.entries(map)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([label, value]) => ({
      label,
      value,
      color: CAT_COLORS[label] ?? CAT_COLORS.Other,
      percentage: (value / total) * 100,
    }));
}

function polarXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function DonutChart({ segments, size = 120 }: { segments: Segment[]; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const cx = size / 2, cy = size / 2;
  const outerR = size * 0.42;
  const innerR = size * 0.25;

  if (segments.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <Package className="w-8 h-8 text-gray-200" />
      </div>
    );
  }

  if (segments.length === 1) {
    return (
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={outerR} fill={segments[0].color} />
        <circle cx={cx} cy={cy} r={innerR} fill="white" />
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize="8" fill="#374151" fontWeight="600">
          100%
        </text>
      </svg>
    );
  }

  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let currentDeg = 0;
  const paths = segments.map((seg, i) => {
    const sweep = (seg.value / total) * 360;
    const start = currentDeg;
    const end = currentDeg + sweep - 0.5; // small gap
    currentDeg += sweep;

    const s = polarXY(cx, cy, outerR, start);
    const e = polarXY(cx, cy, outerR, end);
    const si = polarXY(cx, cy, innerR, end);
    const ei = polarXY(cx, cy, innerR, start);
    const large = sweep > 180 ? 1 : 0;

    const d = [
      `M ${s.x.toFixed(2)} ${s.y.toFixed(2)}`,
      `A ${outerR} ${outerR} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`,
      `L ${si.x.toFixed(2)} ${si.y.toFixed(2)}`,
      `A ${innerR} ${innerR} 0 ${large} 0 ${ei.x.toFixed(2)} ${ei.y.toFixed(2)}`,
      "Z",
    ].join(" ");

    return { d, color: seg.color, i };
  });

  const hovered = hover !== null ? segments[hover] : null;

  return (
    <svg width={size} height={size} className="cursor-default">
      {paths.map(({ d, color, i }) => (
        <path
          key={i}
          d={d}
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          opacity={hover === null || hover === i ? 1 : 0.55}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            transform: hover === i ? "scale(1.06)" : "scale(1)",
            transition: "transform 0.15s, opacity 0.15s",
          }}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        />
      ))}
      <circle cx={cx} cy={cy} r={innerR} fill="white" />
      {hovered ? (
        <>
          <text x={cx} y={cy - 3} textAnchor="middle" fontSize="9" fill="#374151" fontWeight="700">
            {hovered.percentage.toFixed(1)}%
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize="7" fill="#6b7280">
            {hovered.label.split(" ")[0]}
          </text>
        </>
      ) : (
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize="7" fill="#9ca3af">
          hover
        </text>
      )}
    </svg>
  );
}

export function ProductChartWidget({ products, chartPeriod }: Props) {
  const [mode, setMode] = useState<"revenue" | "stock">("revenue");
  const [copied, setCopied] = useState(false);

  const segments = computeSegments(products, mode);
  const totalRevenue = products.reduce((s, p) => s + p.sellPrice * p.soldQuantity, 0);
  const totalBuySell = products.reduce((s, p) => s + calcBuySellAmt(p), 0);
  const totalStock = products.reduce((s, p) => s + p.buyPrice * p.quantity, 0);
  const bsSign = totalBuySell >= 0 ? "+" : "";

  const topProducts = [...products]
    .sort((a, b) => b.sellPrice * b.soldQuantity - a.sellPrice * a.soldQuantity)
    .slice(0, 5);
  const maxRev = (topProducts[0]?.sellPrice ?? 0) * (topProducts[0]?.soldQuantity ?? 0);

  function toCsv(): string {
    const revSegs = computeSegments(products, "revenue");
    const stockSegs = computeSegments(products, "stock");
    const catHeader = "Category,Revenue,Stock Value,Revenue %";
    const catRows = revSegs.map((seg) => {
      const sv = stockSegs.find((s) => s.label === seg.label);
      return `"${seg.label}",${seg.value.toFixed(2)},${(sv?.value ?? 0).toFixed(2)},${seg.percentage.toFixed(1)}%`;
    });
    const prodHeader = "\n\nProduct,Brand,Qty on hand,Sold,Revenue,Stock value,Buy-sell";
    const prodRows = products.map((p) => {
      const bsa = calcBuySellAmt(p);
      return [
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.brand.replace(/"/g, '""')}"`,
        p.quantity,
        p.soldQuantity,
        (p.sellPrice * p.soldQuantity).toFixed(2),
        (p.buyPrice * p.quantity).toFixed(2),
        bsa.toFixed(2),
      ].join(",");
    });
    return [catHeader, ...catRows, prodHeader, ...prodRows].join("\n");
  }

  function toWhatsApp(): string {
    const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const lines: string[] = [
      `📊 *Product Sales Report*`,
      `_${date} · ${products.length} product${products.length !== 1 ? "s" : ""}_`,
      ``,
      `💰 Total revenue: ₹${totalRevenue.toFixed(2)}`,
      `📦 Stock value: ₹${totalStock.toFixed(2)}`,
      `${totalBuySell >= 0 ? "📈" : "📉"} Buy-sell: ${bsSign}₹${totalBuySell.toFixed(2)}`,
      ``,
      `*By category:*`,
    ];
    computeSegments(products, "revenue").forEach((seg) => {
      lines.push(`• ${seg.label}: ₹${seg.value.toFixed(2)} (${seg.percentage.toFixed(1)}%)`);
    });
    lines.push(``, `*Top products:*`);
    topProducts.forEach((p, i) => {
      const rev = p.sellPrice * p.soldQuantity;
      lines.push(`${i + 1}. ${p.name} — ₹${rev.toFixed(2)}`);
    });
    return lines.join("\n");
  }

  async function copyText() {
    await navigator.clipboard.writeText(toWhatsApp());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadCsv() {
    const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `product-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function shareWhatsApp() {
    openUrl(`whatsapp://send?text=${encodeURIComponent(toWhatsApp())}`);
  }

  function shareEmail() {
    const date = new Date().toLocaleDateString("en-GB");
    openUrl(
      `mailto:?subject=${encodeURIComponent(`Product Sales Report — ${date}`)}&body=${encodeURIComponent(toWhatsApp().replace(/\*/g, "").replace(/_/g, ""))}`
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          <p className="text-[10px] text-amber-500 uppercase tracking-wide">Revenue</p>
          <p className="text-sm font-bold text-amber-700">₹{totalRevenue.toFixed(2)}</p>
        </div>
        <div
          className={`border rounded-xl px-3 py-2 ${totalBuySell >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}
        >
          <p
            className="text-[10px] uppercase tracking-wide"
            style={{ color: totalBuySell >= 0 ? "#10b981" : "#ef4444" }}
          >
            Buy-sell
          </p>
          <p
            className={`text-sm font-bold flex items-center gap-1 ${totalBuySell >= 0 ? "text-emerald-700" : "text-red-600"}`}
          >
            {totalBuySell >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {bsSign}₹{totalBuySell.toFixed(2)}
          </p>
        </div>
        <div className="col-span-2 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
          <p className="text-[10px] text-sky-500 uppercase tracking-wide">Stock value on hand</p>
          <p className="text-sm font-bold text-sky-700">₹{totalStock.toFixed(2)}</p>
        </div>
      </div>

      {/* Mode toggle + Donut chart + Legend */}
      <div className="bg-white border border-amber-100 rounded-xl p-3">
        <div className="flex gap-1 mb-3 bg-amber-50 rounded-lg p-0.5">
          {(["revenue", "stock"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 text-[10px] py-1 rounded-md transition-all font-medium ${
                mode === m ? "bg-white text-amber-700 shadow-sm" : "text-amber-400"
              }`}
            >
              {m === "revenue" ? "Revenue" : "Stock value"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <DonutChart segments={segments} size={120} />
          </div>
          <div className="flex-1 flex flex-col gap-1.5 min-w-0">
            {segments.length === 0 ? (
              <p className="text-[10px] text-gray-400">No data yet — record some sales first.</p>
            ) : (
              segments.slice(0, 7).map((seg) => (
                <div key={seg.label} className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="text-[9px] text-gray-600 truncate flex-1">{seg.label}</span>
                  <span className="text-[9px] font-semibold text-gray-700">
                    {seg.percentage.toFixed(1)}%
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {chartPeriod && (
          <p className="text-[8px] text-gray-400 mt-2 text-center">
            Showing all-time cumulative data
          </p>
        )}
      </div>

      {/* Top products */}
      <div>
        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5 px-0.5">
          Top products by revenue
        </p>
        <div className="border border-amber-100 rounded-xl overflow-hidden">
          {topProducts.length === 0 ? (
            <p className="text-[10px] text-gray-400 px-3 py-2">No sales recorded yet.</p>
          ) : (
            topProducts.map((p, i) => {
              const rev = p.sellPrice * p.soldQuantity;
              return (
                <div key={p.id} className={`px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-amber-50/40"}`}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[10px] font-medium text-gray-800 truncate flex-1">{p.name}</span>
                    <span className="text-[10px] font-semibold text-amber-700 flex-shrink-0">
                      ₹{rev.toFixed(0)}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-gray-100 rounded-full">
                    <div
                      className="h-full bg-gradient-to-r from-orange-400 to-amber-500 rounded-full"
                      style={{ width: maxRev > 0 ? `${(rev / maxRev) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
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
