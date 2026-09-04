import test from "node:test";
import assert from "node:assert/strict";

import {
  panelRuntimeFromVersionMetadata,
  validPanelSourceCommit
} from "../src/panel-runtime.js";
import worker from "../src/worker.js";
import { validBackendAdapter } from "./backend-adapter-fixture.js";

const SOURCE_COMMIT = "a".repeat(40);
const VERSION_METADATA = Object.freeze({
  id: "01234567-89ab-cdef-0123-456789abcdef",
  tag: `autoform-source-${SOURCE_COMMIT}`,
  timestamp: "2030-04-05T06:07:08.123Z"
});

function installCatalogReadMock(catalog) {
  const previousFetch = globalThis.fetch;
  let callCount = 0;
  const catalogText = JSON.stringify(catalog);
  globalThis.fetch = async (url) => {
    callCount++;
    const target = String(url);
    if (target.endsWith("/git/ref/heads/main")) {
      return Response.json({ object: { sha: "snapshot-sha" } });
    }
    const marker = "/contents/";
    if (target.includes(marker)) {
      const path = target.slice(target.indexOf(marker) + marker.length).split("?")[0];
      if (path === "form-profiles.json") {
        return Response.json({ content: btoa(catalogText), sha: "profiles-sha" });
      }
      return new Response("not found", { status: 404 });
    }
    return new Response("unexpected request", { status: 500 });
  };
  return {
    restore() {
      globalThis.fetch = previousFetch;
    },
    get callCount() {
      return callCount;
    }
  };
}

function legacyCompatibleCatalog() {
  const backendAdapter = validBackendAdapter();
  return {
    schemaVersion: 2,
    version: 17,
    settings: {
      backendAdapter,
      backendApiBase: backendAdapter.baseUrl,
      endpoints: backendAdapter.endpoints,
      sessionInvalidHttpStatuses: [...backendAdapter.auth.sessionInvalidHttpStatuses],
      sessionInvalidCodes: [...backendAdapter.auth.sessionInvalidCodes],
      sessionInvalidMessagePatterns: [...backendAdapter.auth.sessionInvalidMessagePatterns],
      brand: "Sample brand",
      updateOwner: "sample-owner",
      updateRepo: "sample-repo"
    },
    profiles: []
  };
}

test("strict Cloudflare version metadata produces one sanitized v1 provenance contract", () => {
  assert.equal(validPanelSourceCommit(SOURCE_COMMIT), true);
  assert.equal(validPanelSourceCommit(SOURCE_COMMIT.toUpperCase()), false);
  assert.deepEqual(panelRuntimeFromVersionMetadata(VERSION_METADATA), {
    version: 1,
    provenance: "cloudflare_version_tag",
    workerVersionId: VERSION_METADATA.id,
    sourceCommit: SOURCE_COMMIT,
    versionCreatedAt: VERSION_METADATA.timestamp
  });
});

test("missing or malformed version metadata fails closed without reflecting raw values", () => {
  const privateMarker = "must-not-be-reflected";
  const malformed = [
    undefined,
    null,
    {},
    { ...VERSION_METADATA, id: privateMarker },
    { ...VERSION_METADATA, tag: privateMarker },
    { ...VERSION_METADATA, tag: `autoform-source-${SOURCE_COMMIT}suffix` },
    { ...VERSION_METADATA, tag: `autoform-source-${SOURCE_COMMIT.toUpperCase()}` },
    { ...VERSION_METADATA, timestamp: "2030-02-31T06:07:08Z" },
    { ...VERSION_METADATA, extra: privateMarker },
    new Proxy({}, {
      ownKeys() {
        throw new Error(privateMarker);
      }
    })
  ];
  for (const metadata of malformed) {
    const runtime = panelRuntimeFromVersionMetadata(metadata);
    assert.deepEqual(runtime, { version: 0, provenance: "unavailable" });
    assert.equal(JSON.stringify(runtime).includes(privateMarker), false);
  }
});

test("dedicated runtime provenance endpoint is read-key gated and fail-closed", async () => {
  const github = installCatalogReadMock(legacyCompatibleCatalog());
  const env = {
    GITHUB_REPO: "sample/catalog",
    GITHUB_BRANCH: "main",
    GITHUB_TOKEN: "sample-token",
    CATALOG_READ_KEY: "sample-read-key",
    CF_VERSION_METADATA: VERSION_METADATA
  };
  try {
    const unauthorized = await worker.fetch(
      new Request("https://panel.test.invalid/api/runtime-provenance"), env);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: "unauthorized" });
    assert.equal(github.callCount, 0);

    const authorized = await worker.fetch(new Request(
      "https://panel.test.invalid/api/runtime-provenance", {
        headers: { Authorization: "Bearer sample-read-key" }
      }), env);
    assert.equal(authorized.status, 200);
    assert.deepEqual((await authorized.json()).panelRuntime, {
      version: 1,
      provenance: "cloudflare_version_tag",
      workerVersionId: VERSION_METADATA.id,
      sourceCommit: SOURCE_COMMIT,
      versionCreatedAt: VERSION_METADATA.timestamp
    });
    const missing = await worker.fetch(new Request(
      "https://panel.test.invalid/api/runtime-provenance", {
        headers: { Authorization: "Bearer sample-read-key" }
      }), { ...env, CF_VERSION_METADATA: undefined });
    assert.deepEqual((await missing.json()).panelRuntime, {
      version: 0,
      provenance: "unavailable"
    });
    const privateMarker = "malformed-runtime-value-must-not-escape";
    const malformed = await worker.fetch(new Request(
      "https://panel.test.invalid/api/runtime-provenance", {
        headers: { Authorization: "Bearer sample-read-key" }
      }), {
        ...env,
        CF_VERSION_METADATA: {
          id: privateMarker,
          tag: privateMarker,
          timestamp: privateMarker
        }
      });
    const malformedText = await malformed.text();
    assert.deepEqual(JSON.parse(malformedText).panelRuntime, {
      version: 0,
      provenance: "unavailable"
    });
    assert.equal(malformedText.includes(privateMarker), false);
    assert.equal(github.callCount, 0);
  } finally {
    github.restore();
  }
});

test("runtime metadata never changes the existing api/config response bytes or fields", async () => {
  const catalog = legacyCompatibleCatalog();
  const github = installCatalogReadMock(catalog);
  const request = () => new Request("https://panel.test.invalid/api/config", {
    headers: { Authorization: "Bearer sample-read-key" }
  });
  const baseEnv = {
    GITHUB_REPO: "sample/catalog",
    GITHUB_BRANCH: "main",
    GITHUB_TOKEN: "sample-token",
    CATALOG_READ_KEY: "sample-read-key"
  };
  try {
    const validResponse = await worker.fetch(request(), {
      ...baseEnv,
      CF_VERSION_METADATA: VERSION_METADATA
    });
    const missingResponse = await worker.fetch(request(), baseEnv);
    const privateMarker = "malformed-binding-value-must-not-escape";
    const malformedResponse = await worker.fetch(request(), {
      ...baseEnv,
      CF_VERSION_METADATA: {
        id: privateMarker,
        tag: privateMarker,
        timestamp: privateMarker
      }
    });
    assert.equal(validResponse.status, 200);
    assert.equal(missingResponse.status, 200);
    assert.equal(malformedResponse.status, 200);

    const validText = await validResponse.text();
    const missingText = await missingResponse.text();
    const malformedText = await malformedResponse.text();
    assert.equal(missingText, validText);
    assert.equal(malformedText, validText);
    assert.equal(malformedText.includes(privateMarker), false);

    const legacyConfig = JSON.parse(validText);
    assert.equal("panelRuntime" in legacyConfig, false);
    assert.equal(legacyConfig.updateOwner, catalog.settings.updateOwner);
    assert.equal(legacyConfig.updateRepo, catalog.settings.updateRepo);
    assert.deepEqual(legacyConfig.backendAdapter, catalog.settings.backendAdapter);
  } finally {
    github.restore();
  }
});
