import { useState } from "react";
import { motion } from "framer-motion";
import { Cpu, Shirt, Coffee, Home, Dumbbell, BookOpen, Gamepad2, Heart, Car, Package, TrendingUp, TrendingDown, Globe, Calendar, Pencil } from "lucide-react";
import type { Product } from "../types";
import { calcBuySellAmt } from "../types";
import { playTick } from "../utils/sound";

const CAT_GRADIENT: Record<string, string> = {
  Electronics: "from-blue-100 to-indigo-50",
  Clothing: "from-pink-100 to-rose-50",
  "Food & Beverage": "from-amber-100 to-orange-50",
  "Home & Garden": "from-green-100 to-emerald-50",
  Sports: "from-orange-100 to-yellow-50",
  Books: "from-purple-100 to-violet-50",
  Toys: "from-yellow-100 to-amber-50",
  "Health & Beauty": "from-rose-100 to-pink-50",
  Automotive: "from-cyan-100 to-sky-50",
  Other: "from-gray-100 to-gray-50",
};

const CAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Electronics: Cpu, Clothing: Shirt, "Food & Beverage": Coffee,
  "Home & Garden": Home, Sports: Dumbbell, Books: BookOpen,
  Toys: Gamepad2, "Health & Beauty": Heart, Automotive: Car, Other: Package,
};

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

interface Props {
  product: Product;
  onDelete?: (id: string) => void;
  onEdit?: (product: Product) => void;
}

export function ProductTile({ product, onDelete, onEdit }: Props) {
  const [flipped, setFlipped] = useState(false);
  const category = detectCategory(product.brand, product.name);
  const Icon = CAT_ICON[category] ?? Package;
  const gradient = CAT_GRADIENT[category] ?? CAT_GRADIENT.Other;
  const hasImage = product.images.length > 0;
  const buySellAmt = calcBuySellAmt(product);
  const amtPositive = buySellAmt >= 0;
  const isExpired = (() => {
    if (product.expiryDate === "N/A") return false;
    const d = new Date(product.expiryDate);
    return !isNaN(d.getTime()) && d < new Date();
  })();
  const isExpiringSoon = (() => {
    if (product.expiryDate === "N/A" || isExpired) return false;
    const d = new Date(product.expiryDate);
    const in90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    return !isNaN(d.getTime()) && d <= in90;
  })();

  return (
    <div className="w-44 h-60 cursor-pointer select-none flex-shrink-0" style={{ perspective: "1000px" }}
      onClick={() => { playTick(); setFlipped((f) => !f); }} title={flipped ? "Click to flip back" : "Click for details"}>
      <motion.div className="w-full h-full relative" style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateY: flipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 160, damping: 22 }}>

        {/* FRONT */}
        <div className="absolute inset-0 rounded-2xl overflow-hidden shadow-md" style={{ backfaceVisibility: "hidden" }}>
          {hasImage ? (
            <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full bg-gradient-to-b ${gradient} flex items-center justify-center`}>
              <Icon className="w-14 h-14 text-gray-300" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-3 pt-8 pb-3">
            {product.brand && <p className="text-white/70 text-[9px] uppercase tracking-wider truncate">{product.brand}</p>}
            <p className="text-white text-xs font-semibold leading-snug truncate">{product.name}</p>
            {product.sourceLanguage && (
              <div className="flex items-center gap-1 mt-0.5">
                <Globe className="w-2.5 h-2.5 text-white/50" />
                <p className="text-white/50 text-[9px]">{product.sourceLanguage}</p>
              </div>
            )}
          </div>
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {isExpired && <span className="text-[8px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-medium">Expired</span>}
            {isExpiringSoon && <span className="text-[8px] bg-amber-400 text-white px-1.5 py-0.5 rounded-full font-medium">Exp. soon</span>}
            {product.quantity === 0 && <span className="text-[8px] bg-gray-500 text-white px-1.5 py-0.5 rounded-full font-medium">Out of stock</span>}
            {product.quantity > 0 && product.quantity < 10 && <span className="text-[8px] bg-orange-400 text-white px-1.5 py-0.5 rounded-full font-medium">Low stock</span>}
          </div>
          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <span className="text-white/70 text-[9px] font-bold">↻</span>
          </div>
        </div>

        {/* BACK */}
        <div className="absolute inset-0 rounded-2xl bg-white border border-amber-100 shadow-lg flex flex-col"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
          <div className="px-3 pt-3 pb-2 border-b border-amber-50">
            {product.brand && <p className="text-[9px] text-orange-500 uppercase tracking-wider truncate">{product.brand}</p>}
            <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2">{product.name}</p>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col gap-1.5 overflow-hidden">
            <Row label="On hand" value={`${product.quantity}`} />
            <Row label="Sold" value={`${product.soldQuantity}`} />
            <Row label="Buy price" value={`₹${product.buyPrice.toFixed(2)}`} />
            <Row label="Sell price" value={`₹${product.sellPrice.toFixed(2)}`} />
            {product.manufactureDate !== "N/A" && (
              <div className="flex items-center gap-1 mt-0.5">
                <Calendar className="w-2.5 h-2.5 text-gray-400 flex-shrink-0" />
                <span className="text-[9px] text-gray-400 truncate">Mfg {product.manufactureDate}</span>
              </div>
            )}
            {product.expiryDate !== "N/A" && (
              <div className={`flex items-center gap-1 ${isExpired ? "text-red-500" : isExpiringSoon ? "text-amber-500" : "text-gray-400"}`}>
                <Calendar className="w-2.5 h-2.5 flex-shrink-0" />
                <span className="text-[9px] truncate">Exp {product.expiryDate}</span>
              </div>
            )}
          </div>
          <div className="mx-3 mb-2 pt-2 border-t border-amber-50 flex items-center justify-between">
            <span className="text-[10px] text-gray-400">Buy-sell amt</span>
            <span className={`text-xs font-bold flex items-center gap-0.5 ${amtPositive ? "text-emerald-600" : "text-red-500"}`}>
              {amtPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {amtPositive ? "+" : ""}₹{buySellAmt.toFixed(2)}
            </span>
          </div>
          {product.imageLocation.length > 0 && (
            <div className="mx-3 mb-1 text-[8px] text-gray-400 truncate">📁 {product.imageLocation.join(", ")}</div>
          )}
          <div className="mx-3 mb-2.5 flex gap-2">
            {onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); playTick(); onEdit(product); }}
                className="flex-1 flex items-center justify-center gap-1 text-[10px] text-orange-400 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg py-1 transition-colors"
              >
                <Pencil className="w-2.5 h-2.5" /> Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); playTick(); onDelete(product.id); }}
                className="flex-1 text-[10px] text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 rounded-lg py-1 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-[10px] text-gray-400">{label}</span>
      <span className="text-[10px] text-gray-700 font-medium">{value}</span>
    </div>
  );
}
