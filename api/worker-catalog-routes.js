// The /catalog/* routes the app fetches, and the read-key gate in front of them.
import { readCatalogFile } from "./catalog.js";
import { auth, json } from "./worker-http.js";

function catalogTimingSafeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 目录读取鉴权:配置了 CATALOG_READ_KEY 就要求带匹配的 Bearer(app 侧);没配置则开放(本地 dev / 未启用)。
export function catalogReadAuthorized(request, env) {
  if (!env.CATALOG_READ_KEY) return true;
  return catalogTimingSafeEqual(auth(request).token, env.CATALOG_READ_KEY);
}

export async function handleCatalog(request, env, path) {
  if (!catalogReadAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
  const which = path.endsWith("/manifest") ? "manifest" : "form-profiles.json";
  const text = await readCatalogFile(env, which);
  if (text == null) return json({ error: "catalog not initialized" }, 404);
  return new Response(text, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
