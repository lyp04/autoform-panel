// Publishing a new catalog version, and reading the published one back.
import { CatalogPublishConflictError, MANIFEST_PATH, PANEL_SETTINGS_PATH, PROFILES_PATH, SCHEMA_VERSION } from "./catalog-constants.js";
import { sha256Hex } from "./catalog-digest.js";
import { catalogSnapshot, publishCatalogFiles } from "./catalog-snapshot.js";
import { validateDailyStats, validateDailyStatsAlternateEntries, validateDailyStatsV2 } from "./daily-stats.js";

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
