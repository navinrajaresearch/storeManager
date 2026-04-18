import { useState } from "react";
import type { Product, Supplier } from "../types";

interface Props {
  products: Product[];
  suppliers: Supplier[];
}

const COLORS = [
  "#8b5cf6", "#6366f1", "#06b6d4", "#10b981", "#f59e0b",
  "#f97316", "#ec4899", "#ef4444", "#84cc16", "#64748b",
];

interface SupplierSegment {
  supplierId: string;
  label: string;
  color: string;
  spend: number;       // buyPrice × (qty + soldQty) — total paid
  stockValue: number;  // buyPrice × qty — on-hand cost
  productCount: number;
  lowStock: number;
  expiring: number;
  percentage: number;
}

function buildSegments(products: Product[], suppliers: Supplier[]): SupplierSegment[] {
  const nameMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const in90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  const acc = new Map<string, Omit<SupplierSegment, "color" | "percentage">>();

  for (const p of products) {
    const key = p.supplierId || "__none__";
    const label = p.supplierId ? (nameMap.get(p.supplierId) ?? "Unknown") : "No supplier";
    const spend = p.buyPrice * (p.quantity + p.soldQuantity);
    const stockValue = p.buyPrice * p.quantity;
    const isLow = p.quantity > 0 && p.quantity < 10;
    const isExp = p.expiryDate !== "N/A" &&
      !isNaN(new Date(p.expiryDate).getTime()) &&
      new Date(p.expiryDate) <= in90;

    const cur = acc.get(key);
    if (cur) {
      cur.spend += spend;
      cur.stockValue += stockValue;
      cur.productCount += 1;
      if (isLow) cur.lowStock += 1;
      if (isExp) cur.expiring += 1;
    } else {
      acc.set(key, { supplierId: key, label, spend, stockValue, productCount: 1, lowStock: isLow ? 1 : 0, expiring: isExp ? 1 : 0 });
    }
  }

  const total = Array.from(acc.values()).reduce((s, v) => s + v.spend, 0);
  return Array.from(acc.values())
    .sort((a, b) => b.spend - a.spend)
    .map((seg, i) => ({
      ...seg,
      color: COLORS[i % COLORS.length],
      percentage: total > 0 ? (seg.spend / total) * 100 : 0,
    }));
}

// ── Shared SVG donut ─────────────────────────────────────────────────────────

function polarXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function DonutChart({ segments, size = 120 }: { segments: SupplierSegment[]; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const cx = size / 2, cy = size / 2;
  const outerR = size * 0.42;
  const innerR = size * 0.25;

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center text-[10px] text-gray-300" style={{ width: size, height: size }}>
        No data
      </div>
    );
  }

  if (segments.length === 1) {
    return (
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={outerR} fill={segments[0].color} />
        <circle cx={cx} cy={cy} r={innerR} fill="white" />
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize="8" fill="#374151" fontWeight="600">100%</text>
      </svg>
    );
  }

  const total = segments.reduce((s, seg) => s + seg.spend, 0);
  let currentDeg = 0;
  const paths = segments.map((seg, i) => {
    const sweep = (seg.spend / total) * 360;
    const start = currentDeg;
    const end = currentDeg + sweep - 0.5;
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
          key={i} d={d} fill={color} stroke="white" strokeWidth="1.5"
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
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize="7" fill="#9ca3af">hover</text>
      )}
    </svg>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────

export function SupplierReportWidget({ products, suppliers }: Props) {
  const [mode, setMode] = useState<"spend" | "overview">("spend");
  const segments = buildSegments(products, suppliers);
  const totalSpend = segments.reduce((s, seg) => s + seg.spend, 0);
  const totalStock = segments.reduce((s, seg) => s + seg.stockValue, 0);

  if (!products.length) {
    return <p className="text-xs text-gray-400 text-center py-4">No products in inventory yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
          <p className="text-[10px] text-violet-500 uppercase tracking-wide">Total spend</p>
          <p className="text-sm font-bold text-violet-700">₹{totalSpend.toFixed(2)}</p>
        </div>
        <div className="bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
          <p className="text-[10px] text-sky-500 uppercase tracking-wide">Stock on hand</p>
          <p className="text-sm font-bold text-sky-700">₹{totalStock.toFixed(2)}</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 bg-violet-50 rounded-lg p-0.5">
        {(["spend", "overview"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 text-[10px] py-1 rounded-md transition-all font-medium ${
              mode === m ? "bg-white text-violet-700 shadow-sm" : "text-violet-400"
            }`}
          >
            {m === "spend" ? "Spend chart" : "Overview"}
          </button>
        ))}
      </div>

      {/* Spend chart */}
      {mode === "spend" && (
        <div className="bg-white border border-violet-100 rounded-xl p-3">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <DonutChart segments={segments} size={120} />
            </div>
            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
              {segments.length === 0 ? (
                <p className="text-[10px] text-gray-400">No spend data yet.</p>
              ) : segments.slice(0, 7).map((seg) => (
                <div key={seg.supplierId} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-[9px] text-gray-600 truncate flex-1">{seg.label}</span>
                  <span className="text-[9px] font-semibold text-gray-700">{seg.percentage.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Overview table */}
      {mode === "overview" && (
        <div className="border border-violet-100 rounded-xl overflow-hidden">
          {segments.length === 0 ? (
            <p className="text-[10px] text-gray-400 px-3 py-2">No data yet.</p>
          ) : segments.map((seg, i) => (
            <div key={seg.supplierId} className={`px-3 py-2.5 ${i % 2 === 0 ? "bg-white" : "bg-violet-50/40"}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-[10px] font-semibold text-gray-800 truncate">{seg.label}</span>
                </div>
                <span className="text-[10px] font-bold text-violet-700 flex-shrink-0">
                  ₹{seg.spend.toFixed(0)} spent
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-3.5">
                <span className="text-[9px] text-gray-400">
                  {seg.productCount} product{seg.productCount !== 1 ? "s" : ""}
                </span>
                <span className="text-[9px] text-sky-500">
                  ₹{seg.stockValue.toFixed(0)} on hand
                </span>
                {seg.lowStock > 0 && (
                  <span className="text-[9px] text-orange-500">⚠ {seg.lowStock} low stock</span>
                )}
                {seg.expiring > 0 && (
                  <span className="text-[9px] text-amber-500">⏰ {seg.expiring} expiring</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
