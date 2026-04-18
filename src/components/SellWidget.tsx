import { useState } from "react";
import { Check, X, TrendingUp, TrendingDown } from "lucide-react";
import type { Product } from "../types";
import { playPop } from "../utils/sound";

interface Props {
  products: Product[];           // all available-stock products for the dropdown
  initial?: Product;             // pre-selected (from tile "Sell" button)
  onConfirm: (product: Product, qty: number, sellPrice: number) => void;
  onCancel: () => void;
}

export function SellWidget({ products, initial, onConfirm, onCancel }: Props) {
  const available = products.filter((p) => p.quantity > 0);

  const defaultId = initial?.id ?? available[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(defaultId);
  const [qty, setQty] = useState(1);
  const [priceStr, setPriceStr] = useState<string>(() => {
    const p = initial ?? available.find((p) => p.id === defaultId);
    return p ? String(p.sellPrice) : "0";
  });

  const selected = products.find((p) => p.id === selectedId);
  const sellPrice = parseFloat(priceStr) || 0;
  const maxQty = selected?.quantity ?? 0;
  const cost = (selected?.buyPrice ?? 0) * qty;
  const revenue = sellPrice * qty;
  const profit = revenue - cost;
  const afterQty = maxQty - qty;
  const canConfirm = !!selected && qty >= 1 && qty <= maxQty && sellPrice >= 0;

  function handleProductChange(id: string) {
    setSelectedId(id);
    setQty(1);
    const p = products.find((p) => p.id === id);
    setPriceStr(p ? String(p.sellPrice) : "0");
  }

  function handleConfirm() {
    if (!selected || !canConfirm) return;
    playPop();
    onConfirm(selected, qty, sellPrice);
  }

  if (!available.length) {
    return (
      <div className="text-xs text-gray-400 text-center py-4">
        No products with stock available to sell.
      </div>
    );
  }

  const inp =
    "w-full bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-emerald-400 transition-colors";

  function field(label: string, node: React.ReactNode) {
    return (
      <div>
        <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-0.5">
          {label}
        </label>
        {node}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">

      {/* Product */}
      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-[10px] text-emerald-600 uppercase tracking-wider font-medium">Product</p>
        {initial ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-800">{initial.name}</p>
              {initial.brand && <p className="text-[10px] text-gray-400">{initial.brand}</p>}
            </div>
            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
              {initial.quantity} in stock
            </span>
          </div>
        ) : (
          field("Select product",
            <select className={inp.replace("border-emerald-200", "border-emerald-200")}
              value={selectedId} onChange={(e) => handleProductChange(e.target.value)}>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.brand ? ` · ${p.brand}` : ""} — {p.quantity} left
                </option>
              ))}
            </select>
          )
        )}
      </div>

      {selected && (
        <>
          {/* Quantity + Price */}
          <div className="grid grid-cols-2 gap-2">
            {field(`Quantity (max ${maxQty})`,
              <input
                type="number" min={1} max={maxQty} className={inp}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(parseInt(e.target.value) || 1, maxQty)))}
              />
            )}
            {field("Sell price (₹)",
              <input
                type="number" min={0} step="0.01" className={inp}
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
              />
            )}
          </div>

          {/* Profit / loss preview */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-400">Revenue ({qty} × ₹{sellPrice.toFixed(2)})</span>
              <span className="font-medium text-gray-700">₹{revenue.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-400">Cost ({qty} × ₹{selected.buyPrice.toFixed(2)})</span>
              <span className="font-medium text-gray-700">₹{cost.toFixed(2)}</span>
            </div>
            <div className="border-t border-gray-200 pt-1.5 flex items-center justify-between">
              <span className="text-xs text-gray-600 font-medium">Profit on this sale</span>
              <span className={`text-xs font-bold flex items-center gap-0.5 ${profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {profit >= 0
                  ? <TrendingUp className="w-3 h-3" />
                  : <TrendingDown className="w-3 h-3" />}
                {profit >= 0 ? "+" : ""}₹{profit.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] pt-0.5">
              <span className="text-gray-400">On hand after sale</span>
              <span className={`font-semibold ${
                afterQty === 0 ? "text-red-500" :
                afterQty < 10 ? "text-orange-500" : "text-gray-700"
              }`}>
                {afterQty} unit{afterQty !== 1 ? "s" : ""}
                {afterQty === 0 ? " — out of stock" : afterQty < 10 ? " — low stock" : ""}
              </span>
            </div>
          </div>

          {qty > maxQty && (
            <p className="text-[10px] text-red-500 px-1">
              Only {maxQty} unit{maxQty !== 1 ? "s" : ""} available.
            </p>
          )}
        </>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold py-2 rounded-xl transition-colors"
        >
          <Check className="w-4 h-4" /> Confirm sale
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
