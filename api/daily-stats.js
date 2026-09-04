const DAILY_STATS_KEYS = new Set(["scope", "groups"]);
const DAILY_STATS_GROUP_KEYS = new Set([
  "id", "label", "labelI18n", "uiColor", "resultKeys"
]);
const DAILY_STATS_V2_KEYS = new Set([
  "version", "scope", "groups", "flatSummaries"
]);
const DAILY_STATS_V2_GROUP_KEYS = new Set([
  "id", "label", "labelI18n", "uiColor", "selectors", "legacyResultKeys"
]);
const DAILY_STATS_V2_FLAT_SUMMARY_KEYS = new Set([
  "id", "label", "labelI18n", "uiColor", "selectors"
]);
const DAILY_STATS_V2_SELECTOR_KEYS = new Set(["profileId", "resultKey"]);
const DAILY_STATS_ALTERNATE_ENTRIES_KEYS = new Set([
  "version", "scope", "groups", "flatSummaries"
]);
const DAILY_STATS_ALTERNATE_ENTRY_ITEM_KEYS = new Set(["id", "selectors"]);
const DAILY_STATS_ALTERNATE_ENTRY_SELECTOR_KEYS = new Set(["profileId", "entryId"]);

export const DAILY_STATS_MAX_GROUPS = 16;
export const DAILY_STATS_MAX_RESULT_KEYS = 128;
export const DAILY_STATS_MAX_ID_LENGTH = 128;
export const DAILY_STATS_MAX_LABEL_LENGTH = 160;
export const DAILY_STATS_MAX_RESULT_KEY_LENGTH = 256;
export const DAILY_STATS_V2_MAX_GROUPS = 16;
export const DAILY_STATS_V2_MAX_FLAT_SUMMARIES = 8;
export const DAILY_STATS_V2_MAX_SELECTORS = 512;
export const DAILY_STATS_ALTERNATE_ENTRIES_VERSION = 1;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function allowOnly(value, allowed, path, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is unsupported`);
  }
}

function validateBoundedText(value, path, maxLength, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`);
    return "";
  }
  if (value !== value.trim()) errors.push(`${path} must not have surrounding whitespace`);
  if (value.length > maxLength) {
    errors.push(`${path} must contain at most ${maxLength} characters`);
  }
  return value.trim();
}

function validateLabelI18n(value, path, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const allowed = new Set(["en", "es"]);
  allowOnly(value, allowed, path, errors);
  for (const locale of ["en", "es"]) {
    if (Object.prototype.hasOwnProperty.call(value, locale)) {
      validateBoundedText(value[locale], `${path}.${locale}`,
        DAILY_STATS_MAX_LABEL_LENGTH, errors);
    }
  }
}

function visibleResultKeys(profiles) {
  const declared = new Set();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (profile?.pickerVisible !== true || !isPlainObject(profile?.gradeMap)) continue;
    for (const key of Object.keys(profile.gradeMap)) declared.add(key);
  }
  return declared;
}

function visibleResultPairs(profiles) {
  const declared = new Set();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (profile?.pickerVisible !== true || !isPlainObject(profile?.gradeMap)
        || typeof profile?.id !== "string") continue;
    for (const resultKey of Object.keys(profile.gradeMap)) {
      declared.add(JSON.stringify([profile.id, resultKey]));
    }
  }
  return declared;
}

function uniqueDailyStatsV2ItemIds(dailyStatsV2, collection) {
  const counts = new Map();
  const items = isPlainObject(dailyStatsV2) && Array.isArray(dailyStatsV2[collection])
    ? dailyStatsV2[collection] : [];
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id : "";
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return new Set([...counts.entries()]
    .filter(([, count]) => count === 1)
    .map(([id]) => id));
}

/** Exact picker-visible source/entry pairs which are unambiguous in the effective catalog. */
function uniqueEnabledAlternateEntryPairs(profiles) {
  const profileCounts = new Map();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const profileId = typeof profile?.id === "string" ? profile.id : "";
    if (profileId) profileCounts.set(profileId, (profileCounts.get(profileId) || 0) + 1);
  }

  const pairCounts = new Map();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const profileId = typeof profile?.id === "string" ? profile.id : "";
    if (!profileId || profileCounts.get(profileId) !== 1 || profile?.pickerVisible !== true) {
      continue;
    }
    const alternateEntries = profile?.workflow?.alternateEntries;
    if (!isPlainObject(alternateEntries) || alternateEntries.enabled !== true
        || !Array.isArray(alternateEntries.entries)) {
      continue;
    }
    for (const entry of alternateEntries.entries) {
      const entryId = typeof entry?.id === "string" ? entry.id : "";
      if (!entryId) continue;
      const pair = JSON.stringify([profileId, entryId]);
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }
  }
  return new Set([...pairCounts.entries()]
    .filter(([, count]) => count === 1)
    .map(([pair]) => pair));
}

function validateReferenceText(value, path, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`);
    return "";
  }
  if (value !== value.trim()) errors.push(`${path} must not have surrounding whitespace`);
  if (value.length > DAILY_STATS_MAX_RESULT_KEY_LENGTH) {
    errors.push(`${path} must contain at most ${DAILY_STATS_MAX_RESULT_KEY_LENGTH} characters`);
  }
  return value.trim();
}

/**
 * Validates the optional App-facing catalog-wide result summary.
 *
 * Result keys stay opaque: a group includes only the exact keys explicitly selected by the Panel,
 * and every selected key must exist on at least one explicitly picker-visible profile. This keeps
 * the App from inferring a cross-profile business meaning from labels, values, or profile order.
 */
export function validateDailyStats(value, profiles) {
  if (value === undefined) return [];
  const errors = [];
  const root = "dailyStats";
  if (!isPlainObject(value)) return [`${root} must be an object`];
  allowOnly(value, DAILY_STATS_KEYS, root, errors);
  if (value.scope !== "all_profiles") {
    errors.push(`${root}.scope must equal all_profiles`);
  }
  if (!Array.isArray(value.groups)) {
    errors.push(`${root}.groups must be an array`);
    return errors;
  }
  if (value.groups.length === 0) errors.push(`${root}.groups must not be empty`);
  if (value.groups.length > DAILY_STATS_MAX_GROUPS) {
    errors.push(`${root}.groups must contain at most ${DAILY_STATS_MAX_GROUPS} items`);
  }

  const declared = visibleResultKeys(profiles);
  const ids = new Set();
  const assignedResultKeys = new Map();
  value.groups.forEach((group, groupIndex) => {
    const path = `${root}.groups[${groupIndex}]`;
    if (!isPlainObject(group)) {
      errors.push(`${path} must be an object`);
      return;
    }
    allowOnly(group, DAILY_STATS_GROUP_KEYS, path, errors);
    const id = validateBoundedText(group.id, `${path}.id`,
      DAILY_STATS_MAX_ID_LENGTH, errors);
    if (id) {
      if (ids.has(id)) errors.push(`${path}.id must be unique`);
      ids.add(id);
    }
    validateBoundedText(group.label, `${path}.label`,
      DAILY_STATS_MAX_LABEL_LENGTH, errors);
    validateLabelI18n(group.labelI18n, `${path}.labelI18n`, errors);
    if (typeof group.uiColor !== "string"
        || !/^#[0-9A-Fa-f]{6}$/.test(group.uiColor)) {
      errors.push(`${path}.uiColor must be a six-digit #RRGGBB color`);
    }
    if (!Array.isArray(group.resultKeys)) {
      errors.push(`${path}.resultKeys must be an array`);
      return;
    }
    if (group.resultKeys.length === 0) {
      errors.push(`${path}.resultKeys must not be empty`);
    }
    if (group.resultKeys.length > DAILY_STATS_MAX_RESULT_KEYS) {
      errors.push(`${path}.resultKeys must contain at most ${DAILY_STATS_MAX_RESULT_KEYS} items`);
    }
    const groupResultKeys = new Set();
    group.resultKeys.forEach((rawKey, keyIndex) => {
      const keyPath = `${path}.resultKeys[${keyIndex}]`;
      const key = validateBoundedText(rawKey, keyPath,
        DAILY_STATS_MAX_RESULT_KEY_LENGTH, errors);
      if (!key) return;
      if (groupResultKeys.has(key)) errors.push(`${keyPath} must be unique within its group`);
      groupResultKeys.add(key);
      if (assignedResultKeys.has(key) && assignedResultKeys.get(key) !== groupIndex) {
        errors.push(`${keyPath} must not appear in more than one group`);
      }
      if (!assignedResultKeys.has(key)) assignedResultKeys.set(key, groupIndex);
      if (!declared.has(key)) {
        errors.push(`${keyPath} must be declared by at least one pickerVisible profile gradeMap`);
      }
    });
  });
  return errors;
}

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
