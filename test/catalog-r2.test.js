import test from "node:test";
import assert from "node:assert/strict";

import {
  CatalogPublishConflictError,
  R2_CATALOG_POINTER_KEY,
  R2_CATALOG_SNAPSHOT_PREFIX,
  buildR2CatalogObjects,
  buildR2CatalogSeed,
  encodeR2CatalogState,
  hasCatalogStorage,
  publishCatalog,
  readCatalogFile,
  readProfiles,
  seedR2CatalogFromGitHub,
  sha256Hex
} from "../src/catalog.js";

const PROFILES_PATH = "form-profiles.json";
const MANIFEST_PATH = "manifest.json";
const PANEL_SETTINGS_PATH = "panel-settings.json";

class FakeR2Bucket {
  constructor(entries = []) {
    this.objects = new Map(entries.map(([key, text, etag]) =>
      [key, { text, etag: etag || `etag-seed-${key}` }]));
    this.gets = [];
    this.puts = [];
    this.nextEtag = 1;
  }

  async get(key) {
    this.gets.push(key);
    const current = this.objects.get(key);
    if (!current) return null;
    // Capture immutable result metadata/body so concurrent readers see the same revision.
    const snapshot = { ...current };
    return {
      key,
      etag: snapshot.etag,
      async text() { return snapshot.text; }
    };
  }

  async put(key, value, options = {}) {
    const text = String(value);
    this.puts.push({ key, value: text, options });
    const current = this.objects.get(key);
    const onlyIf = options.onlyIf || {};
    if (onlyIf.etagMatches !== undefined && current?.etag !== onlyIf.etagMatches) {
      return null;
    }
    const ifNoneMatch = onlyIf instanceof Headers
      ? onlyIf.get("If-None-Match")
      : onlyIf.etagDoesNotMatch;
    if (ifNoneMatch === "*" && current) return null;
    const etag = `etag-write-${this.nextEtag++}`;
    this.objects.set(key, { text, etag });
    return { key, etag };
  }
}

function installGitHubReadMock(files) {
  const previousFetch = globalThis.fetch;
  let mutations = 0;
  let requests = 0;
  globalThis.fetch = async (url, options = {}) => {
    requests += 1;
    const method = options.method || "GET";
    const pathWithQuery = String(url).split("/repos/sample/catalog")[1] || "";
    const [path] = pathWithQuery.split("?");
    if (method !== "GET") mutations += 1;
    if (path === "" && method === "GET") {
      return Response.json({ default_branch: "main" });
    }
    if (path === "/git/ref/heads/main" && method === "GET") {
      return Response.json({ object: { sha: "github-v42-commit" } });
    }
    if (path.startsWith("/contents/") && method === "GET") {
      const text = files[path.slice("/contents/".length)];
      if (text === null || text === undefined) return new Response("not found", { status: 404 });
      return Response.json({
        content: Buffer.from(text, "utf8").toString("base64"),
        sha: "unused-file-sha"
      });
    }
    return new Response(`unexpected ${method} ${path}`, { status: 500 });
  };
  return {
    restore() { globalThis.fetch = previousFetch; },
    get mutations() { return mutations; },
    get requests() { return requests; }
  };
}

async function exactV42Files({ privateSettings = false } = {}) {
  const profiles = [
    "{",
    '  "schemaVersion": 2,',
    '  "version": 42,',
    '  "settings": { "brand": "Exact bytes", "future": { "keep": true } },',
    '  "profiles": [{ "id": "existing", "label": "外观检测不通过，未做功能检测" }]',
    "}",
    ""
  ].join("\n");
  return {
    [PROFILES_PATH]: profiles,
    [MANIFEST_PATH]: JSON.stringify({
      schemaVersion: 2,
      version: 42,
      sha256: await sha256Hex(profiles),
      profilesUrl: "https://panel.test.invalid/catalog/form-profiles.json",
      minAppVersionCode: 6,
      updatedAt: "2030-01-01T00:00:00.000Z",
      notes: "published before migration"
    }, null, 2) + "\n",
    [PANEL_SETTINGS_PATH]: privateSettings
      ? JSON.stringify({
        schemaVersion: 1,
        settings: {
          notificationAdapter: {
            version: 1,
            url: "https://notify.test.invalid/hook"
          }
        }
      }, null, 2) + "\n"
      : null
  };
}

async function seededBucket(files) {
  const stateText = encodeR2CatalogState(files);
  const digest = await sha256Hex(stateText);
  const snapshotKey = `${R2_CATALOG_SNAPSHOT_PREFIX}${digest}.json`;
  const pointerText = JSON.stringify({
    schemaVersion: 1,
    snapshotKey,
    stateSha256: digest,
    catalogVersion: JSON.parse(files[PROFILES_PATH]).version
  }, null, 2) + "\n";
  return {
    bucket: new FakeR2Bucket([
      [snapshotKey, stateText, "etag-snapshot-v42"],
      [R2_CATALOG_POINTER_KEY, pointerText, "etag-current-v42"]
    ]),
    snapshotKey,
    stateText
  };
}

test("R2 seed writes an immutable exact v42 snapshot before its conditional current pointer", async () => {
  const files = await exactV42Files();
  const bucket = new FakeR2Bucket();
  const github = installGitHubReadMock(files);
  const env = {
    CATALOG_R2: bucket,
    GITHUB_REPO: "sample/catalog",
    GITHUB_TOKEN: "sample-token"
  };
  try {
    assert.equal(hasCatalogStorage(env), true);
    const material = await buildR2CatalogSeed(env, { expectedVersion: 42 });
    assert.equal(material.version, 42);
    assert.equal(material.sourceRevision, "github-v42-commit");
    assert.equal(material.current.key, R2_CATALOG_POINTER_KEY);
    assert.ok(material.snapshot.key.startsWith(R2_CATALOG_SNAPSHOT_PREFIX));
    assert.equal(material.snapshot.sha256, await sha256Hex(material.snapshot.text));
    assert.equal(JSON.parse(material.snapshot.text).parentStateSha256, null);
    assert.deepEqual(JSON.parse(material.snapshot.text).files, files);

    const result = await seedR2CatalogFromGitHub(env, { expectedVersion: 42 });
    assert.equal(result.created, true);
    assert.equal(result.version, 42);
    assert.equal(result.sourceRevision, "github-v42-commit");
    assert.equal(result.snapshotKey, material.snapshot.key);
    assert.equal(bucket.puts.length, 2);
    assert.equal(bucket.puts[0].key, material.snapshot.key);
    assert.equal(bucket.puts[0].options.onlyIf.get("If-None-Match"), "*");
    assert.equal(bucket.puts[1].key, R2_CATALOG_POINTER_KEY);
    assert.equal(bucket.puts[1].options.onlyIf.get("If-None-Match"), "*");
    assert.deepEqual(JSON.parse(bucket.objects.get(material.snapshot.key).text).files, files);
    const pointer = JSON.parse(bucket.objects.get(R2_CATALOG_POINTER_KEY).text);
    assert.equal(pointer.catalogVersion, 42);
    assert.equal(pointer.snapshotKey, material.snapshot.key);
    assert.equal(pointer.stateSha256, material.snapshot.sha256);

    const requestsAfterSeed = github.requests;
    assert.equal(await readCatalogFile(env, "profiles"), files[PROFILES_PATH]);
    assert.equal(await readCatalogFile(env, "manifest"), files[MANIFEST_PATH]);
    assert.equal(
      JSON.parse(await readCatalogFile(env, "manifest")).sha256,
      await sha256Hex(await readCatalogFile(env, "profiles"))
    );
    const merged = await readProfiles(env);
    assert.equal(merged.version, 42);
    assert.equal(merged.settings.future.keep, true);
    assert.equal(merged.settings.minAppVersionCode, 6);
    assert.equal(merged.catalogSha256, await sha256Hex(files[PROFILES_PATH]));
    assert.equal(github.requests, requestsAfterSeed, "seeded R2 must not read GitHub");

    const existing = await seedR2CatalogFromGitHub(env, { expectedVersion: 42 });
    assert.equal(existing.created, false);
    assert.equal(existing.snapshotKey, material.snapshot.key);
    assert.equal(bucket.puts.length, 2);
    assert.equal(github.requests, requestsAfterSeed);
  } finally {
    github.restore();
  }
});

test("an unseeded R2 binding reads GitHub but fails publishing closed", async () => {
  const files = await exactV42Files();
  const bucket = new FakeR2Bucket();
  const github = installGitHubReadMock(files);
  const env = {
    CATALOG_R2: bucket,
    GITHUB_REPO: "sample/catalog",
    GITHUB_TOKEN: "sample-token"
  };
  try {
    assert.equal(await readCatalogFile(env, "manifest"), files[MANIFEST_PATH]);
    await assert.rejects(
      publishCatalog(env, [{ id: "must-not-publish" }], {
        publicUrl: "https://panel.test.invalid",
        expectedVersion: 42
      }),
      /R2 catalog is not initialized/
    );
    assert.equal(bucket.puts.length, 0);
    assert.equal(github.mutations, 0);
  } finally {
    github.restore();
  }
});

test("R2 publish writes immutable snapshots then moves only current with ETag CAS", async () => {
  const files = await exactV42Files({ privateSettings: true });
  const seeded = await seededBucket(files);
  const bucket = seeded.bucket;
  const env = { CATALOG_R2: bucket };
  const outcomes = await Promise.allSettled([
    publishCatalog(env, [{ id: "first-writer" }], {
      publicUrl: "https://panel.test.invalid",
      expectedVersion: 42,
      settings: { brand: "R2" }
    }),
    publishCatalog(env, [{ id: "second-writer" }], {
      publicUrl: "https://panel.test.invalid",
      expectedVersion: 42,
      settings: { brand: "R2" }
    })
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  const rejected = outcomes.find((entry) => entry.status === "rejected");
  assert.ok(rejected.reason instanceof CatalogPublishConflictError);

  const pointerPuts = bucket.puts.filter((entry) => entry.key === R2_CATALOG_POINTER_KEY);
  const snapshotPuts = bucket.puts.filter((entry) =>
    entry.key.startsWith(R2_CATALOG_SNAPSHOT_PREFIX));
  assert.equal(pointerPuts.length, 2);
  assert.ok(pointerPuts.every((entry) =>
    entry.options.onlyIf.etagMatches === "etag-current-v42"));
  assert.equal(snapshotPuts.length, 2);
  assert.ok(snapshotPuts.every((entry) =>
    entry.options.onlyIf.get("If-None-Match") === "*"));
  assert.equal(
    bucket.objects.get(seeded.snapshotKey).text,
    seeded.stateText,
    "the v42 snapshot must remain immutable"
  );

  const current = JSON.parse(bucket.objects.get(R2_CATALOG_POINTER_KEY).text);
  const stateText = bucket.objects.get(current.snapshotKey).text;
  assert.equal(await sha256Hex(stateText), current.stateSha256);
  const state = JSON.parse(stateText);
  assert.equal(
    state.parentStateSha256,
    seeded.snapshotKey.slice(R2_CATALOG_SNAPSHOT_PREFIX.length, -".json".length)
  );
  const profilesText = state.files[PROFILES_PATH];
  const manifestText = state.files[MANIFEST_PATH];
  const privateText = state.files[PANEL_SETTINGS_PATH];
  const profiles = JSON.parse(profilesText);
  const manifest = JSON.parse(manifestText);
  assert.equal(current.catalogVersion, 43);
  assert.equal(profiles.version, 43);
  assert.equal(profiles.settings.brand, "R2");
  assert.deepEqual(profiles.settings.future, { keep: true });
  assert.equal(manifest.version, 43);
  assert.equal(manifest.sha256, await sha256Hex(profilesText));
  assert.equal(await readCatalogFile(env, "profiles"), profilesText);
  assert.equal(await readCatalogFile(env, "manifest"), manifestText);
  assert.deepEqual(JSON.parse(privateText).settings.notificationAdapter, {
    version: 1,
    url: "https://notify.test.invalid/hook"
  });
});

test("malformed authoritative R2 pointer never silently falls back to GitHub", async () => {
  const bucket = new FakeR2Bucket([
    [R2_CATALOG_POINTER_KEY, '{"schemaVersion":999}\n', "etag-invalid"]
  ]);
  await assert.rejects(
    readProfiles({
      CATALOG_R2: bucket,
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token"
    }),
    /R2 catalog current pointer must use schemaVersion 1/
  );
});

test("R2 current fails closed for missing, tampered, or version-mismatched snapshots", async (t) => {
  const files = await exactV42Files();

  await t.test("missing referenced snapshot", async () => {
    const seeded = await seededBucket(files);
    seeded.bucket.objects.delete(seeded.snapshotKey);
    await assert.rejects(
      readProfiles({ CATALOG_R2: seeded.bucket }),
      /R2 catalog snapshot .* is missing or unreadable/
    );
  });

  await t.test("tampered snapshot bytes", async () => {
    const seeded = await seededBucket(files);
    const stored = seeded.bucket.objects.get(seeded.snapshotKey);
    stored.text = stored.text.replace("Exact bytes", "Tampered bytes");
    await assert.rejects(
      readProfiles({ CATALOG_R2: seeded.bucket }),
      /failed its SHA-256 check/
    );
  });

  await t.test("pointer and catalog version mismatch", async () => {
    const seeded = await seededBucket(files);
    const stored = seeded.bucket.objects.get(R2_CATALOG_POINTER_KEY);
    const pointer = JSON.parse(stored.text);
    pointer.catalogVersion = 43;
    stored.text = JSON.stringify(pointer, null, 2) + "\n";
    await assert.rejects(
      readProfiles({ CATALOG_R2: seeded.bucket }),
      /pointer version does not match its snapshot/
    );
  });
});

test("seed refuses a pre-existing content-addressed key with different bytes", async () => {
  const files = await exactV42Files();
  const github = installGitHubReadMock(files);
  const material = await buildR2CatalogSeed({
    GITHUB_REPO: "sample/catalog",
    GITHUB_TOKEN: "sample-token"
  }, { expectedVersion: 42 });
  const bucket = new FakeR2Bucket([
    [material.snapshot.key, "different bytes", "etag-collision"]
  ]);
  try {
    await assert.rejects(
      seedR2CatalogFromGitHub({
        CATALOG_R2: bucket,
        GITHUB_REPO: "sample/catalog",
        GITHUB_TOKEN: "sample-token"
      }, { expectedVersion: 42 }),
      /immutable catalog snapshot collision/
    );
    assert.equal(bucket.objects.has(R2_CATALOG_POINTER_KEY), false);
    assert.equal(github.mutations, 0);
  } finally {
    github.restore();
  }
});

test("R2 snapshots reject App-incompatible versions and mismatched manifest identity", async () => {
  const files = await exactV42Files();

  const stringVersionProfiles = files[PROFILES_PATH].replace(
    '"version": 42',
    '"version": "42"'
  );
  const stringVersionManifest = JSON.parse(files[MANIFEST_PATH]);
  stringVersionManifest.version = "42";
  stringVersionManifest.sha256 = await sha256Hex(stringVersionProfiles);
  await assert.rejects(
    buildR2CatalogObjects({
      ...files,
      [PROFILES_PATH]: stringVersionProfiles,
      [MANIFEST_PATH]: JSON.stringify(stringVersionManifest) + "\n"
    }),
    /version must be a positive App-compatible integer/
  );

  const wrongVersionManifest = JSON.parse(files[MANIFEST_PATH]);
  wrongVersionManifest.version = 43;
  await assert.rejects(
    buildR2CatalogObjects({
      ...files,
      [MANIFEST_PATH]: JSON.stringify(wrongVersionManifest) + "\n"
    }),
    /manifest version does not match/
  );

  const wrongShaManifest = JSON.parse(files[MANIFEST_PATH]);
  wrongShaManifest.sha256 = "0".repeat(64);
  await assert.rejects(
    buildR2CatalogObjects({
      ...files,
      [MANIFEST_PATH]: JSON.stringify(wrongShaManifest) + "\n"
    }),
    /manifest SHA-256 does not match/
  );
});
