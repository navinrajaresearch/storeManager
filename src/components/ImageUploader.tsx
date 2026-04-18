import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ImagePlus, X, ScanLine } from "lucide-react";
import type { NewProduct } from "../types";
import { ocrExtract } from "../lib/ocr";
import { playClick, playTick } from "../utils/sound";

interface Props {
  /** Called immediately when the user clicks "Read Packaging" — show form right away */
  onImagesReady: (images: string[], names: string[]) => void;
  /** Called when OCR finishes — populate the form fields */
  onOcrDone: (product: Omit<NewProduct, "images" | "imageLocation">, rawText: string) => void;
  onManual: () => void;
}

interface ImageEntry { dataUrl: string; name: string; }

export function ImageUploader({ onImagesReady, onOcrDone, onManual }: Props) {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function readFile(file: File): Promise<ImageEntry> {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res({ dataUrl: reader.result as string, name: file.name });
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const slots = 2 - entries.length;
    const toAdd = Array.from(files).slice(0, slots);
    const read = await Promise.all(toAdd.map(readFile));
    setEntries((prev) => [...prev, ...read].slice(0, 2));
  }

  function removeEntry(i: number) {
    playTick();
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  function proceed() {
    playClick();
    const dataUrls = entries.map((e) => e.dataUrl);
    const names    = entries.map((e) => e.name);

    // Show the form immediately — don't wait for OCR
    onImagesReady(dataUrls, names);

    // Scan in background; form fields fill in when done
    ocrExtract(dataUrls)
      .then(({ parsed, rawText }) => onOcrDone(parsed, rawText))
      .catch(() => onOcrDone(
        { brand: "", name: "", sourceLanguage: "", manufactureDate: "N/A",
          expiryDate: "N/A", buyPrice: 0, sellPrice: 0, quantity: 0, soldQuantity: 0, salesHistory: "", category: "Food & Beverage", supplierId: "" },
        ""
      ));
  }

  const SLOTS = ["Front of packaging", "Back / side"];

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">
      <div className="flex gap-3">
        {[0, 1].map((slot) => {
          const entry = entries[slot];
          return (
            <motion.div
              key={slot}
              whileHover={{ scale: entry ? 1 : 1.03 }}
              className={`relative flex-1 h-28 rounded-xl border-2 border-dashed overflow-hidden cursor-pointer transition-colors ${
                entry ? "border-transparent" : "border-gray-300 hover:border-indigo-400 bg-gray-50"
              }`}
              onClick={() => { if (!entry) { playTick(); inputRef.current?.click(); } }}
            >
              {entry ? (
                <>
                  <img src={entry.dataUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={(e) => { e.stopPropagation(); removeEntry(slot); }}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center text-white/90 hover:bg-black/70"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="absolute bottom-0 inset-x-0 bg-black/40 px-2 py-1">
                    <p className="text-[9px] text-white/80 truncate">{entry.name}</p>
                  </div>
                  <div className="absolute top-1 left-1 text-[9px] text-white/70 bg-black/40 rounded px-1">
                    {SLOTS[slot]}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-1 text-gray-400">
                  <ImagePlus className="w-5 h-5" />
                  <span className="text-[10px]">{SLOTS[slot]}</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      <div className="flex gap-2">
        <motion.button
          disabled={entries.length === 0}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={proceed}
          className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
        >
          <ScanLine className="w-4 h-4" />
          Read Packaging
        </motion.button>
        <button
          onClick={() => { playTick(); onManual(); }}
          className="px-3 py-2.5 text-sm text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
        >
          Manual
        </button>
      </div>
    </div>
  );
}
