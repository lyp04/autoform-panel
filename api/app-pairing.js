const ISSUE_PATH = "/api/app-pair/v1/issue";
const REDEEM_PATH = "/api/app-pair/v1/redeem";
const REDEEM_ENDPOINT = REDEEM_PATH;
const PROTOCOL = "app-pair/v1";
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 600;
const MAX_BODY_BYTES = 4096;
const MAX_INTERNAL_BODY_BYTES = 8192;
const INTERNAL_ORIGIN = "https://app-pair.internal";
const TICKET_RECORD_KEY = "ticket-v1";
const RATE_RECORD_KEY = "rate-v1";
const APP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const CLIENT_DIGEST_RE = /^[0-9a-f]{64}$/u;
const TICKET_RE = /^[A-Za-z0-9_-]{32,512}$/u;
const ACCESS_KEY_RE = /^[A-Za-z0-9._~+/-]+={0,2}$/u;
const HEX_SHA256_RE = /^[0-9a-f]{64}$/u;
const UTF8 = new TextEncoder();

// These limits are deliberately conservative for an operator-triggered pairing action. The
// download Worker is still responsible for authorizing its own session before it calls issue.
const RATE_LIMITS = Object.freeze({
  issueClient: Object.freeze({ limit: 12, windowSeconds: 60 }),
  issueGlobal: Object.freeze({ limit: 600, windowSeconds: 60 }),
  redeemSource: Object.freeze({ limit: 120, windowSeconds: 60 }),
  redeemGlobal: Object.freeze({ limit: 6000, windowSeconds: 60 })
});

function pairingJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function pairingFailure(status = 400) {
  return pairingJson({ error: "pairing unavailable" }, status);
}

function internalResult(ok, status = ok ? 200 : 409) {
  return pairingJson({ ok }, status);
}

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function jsonContentType(request) {
  const raw = request.headers.get("Content-Type") || "";
  const mediaType = raw.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json";
}

async function readSmallJson(request, maximumBytes = MAX_BODY_BYTES) {
  if (!jsonContentType(request)) return null;
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)) return null;
    if (Number(declaredLength) > maximumBytes) return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  if (length === 0) return null;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // TextDecoder normally strips a UTF-8 BOM. Reject it explicitly so there is one wire spelling.
  if (length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return null;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", UTF8.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", UTF8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, UTF8.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeSecretEqual(actual, expected) {
  // Digest both bounded strings first so the comparison loop always has the same 32-byte shape.
  // Including the byte lengths prevents a theoretical digest equality across different encodings.
  if (typeof actual !== "string" || typeof expected !== "string"
      || actual.length > 8192 || expected.length > 8192) return false;
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", UTF8.encode(actual)),
    crypto.subtle.digest("SHA-256", UTF8.encode(expected))
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = UTF8.encode(actual).byteLength ^ UTF8.encode(expected).byteLength;
  for (let i = 0; i < 32; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function validIssuerSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4096
    && value === value.trim() && !/[\u0000-\u0020\u007f]/u.test(value);
}

function validAccessKey(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 4096
    && ACCESS_KEY_RE.test(value);
}

function canonicalHttpsOrigin(value) {
  if (typeof value !== "string" || value.length > 2048 || value !== value.trim()) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || (parsed.pathname !== "" && parsed.pathname !== "/")
      || parsed.search || parsed.hash) return null;
  return parsed.origin;
}

function publicOrigin(env) {
  return canonicalHttpsOrigin(env.PUBLIC_URL);
}

function allowedApplicationIds(env) {
  if (typeof env.APP_PAIR_APPLICATION_IDS !== "string") return null;
  const raw = env.APP_PAIR_APPLICATION_IDS.split(",");
  if (raw.length < 1 || raw.length > 16) return null;
  const values = raw.map((value) => value.trim());
  if (values.some((value) => !value || value.length > 255 || !APP_ID_RE.test(value))) return null;
  const unique = [...new Set(values)];
  return unique.length === values.length ? unique : null;
}

function ticketTtlSeconds(env) {
  const raw = env.APP_PAIR_TTL_SECONDS ?? String(DEFAULT_TTL_SECONDS);
  if (!/^[1-9][0-9]{0,2}$/u.test(String(raw))) return null;
  const ttl = Number(raw);
  return Number.isInteger(ttl) && ttl >= 60 && ttl <= MAX_TTL_SECONDS ? ttl : null;
}

function bytesToBase64Url(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const value = (bytes[index] << 16)
      | ((remaining > 1 ? bytes[index + 1] : 0) << 8)
      | (remaining > 2 ? bytes[index + 2] : 0);
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    if (remaining > 1) output += alphabet[(value >>> 6) & 63];
    if (remaining > 2) output += alphabet[value & 63];
  }
  return output;
}

function createTicket() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function validNamespace(env) {
  return env.APP_PAIR_TICKETS
    && typeof env.APP_PAIR_TICKETS.idFromName === "function"
    && typeof env.APP_PAIR_TICKETS.get === "function";
}

async function callTicketStore(env, name, path, body) {
  const id = env.APP_PAIR_TICKETS.idFromName(name);
  const stub = env.APP_PAIR_TICKETS.get(id);
  if (!stub || typeof stub.fetch !== "function") throw new Error("ticket store unavailable");
  return await stub.fetch(new Request(`${INTERNAL_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
}

async function consumeRate(env, name, policy) {
  const response = await callTicketStore(env, `rate-v1:${name}`, "/v1/rate", {
    version: 1,
    limit: policy.limit,
    windowSeconds: policy.windowSeconds
  });
  return response.status === 200;
}

async function issueRateAllowed(env, clientDigest) {
  if (!await consumeRate(env, `issue-client:${clientDigest}`, RATE_LIMITS.issueClient)) {
    return false;
  }
  return await consumeRate(env, "issue-global", RATE_LIMITS.issueGlobal);
}

async function redeemRateAllowed(request, env, issuerSecret) {
  const connectingIp = (request.headers.get("CF-Connecting-IP") || "unavailable").slice(0, 128);
  const sourceDigest = await hmacSha256Hex(
    issuerSecret, `app-pair-redeem-source-v1\u0000${connectingIp}`);
  if (!await consumeRate(env, `redeem-source:${sourceDigest}`, RATE_LIMITS.redeemSource)) {
    return false;
  }
  return await consumeRate(env, "redeem-global", RATE_LIMITS.redeemGlobal);
}

function baseConfiguration(env, requestUrl) {
  const origin = publicOrigin(env);
  const applicationIds = allowedApplicationIds(env);
  const issuerSecret = env.APP_PAIR_ISSUER_KEY;
  const ttl = ticketTtlSeconds(env);
  if (!origin || requestUrl.origin !== origin || !applicationIds || !validIssuerSecret(issuerSecret)
      || !validAccessKey(env.CATALOG_READ_KEY) || issuerSecret === env.CATALOG_READ_KEY
      || !ttl || !validNamespace(env)) return null;
  return { origin, applicationIds, issuerSecret, ttl };
}

async function handleIssue(request, env, requestUrl) {
  if (request.method !== "POST") return pairingFailure(404);
  const configuration = baseConfiguration(env, requestUrl);
  if (!configuration) return pairingFailure(503);
  const authorization = request.headers.get("Authorization") || "";
  if (!await constantTimeSecretEqual(
    authorization, `Bearer ${configuration.issuerSecret}`)) return pairingFailure(401);
  const body = await readSmallJson(request);
  if (!exactObject(body, ["version", "applicationId", "clientDigest"])
      || body.version !== 1
      || typeof body.applicationId !== "string"
      || !configuration.applicationIds.includes(body.applicationId)
      || typeof body.clientDigest !== "string"
      || !CLIENT_DIGEST_RE.test(body.clientDigest)) return pairingFailure(400);
  try {
    if (!await issueRateAllowed(env, body.clientDigest)) return pairingFailure(429);
    const now = Math.floor(Date.now() / 1000);
    const ticket = createTicket();
    const [ticketHash, accessKeyHash] = await Promise.all([
      sha256Hex(ticket),
      sha256Hex(env.CATALOG_READ_KEY)
    ]);
    const expires = now + configuration.ttl;
    const stored = await callTicketStore(env, `ticket-v1:${ticketHash}`, "/v1/issue", {
      version: 1,
      protocol: PROTOCOL,
      panelOrigin: configuration.origin,
      endpoint: REDEEM_ENDPOINT,
      applicationId: body.applicationId,
      clientDigest: body.clientDigest,
      accessKeyHash,
      issuedAt: now,
      expires
    });
    if (stored.status !== 200) return pairingFailure(503);
    return pairingJson({
      version: 1,
      panelOrigin: configuration.origin,
      applicationId: body.applicationId,
      ticket,
      expires
    });
  } catch {
    return pairingFailure(503);
  }
}

async function handleRedeem(request, env, requestUrl) {
  if (request.method !== "POST") return pairingFailure(404);
  const configuration = baseConfiguration(env, requestUrl);
  if (!configuration) return pairingFailure(503);
  try {
    if (!await redeemRateAllowed(
      request, env, configuration.issuerSecret)) return pairingFailure(429);
    const body = await readSmallJson(request);
    if (!exactObject(body, ["version", "ticket"])
        || body.version !== 1 || typeof body.ticket !== "string"
        || !TICKET_RE.test(body.ticket)) return pairingFailure(400);
    const [ticketHash, accessKeyHash] = await Promise.all([
      sha256Hex(body.ticket),
      sha256Hex(env.CATALOG_READ_KEY)
    ]);
    const consumed = await callTicketStore(env, `ticket-v1:${ticketHash}`, "/v1/redeem", {
      version: 1,
      protocol: PROTOCOL,
      panelOrigin: configuration.origin,
      endpoint: REDEEM_ENDPOINT,
      allowedApplicationIds: configuration.applicationIds,
      accessKeyHash
    });
    if (consumed.status !== 200) return pairingFailure(400);
    // The Durable Object has already committed issued -> consumed at this point. A lost response
    // intentionally consumes the ticket; callers must issue a new one instead of replaying it.
    return pairingJson({ version: 1, accessKey: env.CATALOG_READ_KEY });
  } catch {
    return pairingFailure(503);
  }
}

export function isAppPairingPath(path) {
  return path === ISSUE_PATH || path === REDEEM_PATH;
}

export async function handleAppPairingRequest(request, env, requestUrl) {
  // Nothing from a pairing route may reach worker.js's general exception response, which includes
  // an error message for Panel administration diagnostics. Pairing always fails with one generic,
  // no-store contract even if a binding/getter/runtime primitive throws unexpectedly.
  try {
    const url = requestUrl || new URL(request.url);
    if (url.search || url.hash) return pairingFailure(404);
    if (url.pathname === ISSUE_PATH) return await handleIssue(request, env, url);
    if (url.pathname === REDEEM_PATH) return await handleRedeem(request, env, url);
    return pairingFailure(404);
  } catch {
    return pairingFailure(503);
  }
}

function validStoredTicket(record) {
  return exactObject(record, [
    "version", "protocol", "panelOrigin", "endpoint", "applicationId", "clientDigest",
    "accessKeyHash", "issuedAt", "expires", "status"
  ])
    && record.version === 1 && record.protocol === PROTOCOL
    && record.panelOrigin === canonicalHttpsOrigin(record.panelOrigin)
    && record.endpoint === REDEEM_ENDPOINT
    && typeof record.applicationId === "string" && record.applicationId.length <= 255
    && APP_ID_RE.test(record.applicationId)
    && typeof record.clientDigest === "string" && CLIENT_DIGEST_RE.test(record.clientDigest)
    && typeof record.accessKeyHash === "string" && HEX_SHA256_RE.test(record.accessKeyHash)
    && Number.isSafeInteger(record.issuedAt) && record.issuedAt > 0
    && Number.isSafeInteger(record.expires) && record.expires > record.issuedAt
    && record.expires - record.issuedAt <= MAX_TTL_SECONDS
    && record.status === "issued";
}

function validInternalIssue(body) {
  return exactObject(body, [
    "version", "protocol", "panelOrigin", "endpoint", "applicationId", "clientDigest",
    "accessKeyHash", "issuedAt", "expires"
  ])
    && body.version === 1 && body.protocol === PROTOCOL
    && body.panelOrigin === canonicalHttpsOrigin(body.panelOrigin)
    && body.endpoint === REDEEM_ENDPOINT
    && typeof body.applicationId === "string" && body.applicationId.length <= 255
    && APP_ID_RE.test(body.applicationId)
    && typeof body.clientDigest === "string" && CLIENT_DIGEST_RE.test(body.clientDigest)
    && typeof body.accessKeyHash === "string" && HEX_SHA256_RE.test(body.accessKeyHash)
    && Number.isSafeInteger(body.issuedAt) && body.issuedAt > 0
    && Number.isSafeInteger(body.expires) && body.expires > body.issuedAt
    && body.expires - body.issuedAt <= MAX_TTL_SECONDS;
}

function validInternalRedeem(body) {
  return exactObject(body, [
    "version", "protocol", "panelOrigin", "endpoint", "allowedApplicationIds",
    "accessKeyHash"
  ])
    && body.version === 1 && body.protocol === PROTOCOL
    && body.panelOrigin === canonicalHttpsOrigin(body.panelOrigin)
    && body.endpoint === REDEEM_ENDPOINT
    && Array.isArray(body.allowedApplicationIds)
    && body.allowedApplicationIds.length >= 1 && body.allowedApplicationIds.length <= 16
    && body.allowedApplicationIds.every((value) => typeof value === "string"
      && value.length <= 255 && APP_ID_RE.test(value))
    && new Set(body.allowedApplicationIds).size === body.allowedApplicationIds.length
    && typeof body.accessKeyHash === "string" && HEX_SHA256_RE.test(body.accessKeyHash);
}

function validInternalRate(body) {
  return exactObject(body, ["version", "limit", "windowSeconds"])
    && body.version === 1
    && Number.isSafeInteger(body.limit) && body.limit >= 1 && body.limit <= 10000
    && Number.isSafeInteger(body.windowSeconds)
    && body.windowSeconds >= 10 && body.windowSeconds <= 3600;
}

export class AppPairingTicketStore {
  constructor(state, _env, nowMilliseconds = () => Date.now()) {
    this.state = state;
    this.nowMilliseconds = nowMilliseconds;
  }

  currentEpochSeconds() {
    const value = this.nowMilliseconds();
    return Number.isFinite(value) && value > 0 ? Math.floor(value / 1000) : null;
  }

  async fetch(request) {
    if (request.method !== "POST") return internalResult(false, 404);
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return internalResult(false, 404);
    }
    if (url.origin !== INTERNAL_ORIGIN) return internalResult(false, 404);
    const body = await readSmallJson(request, MAX_INTERNAL_BODY_BYTES);
    try {
      if (url.pathname === "/v1/issue") return await this.issue(body);
      if (url.pathname === "/v1/redeem") return await this.redeem(body);
      if (url.pathname === "/v1/rate") return await this.rate(body);
      return internalResult(false, 404);
    } catch {
      return internalResult(false, 503);
    }
  }

  async issue(body) {
    if (!validInternalIssue(body)) return internalResult(false, 400);
    const now = this.currentEpochSeconds();
    if (now === null || now >= body.expires) return internalResult(false, 400);
    // Schedule cleanup first. If the subsequent write fails, the harmless empty Object is still
    // collected; a successfully persisted ticket can therefore never be left without an alarm.
    await this.state.storage.setAlarm((body.expires + 60) * 1000);
    const inserted = await this.state.storage.transaction(async (transaction) => {
      if (await transaction.get(TICKET_RECORD_KEY)) return false;
      await transaction.put(TICKET_RECORD_KEY, { ...body, status: "issued" });
      return true;
    });
    if (!inserted) return internalResult(false, 409);
    return internalResult(true);
  }

  async redeem(body) {
    if (!validInternalRedeem(body)) return internalResult(false, 400);
    const consumed = await this.state.storage.transaction(async (transaction) => {
      const record = await transaction.get(TICKET_RECORD_KEY);
      const now = this.currentEpochSeconds();
      if (!validStoredTicket(record)
          || now === null
          || record.panelOrigin !== body.panelOrigin
          || record.endpoint !== body.endpoint
          || record.accessKeyHash !== body.accessKeyHash
          || !body.allowedApplicationIds.includes(record.applicationId)
          || now >= record.expires) return false;
      await transaction.put(TICKET_RECORD_KEY, {
        version: record.version,
        protocol: record.protocol,
        panelOrigin: record.panelOrigin,
        endpoint: record.endpoint,
        applicationId: record.applicationId,
        clientDigest: record.clientDigest,
        accessKeyHash: record.accessKeyHash,
        issuedAt: record.issuedAt,
        expires: record.expires,
        status: "consumed",
        consumedAt: now
      });
      return true;
    });
    return internalResult(consumed, consumed ? 200 : 409);
  }

  async rate(body) {
    if (!validInternalRate(body)) return internalResult(false, 400);
    const now = this.currentEpochSeconds();
    if (now === null) return internalResult(false, 503);
    const windowStart = Math.floor(now / body.windowSeconds) * body.windowSeconds;
    await this.state.storage.setAlarm((windowStart + body.windowSeconds + 60) * 1000);
    const allowed = await this.state.storage.transaction(async (transaction) => {
      const current = await transaction.get(RATE_RECORD_KEY);
      const count = current && current.version === 1 && current.windowStart === windowStart
        && current.windowSeconds === body.windowSeconds ? current.count : 0;
      if (!Number.isSafeInteger(count) || count < 0 || count >= body.limit) return false;
      await transaction.put(RATE_RECORD_KEY, {
        version: 1,
        windowStart,
        windowSeconds: body.windowSeconds,
        count: count + 1
      });
      return true;
    });
    return internalResult(allowed, allowed ? 200 : 429);
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}
