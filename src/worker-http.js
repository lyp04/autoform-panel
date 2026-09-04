// JSON responses and reading the caller credentials off a request.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

export function auth(request) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const fingerprint = request.headers.get("X-Fp") || "";
  return { token, fingerprint };
}
