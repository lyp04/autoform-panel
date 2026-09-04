// The original legacy result-key groups.
import { DAILY_STATS_GROUP_KEYS, DAILY_STATS_KEYS, DAILY_STATS_MAX_GROUPS, DAILY_STATS_MAX_ID_LENGTH, DAILY_STATS_MAX_LABEL_LENGTH, DAILY_STATS_MAX_RESULT_KEYS, DAILY_STATS_MAX_RESULT_KEY_LENGTH } from "./daily-stats-constants.js";
import { allowOnly, isPlainObject, validateBoundedText, validateLabelI18n, visibleResultKeys } from "./daily-stats-primitives.js";

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
