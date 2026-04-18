import { useState, useEffect } from "react";
import { Check, X, ChevronDown, ChevronUp, Plus } from "lucide-react";
import type { NewProduct, Supplier } from "../types";
import { CATEGORIES } from "../types";
import { playPop } from "../utils/sound";

interface Props {
  product: Partial<NewProduct>;
  images: string[];
  imageNames: string[];
  scanning?: boolean;
  suppliers: Supplier[];
  onConfirm: (p: NewProduct) => void;
  onCancel: () => void;
  onAddSupplier: (name: string, phone: string) => Promise<Supplier>;
}

export function ProductConfirm({ product, images, imageNames, scanning, suppliers, onConfirm, onCancel, onAddSupplier }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [form, setForm] = useState<NewProduct>({
    brand:           product.brand           ?? "",
    sourceLanguage:  product.sourceLanguage  ?? "",
    name:            product.name            ?? "",
    category:        product.category        ?? "Food & Beverage",
    supplierId:      product.supplierId      ?? "",
    manufactureDate: product.manufactureDate ?? "N/A",
    expiryDate:      product.expiryDate      ?? "N/A",
    imageLocation:   imageNames,
    quantity:        product.quantity        ?? 0,
    soldQuantity:    product.soldQuantity    ?? 0,
    buyPrice:        product.buyPrice        ?? 0,
    sellPrice:       product.sellPrice       ?? 0,
    salesHistory:    product.salesHistory    ?? "",
    images,
  });

  // Inline add-supplier state
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);

  // When OCR finishes (scanning flips false), pull in the populated fields
  useEffect(() => {
    if (!scanning) {
      setForm((f) => ({
        ...f,
        brand:           product.brand           || f.brand,
        sourceLanguage:  product.sourceLanguage  || f.sourceLanguage,
        name:            product.name            || f.name,
        manufactureDate: product.manufactureDate && product.manufactureDate !== "N/A" ? product.manufactureDate : f.manufactureDate,
        expiryDate:      product.expiryDate      && product.expiryDate      !== "N/A" ? product.expiryDate      : f.expiryDate,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const inp =
    "w-full bg-white border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-orange-400 transition-colors selectable";
  const shimmer = scanning
    ? "animate-pulse bg-gray-100 border-gray-200 text-transparent pointer-events-none"
    : "";

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

  async function handleSaveSupplier() {
    const name = newSupplierName.trim();
    if (!name) return;
    setSavingSupplier(true);
    try {
      const created = await onAddSupplier(name, newSupplierPhone.trim());
      setForm((f) => ({ ...f, supplierId: created.id }));
      setAddingSupplier(false);
      setNewSupplierName("");
      setNewSupplierPhone("");
    } finally {
      setSavingSupplier(false);
    }
  }

  function handleSupplierSelect(value: string) {
    if (value === "__add__") {
      setAddingSupplier(true);
      setForm((f) => ({ ...f, supplierId: "" }));
    } else {
      setAddingSupplier(false);
      setForm((f) => ({ ...f, supplierId: value }));
    }
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">
      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="w-16 h-16 object-cover rounded-xl" />
              <span className="absolute bottom-0 inset-x-0 text-center text-[8px] text-white/60 bg-black/50 rounded-b-xl py-0.5">
                {imageNames[i] ?? `Image ${i + 1}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* OCR-extracted (editable) */}
      <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-[10px] text-sky-600 uppercase tracking-wider font-medium flex items-center gap-1.5">
          {scanning ? (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              Reading packaging…
            </>
          ) : "From packaging"}
        </p>

        {field("Brand",
          <input className={`${inp} ${shimmer}`} value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        )}
        {field("Product name",
          <input className={`${inp} ${shimmer}`} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        )}

        <div className="grid grid-cols-2 gap-2">
          {field("Category",
            <select className={inp} value={form.category ?? "Food & Beverage"}
              onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          )}
          {field("Manufacture date",
            <input className={`${inp} ${shimmer}`} placeholder="YYYY-MM or N/A" value={form.manufactureDate}
              onChange={(e) => setForm({ ...form, manufactureDate: e.target.value })} />
          )}
          {field("Expiry date",
            <input className={`${inp} ${shimmer}`} placeholder="YYYY-MM or N/A" value={form.expiryDate}
              onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
          )}
        </div>
      </div>

      {/* Supplier */}
      <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-[10px] text-violet-600 uppercase tracking-wider font-medium">Supplier</p>
        {field("",
          <select
            className={inp.replace("border-amber-200", "border-violet-200").replace("focus:border-orange-400", "focus:border-violet-400")}
            value={addingSupplier ? "__add__" : (form.supplierId || "")}
            onChange={(e) => handleSupplierSelect(e.target.value)}
          >
            <option value="">— None —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.phone ? ` (${s.phone})` : ""}</option>
            ))}
            <option value="__add__">＋ Add new supplier…</option>
          </select>
        )}

        {addingSupplier && (
          <div className="flex flex-col gap-1.5 pt-1 border-t border-violet-100">
            <input
              autoFocus
              className={inp.replace("border-amber-200", "border-violet-200").replace("focus:border-orange-400", "focus:border-violet-400")}
              placeholder="Supplier name *"
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveSupplier()}
            />
            <input
              className={inp.replace("border-amber-200", "border-violet-200").replace("focus:border-orange-400", "focus:border-violet-400")}
              placeholder="Phone (optional)"
              value={newSupplierPhone}
              onChange={(e) => setNewSupplierPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveSupplier()}
            />
            <div className="flex gap-1.5">
              <button
                disabled={!newSupplierName.trim() || savingSupplier}
                onClick={handleSaveSupplier}
                className="flex items-center gap-1 px-3 py-1 bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3" /> {savingSupplier ? "Saving…" : "Add"}
              </button>
              <button
                onClick={() => { setAddingSupplier(false); setNewSupplierName(""); setNewSupplierPhone(""); }}
                className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User-filled */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-[10px] text-amber-600 uppercase tracking-wider font-medium">Fill in pricing & stock</p>
        <div className="grid grid-cols-2 gap-2">
          {field("Buy price (₹)",
            <input type="number" min={0} step="0.01" className={inp} value={form.buyPrice}
              onChange={(e) => setForm({ ...form, buyPrice: parseFloat(e.target.value) || 0 })} />
          )}
          {field("Sell price (₹)",
            <input type="number" min={0} step="0.01" className={inp} value={form.sellPrice}
              onChange={(e) => setForm({ ...form, sellPrice: parseFloat(e.target.value) || 0 })} />
          )}
          {field("On-hand qty",
            <input type="number" min={0} className={inp} value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })} />
          )}
        </div>
      </div>

      {/* Raw OCR text — collapsible */}
      {product.rawText && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowRaw((s) => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <span className="uppercase tracking-wide font-medium">What was read from the packaging</span>
            {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showRaw && (
            <pre className="px-3 pb-3 text-[9px] text-gray-500 whitespace-pre-wrap font-mono leading-relaxed max-h-32 overflow-y-auto selectable">
              {product.rawText || "(nothing was read)"}
            </pre>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => { playPop(); onConfirm(form); }}
          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2 rounded-xl transition-colors"
        >
          <Check className="w-4 h-4" /> Save product
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
