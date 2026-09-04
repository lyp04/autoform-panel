// Pairing responses, and reading a small JSON body safely.
import { MAX_BODY_BYTES } from "./app-pairing-constants.js";

export function pairingJson(data, status = 200) {
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

export function pairingFailure(status = 400) {
  return pairingJson({ error: "pairing unavailable" }, status);
}

export function internalResult(ok, status = ok ? 200 : 409) {
  return pairingJson({ ok }, status);
}

export function exactObject(value, keys) {
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

export async function readSmallJson(request, maximumBytes = MAX_BODY_BYTES) {
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
