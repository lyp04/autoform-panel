// Preserving runtime configuration across an edit, and the value comparison it needs.
import { isPlainObject } from "./profile-primitives.js";

export function jsonValuesEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => jsonValuesEqual(item, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && jsonValuesEqual(left[key], right[key]));
  }
  return false;
}

const WHOLE_PROFILE_DISPLAY_FIELDS = Object.freeze(["displayName", "searchText"]);

function cloneProfileValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Whole-profile AI edits and template refreshes are untrusted replacements, not patches. Start from
 * a deep copy of every current top-level field (including extensions this Panel does not know yet),
 * then accept only the explicitly display-only fields below. Runtime, submission, metadata and
 * unknown fields remain editable through the structured editor or advanced JSON, never this path.
 */
export function preserveRuntimeProfileConfig(next, current) {
  if (!isPlainObject(next) || !isPlainObject(current)) return next;
  const preserved = {};
  for (const [key, value] of Object.entries(current)) {
    preserved[key] = cloneProfileValue(value);
  }

  for (const key of WHOLE_PROFILE_DISPLAY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      preserved[key] = cloneProfileValue(next[key]);
    }
  }
  return preserved;
}

