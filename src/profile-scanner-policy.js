// Scanner policy: bindings, fallbacks, allowed lengths, candidate order, sources, plus
// serial-number plugins and material groups.
import { isPlainObject, requireString, validateI18n } from "./profile-primitives.js";

export function validateSnPlugins(value, errors, rootPath = "snPlugins") {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${rootPath} must be an array`);
    return;
  }
  const keys = new Set();
  value.forEach((plugin, index) => {
    const path = `${rootPath}[${index}]`;
    if (!isPlainObject(plugin)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(plugin.key, `${path}.key`, errors);
    requireString(plugin.field, `${path}.field`, errors);
    requireString(plugin.label, `${path}.label`, errors);
    if (typeof plugin.key === "string" && plugin.key.trim()) {
      const normalizedKey = plugin.key.trim();
      if (plugin.key !== normalizedKey) errors.push(`${path}.key must not have surrounding whitespace`);
      if (keys.has(normalizedKey)) errors.push(`${path}.key must be unique`);
      keys.add(normalizedKey);
    }
    validateI18n(plugin, "labelI18n", `${path}.labelI18n`, errors);
    if (plugin.placeholder !== undefined && typeof plugin.placeholder !== "string") {
      errors.push(`${path}.placeholder must be a string`);
    } else if (typeof plugin.placeholder === "string" && plugin.placeholder.length > 160) {
      errors.push(`${path}.placeholder must contain at most 160 characters`);
    }
    validateI18n(plugin, "placeholderI18n", `${path}.placeholderI18n`, errors);
    if (isPlainObject(plugin.placeholderI18n)) {
      for (const [locale, value] of Object.entries(plugin.placeholderI18n)) {
        if (["en", "es"].includes(locale) && typeof value === "string"
            && value.length > 160) {
          errors.push(`${path}.placeholderI18n.${locale} must contain at most 160 characters`);
        }
      }
    }
    for (const key of ["required", "search", "scan"]) {
      if (plugin[key] !== undefined && typeof plugin[key] !== "boolean") {
        errors.push(`${path}.${key} must be a boolean`);
      }
    }
    const dedicatedScanner = plugin.key === "primary" || plugin.key === "secondary";
    if (!dedicatedScanner && plugin.scan === true) {
      errors.push(`${path}.scan=true is supported only for key=primary or key=secondary`);
    }
    if (!dedicatedScanner && plugin.scanner !== undefined) {
      errors.push(`${path}.scanner is supported only for key=primary or key=secondary`);
    }
    if (plugin.scan === false && ["always", "fallback"].includes(plugin.scanner?.autoTextMode)) {
      errors.push(`${path}.scanner.autoTextMode requires scan=true`);
    }
    validateScannerPolicy(plugin.scanner, `${path}.scanner`, errors);
  });
}

export function validateScannerBindings(profile, errors) {
  if (!Array.isArray(profile.snPlugins)) return;
  for (const role of ["primary", "secondary"]) {
    const index = profile.snPlugins.findIndex((plugin) => plugin?.key === role);
    if (index < 0) continue;
    const plugin = profile.snPlugins[index];
    // scan omitted is the legacy compatibility state. Newly authored profiles and the template
    // converter write an explicit boolean; explicit enablement must never rely on hidden defaults.
    if (plugin.scan !== true) continue;
    if (isPlainObject(plugin.scanner) && Object.keys(plugin.scanner).length > 0) continue;
    if (role === "primary" && isPlainObject(profile.scanner)
        && Object.keys(profile.scanner).length > 0) continue;
    errors.push(`snPlugins[${index}].scanner is required when scan=true`);
  }
}

/**
 * Mirrors the App's primary-scanner fallback merge without mutating the authored profile.
 * A role scanner's explicit expectedLength wins; otherwise legacy expectedSnLength is injected
 * into the effective policy and must satisfy the same bounds and allowedLengths contract.
 */
export function validateEffectivePrimaryScannerFallback(profile, errors) {
  if (!isPlainObject(profile)) return;
  const plugins = Array.isArray(profile.snPlugins) ? profile.snPlugins : [];
  const primaryIndex = plugins.findIndex((plugin) => plugin?.key === "primary");
  const primary = primaryIndex >= 0 ? plugins[primaryIndex] : null;
  let scanner; let path;
  if (primary && primary.scanner !== undefined) {
    if (!isPlainObject(primary.scanner)) return;
    scanner = primary.scanner;
    path = `snPlugins[${primaryIndex}].scanner`;
  } else if (profile.scanner !== undefined) {
    if (!isPlainObject(profile.scanner)) return;
    scanner = profile.scanner;
    path = "scanner";
  } else {
    scanner = {};
    path = "scanner";
  }
  if (Object.prototype.hasOwnProperty.call(scanner, "expectedLength")) return;
  const fallback = profile.expectedSnLength;
  if (!Number.isInteger(fallback) || fallback < 1) return;
  if (fallback > 256) {
    errors.push("expectedSnLength must be at most 256 when used as primary scanner fallback");
    return;
  }
  if (Number.isInteger(scanner.minLength) && fallback < scanner.minLength) {
    errors.push(`expectedSnLength must be at least ${path}.minLength when used as primary scanner fallback`);
  }
  if (Number.isInteger(scanner.maxLength) && fallback > scanner.maxLength) {
    errors.push(`expectedSnLength must be at most ${path}.maxLength when used as primary scanner fallback`);
  }
  if (Array.isArray(scanner.allowedLengths)
      && !scanner.allowedLengths.includes(fallback)) {
    errors.push(`expectedSnLength must be included in ${path}.allowedLengths when used as primary scanner fallback`);
  }
}

export function validateMaterialGroups(value, errors) {
  const allCodes = new Set();
  if (value === undefined) return allCodes;
  if (!Array.isArray(value)) {
    errors.push("materialGroups must be an array");
    return allCodes;
  }
  value.forEach((group, groupIndex) => {
    const path = `materialGroups[${groupIndex}]`;
    if (!isPlainObject(group)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(group.field, `${path}.field`, errors);
    if (!Array.isArray(group.materials)) {
      errors.push(`${path}.materials must be an array`);
      return;
    }
    const codes = new Set();
    group.materials.forEach((material, index) => {
      const itemPath = `${path}.materials[${index}]`;
      if (!isPlainObject(material)) {
        errors.push(`${itemPath} must be an object`);
        return;
      }
      requireString(material.code, `${itemPath}.code`, errors);
      requireString(material.name, `${itemPath}.name`, errors);
      if (typeof material.code === "string" && material.code.trim()) {
        if (codes.has(material.code)) {
          errors.push(`${itemPath}.code must be unique within its group`);
        } else if (allCodes.has(material.code)) {
          errors.push(`${itemPath}.code must be unique across materialGroups`);
        }
        codes.add(material.code);
        allCodes.add(material.code);
      }
      validateI18n(material, "nameI18n", `${itemPath}.nameI18n`, errors);
      if (!Number.isInteger(material.defaultQty) || material.defaultQty <= 0) {
        errors.push(`${itemPath}.defaultQty must be a positive integer`);
      }
    });
  });
  return allCodes;
}

export function validateScannerPolicy(value, path, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const allowedKeys = new Set([
    "expectedLength", "allowedLengths", "preferredPrefixes", "preferredSnPrefixes", "autoTextMode",
    "rejectNumericOnly", "candidateMode", "candidateOrder", "minLength", "maxLength",
    "requireLetterAndDigit", "rejectedSubstrings", "stripLabels", "caseMode",
    "removeWhitespace", "labelMatchMode", "candidateCharacterMode",
    "applyCandidateRulesTo", "applyExpectedLengthTo", "applyAllowedLengthsTo",
    "stripLabelsFrom", "prompt", "promptI18n"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not a supported scanner setting`);
  }
  for (const key of ["expectedLength", "minLength", "maxLength"]) {
    if (value[key] !== undefined
        && (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 256)) {
      errors.push(`${path}.${key} must be an integer from 1 to 256`);
    }
  }
  if (Number.isInteger(value.minLength) && Number.isInteger(value.maxLength)
      && value.minLength > value.maxLength) {
    errors.push(`${path}.maxLength must be at least minLength`);
  }
  if (Number.isInteger(value.expectedLength)
      && Number.isInteger(value.minLength) && value.expectedLength < value.minLength) {
    errors.push(`${path}.expectedLength must be at least minLength`);
  }
  if (Number.isInteger(value.expectedLength)
      && Number.isInteger(value.maxLength) && value.expectedLength > value.maxLength) {
    errors.push(`${path}.expectedLength must be at most maxLength`);
  }
  validateScannerAllowedLengths(value.allowedLengths, `${path}.allowedLengths`, errors);
  if (Array.isArray(value.allowedLengths)) {
    value.allowedLengths.forEach((length, index) => {
      if (!Number.isInteger(length)) return;
      if (Number.isInteger(value.minLength) && length < value.minLength) {
        errors.push(`${path}.allowedLengths[${index}] must be at least minLength`);
      }
      if (Number.isInteger(value.maxLength) && length > value.maxLength) {
        errors.push(`${path}.allowedLengths[${index}] must be at most maxLength`);
      }
    });
  }
  if (Number.isInteger(value.expectedLength) && Array.isArray(value.allowedLengths)
      && !value.allowedLengths.includes(value.expectedLength)) {
    errors.push(`${path}.expectedLength must be included in allowedLengths when both are configured`);
  }
  if (value.autoTextMode !== undefined && !["", "always", "fallback"].includes(value.autoTextMode)) {
    errors.push(`${path}.autoTextMode must be empty, always or fallback`);
  }
  for (const key of ["rejectNumericOnly", "requireLetterAndDigit", "removeWhitespace"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      errors.push(`${path}.${key} must be a boolean`);
    }
  }
  if (value.candidateMode !== undefined && !["ranked", "ordered"].includes(value.candidateMode)) {
    errors.push(`${path}.candidateMode must be ranked or ordered`);
  }
  if (value.caseMode !== undefined && !["upper", "preserve"].includes(value.caseMode)) {
    errors.push(`${path}.caseMode must be upper or preserve`);
  }
  if (value.labelMatchMode !== undefined
      && !["literal", "compact_optional_slash"].includes(value.labelMatchMode)) {
    errors.push(`${path}.labelMatchMode must be literal or compact_optional_slash`);
  }
  if (value.candidateCharacterMode !== undefined
      && !["identifier", "alphanumeric"].includes(value.candidateCharacterMode)) {
    errors.push(`${path}.candidateCharacterMode must be identifier or alphanumeric`);
  }
  if (value.prompt !== undefined && typeof value.prompt !== "string") {
    errors.push(`${path}.prompt must be a string`);
  }
  validateI18n(value, "promptI18n", `${path}.promptI18n`, errors);
  if (value.preferredPrefixes !== undefined && value.preferredSnPrefixes !== undefined) {
    errors.push(`${path} must not define both preferredPrefixes and preferredSnPrefixes`);
  }
  validateScannerStringList(value.preferredPrefixes, `${path}.preferredPrefixes`, errors,
    { identifierCharactersOnly: true });
  validateScannerStringList(value.preferredSnPrefixes, `${path}.preferredSnPrefixes`, errors,
    { identifierCharactersOnly: true });
  validateScannerStringList(value.rejectedSubstrings, `${path}.rejectedSubstrings`, errors);
  validateScannerStringList(value.stripLabels, `${path}.stripLabels`, errors);
  validateScannerCandidateOrder(value.candidateOrder, `${path}.candidateOrder`, errors);
  validateScannerRuleScopes(value.applyCandidateRulesTo,
    `${path}.applyCandidateRulesTo`, errors);
  validateScannerSources(value.applyExpectedLengthTo,
    `${path}.applyExpectedLengthTo`, errors);
  if (Array.isArray(value.applyExpectedLengthTo)
      && value.applyExpectedLengthTo.length === 0) {
    errors.push(`${path}.applyExpectedLengthTo must not be empty`);
  }
  if (value.applyExpectedLengthTo !== undefined
      && !Number.isInteger(value.expectedLength)) {
    errors.push(`${path}.expectedLength is required when applyExpectedLengthTo is configured`);
  }
  validateScannerSources(value.applyAllowedLengthsTo,
    `${path}.applyAllowedLengthsTo`, errors);
  if (Array.isArray(value.applyAllowedLengthsTo)
      && value.applyAllowedLengthsTo.length === 0) {
    errors.push(`${path}.applyAllowedLengthsTo must not be empty`);
  }
  if (value.applyAllowedLengthsTo !== undefined
      && (!Array.isArray(value.allowedLengths) || value.allowedLengths.length === 0)) {
    errors.push(`${path}.allowedLengths is required when applyAllowedLengthsTo is configured`);
  }
  validateScannerSources(value.stripLabelsFrom, `${path}.stripLabelsFrom`, errors);
  if (Array.isArray(value.stripLabelsFrom) && value.stripLabelsFrom.length > 0
      && (!Array.isArray(value.stripLabels)
          || !value.stripLabels.some((label) => typeof label === "string" && label.trim()))) {
    errors.push(`${path}.stripLabels must be non-empty when stripLabelsFrom is non-empty`);
  }
  if (value.candidateMode === "ordered" && !Array.isArray(value.candidateOrder)) {
    errors.push(`${path}.candidateOrder is required when candidateMode=ordered`);
  }
  if (Array.isArray(value.candidateOrder) && value.candidateOrder.includes("label")
      && (!Array.isArray(value.stripLabels) || value.stripLabels.length === 0)) {
    errors.push(`${path}.stripLabels must be non-empty when candidateOrder includes label`);
  }
  const prefixes = value.preferredPrefixes ?? value.preferredSnPrefixes;
  if (value.candidateMode === "ordered" && Array.isArray(value.candidateOrder)
      && value.candidateOrder.includes("prefix")
      && (!Array.isArray(prefixes) || prefixes.length === 0)) {
    errors.push(`${path}.preferredPrefixes must be non-empty when ordered candidateOrder includes prefix`);
  }
  if (value.candidateCharacterMode === "alphanumeric" && Array.isArray(prefixes)) {
    prefixes.forEach((prefix, index) => {
      if (typeof prefix === "string" && !/^[A-Za-z0-9]+$/.test(prefix)) {
        errors.push(`${path}.preferredPrefixes[${index}] must be alphanumeric when candidateCharacterMode=alphanumeric`);
      }
    });
  }
}

function validateScannerStringList(value, path, errors, options = {}) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > 32) errors.push(`${path} must contain at most 32 items`);
  const seen = new Set();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    requireString(item, itemPath, errors);
    if (typeof item !== "string" || !item.trim()) return;
    const token = item.trim();
    if (token.length > 64) errors.push(`${itemPath} must contain at most 64 characters`);
    if (item !== token) errors.push(`${itemPath} must not have surrounding whitespace`);
    if (options.identifierCharactersOnly && !/^[A-Za-z0-9._/-]+$/.test(token)) {
      errors.push(`${itemPath} may contain only letters, digits, dot, underscore, slash or hyphen`);
    }
    const canonical = token.toUpperCase();
    if (seen.has(canonical)) errors.push(`${itemPath} must be unique (case-insensitive)`);
    seen.add(canonical);
  });
}

function validateScannerAllowedLengths(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length === 0) errors.push(`${path} must not be empty`);
  const seen = new Set();
  value.forEach((length, index) => {
    if (!Number.isInteger(length) || length < 1 || length > 256) {
      errors.push(`${path}[${index}] must be an integer from 1 to 256`);
      return;
    }
    if (seen.has(length)) errors.push(`${path}[${index}] must be unique`);
    seen.add(length);
  });
}

function validateScannerCandidateOrder(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length === 0) errors.push(`${path} must not be empty`);
  const seen = new Set();
  value.forEach((source, index) => {
    if (!["label", "prefix", "general"].includes(source)) {
      errors.push(`${path}[${index}] must be one of: label, prefix, general`);
    }
    if (seen.has(source)) errors.push(`${path}[${index}] must be unique`);
    seen.add(source);
  });
}

function validateScannerRuleScopes(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (!value.includes("ocr")) errors.push(`${path} must include ocr`);
  const seen = new Set();
  value.forEach((source, index) => {
    if (!["ocr", "barcode", "entered"].includes(source)) {
      errors.push(`${path}[${index}] must be one of: ocr, barcode, entered`);
    }
    if (seen.has(source)) errors.push(`${path}[${index}] must be unique`);
    seen.add(source);
  });
}

export function validateScannerSources(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  const seen = new Set();
  value.forEach((source, index) => {
    if (!["ocr", "barcode", "entered"].includes(source)) {
      errors.push(`${path}[${index}] must be one of: ocr, barcode, entered`);
    }
    if (seen.has(source)) errors.push(`${path}[${index}] must be unique`);
    seen.add(source);
  });
}

