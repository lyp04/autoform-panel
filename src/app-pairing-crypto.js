// Digests, HMACs, constant-time comparison, and the secrets and origins they guard.
import { ACCESS_KEY_RE, APP_ID_RE, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS, UTF8 } from "./app-pairing-constants.js";

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", UTF8.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", UTF8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, UTF8.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function constantTimeSecretEqual(actual, expected) {
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

export function validIssuerSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4096
    && value === value.trim() && !/[\u0000-\u0020\u007f]/u.test(value);
}

export function validAccessKey(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 4096
    && ACCESS_KEY_RE.test(value);
}

export function canonicalHttpsOrigin(value) {
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

export function publicOrigin(env) {
  return canonicalHttpsOrigin(env.PUBLIC_URL);
}

export function allowedApplicationIds(env) {
  if (typeof env.APP_PAIR_APPLICATION_IDS !== "string") return null;
  const raw = env.APP_PAIR_APPLICATION_IDS.split(",");
  if (raw.length < 1 || raw.length > 16) return null;
  const values = raw.map((value) => value.trim());
  if (values.some((value) => !value || value.length > 255 || !APP_ID_RE.test(value))) return null;
  const unique = [...new Set(values)];
  return unique.length === values.length ? unique : null;
}

export function ticketTtlSeconds(env) {
  const raw = env.APP_PAIR_TTL_SECONDS ?? String(DEFAULT_TTL_SECONDS);
  if (!/^[1-9][0-9]{0,2}$/u.test(String(raw))) return null;
  const ttl = Number(raw);
  return Number.isInteger(ttl) && ttl >= 60 && ttl <= MAX_TTL_SECONDS ? ttl : null;
}

export function bytesToBase64Url(bytes) {
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
