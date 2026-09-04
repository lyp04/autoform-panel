// Groups backed by alternate entries.
import { DAILY_STATS_ALTERNATE_ENTRIES_KEYS, DAILY_STATS_ALTERNATE_ENTRIES_VERSION, DAILY_STATS_ALTERNATE_ENTRY_ITEM_KEYS, DAILY_STATS_ALTERNATE_ENTRY_SELECTOR_KEYS, DAILY_STATS_MAX_ID_LENGTH, DAILY_STATS_V2_MAX_FLAT_SUMMARIES, DAILY_STATS_V2_MAX_GROUPS, DAILY_STATS_V2_MAX_SELECTORS } from "./daily-stats-constants.js";
import { allowOnly, isPlainObject, uniqueDailyStatsV2ItemIds, uniqueEnabledAlternateEntryPairs, validateBoundedText, validateReferenceText } from "./daily-stats-primitives.js";
import { validateDailyStatsV2 } from "./daily-stats-v2.js";

/**
 * Validates Panel-owned attribution of successful alternate entries to dailyStatsV2 cards.
 *
 * The App records the exact picker-visible source profile and alternate-entry id. This mapping is
 * the only place which assigns that event to an ABC group or flat summary. Group and flat
 * collections intentionally have separate pair namespaces, so one event may contribute to both.
 */
export function validateDailyStatsAlternateEntries(value, dailyStatsV2, profiles) {
  const errors = [];
  const root = "dailyStatsAlternateEntries";
  const dailyStatsV2Errors = isPlainObject(dailyStatsV2)
    ? validateDailyStatsV2(dailyStatsV2, profiles) : ["dailyStatsV2 is missing"];
  const alternateOnlyFlatSummaryIds = dailyStatsV2Errors.length === 0
    ? (dailyStatsV2.flatSummaries || [])
      .filter((item) => isPlainObject(item)
        && Array.isArray(item.selectors) && item.selectors.length === 0
        && typeof item.id === "string" && item.id.trim())
      .map((item) => item.id.trim())
    : [];
  const missingAlternateFlatSummaryError = (id) =>
    `${root}.flatSummaries must provide non-empty selectors for dailyStatsV2 flat summary ${JSON.stringify(id)} because its selectors are empty`;
  if (value === undefined) {
    return alternateOnlyFlatSummaryIds.map(missingAlternateFlatSummaryError);
  }
  if (!isPlainObject(value)) return [`${root} must be an object`];
  allowOnly(value, DAILY_STATS_ALTERNATE_ENTRIES_KEYS, root, errors);
  if (value.version !== DAILY_STATS_ALTERNATE_ENTRIES_VERSION) {
    errors.push(`${root}.version must equal ${DAILY_STATS_ALTERNATE_ENTRIES_VERSION}`);
  }
  if (value.scope !== "all_profiles") {
    errors.push(`${root}.scope must equal all_profiles`);
  }

  const groups = Array.isArray(value.groups) ? value.groups : null;
  const flatSummaries = Array.isArray(value.flatSummaries) ? value.flatSummaries : null;
  if (!groups) errors.push(`${root}.groups must be an array`);
  if (!flatSummaries) errors.push(`${root}.flatSummaries must be an array`);
  if (groups && groups.length > DAILY_STATS_V2_MAX_GROUPS) {
    errors.push(`${root}.groups must contain at most ${DAILY_STATS_V2_MAX_GROUPS} items`);
  }
  if (flatSummaries && flatSummaries.length > DAILY_STATS_V2_MAX_FLAT_SUMMARIES) {
    errors.push(`${root}.flatSummaries must contain at most ${DAILY_STATS_V2_MAX_FLAT_SUMMARIES} items`);
  }

  if (dailyStatsV2Errors.length > 0) {
    errors.push(`${root} requires a valid dailyStatsV2`);
  }
  const referencedIds = {
    groups: uniqueDailyStatsV2ItemIds(dailyStatsV2, "groups"),
    flatSummaries: uniqueDailyStatsV2ItemIds(dailyStatsV2, "flatSummaries")
  };
  const declaredPairs = uniqueEnabledAlternateEntryPairs(profiles);
  const itemIds = new Set();
  const assignedGroupPairs = new Map();
  const assignedFlatPairs = new Map();
  const coveredAlternateOnlyFlatSummaryIds = new Set();

  function validateItem(item, collection, itemIndex) {
    const path = `${root}.${collection}[${itemIndex}]`;
    const singular = collection === "groups" ? "group" : "flat summary";
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    allowOnly(item, DAILY_STATS_ALTERNATE_ENTRY_ITEM_KEYS, path, errors);
    const id = validateBoundedText(item.id, `${path}.id`,
      DAILY_STATS_MAX_ID_LENGTH, errors);
    if (id) {
      if (itemIds.has(id)) {
        errors.push(`${path}.id must be unique across groups and flatSummaries`);
      }
      itemIds.add(id);
      if (!referencedIds[collection].has(id)) {
        errors.push(`${path}.id must reference a dailyStatsV2 ${singular} id`);
      }
    }

    if (!Array.isArray(item.selectors)) {
      errors.push(`${path}.selectors must be an array`);
      return;
    }
    if (item.selectors.length === 0) {
      errors.push(`${path}.selectors must not be empty`);
    }
    if (item.selectors.length > DAILY_STATS_V2_MAX_SELECTORS) {
      errors.push(`${path}.selectors must contain at most ${DAILY_STATS_V2_MAX_SELECTORS} items`);
    }
    if (collection === "flatSummaries" && id
        && item.selectors.length > 0
        && alternateOnlyFlatSummaryIds.includes(id)) {
      coveredAlternateOnlyFlatSummaryIds.add(id);
    }
    const itemPairs = new Set();
    const assignedPairs = collection === "groups"
      ? assignedGroupPairs : assignedFlatPairs;
    item.selectors.forEach((selector, selectorIndex) => {
      const selectorPath = `${path}.selectors[${selectorIndex}]`;
      if (!isPlainObject(selector)) {
        errors.push(`${selectorPath} must be an object`);
        return;
      }
      allowOnly(selector, DAILY_STATS_ALTERNATE_ENTRY_SELECTOR_KEYS,
        selectorPath, errors);
      const profileId = validateReferenceText(selector.profileId,
        `${selectorPath}.profileId`, errors);
      const entryId = validateReferenceText(selector.entryId,
        `${selectorPath}.entryId`, errors);
      if (!profileId || !entryId) return;
      const pair = JSON.stringify([profileId, entryId]);
      if (itemPairs.has(pair)) {
        errors.push(`${selectorPath} pair must be unique within its item`);
      }
      itemPairs.add(pair);
      if (assignedPairs.has(pair) && assignedPairs.get(pair) !== itemIndex) {
        errors.push(`${selectorPath} pair must not appear in more than one ${singular}`);
      }
      if (!assignedPairs.has(pair)) assignedPairs.set(pair, itemIndex);
      if (!declaredPairs.has(pair)) {
        errors.push(`${selectorPath} must reference exactly one enabled alternate entry on the selected pickerVisible profile`);
      }
    });
  }

  if (groups) groups.forEach((item, index) => validateItem(item, "groups", index));
  if (flatSummaries) {
    flatSummaries.forEach((item, index) =>
      validateItem(item, "flatSummaries", index));
  }
  for (const id of alternateOnlyFlatSummaryIds) {
    if (!coveredAlternateOnlyFlatSummaryIds.has(id)) {
      errors.push(missingAlternateFlatSummaryError(id));
    }
  }
  return errors;
}
