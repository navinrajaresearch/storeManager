import { useState, useEffect } from "react";
import { Check, X, ChevronDown, ChevronUp } from "lucide-react";
import type { NewProduct } from "../types";
import { CATEGORIES } from "../types";
import { playPop } from "../utils/sound";


interface Props {
  product: Partial<NewProduct>;
  images: string[];
  imageNames: string[];
  scanning?: boolean;
  onConfirm: (p: NewProduct) => void;
  onCancel: () => void;
}

export function ProductConfirm({ product, images, imageNames, scanning, onConfirm, onCancel }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [form, setForm] = useState<NewProduct>({
    brand:           product.brand           ?? "",
    sourceLanguage:  product.sourceLanguage  ?? "",
    name:            product.name            ?? "",
    manufactureDate: product.manufactureDate ?? "N/A",
    expiryDate:      product.expiryDate      ?? "N/A",
    imageLocation:   imageNames,
    quantity:        product.quantity        ?? 0,
    soldQuantity:    product.soldQuantity    ?? 0,
    buyPrice:        product.buyPrice        ?? 0,
    sellPrice:       product.sellPrice       ?? 0,
    images,
  });

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
          {field("Source language",
            <input className={`${inp} ${shimmer}`} value={form.sourceLanguage}
              onChange={(e) => setForm({ ...form, sourceLanguage: e.target.value })} />
          )}
          {field("Category",
            <select className={inp} value={(form as NewProduct & { category?: string }).category ?? "Other"}
              onChange={(e) => setForm({ ...form, ...({"category": e.target.value} as Record<string, unknown>) as Partial<NewProduct> })}>
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
          {field("Sold qty",
            <input type="number" min={0} className={inp} value={form.soldQuantity}
              onChange={(e) => setForm({ ...form, soldQuantity: parseInt(e.target.value) || 0 })} />
          )}
        </div>
      </div>

      {/* Raw OCR text — collapsible, helps user see what was read */}
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
