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

// The catalog store is split across catalog-*.js by concern; this file is the public entry
// point and re-exports it.

export { SCHEMA_VERSION, CatalogPublishConflictError, R2_CATALOG_POINTER_KEY, R2_CATALOG_SNAPSHOT_PREFIX } from "./catalog-constants.js";
export { encodeR2CatalogState, buildR2CatalogObjects } from "./catalog-r2-state.js";
export { hasCatalogStorage } from "./catalog-storage.js";
export { sha256Hex } from "./catalog-digest.js";
export { buildR2CatalogSeed, seedR2CatalogFromGitHub } from "./catalog-seed.js";
export { publishCatalog, readProfiles, readCatalogFile } from "./catalog-publish.js";
