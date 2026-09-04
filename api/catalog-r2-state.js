// The content-addressed state: encoding, decoding, its file contract and the objects a
// publish writes.
import { CATALOG_PATHS, MANIFEST_PATH, MAX_APP_CATALOG_VERSION, PROFILES_PATH, R2_CATALOG_SNAPSHOT_PREFIX, R2_POINTER_SCHEMA_VERSION, R2_STATE_SCHEMA_VERSION } from "./catalog-constants.js";
import { sha256Hex } from "./catalog-digest.js";

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

export function decodeR2CatalogState(text) {
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

export function catalogVersionFromFiles(files) {
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

export async function validateR2CatalogFileContract(files) {
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

export function decodeR2CatalogPointer(text) {
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
