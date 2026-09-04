// Paths, limits, patterns and the rate limits the protocol is pinned to.

export const ISSUE_PATH = "/api/app-pair/v1/issue";

export const REDEEM_PATH = "/api/app-pair/v1/redeem";

export const REDEEM_ENDPOINT = REDEEM_PATH;

export const PROTOCOL = "app-pair/v1";

export const DEFAULT_TTL_SECONDS = 300;

export const MAX_TTL_SECONDS = 600;

export const MAX_BODY_BYTES = 4096;

export const MAX_INTERNAL_BODY_BYTES = 8192;

export const INTERNAL_ORIGIN = "https://app-pair.internal";

export const TICKET_RECORD_KEY = "ticket-v1";

export const RATE_RECORD_KEY = "rate-v1";

export const APP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;

export const CLIENT_DIGEST_RE = /^[0-9a-f]{64}$/u;

export const TICKET_RE = /^[A-Za-z0-9_-]{32,512}$/u;

export const ACCESS_KEY_RE = /^[A-Za-z0-9._~+/-]+={0,2}$/u;

export const HEX_SHA256_RE = /^[0-9a-f]{64}$/u;

export const UTF8 = new TextEncoder();

// These limits are deliberately conservative for an operator-triggered pairing action. The
// download Worker is still responsible for authorizing its own session before it calls issue.
export const RATE_LIMITS = Object.freeze({
  issueClient: Object.freeze({ limit: 12, windowSeconds: 60 }),
  issueGlobal: Object.freeze({ limit: 600, windowSeconds: 60 }),
  redeemSource: Object.freeze({ limit: 120, windowSeconds: 60 }),
  redeemGlobal: Object.freeze({ limit: 6000, windowSeconds: 60 })
});
