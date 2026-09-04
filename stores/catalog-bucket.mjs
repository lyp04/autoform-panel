// Filesystem-backed stand-in for the Workers R2 binding surface that panel/src/catalog.js uses:
//   bucket.get(key)  -> null | { key, etag, httpEtag, size, text(), json(), arrayBuffer() }
//   bucket.put(key, value, { onlyIf, httpMetadata }) -> object | null (null = precondition failed)
// R2 reports the MD5 of a single-part upload as the ETag; the live bucket was verified to match
// that rule for every object, so mirrored files keep byte-identical ETags.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

function md5(buffer) {
  return createHash("md5").update(buffer).digest("hex");
}

function safeKey(key) {
  if (typeof key !== "string" || !key || key.includes("\0")) throw new Error("invalid R2 key");
  const normalized = path.posix.normalize(key);
  if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    throw new Error("invalid R2 key");
  }
  return normalized;
}

function unquote(value) {
  return String(value).trim().replace(/^W\//u, "").replace(/^"(.*)"$/u, "$1");
}

/** Mirrors the Workers runtime's evaluation of `onlyIf` (Headers or R2Conditional). */
function preconditionHolds(onlyIf, existing) {
  if (!onlyIf) return true;
  const etag = existing ? existing.etag : null;
  if (typeof onlyIf.get === "function") {
    const ifMatch = onlyIf.get("If-Match");
    const ifNoneMatch = onlyIf.get("If-None-Match");
    if (ifMatch !== null && ifMatch !== undefined) {
      const list = ifMatch.split(",").map(unquote);
      if (!etag || (!list.includes("*") && !list.includes(etag))) return false;
    }
    if (ifNoneMatch !== null && ifNoneMatch !== undefined) {
      const list = ifNoneMatch.split(",").map(unquote);
      if (etag && (list.includes("*") || list.includes(etag))) return false;
    }
    return true;
  }
  if (onlyIf.etagMatches !== undefined) {
    const list = [].concat(onlyIf.etagMatches).map(unquote);
    if (!etag || (!list.includes("*") && !list.includes(etag))) return false;
  }
  if (onlyIf.etagDoesNotMatch !== undefined) {
    const list = [].concat(onlyIf.etagDoesNotMatch).map(unquote);
    if (etag && (list.includes("*") || list.includes(etag))) return false;
  }
  if (onlyIf.uploadedBefore instanceof Date && existing && !(existing.uploaded < onlyIf.uploadedBefore)) return false;
  if (onlyIf.uploadedAfter instanceof Date && existing && !(existing.uploaded > onlyIf.uploadedAfter)) return false;
  return true;
}

class R2ObjectMirror {
  constructor(key, buffer, uploaded, httpMetadata) {
    this.key = key;
    this.size = buffer.length;
    this.etag = md5(buffer);
    this.httpEtag = `"${this.etag}"`;
    this.uploaded = uploaded;
    this.httpMetadata = httpMetadata || {};
    this.customMetadata = {};
    this.version = this.etag;
    Object.defineProperty(this, "_buffer", { value: buffer, enumerable: false });
  }

  async text() { return this._buffer.toString("utf8"); }
  async json() { return JSON.parse(this._buffer.toString("utf8")); }
  async arrayBuffer() {
    return this._buffer.buffer.slice(this._buffer.byteOffset, this._buffer.byteOffset + this._buffer.byteLength);
  }
  get body() { return new Blob([this._buffer]).stream(); }
  writeHttpMetadata(headers) {
    if (this.httpMetadata.contentType) headers.set("content-type", this.httpMetadata.contentType);
    if (this.httpMetadata.cacheControl) headers.set("cache-control", this.httpMetadata.cacheControl);
  }
}

export class FileSystemR2Bucket {
  constructor(root) {
    this.root = path.resolve(root);
    this.queue = Promise.resolve();
  }

  filePath(key) {
    return path.join(this.root, safeKey(key));
  }

  metaPath(key) {
    return `${this.filePath(key)}.r2meta.json`;
  }

  async readMeta(key) {
    try {
      return JSON.parse(await fs.readFile(this.metaPath(key), "utf8"));
    } catch {
      return {};
    }
  }

  async get(key) {
    let buffer;
    let stat;
    try {
      const file = this.filePath(key);
      [buffer, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
    const meta = await this.readMeta(key);
    return new R2ObjectMirror(key, buffer, new Date(meta.uploaded || stat.mtime), meta.httpMetadata);
  }

  async head(key) {
    return this.get(key);
  }

  async put(key, value, options = {}) {
    const run = async () => {
      const existing = await this.get(key);
      if (!preconditionHolds(options.onlyIf, existing)) return null;
      const buffer = await toBuffer(value);
      const file = this.filePath(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const uploaded = new Date();
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, buffer, { mode: 0o640 });
      await fs.rename(tmp, file);
      await fs.writeFile(this.metaPath(key), JSON.stringify({
        uploaded: uploaded.toISOString(),
        httpMetadata: options.httpMetadata || {}
      }), { mode: 0o640 });
      return new R2ObjectMirror(key, buffer, uploaded, options.httpMetadata);
    };
    // R2 serialises conditional writes per key; a single process-wide queue is sufficient here.
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async delete(keys) {
    for (const key of [].concat(keys)) {
      await fs.rm(this.filePath(key), { force: true });
      await fs.rm(this.metaPath(key), { force: true });
    }
  }

  async list(options = {}) {
    const prefix = options.prefix || "";
    const objects = [];
    const walk = async (dir, rel) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
        else if (!entry.name.endsWith(".r2meta.json") && !entry.name.endsWith(".tmp") && childRel.startsWith(prefix)) {
          objects.push(await this.get(childRel));
        }
      }
    };
    await walk(this.root, "");
    objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { objects, truncated: false, delimitedPrefixes: [] };
  }
}

async function toBuffer(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value && typeof value.arrayBuffer === "function") return Buffer.from(await value.arrayBuffer());
  if (value && typeof value.getReader === "function") {
    const chunks = [];
    for await (const chunk of value) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  if (value === null || value === undefined) return Buffer.alloc(0);
  throw new Error("unsupported R2 put value");
}
