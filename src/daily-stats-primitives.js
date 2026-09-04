// Shared checks: bounded text, labels, and the visible result keys a group may reference.
import { DAILY_STATS_MAX_LABEL_LENGTH, DAILY_STATS_MAX_RESULT_KEY_LENGTH } from "./daily-stats-constants.js";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function allowOnly(value, allowed, path, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is unsupported`);
  }
}

export function validateBoundedText(value, path, maxLength, errors) {
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

export function validateLabelI18n(value, path, errors) {
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

export function visibleResultKeys(profiles) {
  const declared = new Set();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (profile?.pickerVisible !== true || !isPlainObject(profile?.gradeMap)) continue;
    for (const key of Object.keys(profile.gradeMap)) declared.add(key);
  }
  return declared;
}

export function visibleResultPairs(profiles) {
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

export function uniqueDailyStatsV2ItemIds(dailyStatsV2, collection) {
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
export function uniqueEnabledAlternateEntryPairs(profiles) {
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

export function validateReferenceText(value, path, errors) {
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
