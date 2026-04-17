/**
 * Tests the brand/name extraction logic from ocr.ts directly in Node.
 * Run: node scripts/test_ocr_parse.mjs
 */

// ── Replicate the parsing logic from ocr.ts ───────────────────────────────────

const NOT_NAME = /\b(net\s*wt|nett?\s*wt|weight|ingredients?|contains?|best\s*before|expir|manufactur|packed\s*by|fssai|batch|lic\.?\s*no|toll[\s-]?free|customer\s*care|helpline|www\.|\.com|nutrition|serving|energy|protein|fat|carbohydrate|sodium|per\s*100|mrp|rs\.|price)\b/i;

function isClean(line) {
  if (NOT_NAME.test(line)) return false;
  const realWords = line.match(/[a-zA-Z\u00C0-\u024F]{4,}/g) ?? [];
  if (realWords.length === 0) return false;
  const symbols = (line.match(/[^a-zA-Z0-9\u00C0-\u024F\u0900-\u097f\u0b80-\u0bff\u0c00-\u0c7f\s.,\-]/g) ?? []).length;
  if (symbols / line.length > 0.3) return false;
  // Garbled OCR mixes 1-2 char tokens ("VV", "XY", "=", "~") between real words.
  // If more than half the tokens are ≤2 stripped chars, the line is noise.
  const tokens = line.trim().split(/\s+/);
  if (tokens.length > 1) {
    const shortCount = tokens.filter(t => t.replace(/[^a-zA-Z0-9]/g, "").length <= 2).length;
    if (shortCount / tokens.length > 0.5) return false;
  }
  return true;
}

function parseNames(frontText) {
  const lines = frontText.split("\n").map(l => l.trim()).filter(l => l.length > 1);
  const cleanLines = lines.filter(isClean);
  return {
    brand: cleanLines[0] ?? "(nothing)",
    name:  cleanLines[1] ?? cleanLines[0] ?? "(nothing)",
    cleanLines,
  };
}

// ── Test cases ────────────────────────────────────────────────────────────────

const tests = [
  {
    label: "Aachi Garam Masala — OCR as separate lines",
    front: `VV) = Wa\nAachi\nGaram Masala\nNet Wt. 100g\nBest Before Dec 2025`,
    expect: { brand: "Aachi", name: "Garam Masala" },
  },
  {
    label: "Aachi Garam Masala — garbled as one long line",
    front: `VV) = Wa manent XY ~ Aachi) 4\nGaram Masala\nNet Wt. 100g`,
    expect: { brand: "Garam Masala", name: "Garam Masala" },
  },
  {
    label: "Aachi Garam Masala — PaddleOCR clean",
    front: `Aachi\nGaram Masala\n100g`,
    expect: { brand: "Aachi", name: "Garam Masala" },
  },
  {
    label: "Mixed garble with brand buried",
    front: `VV) = Wa\nmanent XY ~\nAachi) 4\nGaram Masala`,
    expect: { brand: "Aachi", name: "Garam Masala" },
  },
  {
    label: "Clean two-word brand",
    front: `MTR Foods\nSambar Powder\nNet Wt 200g`,
    expect: { brand: "MTR Foods", name: "Sambar Powder" },
  },
  {
    label: "Single image — only front",
    front: `Maggi\n2-Minute Noodles\nMasala Flavour`,
    expect: { brand: "Maggi", name: "Noodles" },
  },
];

// ── Run tests ─────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

for (const t of tests) {
  const result = parseNames(t.front);
  const brandOk = result.brand.toLowerCase().includes(t.expect.brand.toLowerCase());
  const nameOk  = result.name.toLowerCase().includes(t.expect.name.toLowerCase());
  const ok = brandOk && nameOk;

  if (ok) {
    passed++;
    console.log(`✓ ${t.label}`);
  } else {
    failed++;
    console.log(`✗ ${t.label}`);
    console.log(`    expected brand="${t.expect.brand}" name="${t.expect.name}"`);
    console.log(`    got     brand="${result.brand}" name="${result.name}"`);
    console.log(`    cleanLines: ${JSON.stringify(result.cleanLines)}`);
  }
}

console.log(`\n${passed}/${passed + failed} passed`);
