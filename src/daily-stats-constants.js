// Allowed key sets and the limits every generation of the rules shares.

export const DAILY_STATS_KEYS = new Set(["scope", "groups"]);

export const DAILY_STATS_GROUP_KEYS = new Set([
  "id", "label", "labelI18n", "uiColor", "resultKeys"
]);

export const DAILY_STATS_V2_KEYS = new Set([
  "version", "scope", "groups", "flatSummaries"
]);

export const DAILY_STATS_V2_GROUP_KEYS = new Set([
  "id", "label", "labelI18n", "uiColor", "selectors", "legacyResultKeys"
]);

export const DAILY_STATS_V2_FLAT_SUMMARY_KEYS = new Set([
  "id", "label", "labelI18n", "uiColor", "selectors"
]);

export const DAILY_STATS_V2_SELECTOR_KEYS = new Set(["profileId", "resultKey"]);

export const DAILY_STATS_ALTERNATE_ENTRIES_KEYS = new Set([
  "version", "scope", "groups", "flatSummaries"
]);

export const DAILY_STATS_ALTERNATE_ENTRY_ITEM_KEYS = new Set(["id", "selectors"]);

export const DAILY_STATS_ALTERNATE_ENTRY_SELECTOR_KEYS = new Set(["profileId", "entryId"]);

export const DAILY_STATS_MAX_GROUPS = 16;

export const DAILY_STATS_MAX_RESULT_KEYS = 128;

export const DAILY_STATS_MAX_ID_LENGTH = 128;

export const DAILY_STATS_MAX_LABEL_LENGTH = 160;

export const DAILY_STATS_MAX_RESULT_KEY_LENGTH = 256;

export const DAILY_STATS_V2_MAX_GROUPS = 16;

export const DAILY_STATS_V2_MAX_FLAT_SUMMARIES = 8;

export const DAILY_STATS_V2_MAX_SELECTORS = 512;

export const DAILY_STATS_ALTERNATE_ENTRIES_VERSION = 1;
