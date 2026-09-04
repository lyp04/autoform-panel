// The two views of a catalog: what the app may read, and what the panel editor sees.
import { validateDailyStats, validateDailyStatsAlternateEntries, validateDailyStatsV2 } from "./daily-stats.js";
import { migrateNotificationAdapter } from "./notification-adapter.js";
import { safeUpdateSourceForApp } from "./update-source.js";

const APP_CATALOG_SETTING_KEYS = Object.freeze([
  "backendAdapter",
  "backendApiBase",
  "notifyWebhook",
  "brand",
  "updateOwner",
  "updateRepo",
  "updateSource",
  "dailyStats",
  "dailyStatsV2",
  "dailyStatsAlternateEntries",
  "webOrigin",
  "webReferer",
  "endpoints",
  "sessionInvalidHttpStatuses",
  "sessionInvalidCodes",
  "sessionInvalidMessagePatterns",
  "minAppVersionCode",
  "updatedAt"
]);

export function clientCatalog(catalog) {
  const copy = JSON.parse(JSON.stringify(catalog || {}));
  if (copy.settings && typeof copy.settings === "object") {
    copy.settings = Object.fromEntries(APP_CATALOG_SETTING_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(copy.settings, key))
      .map((key) => [key, copy.settings[key]]));
    if (Object.prototype.hasOwnProperty.call(copy.settings, "updateSource")) {
      copy.settings.updateSource = safeUpdateSourceForApp(copy.settings);
    }
    if (validateDailyStats(copy.settings.dailyStats, copy.profiles).length > 0) {
      delete copy.settings.dailyStats;
    }
    if (validateDailyStatsV2(copy.settings.dailyStatsV2, copy.profiles).length > 0) {
      delete copy.settings.dailyStatsV2;
    }
    if (validateDailyStatsAlternateEntries(copy.settings.dailyStatsAlternateEntries,
        copy.settings.dailyStatsV2, copy.profiles).length > 0) {
      delete copy.settings.dailyStatsAlternateEntries;
      // Never serve a v2 flat summary whose ordinary selectors are empty after its
      // required alternate-entry mapping has been rejected or omitted.
      if (validateDailyStatsAlternateEntries(undefined,
          copy.settings.dailyStatsV2, copy.profiles).length > 0) {
        delete copy.settings.dailyStatsV2;
      }
    }
  }
  return copy;
}

export function panelCatalog(catalog) {
  const copy = JSON.parse(JSON.stringify(catalog || {}));
  if (copy.settings?.notificationAdapter) {
    copy.settings.notificationAdapter = migrateNotificationAdapter(copy.settings.notificationAdapter);
  }
  return copy;
}
