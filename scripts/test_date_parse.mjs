/**
 * Tests the date extraction logic from ocr.ts directly in Node.
 * Run: node scripts/test_date_parse.mjs
 */

// ── Replicate findDate + normaliseDate from ocr.ts ────────────────────────────

const MONTH_NAMES = {
  jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
  jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
};

const DATE_PATTERNS = [
  /((?:19|20)\d{2}[-\/\.]\d{1,2}(?:[-\/\.]\d{1,2})?)/,
  /(\d{1,2}[-\/\.](?:\d{1,2}[-\/\.])?((?:19|20)\d{2}))/,
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/]?\d{2,4})/i,
  /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/i,
  /\b(\d{1,2}[\/\-]\d{2})\b/,
];

function normaliseDate(raw) {
  const trimmed = raw.trim();
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
  const yearIdx = parts.findIndex(p => p.length === 4 && /^\d{4}$/.test(p));
  if (yearIdx !== -1) {
    const yyyy = parts[yearIdx];
    const rest = parts.filter((_, i) => i !== yearIdx);
    if (rest.length >= 2) {
      const [a, b] = yearIdx === 0 ? [rest[0], rest[1]] : [rest[1], rest[0]];
      return `${yyyy}-${a.padStart(2,"0")}-${b.padStart(2,"0")}`;
    }
    if (rest.length === 1) return `${yyyy}-${rest[0].padStart(2,"0")}`;
    return yyyy;
  }
  // MM/YY or MM-YY
  const mmyyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{2})$/);
  if (mmyyMatch) {
    const mm = parseInt(mmyyMatch[1]);
    const yy = parseInt(mmyyMatch[2]);
    if (mm >= 1 && mm <= 12 && yy >= 20 && yy <= 45)
      return `20${mmyyMatch[2]}-${mmyyMatch[1].padStart(2, "0")}`;
  }
  return trimmed;
}

function findDate(text, keywords, globalFallback) {
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
      const d6 = slice.match(/\b(\d{2})(\d{2})(\d{2})\b/);
      if (d6) {
        const [, dd, mm, yy] = d6;
        if (parseInt(yy) >= 20 && parseInt(yy) <= 40 && parseInt(mm) >= 1 && parseInt(mm) <= 12)
          return `20${yy}-${mm}-${dd}`;
      }
    }
  }
  if (globalFallback || !keywordFound) {
    const iso = text.match(/((?:19|20)\d{2}[-\/\.]\d{2}[-\/\.]\d{2})/);
    if (iso) return normaliseDate(iso[1]);
    const mon = text.match(/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/]?\d{2,4})/i);
    if (mon) return normaliseDate(mon[1]);
  }
  return null;
}

const EXP_KW  = ["best before", "exp", "expiry", "use by", "bbd", "use before", "bb", "expiration"];
const MFG_KW  = ["mfd", "mfg", "manufactured", "production date", "made on", "prod ", "packed on", "packing date", "pack date"];

// ── Test cases ────────────────────────────────────────────────────────────────

const tests = [
  // formats that already work
  { text: "Best Before: Jun 2026",        kw: EXP_KW,  expect: "2026-06" },
  { text: "Mfg. Jun 2025",               kw: MFG_KW,  expect: "2025-06" },
  { text: "MFD: 2025/06/15",             kw: MFG_KW,  expect: "2025-06-15" },
  { text: "exp date 15/06/2026",         kw: EXP_KW,  expect: "2026-06-15" },
  // common Indian packaging gaps
  { text: "MFD: 03-25",                  kw: MFG_KW,  expect: "2025-03" },  // MM-YY
  { text: "EXP. 06/26",                  kw: EXP_KW,  expect: "2026-06" },  // "exp." not "exp "
  { text: "EXP:06/2026",                 kw: EXP_KW,  expect: "2026-06" },  // "exp:" no space
  { text: "BB: 03/25",                   kw: EXP_KW,  expect: "2025-03" },  // "bb:" not "bb "
  { text: "Mfg 06/25  Exp 06/26",        kw: MFG_KW,  expect: "2025-06" },  // MM/YY
  { text: "MFG-06/25 EXP-06/26",         kw: MFG_KW,  expect: "2025-06" },
  { text: "BEST BEFORE: 06-26",          kw: EXP_KW,  expect: "2026-06" },  // MM-YY expiry
];

let passed = 0, failed = 0;
for (const t of tests) {
  const result = findDate(t.text, t.kw, false) ?? "(null)";
  const ok = result === t.expect;
  if (ok) { passed++; console.log(`✓ "${t.text}" → ${result}`); }
  else     { failed++; console.log(`✗ "${t.text}"\n    expected: ${t.expect}\n    got:      ${result}`); }
}
console.log(`\n${passed}/${passed+failed} passed`);
