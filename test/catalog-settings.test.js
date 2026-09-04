import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { publishCatalog, readCatalogFile, readProfiles, sha256Hex } from "../src/catalog.js";
import { validBackendAdapter } from "./backend-adapter-fixture.js";
import worker, { validateLegacyAppCompatibility } from "../src/worker.js";

const seed = JSON.parse(await readFile(
  new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"
));
const clone = (value) => JSON.parse(JSON.stringify(value));
const sampleProfile = (index = 0) => clone(seed.profiles[index]);

function alternateDailyStatsCatalog() {
  const source = sampleProfile(0);
  source.id = "sample-alternate-source";
  source.pickerVisible = true;
  source.snPlugins.find((plugin) => plugin.key === "primary")
    .scanner.expectedLength = 12;
  const target = sampleProfile(1);
  target.id = "sample-alternate-target";
  target.pickerVisible = false;
  const targetPhotoField = target.photoSlots[0].field;
  source.workflow.alternateEntries = {
    enabled: true,
    entries: [{
      id: "sample-alternate-entry",
      title: "Sample alternate entry",
      targetProfileId: target.id,
      identifierRole: "primary",
      resultKey: "sample-ready",
      photoTargetFields: [targetPhotoField],
      joinWith: ",",
      minPhotos: 1,
      maxPhotos: 1,
      uploadNameTemplate: "{identifier}-alternate-{index}.jpg",
      scanner: { applyExpectedLengthTo: ["ocr", "barcode"] },
      submissionRetry: { maxAttempts: 1, retryDelayMs: 0 },
      toggles: [],
      flags: { duplicateCheck: false, previousSteps: false, printing: false },
      dataOverrides: {},
      dynamicOverrideFields: [],
      dynamicOverrideProviders: []
    }]
  };
  const dailyStatsV2 = {
    version: 2,
    scope: "all_profiles",
    groups: [{
      id: "sample-alternate-group",
      label: "Sample group",
      uiColor: "#2563EB",
      selectors: [{ profileId: source.id, resultKey: "sample-ready" }]
    }],
    flatSummaries: [{
      id: "sample-alternate-flat",
      label: "Sample flat",
      uiColor: "#64748B",
      selectors: [{ profileId: source.id, resultKey: "sample-ready" }]
    }]
  };
  const dailyStatsAlternateEntries = {
    version: 1,
    scope: "all_profiles",
    groups: [{
      id: "sample-alternate-group",
      selectors: [{ profileId: source.id, entryId: "sample-alternate-entry" }]
    }],
    flatSummaries: [{
      id: "sample-alternate-flat",
      selectors: [{ profileId: source.id, entryId: "sample-alternate-entry" }]
    }]
  };
  return {
    profiles: [source, target],
    dailyStatsV2,
    dailyStatsAlternateEntries
  };
}

function authenticatedPanelRequest(path, body) {
  return new Request(`https://panel.test.invalid${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer sample-session-token-long-enough",
      "X-Fp": "sample-fingerprint",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function installCatalogGitMock(files, { failRefUpdate = false } = {}) {
  const previousFetch = globalThis.fetch;
  const blobs = new Map();
  let nextTree = null;
  let refUpdates = 0;
  let headSha = "parent-sha";
  let commitParents = [];
  const contentRefs = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    if (String(url).startsWith("https://api.test.invalid/v1/account/me")) {
      return Response.json({
        meta: { state: "accepted" },
        payload: { person: { label: "Sample operator" } }
      });
    }
    const pathWithQuery = String(url).split("/repos/sample/catalog")[1] || "";
    const [path, query = ""] = pathWithQuery.split("?");
    if (path.startsWith("/contents/") && method === "GET") {
      const match = query.match(/(?:^|&)ref=([^&]+)/);
      contentRefs.push(match ? decodeURIComponent(match[1]) : "");
      const file = files.get(path.slice("/contents/".length));
      if (!file) return new Response("not found", { status: 404 });
      return Response.json({
        content: Buffer.from(file.text, "utf8").toString("base64"),
        sha: file.sha
      });
    }
    if (path === "" && method === "GET") return Response.json({ default_branch: "main" });
    if (path === "/git/ref/heads/main" && method === "GET") {
      return Response.json({ object: { sha: headSha } });
    }
    if (path.startsWith("/git/commits/") && method === "GET") {
      return Response.json({ tree: { sha: "base-tree-sha" } });
    }
    if (path === "/git/blobs" && method === "POST") {
      const body = JSON.parse(options.body);
      const sha = `blob-${blobs.size + 1}`;
      blobs.set(sha, body.content);
      return Response.json({ sha });
    }
    if (path === "/git/trees" && method === "POST") {
      nextTree = JSON.parse(options.body).tree;
      return Response.json({ sha: "next-tree-sha" });
    }
    if (path === "/git/commits" && method === "POST") {
      commitParents = JSON.parse(options.body).parents;
      return Response.json({ sha: "next-commit-sha" });
    }
    if (path === "/git/refs/heads/main" && method === "PATCH") {
      if (failRefUpdate) {
        headSha = "concurrent-sha";
        return new Response("branch moved", { status: 409 });
      }
      for (const entry of nextTree || []) {
        files.set(entry.path, { text: blobs.get(entry.sha), sha: entry.sha });
      }
      headSha = "next-commit-sha";
      refUpdates += 1;
      return Response.json({ object: { sha: "next-commit-sha" } });
    }
    return new Response(`unexpected ${method} ${path}`, { status: 500 });
  };
  return {
    restore() { globalThis.fetch = previousFetch; },
    get refUpdates() { return refUpdates; },
    get commitParents() { return commitParents; },
    get contentRefs() { return contentRefs; }
  };
}

test("catalog publish merges settings and preserves unknown/private configuration", async () => {
  const files = new Map();
  const initial = {
    schemaVersion: 2,
    version: 7,
    settings: {
      brand: "Before",
      backendAdapter: validBackendAdapter(),
      futureSetting: { keep: true }
    },
    profiles: [{ id: "existing" }]
  };
  files.set("form-profiles.json", { text: JSON.stringify(initial), sha: "profiles-sha" });
  files.set("manifest.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 7, minAppVersionCode: 6 }),
    sha: "manifest-sha"
  });

  const github = installCatalogGitMock(files);

  try {
    await publishCatalog({
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    }, [{ id: "updated" }], {
      publicUrl: "https://panel.test.invalid",
      settings: { brand: "After" }
    });
    const written = JSON.parse(files.get("form-profiles.json").text);
    assert.equal(written.version, 8);
    assert.equal(written.settings.brand, "After");
    assert.deepEqual(written.settings.futureSetting, { keep: true });
    assert.deepEqual(written.settings.backendAdapter, initial.settings.backendAdapter);
    assert.equal(JSON.parse(files.get("manifest.json").text).minAppVersionCode, 6);
    assert.deepEqual(github.commitParents, ["parent-sha"]);
    assert.ok(github.contentRefs.slice(0, 3).every((ref) => ref === "parent-sha"));
    const merged = await readProfiles({ GITHUB_REPO: "sample/catalog", GITHUB_TOKEN: "sample-token" });
    assert.equal(merged.settings.minAppVersionCode, 6);
  } finally {
    github.restore();
  }
});

test("catalog publish validates effective dailyStatsV2 even when called below the Worker route", async () => {
  const profile = sampleProfile();
  profile.id = "sample-catalog-v2";
  profile.pickerVisible = true;
  profile.gradeMap = {
    "sample-ready": {
      field: "sample-result",
      label: "Sample ready",
      value: "SAMPLE_READY"
    }
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({
      schemaVersion: 2,
      version: 8,
      settings: { backendAdapter: validBackendAdapter() },
      profiles: [profile]
    }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    await assert.rejects(() => publishCatalog({
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    }, [profile], {
      publicUrl: "https://catalog.test.invalid",
      settings: {
        dailyStatsV2: {
          version: 2,
          scope: "all_profiles",
          groups: [{
            id: "sample-invalid-v2",
            label: "Sample invalid",
            uiColor: "#2563EB",
            selectors: [{ profileId: profile.id, resultKey: "not-declared" }]
          }],
          flatSummaries: []
        }
      },
      expectedVersion: 8
    }), /dailyStatsV2 validation failed/u);
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("catalog publish validates effective alternate-entry attribution below the Worker route", async () => {
  const {
    profiles,
    dailyStatsV2,
    dailyStatsAlternateEntries
  } = alternateDailyStatsCatalog();
  dailyStatsAlternateEntries.groups[0].selectors[0].entryId = "missing-entry";
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({
      schemaVersion: 2,
      version: 9,
      settings: { backendAdapter: validBackendAdapter() },
      profiles
    }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    await assert.rejects(() => publishCatalog({
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    }, profiles, {
      publicUrl: "https://catalog.test.invalid",
      settings: { dailyStatsV2, dailyStatsAlternateEntries },
      expectedVersion: 9
    }), /dailyStatsAlternateEntries validation failed/u);
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("Panel minimum App version setting updates the derived manifest", async () => {
  const files = new Map();
  files.set("form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 3, settings: {}, profiles: [] }),
    sha: "profiles-sha"
  });
  files.set("manifest.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 3, minAppVersionCode: 2 }),
    sha: "manifest-sha"
  });
  const github = installCatalogGitMock(files);
  try {
    await publishCatalog({ GITHUB_REPO: "sample/catalog", GITHUB_TOKEN: "sample-token" }, [], {
      publicUrl: "https://panel.test.invalid",
      settings: { minAppVersionCode: 8 }
    });
    assert.equal(JSON.parse(files.get("manifest.json").text).minAppVersionCode, 8);
  } finally {
    github.restore();
  }
});

test("App config keeps the old and new backend contracts identical during migration", async () => {
  const adapter = validBackendAdapter();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    notifyWebhook: "https://notify.test.invalid/legacy",
    brand: "Sample brand",
    updateOwner: "sample-owner",
    updateRepo: "sample-repo",
    webOrigin: "https://panel.test.invalid",
    webReferer: "https://panel.test.invalid/",
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns],
    updatedAt: "2030-01-01T00:00:00.000Z"
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 9, settings, profiles: [] }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(new Request(
      "https://panel.test.invalid/api/config", {
        headers: { Authorization: "Bearer sample-read-key" }
      }), {
        GITHUB_REPO: "sample/catalog",
        GITHUB_TOKEN: "sample-token",
        CATALOG_READ_KEY: "sample-read-key"
      });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.catalogVersion, 9);
    assert.deepEqual(body._autoFormKitLegacyCacheProof, {
      version: 1,
      panelBase: "https://panel.test.invalid",
      keySha256: await sha256Hex("sample-read-key"),
      catalogSha256: await sha256Hex(files.get("form-profiles.json").text),
      catalogVersion: 9
    });
    assert.equal(body.backendApiBase, adapter.baseUrl);
    assert.deepEqual(body.endpoints, adapter.endpoints);
    assert.deepEqual(body.sessionInvalidHttpStatuses,
      adapter.auth.sessionInvalidHttpStatuses);
    assert.deepEqual(body.sessionInvalidCodes, adapter.auth.sessionInvalidCodes);
    assert.deepEqual(body.sessionInvalidMessagePatterns,
      adapter.auth.sessionInvalidMessagePatterns);
    assert.equal(body.notifyWebhook, settings.notifyWebhook);
    assert.equal(body.brand, settings.brand);
    assert.equal(body.updateOwner, settings.updateOwner);
    assert.equal(body.updateRepo, settings.updateRepo);
    // A deployed legacy Panel has no structured update fields. Their absence must remain
    // observable so the App keeps its exact stable/device-beta APK defaults.
    assert.equal("updateSource" in body, false);
    assert.equal(body.webOrigin, settings.webOrigin);
    assert.equal(body.webReferer, settings.webReferer);
  } finally {
    github.restore();
  }

  assert.deepEqual(validateLegacyAppCompatibility({
    ...settings,
    backendApiBase: "https://different.test.invalid",
    sessionInvalidCodes: ["DIFFERENT"]
  }, adapter), [
    "legacy backendApiBase must equal backendAdapter.baseUrl during the old-App migration window",
    "legacy sessionInvalidCodes must equal backendAdapter.auth.sessionInvalidCodes during the old-App migration window"
  ]);
});

test("App config sends one Panel-first update source while retaining old App coordinates", async () => {
  const adapter = validBackendAdapter();
  const updateSource = {
    version: 1,
    owner: "sample-owner",
    repo: "sample-repo"
  };
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    updateOwner: updateSource.owner,
    updateRepo: updateSource.repo,
    updateSource,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 10, settings, profiles: [] }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(new Request(
      "https://panel.test.invalid/api/config", {
        headers: { Authorization: "Bearer sample-read-key" }
      }), {
        GITHUB_REPO: "sample/catalog",
        GITHUB_TOKEN: "sample-token",
        CATALOG_READ_KEY: "sample-read-key"
      });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.updateSource, updateSource);
    assert.equal(body.updateOwner, updateSource.owner);
    assert.equal(body.updateRepo, updateSource.repo);
  } finally {
    github.restore();
  }
});

test("malformed stored updateSource keeps App config 200 and emits only invalid sentinel", async () => {
  const adapter = validBackendAdapter();
  const privateMarker = "private-malformed-value-must-not-escape";
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    updateOwner: "sample-owner",
    updateRepo: "sample-repo",
    updateSource: {
      version: 1,
      owner: privateMarker,
      repo: privateMarker,
      secret: privateMarker
    },
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 11, settings, profiles: [] }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(new Request(
      "https://panel.test.invalid/api/config", {
        headers: { Authorization: "Bearer sample-read-key" }
      }), {
        GITHUB_REPO: "sample/catalog",
        GITHUB_TOKEN: "sample-token",
        CATALOG_READ_KEY: "sample-read-key"
      });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes(privateMarker), false);
    const body = JSON.parse(text);
    assert.deepEqual(body.updateSource, { version: 0 });
    assert.equal(body.updateOwner, "sample-owner");
    assert.equal(body.updateRepo, "sample-repo");
    assert.deepEqual(body.backendAdapter, adapter);
    assert.equal(body.catalogVersion, 11);
  } finally {
    github.restore();
  }
});

test("settings API rejects malformed updateSource with 400 before catalog publish", async () => {
  const adapter = validBackendAdapter();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 12, settings, profiles: [] }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(new Request(
      "https://panel.test.invalid/api/settings", {
        method: "POST",
        headers: {
          Authorization: "Bearer sample-session-token-long-enough",
          "X-Fp": "sample-fingerprint",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          baseVersion: 12,
          updateOwner: "sample-owner",
          updateRepo: "sample-repo",
          updateSource: {
            version: 1,
            owner: "sample-owner",
            repo: "sample-repo",
            defaultChannel: "beta"
          }
        })
      }), {
        GITHUB_REPO: "sample/catalog",
        GITHUB_TOKEN: "sample-token"
      });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "updateSource validation failed");
    assert.equal(body.problems[0].errors.includes(
      "updateSource.defaultChannel is unsupported"), true);
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("settings API validates and stores App-facing dailyStats groups", async () => {
  const adapter = validBackendAdapter();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const visibleProfile = sampleProfile();
  visibleProfile.id = "sample-visible";
  visibleProfile.gradeMap = {
    "sample-ready": {
      field: "sample-result",
      label: "Sample ready",
      value: "SAMPLE_READY"
    }
  };
  const profiles = [visibleProfile];
  const dailyStats = {
    scope: "all_profiles",
    groups: [{
      id: "sample-ready-summary",
      label: "Sample ready",
      labelI18n: { en: "Sample ready", es: "Ejemplo listo" },
      uiColor: "#2563EB",
      resultKeys: ["sample-ready"]
    }]
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 13, settings, profiles }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(new Request(
      "https://panel.test.invalid/api/settings", {
        method: "POST",
        headers: {
          Authorization: "Bearer sample-session-token-long-enough",
          "X-Fp": "sample-fingerprint",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ baseVersion: 13, dailyStats })
      }), {
        GITHUB_REPO: "sample/catalog",
        GITHUB_TOKEN: "sample-token"
      });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).version, 14);
    const written = JSON.parse(files.get("form-profiles.json").text);
    assert.deepEqual(written.settings.dailyStats, dailyStats);
    assert.equal(github.refUpdates, 1);

    const deleteResponse = await worker.fetch(new Request(
      "https://panel.test.invalid/api/settings", {
        method: "POST",
        headers: {
          Authorization: "Bearer sample-session-token-long-enough",
          "X-Fp": "sample-fingerprint",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ baseVersion: 14, dailyStats: null })
      }), {
        GITHUB_REPO: "sample/catalog",
        GITHUB_TOKEN: "sample-token"
      });
    assert.equal(deleteResponse.status, 200);
    assert.equal((await deleteResponse.json()).version, 15);
    const deleted = JSON.parse(files.get("form-profiles.json").text);
    assert.equal("dailyStats" in deleted.settings, false);
    assert.equal(github.refUpdates, 2);
  } finally {
    github.restore();
  }
});

test("settings API validates, stores and deletes App-facing dailyStatsV2", async () => {
  const adapter = validBackendAdapter();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const profile = sampleProfile();
  profile.id = "sample-qualified";
  profile.pickerVisible = true;
  profile.gradeMap = {
    "sample-ready": {
      field: "sample-result",
      label: "Sample ready",
      value: "SAMPLE_READY"
    }
  };
  const profiles = [profile];
  const dailyStatsV2 = {
    version: 2,
    scope: "all_profiles",
    groups: [{
      id: "sample-ready-qualified",
      label: "Sample ready",
      labelI18n: { en: "Sample ready", es: "Ejemplo listo" },
      uiColor: "#2563EB",
      selectors: [{ profileId: profile.id, resultKey: "sample-ready" }],
      legacyResultKeys: ["sample-ready"]
    }],
    flatSummaries: [{
      id: "sample-total-qualified",
      label: "Sample total",
      uiColor: "#64748B",
      selectors: [{ profileId: profile.id, resultKey: "sample-ready" }]
    }]
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 15, settings, profiles }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 15,
      dailyStatsV2
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).version, 16);
    const written = JSON.parse(files.get("form-profiles.json").text);
    assert.deepEqual(written.settings.dailyStatsV2, dailyStatsV2);
    assert.equal(github.refUpdates, 1);

    const deleteResponse = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 16,
      dailyStatsV2: null
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal((await deleteResponse.json()).version, 17);
    const deleted = JSON.parse(files.get("form-profiles.json").text);
    assert.equal("dailyStatsV2" in deleted.settings, false);
    assert.equal(github.refUpdates, 2);
  } finally {
    github.restore();
  }
});

test("settings API stores, validates and deletes alternate-entry daily-stat attribution", async () => {
  const adapter = validBackendAdapter();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const {
    profiles,
    dailyStatsV2,
    dailyStatsAlternateEntries
  } = alternateDailyStatsCatalog();
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 18, settings, profiles }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 18,
      dailyStatsV2,
      dailyStatsAlternateEntries
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).version, 19);
    const written = JSON.parse(files.get("form-profiles.json").text);
    assert.deepEqual(written.settings.dailyStatsV2, dailyStatsV2);
    assert.deepEqual(written.settings.dailyStatsAlternateEntries,
      dailyStatsAlternateEntries);
    assert.equal(github.refUpdates, 1);

    const orphanResponse = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 19,
      dailyStatsV2: null
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(orphanResponse.status, 400);
    const orphanBody = await orphanResponse.json();
    assert.equal(orphanBody.error,
      "dailyStatsAlternateEntries validation failed");
    assert.ok(orphanBody.problems[0].errors.includes(
      "dailyStatsAlternateEntries.groups[0].id must reference a dailyStatsV2 group id"));
    assert.equal(github.refUpdates, 1);

    const deleteResponse = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 19,
      dailyStatsAlternateEntries: null
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(deleteResponse.status, 200, await deleteResponse.clone().text());
    assert.equal((await deleteResponse.json()).version, 20);
    const deleted = JSON.parse(files.get("form-profiles.json").text);
    assert.equal("dailyStatsAlternateEntries" in deleted.settings, false);
    assert.deepEqual(deleted.settings.dailyStatsV2, dailyStatsV2);
    assert.equal(github.refUpdates, 2);
  } finally {
    github.restore();
  }
});

test("settings API keeps alternate-only flat summaries atomic", async () => {
  const adapter = validBackendAdapter();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const {
    profiles,
    dailyStatsV2,
    dailyStatsAlternateEntries
  } = alternateDailyStatsCatalog();
  const ordinaryFlatSelectors = clone(dailyStatsV2.flatSummaries[0].selectors);
  dailyStatsV2.flatSummaries[0].selectors = [];
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 30, settings, profiles }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const createResponse = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 30,
      dailyStatsV2,
      dailyStatsAlternateEntries
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(createResponse.status, 200, await createResponse.clone().text());
    assert.equal((await createResponse.json()).version, 31);
    let written = JSON.parse(files.get("form-profiles.json").text);
    assert.deepEqual(written.settings.dailyStatsV2, dailyStatsV2);
    assert.deepEqual(written.settings.dailyStatsAlternateEntries,
      dailyStatsAlternateEntries);
    assert.equal(github.refUpdates, 1);

    const orphanResponse = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 31,
      dailyStatsAlternateEntries: null
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(orphanResponse.status, 400);
    const orphanBody = await orphanResponse.json();
    assert.equal(orphanBody.error,
      "dailyStatsAlternateEntries validation failed");
    assert.ok(orphanBody.problems[0].errors.includes(
      "dailyStatsAlternateEntries.flatSummaries must provide non-empty selectors for dailyStatsV2 flat summary \"sample-alternate-flat\" because its selectors are empty"));
    assert.equal(github.refUpdates, 1);

    const ordinaryDailyStatsV2 = clone(dailyStatsV2);
    ordinaryDailyStatsV2.flatSummaries[0].selectors = ordinaryFlatSelectors;
    const convertResponse = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 31,
      dailyStatsV2: ordinaryDailyStatsV2,
      dailyStatsAlternateEntries: null
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(convertResponse.status, 200, await convertResponse.clone().text());
    assert.equal((await convertResponse.json()).version, 32);
    written = JSON.parse(files.get("form-profiles.json").text);
    assert.deepEqual(written.settings.dailyStatsV2, ordinaryDailyStatsV2);
    assert.equal("dailyStatsAlternateEntries" in written.settings, false);
    assert.equal(github.refUpdates, 2);
  } finally {
    github.restore();
  }
});

test("profile publish rejects retained alternate-entry stats mappings made unreachable", async () => {
  const adapter = validBackendAdapter();
  const {
    profiles,
    dailyStatsV2,
    dailyStatsAlternateEntries
  } = alternateDailyStatsCatalog();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns],
    dailyStatsV2,
    dailyStatsAlternateEntries
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 20, settings, profiles }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const sourceWithoutEntry = clone(profiles[0]);
    sourceWithoutEntry.workflow.alternateEntries = { enabled: false, entries: [] };
    const response = await worker.fetch(authenticatedPanelRequest("/api/publish", {
      baseVersion: 20,
      profiles: [sourceWithoutEntry]
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(response.status, 422, await response.clone().text());
    const body = await response.json();
    assert.equal(body.error, "dailyStatsAlternateEntries validation failed");
    assert.ok(body.problems[0].errors.includes(
      "dailyStatsAlternateEntries.groups[0].selectors[0] must reference exactly one enabled alternate entry on the selected pickerVisible profile"));
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("settings API rejects dailyStatsV2 selectors outside explicit picker-visible profiles", async () => {
  const adapter = validBackendAdapter();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const profile = sampleProfile();
  profile.id = "sample-hidden-qualified";
  profile.pickerVisible = false;
  profile.gradeMap = {
    "sample-hidden": {
      field: "sample-result",
      label: "Sample hidden",
      value: "SAMPLE_HIDDEN"
    }
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 17, settings, profiles: [profile] }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 17,
      dailyStatsV2: {
        version: 2,
        scope: "all_profiles",
        groups: [{
          id: "sample-hidden-summary",
          label: "Sample hidden",
          uiColor: "#2563EB",
          selectors: [{ profileId: profile.id, resultKey: "sample-hidden" }]
        }],
        flatSummaries: []
      }
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "dailyStatsV2 validation failed");
    assert.ok(body.problems[0].errors.includes(
      "dailyStatsV2.groups[0].selectors[0] must reference a gradeMap resultKey on the selected pickerVisible profile"));
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("settings API rejects dailyStats keys not declared by a picker-visible profile", async () => {
  const adapter = validBackendAdapter();
  const settings = {
    backendAdapter: adapter,
    backendApiBase: adapter.baseUrl,
    sessionInvalidHttpStatuses: [...adapter.auth.sessionInvalidHttpStatuses],
    sessionInvalidCodes: [...adapter.auth.sessionInvalidCodes],
    sessionInvalidMessagePatterns: [...adapter.auth.sessionInvalidMessagePatterns]
  };
  const hiddenProfile = sampleProfile();
  hiddenProfile.id = "sample-hidden";
  hiddenProfile.pickerVisible = false;
  hiddenProfile.gradeMap = {
    "sample-hidden-only": {
      field: "sample-result",
      label: "Sample hidden",
      value: "SAMPLE"
    }
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({
      schemaVersion: 2,
      version: 14,
      settings,
      profiles: [hiddenProfile]
    }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(new Request(
      "https://panel.test.invalid/api/settings", {
        method: "POST",
        headers: {
          Authorization: "Bearer sample-session-token-long-enough",
          "X-Fp": "sample-fingerprint",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          baseVersion: 14,
          dailyStats: {
            scope: "all_profiles",
            groups: [{
              id: "sample-summary",
              label: "Sample",
              uiColor: "#2563EB",
              resultKeys: ["sample-hidden-only"]
            }]
          }
        })
      }), {
        GITHUB_REPO: "sample/catalog",
        GITHUB_TOKEN: "sample-token"
      });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "dailyStats validation failed");
    assert.ok(body.problems[0].errors.includes(
      "dailyStats.groups[0].resultKeys[0] must be declared by at least one pickerVisible profile gradeMap"));
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("profile upsert rejects an invalid retained profile in the merged catalog", async () => {
  const retained = sampleProfile(0);
  retained.workflow.compatibilityReviewed = false;
  const incoming = sampleProfile(1);
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({
      schemaVersion: 2,
      version: 20,
      settings: { backendAdapter: validBackendAdapter() },
      profiles: [retained]
    }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(authenticatedPanelRequest("/api/publish", {
      baseVersion: 20,
      profiles: [incoming]
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(response.status, 422, await response.clone().text());
    const body = await response.json();
    assert.equal(body.error, "validation failed");
    assert.ok(body.problems.some((problem) => problem.id === retained.id
      && problem.errors.includes(
        "workflow.compatibilityReviewed must be true before publish")));
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("settings-only publish rejects an invalid retained profile", async () => {
  const retained = sampleProfile();
  delete retained.template.sku;
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify({
      schemaVersion: 2,
      version: 21,
      settings: { backendAdapter: validBackendAdapter(), brand: "Before" },
      profiles: [retained]
    }),
    sha: "profiles-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    const response = await worker.fetch(authenticatedPanelRequest("/api/settings", {
      baseVersion: 21,
      brand: "After"
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    });
    assert.equal(response.status, 422, await response.clone().text());
    const body = await response.json();
    assert.equal(body.error, "validation failed");
    assert.ok(body.problems.some((problem) => problem.id === retained.id
      && problem.errors.includes(
        "template.sku is required and must not contain surrounding whitespace")));
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("notification provider settings are stored privately and omitted from the hash-verified App catalog", async () => {
  const files = new Map();
  files.set("form-profiles.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 2, settings: { brand: "Sample" }, profiles: [] }),
    sha: "profiles-sha"
  });
  const notificationAdapter = {
    version: 1,
    url: "https://notify.test.invalid/hook",
    method: "POST",
    bodyTemplate: { text: "{{message}}", kind: "{{type}}" },
    successStatuses: [200, 202]
  };

  const github = installCatalogGitMock(files);

  try {
    await assert.rejects(
      publishCatalog({ GITHUB_REPO: "sample/catalog", GITHUB_TOKEN: "sample-token" }, [], {
        publicUrl: "https://panel.test.invalid",
        settings: { notificationAdapter, notificationsEnabled: "yes" }
      }),
      /notificationsEnabled must be a boolean/
    );
    assert.equal(files.has("panel-settings.json"), false);
    await publishCatalog({ GITHUB_REPO: "sample/catalog", GITHUB_TOKEN: "sample-token" }, [], {
      publicUrl: "https://panel.test.invalid",
      settings: { notificationAdapter, notificationsEnabled: false }
    });
    const appCatalog = JSON.parse(files.get("form-profiles.json").text);
    assert.equal("notificationAdapter" in appCatalog.settings, false);
    assert.equal("notificationsEnabled" in appCatalog.settings, false);
    const privateSettings = JSON.parse(files.get("panel-settings.json").text);
    assert.deepEqual(privateSettings.settings.notificationAdapter, notificationAdapter);
    assert.equal(privateSettings.settings.notificationsEnabled, false);
    const merged = await readProfiles({ GITHUB_REPO: "sample/catalog", GITHUB_TOKEN: "sample-token" });
    assert.deepEqual(merged.settings.notificationAdapter, notificationAdapter);
    assert.equal(merged.settings.notificationsEnabled, false);
  } finally {
    github.restore();
  }
});

test("catalog files become visible only after one successful branch ref update", async () => {
  const files = new Map();
  const originalProfiles = JSON.stringify({ schemaVersion: 2, version: 4, profiles: [{ id: "before" }] });
  const originalManifest = JSON.stringify({ schemaVersion: 2, version: 4, minAppVersionCode: 3 });
  files.set("form-profiles.json", { text: originalProfiles, sha: "profiles-sha" });
  files.set("manifest.json", { text: originalManifest, sha: "manifest-sha" });
  const github = installCatalogGitMock(files, { failRefUpdate: true });
  try {
    await assert.rejects(
      publishCatalog({ GITHUB_REPO: "sample/catalog", GITHUB_TOKEN: "sample-token" }, [{ id: "after" }], {
        publicUrl: "https://panel.test.invalid"
      }),
      /catalog changed while publishing/
    );
    assert.equal(files.get("form-profiles.json").text, originalProfiles);
    assert.equal(files.get("manifest.json").text, originalManifest);
    assert.equal(github.refUpdates, 0);
    assert.deepEqual(github.commitParents, ["parent-sha"]);
    assert.ok(github.contentRefs.every((ref) => ref === "parent-sha"));
  } finally {
    github.restore();
  }
});

test("stale catalog version is rejected before any branch update", async () => {
  const files = new Map();
  const originalProfiles = JSON.stringify({ schemaVersion: 2, version: 5, profiles: [{ id: "current" }] });
  files.set("form-profiles.json", { text: originalProfiles, sha: "profiles-sha" });
  files.set("manifest.json", {
    text: JSON.stringify({ schemaVersion: 2, version: 5, minAppVersionCode: 0 }),
    sha: "manifest-sha"
  });
  const github = installCatalogGitMock(files);
  try {
    await assert.rejects(
      publishCatalog({ GITHUB_REPO: "sample/catalog", GITHUB_TOKEN: "sample-token" }, [{ id: "stale" }], {
        publicUrl: "https://panel.test.invalid",
        expectedVersion: 4
      }),
      /catalog changed while publishing/
    );
    assert.equal(files.get("form-profiles.json").text, originalProfiles);
    assert.equal(github.refUpdates, 0);
  } finally {
    github.restore();
  }
});

test("legacy Worker-only notification settings fail closed until Panel migration publishes them", async () => {
  const legacy = {
    schemaVersion: 2,
    version: 1,
    settings: {
      notificationAdapter: {
        version: 1,
        url: "https://notify.test.invalid/hook",
        method: "POST",
        bodyTemplate: { text: "{{message}}" },
        successStatuses: [200]
      }
    },
    profiles: []
  };
  const files = new Map([["form-profiles.json", {
    text: JSON.stringify(legacy),
    sha: "legacy-sha"
  }]]);
  const github = installCatalogGitMock(files);
  try {
    await assert.rejects(
      readCatalogFile({ GITHUB_REPO: "sample/catalog", GITHUB_TOKEN: "sample-token" }, "profiles"),
      /publish once to migrate/
    );
  } finally {
    github.restore();
  }
});
