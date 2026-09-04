import test from "node:test";
import assert from "node:assert/strict";

import { translateProfileTitles } from "../api/translate.js";

test("publish translation fills identifier placeholderI18n", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      0: { en: "Enter", es: "Introduzca" }
    }) } }]
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const profile = {
      snPlugins: [{
        key: "primary",
        field: "example_identifier",
        label: "标识",
        labelI18n: { en: "Identifier", es: "Identificador" },
        placeholder: "请输入"
      }],
      snPluginsHidden: []
    };

    const result = await translateProfileTitles(profile, {
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-only",
      model: "test-only"
    });

    assert.equal(result.translated, true);
    assert.deepEqual(profile.snPlugins[0].placeholderI18n,
      { en: "Enter", es: "Introduzca" });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
