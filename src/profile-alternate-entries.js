// Alternate entries: shape of the entries themselves, their toggles, retries, providers,
// result presets and overrides.
import { validatePhotoInputSource } from "./profile-previous-step.js";
import { allowOnly, isPlainObject, requireString, validateIntegerRange } from "./profile-primitives.js";
import { validateScannerSources } from "./profile-scanner-policy.js";

const ALTERNATE_ENTRY_KEYS = Object.freeze([
  "id", "title", "titleI18n", "targetProfileId", "identifierRole", "resultKey",
  "photoTargetFields", "joinWith", "minPhotos", "maxPhotos", "uploadNameTemplate",
  "inputSource",
  "scanner", "submissionRetry", "toggles", "flags", "dataOverrides", "dynamicOverrideFields",
  "dynamicOverrideProviders", "resultPresets"
]);

const ALTERNATE_SUBMISSION_RETRY_KEYS = Object.freeze(["maxAttempts", "retryDelayMs"]);

const ALTERNATE_TOGGLE_KEYS = Object.freeze([
  "key", "label", "labelI18n", "default", "retainUntilExit", "dataOverrides"
]);

const ALTERNATE_RESULT_PRESET_KEYS = Object.freeze([
  "defaultKey", "retainUntilExit", "showCodes", "splitLabelsOnPlus", "items"
]);

const ALTERNATE_RESULT_PRESET_ITEM_KEYS = Object.freeze([
  "key", "code", "label", "labelI18n", "uiColor", "resultKey",
  "activeToggleKeys", "dataOverrides"
]);

const ALTERNATE_FLAG_KEYS = Object.freeze(["duplicateCheck", "previousSteps", "printing"]);

const ALTERNATE_DYNAMIC_PROVIDER_KEYS = Object.freeze([
  "id", "triggerToggleKey", "templateId", "expectedStep", "resolverId", "outputField"
]);

export const IDENTITY_OVERRIDE_FIELDS = new Set([
  "template", "identity", "templateId", "warehouseId", "sku",
  "template.id", "template.warehouseId", "template.sku"
]);

export function validateAlternateEntries(profile, value, errors) {
  const root = "workflow.alternateEntries";
  if (value === undefined) {
    // Legacy profiles remain editable. Publishing requires an explicit disabled/enabled decision.
    return;
  }
  if (!isPlainObject(value)) {
    errors.push(`${root} must be an object`);
    return;
  }
  allowOnly(value, ["enabled", "entries"], root, errors);
  if (typeof value.enabled !== "boolean") errors.push(`${root}.enabled must be a boolean`);
  if (!Array.isArray(value.entries)) {
    errors.push(`${root}.entries must be an array`);
    return;
  }
  if (value.entries.length > 16) errors.push(`${root}.entries must contain at most 16 items`);
  if (value.enabled === true && value.entries.length === 0) {
    errors.push(`${root}.entries must be non-empty when enabled=true`);
  }
  if (value.enabled === false && value.entries.length !== 0) {
    errors.push(`${root}.entries must be empty when enabled=false`);
  }
  const entryIds = new Set();
  value.entries.forEach((entry, index) => {
    const path = `${root}.entries[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${path} must be an object`);
      return;
    }
    allowOnly(entry, ALTERNATE_ENTRY_KEYS, path, errors);
    validateTrimmedText(entry.id, `${path}.id`, errors);
    if (typeof entry.id === "string" && entry.id.length > 256) {
      errors.push(`${path}.id must contain at most 256 characters`);
    }
    validateTrimmedText(entry.title, `${path}.title`, errors);
    validateStrictI18n(entry.titleI18n, `${path}.titleI18n`, errors);
    validateTrimmedText(entry.targetProfileId, `${path}.targetProfileId`, errors);
    if (entry.identifierRole !== "primary") {
      errors.push(`${path}.identifierRole must be primary`);
    }
    validateTrimmedText(entry.resultKey, `${path}.resultKey`, errors);
    validateUniqueTrimmedStringArray(entry.photoTargetFields,
      `${path}.photoTargetFields`, errors, { required: true, maxItems: 32 });
    validateTrimmedText(entry.joinWith, `${path}.joinWith`, errors);
    validateIntegerRange(entry.minPhotos, 1, 20,
      `${path}.minPhotos`, errors);
    validateIntegerRange(entry.maxPhotos, 0, 2147483647,
      `${path}.maxPhotos`, errors);
    if (Number.isInteger(entry.minPhotos) && Number.isInteger(entry.maxPhotos)
        && entry.maxPhotos !== 0 && entry.maxPhotos < entry.minPhotos) {
      errors.push(`${path}.maxPhotos must be at least minPhotos`);
    }
    validateUploadNameTemplate(entry.uploadNameTemplate,
      `${path}.uploadNameTemplate`, errors);
    validatePhotoInputSource(entry.inputSource, `${path}.inputSource`, errors);
    const primaryPlugin = Array.isArray(profile.snPlugins)
      ? profile.snPlugins.find((plugin) => plugin?.key === "primary") : undefined;
    const primaryScanner = isPlainObject(primaryPlugin?.scanner)
      ? primaryPlugin.scanner : profile.scanner;
    const expectedLength = primaryScanner?.expectedLength ?? profile.expectedSnLength;
    const allowedLengths = primaryScanner?.allowedLengths;
    const hasExpectedLength = Number.isInteger(expectedLength)
      && expectedLength >= 1 && expectedLength <= 256;
    const hasAllowedLengths = Array.isArray(allowedLengths) && allowedLengths.length > 0;
    validateAlternateEntryScanner(entry.scanner, `${path}.scanner`, errors, {
      hasAllowedLengths
    });
    if (!hasExpectedLength && !hasAllowedLengths) {
      errors.push(`${path}.scanner requires source primary expectedLength or allowedLengths`);
    }
    validateAlternateSubmissionRetry(entry.submissionRetry,
      `${path}.submissionRetry`, errors);
    validateAlternateToggles(entry.toggles, `${path}.toggles`, errors);
    validateAlternateResultPresets(entry, `${path}.resultPresets`, errors);
    validateAlternateFlags(entry.flags, `${path}.flags`, errors);
    validateOverrideObject(entry.dataOverrides, `${path}.dataOverrides`, errors);
    validateUniqueTrimmedStringArray(entry.dynamicOverrideFields,
      `${path}.dynamicOverrideFields`, errors, { maxItems: 32 });
    validateAlternateDynamicProviders(entry, path, errors);
    if (typeof entry.id === "string" && entry.id.trim()) {
      const id = entry.id.trim();
      if (entryIds.has(id)) errors.push(`${path}.id must be unique within its source profile`);
      entryIds.add(id);
    }
  });
}

function validateAlternateSubmissionRetry(value, path, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(value, ALTERNATE_SUBMISSION_RETRY_KEYS, path, errors);
  validateIntegerRange(value.maxAttempts, 1, 10,
    `${path}.maxAttempts`, errors);
  validateIntegerRange(value.retryDelayMs, 0, 60000,
    `${path}.retryDelayMs`, errors);
}

function validateAlternateDynamicProviders(entry, path, errors) {
  const providers = entry.dynamicOverrideProviders;
  if (!Array.isArray(providers)) {
    errors.push(`${path}.dynamicOverrideProviders must be an array`);
    return;
  }
  if (providers.length > 32) {
    errors.push(`${path}.dynamicOverrideProviders must contain at most 32 items`);
  }
  const toggleKeys = new Set((Array.isArray(entry.toggles) ? entry.toggles : [])
    .map((toggle) => typeof toggle?.key === "string" ? toggle.key.trim() : "")
    .filter(Boolean));
  const allowedFields = new Set((Array.isArray(entry.dynamicOverrideFields)
    ? entry.dynamicOverrideFields : [])
    .map((field) => typeof field === "string" ? field.trim() : "")
    .filter(Boolean));
  const staticFields = new Set([
    ...Object.keys(isPlainObject(entry.dataOverrides) ? entry.dataOverrides : {}),
    ...(Array.isArray(entry.toggles) ? entry.toggles : []).flatMap((toggle) =>
      Object.keys(isPlainObject(toggle?.dataOverrides) ? toggle.dataOverrides : {})),
    ...(Array.isArray(entry.resultPresets?.items) ? entry.resultPresets.items : [])
      .flatMap((preset) => Object.keys(
        isPlainObject(preset?.dataOverrides) ? preset.dataOverrides : {}))
  ]);
  const ids = new Set();
  const outputs = new Set();
  providers.forEach((provider, index) => {
    const itemPath = `${path}.dynamicOverrideProviders[${index}]`;
    if (!isPlainObject(provider)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    allowOnly(provider, ALTERNATE_DYNAMIC_PROVIDER_KEYS, itemPath, errors);
    for (const key of ["id", "triggerToggleKey", "resolverId"]) {
      validateSafeAlternateProviderId(provider[key], `${itemPath}.${key}`, errors);
    }
    validateTrimmedText(provider.outputField, `${itemPath}.outputField`, errors);
    for (const key of ["templateId", "expectedStep"]) {
      if (!Number.isSafeInteger(provider[key]) || provider[key] <= 0) {
        errors.push(`${itemPath}.${key} must be a positive safe integer`);
      }
    }
    if (typeof provider.id === "string" && provider.id.trim()) {
      if (ids.has(provider.id)) errors.push(`${itemPath}.id must be unique within its entry`);
      ids.add(provider.id);
    }
    if (typeof provider.triggerToggleKey === "string"
        && !toggleKeys.has(provider.triggerToggleKey)) {
      errors.push(`${itemPath}.triggerToggleKey must reference a toggle in the same entry`);
    }
    if (typeof provider.outputField === "string" && provider.outputField.trim()) {
      const field = provider.outputField.trim();
      if (!allowedFields.has(field)) {
        errors.push(`${itemPath}.outputField must be listed in dynamicOverrideFields`);
      }
      if (outputs.has(field)) errors.push(`${itemPath}.outputField must be unique`);
      if (staticFields.has(field)) {
        errors.push(`${itemPath}.outputField must not overlap static, toggle, or result preset overrides`);
      }
      outputs.add(field);
    }
  });
  for (const field of allowedFields) {
    if (!outputs.has(field)) {
      errors.push(`${path}.dynamicOverrideFields must not contain fields without a provider`);
    }
  }
}

function validateSafeAlternateProviderId(value, path, errors) {
  validateTrimmedText(value, path, errors);
  if (typeof value !== "string" || !value.trim()) return;
  if (value.length > 128 || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)
      || ["__proto__", "prototype", "constructor"].includes(value)) {
    errors.push(`${path} must be a safe bounded identifier`);
  }
}

function validateAlternateEntryScanner(value, path, errors, {
  hasAllowedLengths = false
} = {}) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(value, ["applyExpectedLengthTo", "applyAllowedLengthsTo"], path, errors);
  validateScannerSources(value.applyExpectedLengthTo,
    `${path}.applyExpectedLengthTo`, errors);
  if (!Array.isArray(value.applyExpectedLengthTo)
      || value.applyExpectedLengthTo.length === 0) {
    errors.push(`${path}.applyExpectedLengthTo must not be empty`);
  }
  validateScannerSources(value.applyAllowedLengthsTo,
    `${path}.applyAllowedLengthsTo`, errors);
  if (Array.isArray(value.applyAllowedLengthsTo)
      && value.applyAllowedLengthsTo.length === 0) {
    errors.push(`${path}.applyAllowedLengthsTo must not be empty`);
  }
  if (value.applyAllowedLengthsTo !== undefined && !hasAllowedLengths) {
    errors.push(`${path}.applyAllowedLengthsTo requires source primary allowedLengths`);
  }
}

export function validateUploadNameTemplate(value, path, errors, { requireIndex = true } = {}) {
  validateTrimmedText(value, path, errors);
  if (typeof value !== "string" || !value.trim()) return;
  if (/[\\/":\u0000-\u001f\u007f]/u.test(value)) {
    errors.push(`${path} must not contain path separators, colon, quotes, or control characters`);
  }
  if (!value.includes("{identifier}")) {
    errors.push(`${path} must contain {identifier}`);
  }
  if (requireIndex && !value.includes("{index}")) {
    errors.push(`${path} must contain {index}`);
  }
  const remaining = value
    .replaceAll("{identifier}", "")
    .replaceAll("{index}", "");
  if (remaining.includes("{") || remaining.includes("}")) {
    errors.push(`${path} may only use {identifier} and {index} placeholders`);
  }
}

function validateAlternateToggles(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > 16) errors.push(`${path} must contain at most 16 items`);
  const keys = new Set();
  value.forEach((toggle, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(toggle)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    allowOnly(toggle, ALTERNATE_TOGGLE_KEYS, itemPath, errors);
    validateTrimmedText(toggle.key, `${itemPath}.key`, errors);
    validateTrimmedText(toggle.label, `${itemPath}.label`, errors);
    validateStrictI18n(toggle.labelI18n, `${itemPath}.labelI18n`, errors);
    if (typeof toggle.default !== "boolean") {
      errors.push(`${itemPath}.default must be a boolean`);
    }
    if (typeof toggle.retainUntilExit !== "boolean") {
      errors.push(`${itemPath}.retainUntilExit must be a boolean`);
    }
    validateOverrideObject(toggle.dataOverrides, `${itemPath}.dataOverrides`, errors);
    if (typeof toggle.key === "string" && toggle.key.trim()) {
      const key = toggle.key.trim();
      if (keys.has(key)) errors.push(`${itemPath}.key must be unique within its entry`);
      keys.add(key);
    }
  });
}

function validateAlternateResultPresets(entry, path, errors) {
  const value = entry?.resultPresets;
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(value, ALTERNATE_RESULT_PRESET_KEYS, path, errors);
  validateSafeAlternateProviderId(value.defaultKey, `${path}.defaultKey`, errors);
  if (typeof value.retainUntilExit !== "boolean") {
    errors.push(`${path}.retainUntilExit must be a boolean`);
  }
  if (value.showCodes !== undefined && typeof value.showCodes !== "boolean") {
    errors.push(`${path}.showCodes must be a boolean`);
  }
  if (value.splitLabelsOnPlus !== undefined
      && typeof value.splitLabelsOnPlus !== "boolean") {
    errors.push(`${path}.splitLabelsOnPlus must be a boolean`);
  }
  const showCodes = value.showCodes === undefined ? true : value.showCodes;
  const splitLabelsOnPlus = value.splitLabelsOnPlus === undefined
    ? false : value.splitLabelsOnPlus;
  if (showCodes === true && splitLabelsOnPlus === true) {
    errors.push(`${path} cannot show codes while splitting labels on plus`);
  }
  if (!Array.isArray(value.items)) {
    errors.push(`${path}.items must be an array`);
    return;
  }
  if (value.items.length < 2 || value.items.length > 8) {
    errors.push(`${path}.items must contain from 2 to 8 items`);
  }
  const toggleKeys = new Set((Array.isArray(entry?.toggles) ? entry.toggles : [])
    .map((toggle) => typeof toggle?.key === "string" ? toggle.key.trim() : "")
    .filter(Boolean));
  const presetKeys = new Set();
  const codes = new Set();
  value.items.forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    allowOnly(item, ALTERNATE_RESULT_PRESET_ITEM_KEYS, itemPath, errors);
    validateSafeAlternateProviderId(item.key, `${itemPath}.key`, errors);
    validateTrimmedText(item.code, `${itemPath}.code`, errors);
    if (typeof item.code === "string" && item.code.length > 12) {
      errors.push(`${itemPath}.code must contain at most 12 characters`);
    }
    validateTrimmedText(item.label, `${itemPath}.label`, errors);
    validateStrictI18n(item.labelI18n, `${itemPath}.labelI18n`, errors);
    if (typeof item.uiColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(item.uiColor)) {
      errors.push(`${itemPath}.uiColor must be #RRGGBB`);
    }
    validateTrimmedText(item.resultKey, `${itemPath}.resultKey`, errors);
    validateUniqueTrimmedStringArray(item.activeToggleKeys,
      `${itemPath}.activeToggleKeys`, errors, { maxItems: 16 });
    validateOverrideObject(item.dataOverrides, `${itemPath}.dataOverrides`, errors);
    if (typeof item.key === "string" && item.key.trim()) {
      const key = item.key.trim();
      if (toggleKeys.has(key)) {
        errors.push(`${itemPath}.key must be distinct from toggle keys`);
      }
      if (presetKeys.has(key)) {
        errors.push(`${itemPath}.key must be unique within resultPresets`);
      }
      presetKeys.add(key);
    }
    if (typeof item.code === "string" && item.code.trim()) {
      const code = item.code.trim();
      if (codes.has(code)) errors.push(`${itemPath}.code must be unique within resultPresets`);
      codes.add(code);
    }
    (Array.isArray(item.activeToggleKeys) ? item.activeToggleKeys : [])
      .forEach((key, activeIndex) => {
        if (typeof key === "string" && key.trim() && !toggleKeys.has(key.trim())) {
          errors.push(`${itemPath}.activeToggleKeys[${activeIndex}] must reference a toggle in the same entry`);
        }
      });
  });
  if (typeof value.defaultKey === "string" && value.defaultKey.trim()
      && !presetKeys.has(value.defaultKey.trim())) {
    errors.push(`${path}.defaultKey must reference an item`);
  }
}

function validateAlternateFlags(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(value, ALTERNATE_FLAG_KEYS, path, errors);
  for (const key of ALTERNATE_FLAG_KEYS) {
    if (value[key] !== false) errors.push(`${path}.${key} must be false`);
  }
}

function validateOverrideObject(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const entries = Object.entries(value);
  if (entries.length > 128) errors.push(`${path} must contain at most 128 fields`);
  for (const [field, item] of entries) {
    validateTrimmedText(field, `${path} field`, errors);
    if (["__proto__", "prototype", "constructor"].includes(field)) {
      errors.push(`${path}.${field} is not a safe field name`);
    }
    validateJsonValue(item, `${path}.${field}`, errors, 0, { count: 0 });
  }
}

function validateJsonValue(value, path, errors, depth, state) {
  state.count += 1;
  if (state.count > 2048) {
    if (state.count === 2049) errors.push(`${path} exceeds the JSON value size limit`);
    return;
  }
  if (depth > 16) {
    errors.push(`${path} exceeds the JSON value depth limit`);
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} must be a finite JSON number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, errors,
      depth + 1, state));
    return;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, item]) => validateJsonValue(item,
      `${path}.${key}`, errors, depth + 1, state));
    return;
  }
  errors.push(`${path} must be JSON-compatible`);
}

function validateTrimmedText(value, path, errors) {
  requireString(value, path, errors);
  if (typeof value === "string" && value.trim() && value !== value.trim()) {
    errors.push(`${path} must not have surrounding whitespace`);
  }
}

function validateStrictI18n(value, path, errors) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object with en/es string values`);
    return;
  }
  allowOnly(value, ["en", "es"], path, errors);
  for (const [locale, text] of Object.entries(value)) {
    if (!["en", "es"].includes(locale)) continue;
    validateTrimmedText(text, `${path}.${locale}`, errors);
  }
}

function validateUniqueTrimmedStringArray(value, path, errors,
                                          { required = false, maxItems = 128 } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (required && value.length === 0) errors.push(`${path} must not be empty`);
  if (value.length > maxItems) errors.push(`${path} must contain at most ${maxItems} items`);
  const seen = new Set();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    validateTrimmedText(item, itemPath, errors);
    if (typeof item === "string" && item.trim()) {
      const key = item.trim();
      if (seen.has(key)) errors.push(`${itemPath} must be unique`);
      seen.add(key);
    }
  });
}

