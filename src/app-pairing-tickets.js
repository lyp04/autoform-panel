// Creating tickets, talking to the ticket store, and the rate limits around it.
import { INTERNAL_ORIGIN, RATE_LIMITS } from "./app-pairing-constants.js";
import { allowedApplicationIds, bytesToBase64Url, hmacSha256Hex, publicOrigin, ticketTtlSeconds, validAccessKey, validIssuerSecret } from "./app-pairing-crypto.js";

export function createTicket() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function validNamespace(env) {
  return env.APP_PAIR_TICKETS
    && typeof env.APP_PAIR_TICKETS.idFromName === "function"
    && typeof env.APP_PAIR_TICKETS.get === "function";
}

export async function callTicketStore(env, name, path, body) {
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

export async function issueRateAllowed(env, clientDigest) {
  if (!await consumeRate(env, `issue-client:${clientDigest}`, RATE_LIMITS.issueClient)) {
    return false;
  }
  return await consumeRate(env, "issue-global", RATE_LIMITS.issueGlobal);
}

export async function redeemRateAllowed(request, env, issuerSecret) {
  const connectingIp = (request.headers.get("CF-Connecting-IP") || "unavailable").slice(0, 128);
  const sourceDigest = await hmacSha256Hex(
    issuerSecret, `app-pair-redeem-source-v1\u0000${connectingIp}`);
  if (!await consumeRate(env, `redeem-source:${sourceDigest}`, RATE_LIMITS.redeemSource)) {
    return false;
  }
  return await consumeRate(env, "redeem-global", RATE_LIMITS.redeemGlobal);
}

export function baseConfiguration(env, requestUrl) {
  const origin = publicOrigin(env);
  const applicationIds = allowedApplicationIds(env);
  const issuerSecret = env.APP_PAIR_ISSUER_KEY;
  const ttl = ticketTtlSeconds(env);
  if (!origin || requestUrl.origin !== origin || !applicationIds || !validIssuerSecret(issuerSecret)
      || !validAccessKey(env.CATALOG_READ_KEY) || issuerSecret === env.CATALOG_READ_KEY
      || !ttl || !validNamespace(env)) return null;
  return { origin, applicationIds, issuerSecret, ttl };
}
