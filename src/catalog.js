// Reads the catalog from one authoritative snapshot, publishes it atomically, and serves it to the
// Android App. GitHub remains the default and pre-cutover fallback store. When CATALOG_R2 is bound
// and contains the seeded R2 current pointer, that pointer and its immutable snapshot become
// authoritative instead:
//   form-profiles.json : { schemaVersion, version, profiles:[...] }   <- the app loads this
//   manifest.json      : { schemaVersion, version, sha256, profilesUrl, minAppVersionCode, ... }
//   panel-settings.json: Worker-only notification settings (never served through /catalog/*)
// The app's FormCatalogManager fetches manifest.json, gates on schemaVersion/version, then
// downloads profilesUrl and SHA-256-verifies it against manifest.sha256.

import {
  validateDailyStats,
  validateDailyStatsAlternateEntries,
  validateDailyStatsV2
} from "./daily-stats.js";

export const SCHEMA_VERSION = 2; // keep in sync with FormCatalog.SUPPORTED_SCHEMA_VERSION (Android)

export class CatalogPublishConflictError extends Error {
  constructor() {
    super("catalog changed while publishing; reload the Panel and retry");
    this.name = "CatalogPublishConflictError";
  }
}

const PROFILES_PATH = "form-profiles.json";
const MANIFEST_PATH = "manifest.json";
const PANEL_SETTINGS_PATH = "panel-settings.json";
const CATALOG_PATHS = [PROFILES_PATH, MANIFEST_PATH, PANEL_SETTINGS_PATH];
const R2_STATE_SCHEMA_VERSION = 1;
const R2_POINTER_SCHEMA_VERSION = 1;
const MAX_APP_CATALOG_VERSION = 2_147_483_647;
export const R2_CATALOG_POINTER_KEY = "catalog-current-v1.json";
export const R2_CATALOG_SNAPSHOT_PREFIX = "catalog-snapshots-v1/";

function normalizedCatalogFiles(files) {
  const normalized = {};
  for (const path of CATALOG_PATHS) {
    const value = files?.[path] ?? null;
    if (value !== null && typeof value !== "string") {
      throw new Error(`R2 catalog state ${path} must be a string or null`);
    }
    normalized[path] = value;
  }
  return normalized;
}

function normalizedParentStateSha256(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error("R2 catalog parentStateSha256 must be null or a lowercase SHA-256");
  }
  return value;
}

/** Deterministic immutable snapshot format. Each value is the exact file text, not a
 * parsed/re-serialized catalog, so migration does not bump version/updatedAt or change App bytes.
 * The parent digest makes successful current-pointer history distinguishable from orphan losers. */
export function encodeR2CatalogState(files, { parentStateSha256 = null } = {}) {
  return JSON.stringify({
    schemaVersion: R2_STATE_SCHEMA_VERSION,
    parentStateSha256: normalizedParentStateSha256(parentStateSha256),
    files: normalizedCatalogFiles(files)
  }, null, 2) + "\n";
}

function decodeR2CatalogState(text) {
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new Error("R2 catalog state is not valid JSON");
  }
  if (state?.schemaVersion !== R2_STATE_SCHEMA_VERSION
      || !state.files || typeof state.files !== "object" || Array.isArray(state.files)) {
    throw new Error(`R2 catalog state must use schemaVersion ${R2_STATE_SCHEMA_VERSION} and contain files`);
  }
  return {
    parentStateSha256: normalizedParentStateSha256(state.parentStateSha256),
    files: normalizedCatalogFiles(state.files)
  };
}

function catalogVersionFromFiles(files) {
  if (!files?.[PROFILES_PATH]) return 0;
  try {
    const version = JSON.parse(files[PROFILES_PATH]).version;
    return Number.isInteger(version) && version >= 0 && version <= MAX_APP_CATALOG_VERSION
      ? version
      : 0;
  } catch {
    return 0;
  }
}

async function validateR2CatalogFileContract(files) {
  if (!files[PROFILES_PATH] || !files[MANIFEST_PATH]) {
    throw new Error("R2 catalog snapshot must contain profiles and manifest text");
  }
  let profiles;
  let manifest;
  try {
    profiles = JSON.parse(files[PROFILES_PATH]);
    manifest = JSON.parse(files[MANIFEST_PATH]);
  } catch {
    throw new Error("R2 catalog profiles and manifest must be valid JSON");
  }
  const version = profiles?.version;
  if (!Number.isInteger(version) || version < 1 || version > MAX_APP_CATALOG_VERSION) {
    throw new Error("R2 catalog version must be a positive App-compatible integer");
  }
  if (manifest?.version !== version) {
    throw new Error("R2 manifest version does not match form-profiles version");
  }
  const catalogSha256 = await sha256Hex(files[PROFILES_PATH]);
  if (manifest?.sha256 !== catalogSha256) {
    throw new Error("R2 manifest SHA-256 does not match the exact form-profiles bytes");
  }
  return { version, catalogSha256 };
}

/** Builds the two upload payloads from exact file strings without needing GitHub or an R2 binding. */
export async function buildR2CatalogObjects(files, { parentStateSha256 = null } = {}) {
  const normalizedFiles = normalizedCatalogFiles(files);
  const identity = await validateR2CatalogFileContract(normalizedFiles);
  const stateText = encodeR2CatalogState(normalizedFiles, { parentStateSha256 });
  const stateSha256 = await sha256Hex(stateText);
  const snapshotKey = `${R2_CATALOG_SNAPSHOT_PREFIX}${stateSha256}.json`;
  const catalogVersion = identity.version;
  const pointerText = JSON.stringify({
    schemaVersion: R2_POINTER_SCHEMA_VERSION,
    snapshotKey,
    stateSha256,
    catalogVersion
  }, null, 2) + "\n";
  return {
    stateText,
    stateSha256,
    snapshotKey,
    catalogVersion,
    pointerText
  };
}

function decodeR2CatalogPointer(text) {
  let pointer;
  try {
    pointer = JSON.parse(text);
  } catch {
    throw new Error("R2 catalog current pointer is not valid JSON");
  }
  const digest = typeof pointer?.stateSha256 === "string" ? pointer.stateSha256 : "";
  const expectedSnapshotKey = `${R2_CATALOG_SNAPSHOT_PREFIX}${digest}.json`;
  if (pointer?.schemaVersion !== R2_POINTER_SCHEMA_VERSION
      || !/^[0-9a-f]{64}$/u.test(digest)
      || pointer.snapshotKey !== expectedSnapshotKey
      || !Number.isSafeInteger(pointer.catalogVersion)
      || pointer.catalogVersion < 0) {
    throw new Error(
      `R2 catalog current pointer must use schemaVersion ${R2_POINTER_SCHEMA_VERSION} and reference one content-addressed snapshot`
    );
  }
  return pointer;
}

function r2Bucket(env, required = false) {
  const bucket = env?.CATALOG_R2;
  if (!bucket) {
    if (required) throw new Error("CATALOG_R2 binding is not configured");
    return null;
  }
  if (typeof bucket.get !== "function" || typeof bucket.put !== "function") {
    throw new Error("CATALOG_R2 is not a valid R2 binding");
  }
  return bucket;
}

/** Shared storage-presence predicate for callers that should read active settings with either
 * backend. GitHub credentials remain independently required for fallback and rollback. */
export function hasCatalogStorage(env) {
  return Boolean(env?.CATALOG_R2 || (env?.GITHUB_REPO && env?.GITHUB_TOKEN));
}

function repoApi(env, path) {
  const repo = env.GITHUB_REPO; // "owner/name"
  if (!repo) throw new Error("GITHUB_REPO env is not set");
  return `https://api.github.com/repos/${repo}/contents/${path}`;
}

function repoRoot(env) {
  const repo = env.GITHUB_REPO;
  if (!repo) throw new Error("GITHUB_REPO env is not set");
  return `https://api.github.com/repos/${repo}`;
}

function ghHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN env is not set");
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "autoform-panel"
  };
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64decode(b64) {
  const binary = atob((b64 || "").replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Returns { text, sha } for a repo file, or { text: null, sha: null } when it doesn't exist yet. */
async function getFile(env, path, ref = "") {
  const requestedRef = String(ref || env.GITHUB_BRANCH || "").trim();
  const url = requestedRef ? `${repoApi(env, path)}?ref=${encodeURIComponent(requestedRef)}` : repoApi(env, path);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return { text: null, sha: null };
  if (!res.ok) {
    const error = new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
    error.status = res.status;
    throw error;
  }
  const json = await res.json();
  return { text: b64decode(json.content), sha: json.sha };
}

async function githubJson(env, path, options = {}) {
  const res = await fetch(`${repoRoot(env)}${path}`, {
    ...options,
    headers: { ...ghHeaders(env), "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!res.ok) {
    const error = new Error(`GitHub ${options.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function encodedRefPath(branch) {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

async function catalogHead(env) {
  let branch = String(env.GITHUB_BRANCH || "").trim();
  if (!branch) {
    const repository = await githubJson(env, "");
    branch = String(repository.default_branch || "").trim();
  }
  if (!branch) throw new Error("GitHub default branch is not configured");
  const refPath = `heads/${encodedRefPath(branch)}`;
  const ref = await githubJson(env, `/git/ref/${refPath}`);
  const parentSha = ref?.object?.sha;
  if (!parentSha) throw new Error("GitHub branch ref did not include a commit SHA");
  return { branch, refPath, parentSha };
}

/** Write every catalog file from one immutable snapshot, then move the branch only if it still
 * points to that snapshot. Blob/tree/commit creation can leave unreachable Git objects on failure,
 * but Apps never observe a partial or stale overwrite because the ref is the sole publication point. */
async function commitCatalogFiles(env, files, message, snapshot) {
  const { refPath, parentSha } = snapshot;
  const parent = await githubJson(env, `/git/commits/${parentSha}`);
  const baseTree = parent?.tree?.sha;
  if (!baseTree) throw new Error("GitHub parent commit did not include a tree SHA");

  const tree = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await githubJson(env, "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content, encoding: "utf-8" })
    });
    if (!blob?.sha) throw new Error(`GitHub blob creation did not return a SHA for ${path}`);
    tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const nextTree = await githubJson(env, "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree })
  });
  const commit = await githubJson(env, "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: nextTree.sha, parents: [parentSha] })
  });
  if (!commit?.sha) throw new Error("GitHub commit creation did not return a SHA");
  let updated;
  try {
    updated = await githubJson(env, `/git/refs/${refPath}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
  } catch (error) {
    if (error?.status === 409 || error?.status === 422) throw new CatalogPublishConflictError();
    throw error;
  }
  if (updated?.object?.sha !== commit.sha) {
    throw new Error("GitHub branch update did not confirm the new commit SHA");
  }
  return commit.sha;
}

async function githubCatalogSnapshot(env) {
  const head = await catalogHead(env);
  const entries = await Promise.all(CATALOG_PATHS.map((path) => getFile(env, path, head.parentSha)));
  return {
    storage: "github",
    github: head,
    files: Object.fromEntries(CATALOG_PATHS.map((path, index) => [path, entries[index].text]))
  };
}

async function r2CatalogSnapshot(env) {
  const bucket = r2Bucket(env);
  if (!bucket) return null;
  const current = await bucket.get(R2_CATALOG_POINTER_KEY);
  if (!current) return { storage: "r2-missing", bucket };
  if (!current.etag || typeof current.text !== "function") {
    throw new Error("R2 catalog current pointer did not include an ETag and readable body");
  }
  const pointer = decodeR2CatalogPointer(await current.text());
  const object = await bucket.get(pointer.snapshotKey);
  if (!object || typeof object.text !== "function") {
    throw new Error(`R2 catalog snapshot ${pointer.snapshotKey} is missing or unreadable`);
  }
  const stateText = await object.text();
  if (await sha256Hex(stateText) !== pointer.stateSha256) {
    throw new Error(`R2 catalog snapshot ${pointer.snapshotKey} failed its SHA-256 check`);
  }
  const state = decodeR2CatalogState(stateText);
  const files = state.files;
  const identity = await validateR2CatalogFileContract(files);
  if (identity.version !== pointer.catalogVersion) {
    throw new Error("R2 catalog current pointer version does not match its snapshot");
  }
  return {
    storage: "r2",
    bucket,
    etag: current.etag,
    pointer,
    parentStateSha256: state.parentStateSha256,
    files
  };
}

/** R2 is authoritative only after its current pointer exists. A bound but unseeded bucket is a
 * read-only GitHub fallback, which makes cutover safe without silently publishing a version-bumped
 * state. A malformed pointer/snapshot fails closed. After an R2-only publish, GitHub is stale and
 * cannot be used as a direct rollback until the exact R2 current snapshot has been restored there. */
async function catalogSnapshot(env) {
  const r2 = await r2CatalogSnapshot(env);
  if (r2?.storage === "r2") return r2;
  const github = await githubCatalogSnapshot(env);
  return r2?.storage === "r2-missing"
    ? { ...github, storage: "github-fallback", bucket: r2.bucket }
    : github;
}

async function putR2CurrentPointer(bucket, pointerText, onlyIf) {
  let written;
  try {
    written = await bucket.put(R2_CATALOG_POINTER_KEY, pointerText, {
      onlyIf,
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "no-store"
      }
    });
  } catch (error) {
    if (error?.status === 409 || error?.status === 412) throw new CatalogPublishConflictError();
    throw error;
  }
  // The Workers R2 API returns null when a conditional put precondition fails.
  if (!written) throw new CatalogPublishConflictError();
  if (!written.etag) throw new Error("R2 catalog current-pointer write did not return an ETag");
  return written;
}

async function putImmutableR2Snapshot(bucket, objects) {
  let written;
  try {
    written = await bucket.put(objects.snapshotKey, objects.stateText, {
      // Headers preserve the standard wildcard semantics: create only when the key does not exist.
      onlyIf: new Headers({ "If-None-Match": "*" }),
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        // The state also contains Worker-only panel settings; never advertise it as public cache data.
        cacheControl: "no-store"
      }
    });
  } catch (error) {
    if (error?.status !== 409 && error?.status !== 412) throw error;
  }
  if (written) return written;

  // A content-addressed snapshot may already exist after a retry or concurrent identical publish.
  // Accept it only when its exact bytes still match the digest-derived key.
  const existing = await bucket.get(objects.snapshotKey);
  if (!existing || typeof existing.text !== "function"
      || await existing.text() !== objects.stateText) {
    throw new Error(`R2 immutable catalog snapshot collision at ${objects.snapshotKey}`);
  }
  return existing;
}

async function publishCatalogFiles(env, updates, message, snapshot) {
  if (snapshot.storage === "r2") {
    const files = { ...snapshot.files, ...updates };
    const objects = await buildR2CatalogObjects(files, {
      parentStateSha256: snapshot.pointer.stateSha256
    });
    await putImmutableR2Snapshot(snapshot.bucket, objects);
    return putR2CurrentPointer(
      snapshot.bucket,
      objects.pointerText,
      { etagMatches: snapshot.etag }
    );
  }
  if (snapshot.storage === "github-fallback") {
    throw new Error(
      `R2 catalog is not initialized; seed ${R2_CATALOG_POINTER_KEY} before publishing or remove the CATALOG_R2 binding`
    );
  }
  return commitCatalogFiles(env, updates, message, snapshot.github);
}

/** Returns byte-exact seed material without writing R2. Upload `snapshot` first and `current`
 * second; neither operation parses/re-serializes the three catalog files. */
export async function buildR2CatalogSeed(env, { expectedVersion = undefined } = {}) {
  const snapshot = await githubCatalogSnapshot(env);
  const version = catalogVersionFromFiles(snapshot.files);
  if (expectedVersion !== undefined && expectedVersion !== version) {
    throw new CatalogPublishConflictError();
  }
  const objects = await buildR2CatalogObjects(snapshot.files);
  return {
    version,
    sourceRevision: snapshot.github.parentSha,
    snapshot: {
      key: objects.snapshotKey,
      text: objects.stateText,
      sha256: objects.stateSha256
    },
    current: {
      key: R2_CATALOG_POINTER_KEY,
      text: objects.pointerText
    }
  };
}

/** One-shot in-Worker migration helper. First route all writes through an unseeded CATALOG_R2
 * deployment (whose publish path fails closed), then call this with expectedVersion. Git and R2
 * cannot share one CAS, so seeding while an older Git-backed Worker still accepts writes is unsafe.
 * The helper copies one immutable GitHub commit exactly and creates the current pointer with
 * If-None-Match:* so concurrent seeds cannot replace authority. */
export async function seedR2CatalogFromGitHub(env, { expectedVersion = undefined } = {}) {
  const bucket = r2Bucket(env, true);
  const existing = await r2CatalogSnapshot(env);
  if (existing?.storage === "r2") {
    const version = existing.pointer.catalogVersion;
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw new CatalogPublishConflictError();
    }
    return {
      created: false,
      key: R2_CATALOG_POINTER_KEY,
      version,
      etag: existing.etag,
      snapshotKey: existing.pointer.snapshotKey
    };
  }
  const seed = await buildR2CatalogSeed(env, { expectedVersion });
  await putImmutableR2Snapshot(bucket, {
    snapshotKey: seed.snapshot.key,
    stateText: seed.snapshot.text
  });
  const written = await putR2CurrentPointer(
    bucket,
    seed.current.text,
    new Headers({ "If-None-Match": "*" })
  );
  return {
    created: true,
    key: R2_CATALOG_POINTER_KEY,
    version: seed.version,
    etag: written.etag,
    snapshotKey: seed.snapshot.key,
    sourceRevision: seed.sourceRevision
  };
}

/** Validated profiles -> bump version, write form-profiles.json + manifest.json.
 *  `settings` (optional) is a global sibling object stored alongside `profiles` in the same file;
 *  when given it is MERGED over the previously stored settings (incoming keys win). */
export async function publishCatalog(env, profiles, {
  publicUrl,
  notes = "",
  minAppVersionCode = undefined,
  settings = undefined,
  expectedVersion = undefined
} = {}) {
  const snapshot = await catalogSnapshot(env);
  const existingProfiles = { text: snapshot.files[PROFILES_PATH] };
  const existingPanelSettings = { text: snapshot.files[PANEL_SETTINGS_PATH] };
  const existingManifest = { text: snapshot.files[MANIFEST_PATH] };
  let prevVersion = 0;
  let prevSettings = undefined;
  let prevPrivateSettings = {};
  let prevMinAppVersionCode = 0;
  if (existingProfiles.text) {
    try {
      const prev = JSON.parse(existingProfiles.text);
      prevVersion = Number(prev.version) || 0;
      if (prev.settings && typeof prev.settings === "object" && !Array.isArray(prev.settings)) prevSettings = prev.settings;
    } catch {
      prevVersion = 0;
    }
  }
  if (expectedVersion !== undefined && expectedVersion !== prevVersion) {
    throw new CatalogPublishConflictError();
  }
  if (existingPanelSettings.text) {
    try {
      const previous = JSON.parse(existingPanelSettings.text);
      if (previous.settings && typeof previous.settings === "object" && !Array.isArray(previous.settings)) {
        prevPrivateSettings = previous.settings;
      }
    } catch {}
  }
  if (existingManifest.text) {
    try {
      const previous = JSON.parse(existingManifest.text);
      if (Number.isInteger(previous.minAppVersionCode) && previous.minAppVersionCode >= 0) {
        prevMinAppVersionCode = previous.minAppVersionCode;
      }
    } catch {}
  }
  const version = prevVersion + 1;
  // Merge incoming settings over previous (incoming keys win); omit the field entirely if neither exists.
  let mergedSettings = undefined;
  if (settings !== undefined || prevSettings !== undefined) {
    mergedSettings = { ...(prevSettings || {}), ...(settings || {}) };
  }
  if (mergedSettings
      && Object.prototype.hasOwnProperty.call(mergedSettings, "notificationsEnabled")
      && typeof mergedSettings.notificationsEnabled !== "boolean") {
    throw new Error("notificationsEnabled must be a boolean");
  }
  const dailyStatsErrors = validateDailyStats(mergedSettings?.dailyStats, profiles);
  if (dailyStatsErrors.length) {
    throw new Error(`dailyStats validation failed: ${dailyStatsErrors.join("; ")}`);
  }
  const dailyStatsV2Errors = validateDailyStatsV2(mergedSettings?.dailyStatsV2, profiles);
  if (dailyStatsV2Errors.length) {
    throw new Error(`dailyStatsV2 validation failed: ${dailyStatsV2Errors.join("; ")}`);
  }
  const dailyStatsAlternateEntriesErrors = validateDailyStatsAlternateEntries(
    mergedSettings?.dailyStatsAlternateEntries, mergedSettings?.dailyStatsV2, profiles);
  if (dailyStatsAlternateEntriesErrors.length) {
    throw new Error(`dailyStatsAlternateEntries validation failed: ${dailyStatsAlternateEntriesErrors.join("; ")}`);
  }
  const configuredMinAppVersionCode = minAppVersionCode !== undefined
    ? minAppVersionCode
    : mergedSettings?.minAppVersionCode;
  const resolvedMinAppVersionCode = configuredMinAppVersionCode === undefined
    ? prevMinAppVersionCode
    : configuredMinAppVersionCode;
  if (!Number.isInteger(resolvedMinAppVersionCode) || resolvedMinAppVersionCode < 0) {
    throw new Error("minAppVersionCode must be a non-negative integer");
  }
  // Provider protocol/URL and its global enable switch are Worker-only. Migrate any earlier in-file
  // value into a separate private settings file so the App catalog remains hash-verifiable without
  // receiving notification delivery configuration.
  const privateSettings = { ...prevPrivateSettings };
  for (const key of ["notificationAdapter", "notificationsEnabled"]) {
    if (mergedSettings && Object.prototype.hasOwnProperty.call(mergedSettings, key)) {
      privateSettings[key] = mergedSettings[key];
      delete mergedSettings[key];
    }
  }
  const profilesObj = mergedSettings !== undefined
    ? { schemaVersion: SCHEMA_VERSION, version, settings: mergedSettings, profiles }
    : { schemaVersion: SCHEMA_VERSION, version, profiles };
  const profilesJson = JSON.stringify(profilesObj, null, 2) + "\n";
  const sha256 = await sha256Hex(profilesJson);
  const profilesUrl = `${(publicUrl || "").replace(/\/+$/, "")}/catalog/form-profiles.json`;
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    version,
    sha256,
    profilesUrl,
    minAppVersionCode: resolvedMinAppVersionCode,
    updatedAt: new Date().toISOString(),
    notes
  };
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";

  const files = {
    [PROFILES_PATH]: profilesJson,
    [MANIFEST_PATH]: manifestJson
  };
  if (Object.keys(privateSettings).length || existingPanelSettings.text) {
    const privateJson = JSON.stringify({ schemaVersion: 1, settings: privateSettings }, null, 2) + "\n";
    files[PANEL_SETTINGS_PATH] = privateJson;
  }
  await publishCatalogFiles(
    env,
    files,
    `catalog: publish v${version} (${profiles.length} profiles)`,
    snapshot
  );
  return { version, sha256, profilesUrl };
}

/** Current published profiles array + global settings (empty when the catalog is uninitialized). */
export async function readProfiles(env) {
  const snapshot = await catalogSnapshot(env);
  const file = { text: snapshot.files[PROFILES_PATH] };
  const panelFile = { text: snapshot.files[PANEL_SETTINGS_PATH] };
  const manifestFile = { text: snapshot.files[MANIFEST_PATH] };
  if (!file.text) {
    return { version: 0, profiles: [], settings: {}, catalogSha256: "" };
  }
  const json = JSON.parse(file.text);
  const settings = json.settings && typeof json.settings === "object" && !Array.isArray(json.settings) ? { ...json.settings } : {};
  if (panelFile.text) {
    const panel = JSON.parse(panelFile.text);
    if (panel.settings && typeof panel.settings === "object" && !Array.isArray(panel.settings)) {
      Object.assign(settings, panel.settings);
    }
  }
  if (settings.minAppVersionCode === undefined && manifestFile.text) {
    try {
      const manifest = JSON.parse(manifestFile.text);
      if (Number.isInteger(manifest.minAppVersionCode) && manifest.minAppVersionCode >= 0) {
        settings.minAppVersionCode = manifest.minAppVersionCode;
      }
    } catch {}
  }
  return {
    version: Number(json.version) || 0,
    profiles: Array.isArray(json.profiles) ? json.profiles : [],
    settings,
    // Exact hash of the bytes served by /catalog/form-profiles.json. /api/config includes this
    // value in a connection proof so a newer App can bind a legacy cache only when it is the
    // catalog fetched from this exact Panel/key connection.
    catalogSha256: await sha256Hex(file.text)
  };
}

/** Raw stored file text for the app's /catalog/* fetches. */
export async function readCatalogFile(env, which) {
  const path = which === "manifest" ? MANIFEST_PATH : PROFILES_PATH;
  const snapshot = await catalogSnapshot(env);
  const text = snapshot.files[path];
  if (text && path === PROFILES_PATH) {
    const catalog = JSON.parse(text);
    if (catalog?.settings && Object.prototype.hasOwnProperty.call(catalog.settings, "notificationAdapter")) {
      throw new Error("catalog contains Worker-only notificationAdapter; publish once to migrate it before serving App catalog");
    }
  }
  return text;
}
