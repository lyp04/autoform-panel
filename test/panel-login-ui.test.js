import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Panel login initializes without a shared access-key control", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /panelAccessGate|panelAccessBtn|PANEL_ACCESS_KEY/u);
  assert.doesNotMatch(html, /面板访问密钥|加载面板配置/u);
  assert.match(html, /sessionStorage\.removeItem\("panelAccessKey"\)/u);
  assert.match(html, /api\("\/api\/panel-config", \{ auth:false \}\)/u);
});
