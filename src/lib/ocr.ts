import { invoke } from "@tauri-apps/api/core";
import type { NewProduct } from "../types";

/**
 * Run Tesseract OCR on up to 2 images (data-URLs), then heuristically
 * parse the text to fill product fields.
 */
export interface OcrResult {
  parsed: Omit<NewProduct, "images" | "imageLocation">;
  rawText: string;
}

/** Resize + convert to grayscale JPEG in-browser before sending to OCR.
 *  Drops a 4K phone image (~12MB) down to ~150KB — single biggest speedup. */
async function prepareImage(dataUrl: string, maxDim = 1200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.filter = "grayscale(1) contrast(1.15)";
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(dataUrl); // fallback: send original
    img.src = dataUrl;
  });
}

export async function ocrExtract(images: string[]): Promise<OcrResult> {
  // Resize all images first (fast, in-browser), then fire OCR calls in parallel
  const prepared = await Promise.all(images.map((img) => prepareImage(img)));
  const texts = await Promise.all(
    prepared.map((img) => invoke<string>("extract_text_from_image", { dataUrl: img }))
  );
  // Front page text (image 0) — used for brand/name extraction.
  // All pages combined — used for date extraction (MFD/expiry often on the back).
  const frontText = texts[0]?.trim() ?? "";
  const rawText   = texts.map((t) => t.trim()).filter(Boolean).join("\n---\n");
  return { parsed: parseOcrText(rawText, frontText), rawText };
}

function parseOcrText(raw: string, frontText?: string): Omit<NewProduct, "images" | "imageLocation"> {
  // Brand/name come only from the front page; dates can come from any page.
  const nameSource = frontText ?? raw;
  const lines = nameSource.split("\n").map((l) => l.trim()).filter((l) => l.length > 1);

  // Lines that are clearly NOT a brand or product name — skip them.
  const NOT_NAME = /\b(net\s*wt|nett?\s*wt|weight|ingredients?|contains?|best\s*before|expir|manufactur|packed\s*by|fssai|batch|lic\.?\s*no|toll[\s-]?free|customer\s*care|helpline|www\.|\.com|nutrition|serving|energy|protein|fat|carbohydrate|sodium|per\s*100|mrp|rs\.|price)\b/i;

  // A line is "clean" if it has at least one real word (4+ letters),
  // a low symbol ratio, and is not regulatory/nutritional text.
  function isClean(line: string): boolean {
    if (NOT_NAME.test(line)) return false;
    const realWords = line.match(/[a-zA-Z\u00C0-\u024F]{4,}/g) ?? [];
    if (realWords.length === 0) return false; // "VV", "XY", "Wa" — all short fragments
    const symbols = (line.match(/[^a-zA-Z0-9\u00C0-\u024F\u0900-\u097f\u0b80-\u0bff\u0c00-\u0c7f\s.,\-]/g) ?? []).length;
    if (symbols / line.length > 0.3) return false;
    // Garbled OCR mixes 1-2 char tokens ("VV", "XY", "=", "~") between real words.
    // If more than half the tokens are ≤2 stripped chars, the line is noise.
    const tokens = line.trim().split(/\s+/);
    if (tokens.length > 1) {
      const shortCount = tokens.filter((t) => t.replace(/[^a-zA-Z0-9]/g, "").length <= 2).length;
      if (shortCount / tokens.length > 0.5) return false;
    }
    return true;
  }

  // Preserve OCR order (top → bottom on packaging).
  // Brand is usually the first prominent text; product name is directly below it.
  const cleanLines = lines.filter(isClean);

  const brand = cleanLines[0] ?? "";
  const name  = cleanLines[1] ?? cleanLines[0] ?? "";

  const expiryDate      = findDate(raw, ["best before", "exp", "expiry", "use by", "bbd", "use before", "bb", "expiration"], false) ?? "N/A";
  const manufactureDate = findDate(raw, ["mfd", "mfg", "manufactured", "production date", "made on", "prod ", "packed on", "packing date", "pack date"], true) ?? "N/A";

  return {
    brand,
    name,
    sourceLanguage: detectLanguage(raw),
    manufactureDate,
    expiryDate,
    buyPrice:     0,
    sellPrice:    0,
    quantity:     0,
    soldQuantity: 0,
  };
}

const MONTH_NAMES: Record<string, string> = {
  jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
  jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
};

// Patterns tried in order for each candidate slice
const DATE_PATTERNS: RegExp[] = [
  // YYYY-MM-DD  or  YYYY/MM  — year must be realistic (1900-2099)
  /((?:19|20)\d{2}[-\/\.]\d{1,2}(?:[-\/\.]\d{1,2})?)/,
  // DD-MM-YYYY  or  DD/MM/YYYY
  /(\d{1,2}[-\/\.](?:\d{1,2}[-\/\.])?((?:19|20)\d{2}))/,
  // MON-YY  or  MON YYYY  e.g. "JUN-15" "JUN 2015" "JUN/25"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/]?\d{2,4})/i,
  // DD MON YYYY  e.g. "15 JUN 2025"
  /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/i,
  // MM/YY or MM-YY  e.g. "06/25"  "03-26"  (2-digit year, validated in normaliseDate)
  /\b(\d{1,2}[\/\-]\d{2})\b/,
];

function findDate(text: string, keywords: string[], globalFallback: boolean): string | null {
  const lower = text.toLowerCase();
  let keywordFound = false;
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      keywordFound = true;
      const slice = text.slice(idx, idx + 80);
      for (const pat of DATE_PATTERNS) {
        const m = slice.match(pat);
        if (m) return normaliseDate(m[1]);
      }
      // 6-digit DDMMYY — only accept plausible food-product years (2020–2040)
      const d6 = slice.match(/\b(\d{2})(\d{2})(\d{2})\b/);
      if (d6) {
        const [, dd, mm, yy] = d6;
        const yyNum = parseInt(yy);
        if (yyNum >= 20 && yyNum <= 40 && parseInt(mm) >= 1 && parseInt(mm) <= 12)
          return `20${yy}-${mm}-${dd}`;
      }
    }
  }
  // Global fallbacks — only when allowed (mfg) or when no keyword was seen at all
  if (globalFallback || !keywordFound) {
    const iso = text.match(/((?:19|20)\d{2}[-\/\.]\d{2}[-\/\.]\d{2})/);
    if (iso) return normaliseDate(iso[1]);
    const mon = text.match(/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/]?\d{2,4})/i);
    if (mon) return normaliseDate(mon[1]);
  }
  return null;
}

function normaliseDate(raw: string): string {
  const trimmed = raw.trim();

  // MON-YY or MON YYYY or DD MON YYYY
  const monthNameMatch = trimmed.match(
    /^(?:(\d{1,2})\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/]?(\d{2,4})$/i
  );
  if (monthNameMatch) {
    const [, day, mon, yr] = monthNameMatch;
    const mm = MONTH_NAMES[mon.toLowerCase().slice(0, 3)];
    const yyyy = yr.length === 2 ? (parseInt(yr) >= 50 ? `19${yr}` : `20${yr}`) : yr;
    return day ? `${yyyy}-${mm}-${day.padStart(2, "0")}` : `${yyyy}-${mm}`;
  }

  const parts = trimmed.split(/[-\/\.\s]+/);
  const yearIdx = parts.findIndex((p) => p.length === 4 && /^\d{4}$/.test(p));
  if (yearIdx !== -1) {
    const yyyy = parts[yearIdx];
    const rest = parts.filter((_, i) => i !== yearIdx);
    if (rest.length >= 2) {
      // Year first → YYYY-MM-DD; year last (DD/MM/YYYY) → swap to YYYY-MM-DD
      const [a, b] = yearIdx === 0 ? [rest[0], rest[1]] : [rest[1], rest[0]];
      return `${yyyy}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
    }
    if (rest.length === 1)
      return `${yyyy}-${rest[0].padStart(2, "0")}`;
    return yyyy;
  }

  // MM/YY or MM-YY — only plausible months and future food-product years (2020–2045)
  const mmyyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{2})$/);
  if (mmyyMatch) {
    const mm = parseInt(mmyyMatch[1]);
    const yy = parseInt(mmyyMatch[2]);
    if (mm >= 1 && mm <= 12 && yy >= 20 && yy <= 45)
      return `20${mmyyMatch[2]}-${mmyyMatch[1].padStart(2, "0")}`;
  }

  return trimmed;
}

function detectLanguage(text: string): string {
  if (/[\u4e00-\u9fff]/.test(text))               return "Chinese";
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text))  return "Japanese";
  if (/[\uac00-\ud7af]/.test(text))               return "Korean";
  if (/[\u0600-\u06ff]/.test(text))               return "Arabic";
  if (/[\u0b80-\u0bff]/.test(text))               return "Tamil";
  if (/[\u0c00-\u0c7f]/.test(text))               return "Telugu";
  if (/[\u0900-\u097f]/.test(text))               return "Hindi";
  if (/[\u0400-\u04ff]/.test(text))               return "Russian";
  if (/[àâçéèêëîïôùûü]/i.test(text))             return "French";
  if (/[äöüß]/i.test(text))                       return "German";
  if (/[ñáéíóúü]/i.test(text))                    return "Spanish";
  return "English";
}
