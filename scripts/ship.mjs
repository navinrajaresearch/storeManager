#!/usr/bin/env node
/**
 * npm run ship
 *
 * 1. Wipes Rust build cache (src-tauri/target) — the 13-18 GB culprit
 * 2. Zips the project source into store_manager_YYYY-MM-DD.zip
 *    excluding: target/, node_modules/, dist/, .venv/
 * 3. Prints the final zip size
 *
 * Works on macOS and Windows — no extra npm packages needed.
 */

import { execSync }                                        from "child_process";
import { existsSync, statSync, mkdirSync, cpSync,
         readdirSync }                                     from "fs";
import { join, resolve, dirname, relative }               from "path";
import { fileURLToPath }                                   from "url";
import os                                                  from "os";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, "..");
const TODAY = new Date().toISOString().slice(0, 10);
const OUT   = join(ROOT, `store_manager_${TODAY}.zip`);

const EXCLUDE = ["node_modules", "target", ".venv", "dist", "dist-ssr", ".git"];

function fmt(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

function run(cmd) {
  console.log("  $", cmd);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

// ── Step 1: cargo clean ───────────────────────────────────────────────────────

console.log("\n── Step 1: Clean Rust build cache ──────────────────────────");
const cargoToml = join(ROOT, "src-tauri", "Cargo.toml");
if (existsSync(cargoToml)) {
  run(`cargo clean --manifest-path "${cargoToml}"`);
  console.log("  ✓ target/ wiped");
} else {
  console.log("  ⚠ Cargo.toml not found, skipping");
}

// ── Step 2: zip source ───────────────────────────────────────────────────────

console.log("\n── Step 2: Create zip ───────────────────────────────────────");

if (os.platform() === "win32") {
  // Stage files into a temp dir, then PowerShell Compress-Archive
  const stage = join(os.tmpdir(), `ship_stage_${Date.now()}`);
  mkdirSync(stage, { recursive: true });

  function stageDir(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel  = relative(ROOT, full);
      const segments = rel.split(/[/\\]/);
      if (EXCLUDE.some((ex) => segments.includes(ex))) continue;
      if (entry.name.endsWith(".zip")) continue;
      if (entry.isDirectory()) {
        stageDir(full);
      } else {
        const dest = join(stage, rel);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(full, dest);
      }
    }
  }

  stageDir(ROOT);
  run(`powershell -NoProfile -Command "Compress-Archive -Path '${stage}\\*' -DestinationPath '${OUT}' -Force"`);
  execSync(`rmdir /s /q "${stage}"`, { shell: "cmd.exe", stdio: "inherit" });

} else {
  // macOS / Linux — zip is always available
  const excludeArgs = EXCLUDE
    .map((e) => `--exclude='*/${e}/*' --exclude='./${e}/*'`)
    .join(" ");
  run(`cd "${ROOT}" && zip -r "${OUT}" . ${excludeArgs} --exclude='*.DS_Store' --exclude='*.zip'`);
}

// ── Step 3: report ───────────────────────────────────────────────────────────

console.log("\n── Done ─────────────────────────────────────────────────────");
if (existsSync(OUT)) {
  console.log(`  ✓ ${OUT}`);
  console.log(`  Size: ${fmt(statSync(OUT).size)}`);
} else {
  console.log("  ⚠ Zip not found — check errors above");
}
console.log("");
