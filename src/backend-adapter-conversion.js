// Template import: field kinds and the result mappings a template converts into.
import { CANONICAL_FIELD_KINDS } from "./backend-adapter-constants.js";
import { allowOnly, validateOptionalOperatorLabel, validateOptionalOperatorLabelI18n } from "./backend-adapter-outcome-policy.js";
import { addBusinessValueArray, addRequiredString, addStringArray, isPlainObject } from "./backend-adapter-primitives.js";

export function validateConversion(conversion, errors) {
  if (!isPlainObject(conversion)) {
    errors.push("conversion must be an object");
    return;
  }
  allowOnly(errors, conversion, ["fieldKinds", "result"], "conversion");
  if (!isPlainObject(conversion.fieldKinds)) {
    errors.push("conversion.fieldKinds must be an object");
  } else {
    allowOnly(errors, conversion.fieldKinds, CANONICAL_FIELD_KINDS, "conversion.fieldKinds");
    for (const kind of CANONICAL_FIELD_KINDS) {
      addBusinessValueArray(errors, conversion.fieldKinds[kind], `conversion.fieldKinds.${kind}`, { allowEmpty: true });
    }
  }
  const result = conversion.result;
  if (!isPlainObject(result)) {
    errors.push("conversion.result must be an object");
    return;
  }
  allowOnly(errors, result, ["includeUnmapped", "mappings"], "conversion.result");
  if (typeof result.includeUnmapped !== "boolean") {
    errors.push("conversion.result.includeUnmapped must be a boolean");
  }
  if (!Array.isArray(result.mappings)) {
    errors.push("conversion.result.mappings must be an array");
    return;
  }
  const keys = new Set();
  result.mappings.forEach((mapping, index) => {
    const path = `conversion.result.mappings[${index}]`;
    if (!isPlainObject(mapping)) {
      errors.push(`${path} must be an object`);
      return;
    }
    allowOnly(errors, mapping,
      ["key", "label", "labelI18n", "operatorLabel", "operatorLabelI18n", "uiColor",
        "include", "submitValue", "matchValues", "matchLabelPatterns"], path);
    addRequiredString(errors, mapping.key, `${path}.key`);
    if (typeof mapping.key === "string" && mapping.key.trim()) {
      if (keys.has(mapping.key)) errors.push(`${path}.key must be unique`);
      keys.add(mapping.key);
    }
    if (mapping.label !== undefined && typeof mapping.label !== "string") {
      errors.push(`${path}.label must be a string`);
    }
    if (mapping.labelI18n !== undefined) {
      if (!isPlainObject(mapping.labelI18n)) errors.push(`${path}.labelI18n must be an object`);
      else for (const [language, value] of Object.entries(mapping.labelI18n)) {
        if (!["en", "es"].includes(language) || typeof value !== "string") {
          errors.push(`${path}.labelI18n must contain only en/es strings`);
          break;
        }
      }
    }
    validateOptionalOperatorLabel(errors, mapping.operatorLabel,
      `${path}.operatorLabel`);
    validateOptionalOperatorLabelI18n(errors, mapping.operatorLabelI18n,
      `${path}.operatorLabelI18n`);
    if (mapping.uiColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(mapping.uiColor))) {
      errors.push(`${path}.uiColor must be a six-digit hex color`);
    }
    if (mapping.include !== undefined && typeof mapping.include !== "boolean") {
      errors.push(`${path}.include must be a boolean`);
    }
    // submitValue is deliberately allowed to be any JSON value. It is deployment data copied
    // verbatim into the generated profile, so the public converter never invents a payload shape.
    addBusinessValueArray(errors, mapping.matchValues, `${path}.matchValues`, { allowEmpty: true });
    addStringArray(errors, mapping.matchLabelPatterns, `${path}.matchLabelPatterns`, { allowEmpty: true });
    (Array.isArray(mapping.matchLabelPatterns) ? mapping.matchLabelPatterns : []).forEach((pattern, patternIndex) => {
      try {
        new RegExp(pattern, "i");
      } catch {
        errors.push(`${path}.matchLabelPatterns[${patternIndex}] must be a valid regular expression`);
      }
    });
  });
}

