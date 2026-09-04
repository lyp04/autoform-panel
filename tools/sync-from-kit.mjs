#!/usr/bin/env node
// Sync the panel core from autoform-kit, which is the single source of truth for it.
//
//   node tools/sync-from-kit.mjs --kit <path-to-autoform-kit>            write the files
//   node tools/sync-from-kit.mjs --kit <path-to-autoform-kit> --check    verify only (CI)
//
// What it copies:
//   panel/src/*.js            -> api/*.js                    verbatim
//   panel/src/worker.js       -> api/request-handler.mjs     Worker default export -> named handleRequest
//   panel/*.example.json      -> config/*.example.json       verbatim
//   panel/test/*              -> test/*                      import paths rewritten for this layout
//
// Tests that read the kit's Android app/ tree are skipped: they need the full monorepo and run in
// the kit's own CI.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const kitIndex = args.indexOf("--kit");
const kit = kitIndex >= 0 ? args[kitIndex + 1] : "/root/akit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(kit, "panel", "src");
const testDir = path.join(kit, "panel", "test");

if (!existsSync(srcDir)) {
  console.error(`autoform-kit panel/src not found at ${srcDir}`);
  console.error("Pass --kit <path to an autoform-kit checkout>.");
  process.exit(2);
}

const sha = (text) => createHash("sha256").update(text).digest("hex");
let drifted = 0;
let written = 0;

function emit(relative, content) {
  const destination = path.join(root, relative);
  if (!check) {
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
    written++;
    return;
  }
  if (!existsSync(destination)) {
    console.error(`missing  ${relative}`);
    drifted++;
    return;
  }
  if (sha(readFileSync(destination, "utf8")) !== sha(content)) {
    console.error(`DRIFT    ${relative}`);
    drifted++;
  }
}

// 1) Shared modules, byte for byte.
for (const file of readdirSync(srcDir)) {
  if (!file.endsWith(".js") || file === "worker.js") continue;
  emit(path.join("api", file), readFileSync(path.join(srcDir, file), "utf8"));
}

// 2) worker.js becomes a plain named handler. This is the only intentional difference from the kit.
{
  const original = readFileSync(path.join(srcDir, "worker.js"), "utf8");
  let handler = original.replace(
    "export default {\n  async fetch(request, env) {",
    "export async function handleRequest(request, env) {"
  );
  handler = handler.replace(/\n {2}\}\n\};\s*$/, "\n}\n");
  if (handler === original) {
    console.error("worker.js export transform did not apply - upstream shape changed, update this script");
    process.exit(2);
  }
  emit(path.join("api", "request-handler.mjs"), handler);
}

// 3) Example configs the tests and operators read.
for (const file of ["backend-adapter.example.json", "notification-adapter.example.json"]) {
  const source = path.join(kit, "panel", file);
  if (existsSync(source)) emit(path.join("config", file), readFileSync(source, "utf8"));
}

// 4) Tests, with imports rewritten for this repo's layout.
const rewrite = (text) =>
  text
    .replace(
      /import\s+worker\s*,\s*\{([\s\S]*?)\}\s*from\s*"\.\.\/src\/worker\.js";/,
      (_match, named) =>
        `import { handleRequest, ${named.trim().replace(/,\s*$/, "")} } from "../api/request-handler.mjs";\n` +
        "const worker = { fetch: handleRequest };"
    )
    .replace(
      /import\s+worker\s+from\s*"\.\.\/src\/worker\.js";/,
      'import { handleRequest } from "../api/request-handler.mjs";\nconst worker = { fetch: handleRequest };'
    )
    .replace(/"\.\.\/src\//g, '"../api/')
    .replace(/"\.\.\/backend-adapter\.example\.json"/g, '"../config/backend-adapter.example.json"')
    .replace(/"\.\.\/notification-adapter\.example\.json"/g, '"../config/notification-adapter.example.json"');

const needsAndroidTree = (text) => /\.\.\/\.\.\/app\/|\.\.\/app\/src\//.test(text);
const skipped = [];
let tests = 0;

for (const file of readdirSync(testDir)) {
  const text = readFileSync(path.join(testDir, file), "utf8");
  if (file.endsWith(".test.js") && needsAndroidTree(text)) {
    skipped.push(file);
    continue;
  }
  emit(path.join("test", file), rewrite(text));
  if (file.endsWith(".test.js")) tests++;
}

console.log(`${tests} test files from the kit; ${skipped.length} skipped (need the kit's app/ tree):`);
for (const file of skipped) console.log(`  - ${file}`);

if (check) {
  if (drifted) {
    console.error(`\n${drifted} file(s) differ from ${kit}. Run without --check to resync.`);
    process.exit(1);
  }
  console.log("\nno drift from autoform-kit");
} else {
  console.log(`\nwrote ${written} files from ${kit}`);
}
