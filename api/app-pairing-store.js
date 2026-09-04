// The ticket store itself: stored record shapes and the single-writer object behind them.
import { APP_ID_RE, CLIENT_DIGEST_RE, HEX_SHA256_RE, INTERNAL_ORIGIN, MAX_INTERNAL_BODY_BYTES, MAX_TTL_SECONDS, PROTOCOL, RATE_RECORD_KEY, REDEEM_ENDPOINT, TICKET_RECORD_KEY } from "./app-pairing-constants.js";
import { allowedApplicationIds, canonicalHttpsOrigin } from "./app-pairing-crypto.js";
import { exactObject, internalResult, readSmallJson } from "./app-pairing-http.js";

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
