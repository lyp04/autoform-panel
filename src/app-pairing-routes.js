// The issue and redeem endpoints.
import { CLIENT_DIGEST_RE, ISSUE_PATH, PROTOCOL, REDEEM_ENDPOINT, REDEEM_PATH, TICKET_RE } from "./app-pairing-constants.js";
import { allowedApplicationIds, constantTimeSecretEqual, sha256Hex } from "./app-pairing-crypto.js";
import { exactObject, pairingFailure, pairingJson, readSmallJson } from "./app-pairing-http.js";
import { baseConfiguration, callTicketStore, createTicket, issueRateAllowed, redeemRateAllowed } from "./app-pairing-tickets.js";

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
