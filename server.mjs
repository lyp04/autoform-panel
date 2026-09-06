// Native Node HTTP server for the AutoForm Kit panel.
//
// This is a plain Node 22 web server. The request pipeline is `api/request-handler.mjs`
// (`handleRequest(request, bindings)`), which uses standard Web APIs (Request/Response/Headers/
// crypto.subtle) that Node 22 supports natively. The three services the panel needs are ordinary
// native modules, injected via `bindings`:
//   ASSETS            -> StaticAssets(panel/public)          static SPA files
//   CATALOG_R2        -> FileSystemR2Bucket(data/catalog)    content-addressed catalog store
//   APP_PAIR_TICKETS  -> SqliteDurableObjectNamespace(...)   single-writer ticket store
//   CF_VERSION_METADATA -> { id, tag, timestamp } from the env file (Cloudflare only)
//   SELF_HOSTED_DEPLOYMENT -> { sourceCommit, deploymentSha256, deployedAt } from this tree
// Config/secrets come from the env file (AUTOFORM_ENV_FILE, default /etc/autoform-panel/env).
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, cpSync, readdirSync, readFileSync, statSync } from "node:fs";
import { loadEnvFile } from "./api/env.mjs";
import { StaticAssets } from "./stores/static-assets.mjs";
import { FileSystemR2Bucket } from "./stores/catalog-bucket.mjs";
import { SqliteDurableObjectNamespace } from "./stores/pairing-store.mjs";
import { handleRequest, AppPairingTicketStore } from "./api/request-handler.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = process.env.AUTOFORM_ENV_FILE || path.join(ROOT, "config", "env");
const config = loadEnvFile(ENV_FILE, {});
const HOST = config.LISTEN_HOST || process.env.LISTEN_HOST || "127.0.0.1";
const PORT = Number(config.LISTEN_PORT || process.env.LISTEN_PORT || 18788);
const DATA_DIR = config.DATA_DIR || process.env.DATA_DIR || path.join(ROOT, "data");

// Create the runtime data directories on first run so a fresh clone works with config alone.
const catalogDir = path.join(DATA_DIR, "catalog");
mkdirSync(catalogDir, { recursive: true });
// On first run, seed an empty catalog so the panel bootstrap works before anything is published.
if (!existsSync(path.join(catalogDir, "catalog-current-v1.json"))) {
  const seedDir = path.join(ROOT, "config", "seed-catalog");
  if (existsSync(path.join(seedDir, "catalog-current-v1.json"))) cpSync(seedDir, catalogDir, { recursive: true });
}

const VARS = [
  "AI_BASE_URL", "AI_MODEL", "APP_PAIR_APPLICATION_IDS", "APP_PAIR_TTL_SECONDS", "BACKEND_API_BASE",
  "PUBLIC_URL"
];
const SECRETS = [
  "AI_API_KEY", "APP_PAIR_ISSUER_KEY", "BACKEND_SESSION_PROOF_CODES", "CATALOG_READ_KEY",
  "BACKEND_ADAPTER_JSON"
];

// `bindings` is a plain object of config values + injected native stores. It is passed to
// handleRequest() as its second argument and threaded to the panel modules that need it.
const bindings = {};
for (const name of [...VARS, ...SECRETS]) {
  const value = config[name] ?? process.env[name];
  if (value !== undefined && value !== "") bindings[name] = value;
}
bindings.CF_VERSION_METADATA = {
  id: config.VERSION_ID || "00000000-0000-0000-0000-000000000000",
  tag: config.VERSION_TAG || `autoform-source-${config.SOURCE_COMMIT || ""}`,
  timestamp: config.VERSION_TIMESTAMP || new Date().toISOString()
};

// Digest the code this process actually serves from: api/, stores/, public/ and the two entry
// files. Data and node_modules are excluded — the first changes constantly and is not code, the
// second is pinned by package-lock.json. Walked in sorted order so the digest is reproducible.
function deploymentDigest(root) {
  const hash = createHash("sha256");
  hash.update("AUTOFORM_PANEL_DEPLOYMENT_V1\n");
  const walk = (relative) => {
    const absolute = path.join(root, relative);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) walk(path.join(relative, entry));
      return;
    }
    if (!stat.isFile()) return;
    hash.update(`${relative}\n`);
    hash.update(createHash("sha256").update(readFileSync(absolute)).digest("hex"));
    hash.update("\n");
  };
  for (const entry of ["api", "stores", "public", "server.mjs", "package.json"]) walk(entry);
  return hash.digest("hex");
}

const deployedSourceCommit = (() => {
  const file = path.join(ROOT, "SOURCE_COMMIT");
  if (!existsSync(file)) return config.SOURCE_COMMIT || "";
  return readFileSync(file, "utf8").trim();
})();
if (/^[0-9a-f]{40}$/u.test(deployedSourceCommit)) {
  bindings.SELF_HOSTED_DEPLOYMENT = {
    sourceCommit: deployedSourceCommit,
    deploymentSha256: deploymentDigest(ROOT),
    deployedAt: new Date(statSync(path.join(ROOT, "SOURCE_COMMIT")).mtime).toISOString()
  };
}
bindings.ASSETS = new StaticAssets(path.join(ROOT, "public"));
bindings.CATALOG_R2 = new FileSystemR2Bucket(path.join(DATA_DIR, "catalog"));
bindings.APP_PAIR_TICKETS = new SqliteDurableObjectNamespace({
  databasePath: path.join(DATA_DIR, "pairing.sqlite"),
  className: "AppPairingTicketStore",
  ObjectClass: AppPairingTicketStore,
  env: bindings
});

for (const name of ["CATALOG_READ_KEY", "APP_PAIR_ISSUER_KEY", "PUBLIC_URL"]) {
  if (!bindings[name]) console.warn(`[autoform-panel] WARNING: ${name} is not set (see ${ENV_FILE})`);
}

// Build a standard Web Request from the Node request (Node 22 ships Request/Headers/ReadableStream).
function requestFromNode(req) {
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || `${HOST}:${PORT}`).split(",")[0].trim();
  const url = new URL(req.url, `${proto}://${host}`);
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    if (/^(connection|keep-alive|transfer-encoding|upgrade|proxy-connection)$/iu.test(name)) continue;
    headers.append(name, req.rawHeaders[i + 1]);
  }
  const hasBody = !(req.method === "GET" || req.method === "HEAD");
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual"
  });
}

async function sendResponse(res, response, method) {
  const headers = [];
  for (const [name, value] of response.headers) {
    if (name === "set-cookie") continue;
    headers.push([name, value]);
  }
  for (const cookie of response.headers.getSetCookie()) headers.push(["set-cookie", cookie]);
  res.writeHead(response.status, response.statusText, headers);
  if (method === "HEAD" || !response.body) return res.end();
  Readable.fromWeb(response.body).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  let status = 500;
  try {
    if (req.url === "/__host/health") {
      status = 200;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, tickets: bindings.APP_PAIR_TICKETS.stats(), version: bindings.CF_VERSION_METADATA }));
      return;
    }
    const response = await handleRequest(requestFromNode(req), bindings);
    status = response.status;
    await sendResponse(res, response, req.method);
  } catch (error) {
    console.error("[autoform-panel] unhandled", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "internal error" }));
    } else res.destroy();
  } finally {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`${req.method} ${req.url} ${status} ${ms.toFixed(1)}ms`);
  }
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.listen(PORT, HOST, () => console.log(`[autoform-panel] listening on http://${HOST}:${PORT} (data: ${DATA_DIR})`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[autoform-panel] ${signal}, shutting down`);
    server.close(() => { bindings.APP_PAIR_TICKETS.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
