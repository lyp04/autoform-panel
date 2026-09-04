// Exact profile and result groups, with their flat summaries.
import { DAILY_STATS_MAX_ID_LENGTH, DAILY_STATS_MAX_LABEL_LENGTH, DAILY_STATS_MAX_RESULT_KEYS, DAILY_STATS_MAX_RESULT_KEY_LENGTH, DAILY_STATS_V2_FLAT_SUMMARY_KEYS, DAILY_STATS_V2_GROUP_KEYS, DAILY_STATS_V2_KEYS, DAILY_STATS_V2_MAX_FLAT_SUMMARIES, DAILY_STATS_V2_MAX_GROUPS, DAILY_STATS_V2_MAX_SELECTORS, DAILY_STATS_V2_SELECTOR_KEYS } from "./daily-stats-constants.js";
import { allowOnly, isPlainObject, validateBoundedText, validateLabelI18n, validateReferenceText, visibleResultPairs } from "./daily-stats-primitives.js";

/**
 * Validates the profile-qualified result summary consumed by newer Apps.
 *
 * Unlike legacy dailyStats.resultKeys, every selector names one exact profile/result pair. Groups
 * and flat summaries are independent namespaces: pairs cannot overlap within either collection,
 * while a flat summary may intentionally reuse a pair already assigned to a group.
 */
export function validateDailyStatsV2(value, profiles) {
  if (value === undefined) return [];
  const errors = [];
  const root = "dailyStatsV2";
  if (!isPlainObject(value)) return [`${root} must be an object`];
  allowOnly(value, DAILY_STATS_V2_KEYS, root, errors);
  if (value.version !== 2) errors.push(`${root}.version must equal 2`);
  if (value.scope !== "all_profiles") {
    errors.push(`${root}.scope must equal all_profiles`);
  }

  const groups = Array.isArray(value.groups) ? value.groups : null;
  const flatSummaries = Array.isArray(value.flatSummaries) ? value.flatSummaries : null;
  if (!groups) errors.push(`${root}.groups must be an array`);
  if (!flatSummaries) errors.push(`${root}.flatSummaries must be an array`);
  if (groups && groups.length === 0) errors.push(`${root}.groups must not be empty`);
  if (groups && groups.length > DAILY_STATS_V2_MAX_GROUPS) {
    errors.push(`${root}.groups must contain at most ${DAILY_STATS_V2_MAX_GROUPS} items`);
  }
  if (flatSummaries && flatSummaries.length > DAILY_STATS_V2_MAX_FLAT_SUMMARIES) {
    errors.push(`${root}.flatSummaries must contain at most ${DAILY_STATS_V2_MAX_FLAT_SUMMARIES} items`);
  }

  const declaredPairs = visibleResultPairs(profiles);
  const itemIds = new Set();
  const assignedGroupPairs = new Map();
  const assignedFlatPairs = new Map();
  const assignedLegacyResultKeys = new Map();

  function validateItem(item, collection, itemIndex) {
    const path = `${root}.${collection}[${itemIndex}]`;
    const isGroup = collection === "groups";
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    allowOnly(item, isGroup ? DAILY_STATS_V2_GROUP_KEYS
      : DAILY_STATS_V2_FLAT_SUMMARY_KEYS, path, errors);
    const id = validateBoundedText(item.id, `${path}.id`,
      DAILY_STATS_MAX_ID_LENGTH, errors);
    if (id) {
      if (itemIds.has(id)) {
        errors.push(`${path}.id must be unique across groups and flatSummaries`);
      }
      itemIds.add(id);
    }
    validateBoundedText(item.label, `${path}.label`,
      DAILY_STATS_MAX_LABEL_LENGTH, errors);
    validateLabelI18n(item.labelI18n, `${path}.labelI18n`, errors);
    if (typeof item.uiColor !== "string"
        || !/^#[0-9A-Fa-f]{6}$/.test(item.uiColor)) {
      errors.push(`${path}.uiColor must be a six-digit #RRGGBB color`);
    }

    const itemSelectorResultKeys = new Set();
    if (!Array.isArray(item.selectors)) {
      errors.push(`${path}.selectors must be an array`);
    } else {
      // A flat summary may be backed entirely by alternate-entry events. The joint
      // validator below requires an exact, non-empty alternate mapping for that id;
      // ABC groups continue to require at least one ordinary profile/result pair.
      if (isGroup && item.selectors.length === 0) {
        errors.push(`${path}.selectors must not be empty`);
      }
      if (item.selectors.length > DAILY_STATS_V2_MAX_SELECTORS) {
        errors.push(`${path}.selectors must contain at most ${DAILY_STATS_V2_MAX_SELECTORS} items`);
      }
      const itemPairs = new Set();
      const assignedPairs = isGroup ? assignedGroupPairs : assignedFlatPairs;
      item.selectors.forEach((selector, selectorIndex) => {
        const selectorPath = `${path}.selectors[${selectorIndex}]`;
        if (!isPlainObject(selector)) {
          errors.push(`${selectorPath} must be an object`);
          return;
        }
        allowOnly(selector, DAILY_STATS_V2_SELECTOR_KEYS, selectorPath, errors);
        const profileId = validateReferenceText(selector.profileId,
          `${selectorPath}.profileId`, errors);
        const resultKey = validateReferenceText(selector.resultKey,
          `${selectorPath}.resultKey`, errors);
        if (!profileId || !resultKey) return;
        itemSelectorResultKeys.add(resultKey);
        const pair = JSON.stringify([profileId, resultKey]);
        if (itemPairs.has(pair)) {
          errors.push(`${selectorPath} pair must be unique within its item`);
        }
        itemPairs.add(pair);
        if (assignedPairs.has(pair) && assignedPairs.get(pair) !== itemIndex) {
          errors.push(`${selectorPath} pair must not appear in more than one ${isGroup ? "group" : "flat summary"}`);
        }
        if (!assignedPairs.has(pair)) assignedPairs.set(pair, itemIndex);
        if (!declaredPairs.has(pair)) {
          errors.push(`${selectorPath} must reference a gradeMap resultKey on the selected pickerVisible profile`);
        }
      });
    }

    if (!isGroup || item.legacyResultKeys === undefined) return;
    if (!Array.isArray(item.legacyResultKeys)) {
      errors.push(`${path}.legacyResultKeys must be an array`);
      return;
    }
    if (item.legacyResultKeys.length === 0) {
      errors.push(`${path}.legacyResultKeys must not be empty`);
    }
    if (item.legacyResultKeys.length > DAILY_STATS_MAX_RESULT_KEYS) {
      errors.push(`${path}.legacyResultKeys must contain at most ${DAILY_STATS_MAX_RESULT_KEYS} items`);
    }
    const itemLegacyResultKeys = new Set();
    item.legacyResultKeys.forEach((rawKey, keyIndex) => {
      const keyPath = `${path}.legacyResultKeys[${keyIndex}]`;
      const key = validateBoundedText(rawKey, keyPath,
        DAILY_STATS_MAX_RESULT_KEY_LENGTH, errors);
      if (!key) return;
      if (!itemSelectorResultKeys.has(key)) {
        errors.push(`${keyPath} must match a resultKey selected by its group`);
      }
      if (itemLegacyResultKeys.has(key)) {
        errors.push(`${keyPath} must be unique within its group`);
      }
      itemLegacyResultKeys.add(key);
      if (assignedLegacyResultKeys.has(key)
          && assignedLegacyResultKeys.get(key) !== itemIndex) {
        errors.push(`${keyPath} must not appear in more than one group`);
      }
      if (!assignedLegacyResultKeys.has(key)) {
        assignedLegacyResultKeys.set(key, itemIndex);
      }
    });
  }

  if (groups) groups.forEach((item, index) => validateItem(item, "groups", index));
  if (flatSummaries) {
    flatSummaries.forEach((item, index) => validateItem(item, "flatSummaries", index));
  }
  return errors;
}
