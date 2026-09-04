// Identifier correction, scan prechecks and photo slots.
import { isPlainObject, requireString, validateI18n, validateIntegerRange, validateOneOf } from "./profile-primitives.js";
import { PHOTO_INPUT_SOURCES } from "./profile-shape.js";
import { validateStringArrayIfPresent } from "./profile-workflow-templates.js";

export function validateIdentifierCorrection(value, errors) {
  if (value === undefined) return;
  const path = "workflow.previousSteps.identifierCorrection";
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof value.enabled !== "boolean") {
    errors.push(`${path}.enabled must be a boolean`);
  }
  validateOneOf(value.applyAction, ["auto", "confirm", "block"],
    `${path}.applyAction`, errors);
  validateStringArrayIfPresent(value.resultKeys, `${path}.resultKeys`, errors);
  if (!Array.isArray(value.substitutions)) {
    errors.push(`${path}.substitutions must be an array`);
    return;
  }
  if (value.substitutions.length > 8) {
    errors.push(`${path}.substitutions must contain at most 8 items`);
  }
  const fromValues = new Set();
  value.substitutions.forEach((item, index) => {
    const itemPath = `${path}.substitutions[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    for (const key of ["from", "to"]) {
      const candidate = item[key];
      if (typeof candidate !== "string" || candidate.trim() === ""
          || [...candidate].length !== 1) {
        errors.push(`${itemPath}.${key} must be exactly one non-whitespace character`);
      }
    }
    if (typeof item.from === "string" && item.from.trim() !== ""
        && [...item.from].length === 1) {
      if (fromValues.has(item.from)) {
        errors.push(`${itemPath}.from must be unique`);
      }
      fromValues.add(item.from);
    }
  });
}

export function validateScanPrecheckPolicy(value, errors) {
  if (value === undefined) return;
  const path = "workflow.previousSteps.scanPrecheckPolicy";
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateIntegerRange(value.maxMissingAttempts, 1, 10,
    `${path}.maxMissingAttempts`, errors);
  validateOneOf(value.beforeLimitAction, ["remove", "block"],
    `${path}.beforeLimitAction`, errors);
  validateOneOf(value.atLimitAction, ["require_artifact", "block"],
    `${path}.atLimitAction`, errors);
}

export function validatePhotoSlots(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((slot, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(slot)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    requireString(slot.field, `${itemPath}.field`, errors);
    requireString(slot.title, `${itemPath}.title`, errors);
    validateI18n(slot, "titleI18n", `${itemPath}.titleI18n`, errors);
    if (!Number.isInteger(slot.minPhotos) || slot.minPhotos < 0) {
      errors.push(`${itemPath}.minPhotos must be a non-negative integer`);
    }
    if (!Number.isInteger(slot.maxPhotos) || slot.maxPhotos < 1) {
      errors.push(`${itemPath}.maxPhotos must be a positive integer`);
    } else if (Number.isInteger(slot.minPhotos) && slot.maxPhotos < slot.minPhotos) {
      errors.push(`${itemPath}.maxPhotos must be at least minPhotos`);
    }
    for (const key of ["required", "conditional"]) {
      if (slot[key] !== undefined && typeof slot[key] !== "boolean") {
        errors.push(`${itemPath}.${key} must be a boolean`);
      }
    }
    validatePhotoInputSource(slot.inputSource, `${itemPath}.inputSource`, errors);
  });
}

export function validatePhotoInputSource(value, path, errors) {
  if (value === undefined) return;
  if (typeof value !== "string" || !PHOTO_INPUT_SOURCES.includes(value)) {
    errors.push(`${path} must be camera, gallery, or file`);
  }
}

