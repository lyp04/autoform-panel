// Stand-in for the Workers static assets binding (`[assets] directory = "./public"`) with the
// default `html_handling = "auto-trailing-slash"` and `not_found_handling = "none"` behaviour that
// the live deployment exhibited: `/` -> index.html, `/index.html` -> 307 `/`, `/x.html` -> 307 `/x`,
// unknown -> empty 404. Only GET/HEAD are served.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json"
};

export class StaticAssets {
  constructor(root) {
    this.root = path.resolve(root);
    this.cache = new Map();
  }

  async load(relative) {
    const file = path.join(this.root, relative);
    if (!file.startsWith(this.root + path.sep) && file !== this.root) return null;
    let stat;
    try { stat = await fs.stat(file); } catch { return null; }
    if (!stat.isFile()) return null;
    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
    const body = await fs.readFile(file);
    const entry = {
      body,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`,
      type: MIME[path.extname(file).toLowerCase()] || "application/octet-stream"
    };
    this.cache.set(file, entry);
    return entry;
  }

  async fetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response(null, { status: 404 }); }
    if (pathname.includes("\0")) return new Response(null, { status: 404 });

    const redirect = (to) => new Response(null, { status: 307, headers: { location: to + url.search } });

    // auto-trailing-slash: /foo.html -> /foo ; /foo/index.html -> /foo/ ; /index.html -> /
    if (pathname.endsWith("/index.html")) return redirect(pathname.slice(0, -"index.html".length));
    if (pathname.endsWith(".html")) return redirect(pathname.slice(0, -".html".length));

    const candidates = [];
    const relative = pathname.replace(/^\/+/u, "");
    if (pathname.endsWith("/")) {
      candidates.push(`${relative}index.html`);
      // /foo/ where foo.html exists -> redirect to /foo
      const bare = relative.replace(/\/+$/u, "");
      if (bare && await this.load(`${bare}.html`)) return redirect(`/${bare}`);
    } else {
      candidates.push(relative);
      candidates.push(`${relative}.html`);
      // /foo where foo/index.html exists -> redirect to /foo/
      if (await this.load(`${relative}/index.html`)) return redirect(`${pathname}/`);
    }
    let entry = null;
    for (const candidate of candidates) {
      entry = await this.load(candidate);
      if (entry) break;
    }
    if (!entry) return new Response(null, { status: 404 });

    const headers = new Headers({
      "content-type": entry.type,
      "cache-control": "public, max-age=0, must-revalidate",
      etag: entry.etag
    });
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch.split(",").map((s) => s.trim().replace(/^W\//u, "")).includes(entry.etag)) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("content-length", String(entry.size));
    return new Response(request.method === "HEAD" ? null : entry.body, { status: 200, headers });
  }
}
