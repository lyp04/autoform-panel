// Alternate entries: publish-time resolution of references between entries, their targets
// and the fields they declare.
import { IDENTITY_OVERRIDE_FIELDS } from "./profile-alternate-entries.js";
import { isPlainObject } from "./profile-primitives.js";

/**
 * Validate alternate-entry references that cannot be checked from one profile in isolation.
 * The returned indexes refer to `profiles`; `catalogProfiles` may be the final merged catalog when
 * the Panel publishes a single source profile.
 */
export function validateAlternateEntryReferences(profiles, catalogProfiles = profiles) {
  const sources = Array.isArray(profiles) ? profiles : [];
  const catalog = Array.isArray(catalogProfiles) ? catalogProfiles : [];
  const targetIndexes = new Map();
  catalog.forEach((profile, index) => {
    const id = typeof profile?.id === "string" ? profile.id.trim() : "";
    if (!id) return;
    if (!targetIndexes.has(id)) targetIndexes.set(id, []);
    targetIndexes.get(id).push({ profile, index });
  });
  const problems = [];
  sources.forEach((source, sourceIndex) => {
    const entries = source?.workflow?.alternateEntries?.entries;
    if (!Array.isArray(entries)) return;
    const errors = [];
    const sourceId = typeof source?.id === "string" ? source.id.trim() : "";
    entries.forEach((entry, entryIndex) => {
      if (!isPlainObject(entry)) return;
      const path = `workflow.alternateEntries.entries[${entryIndex}]`;
      const targetId = typeof entry.targetProfileId === "string"
        ? entry.targetProfileId.trim() : "";
      if (!targetId) return;
      if (sourceId && sourceId === targetId) {
        errors.push(`${path}.targetProfileId must differ from the source profile id`);
        return;
      }
      const matches = targetIndexes.get(targetId) || [];
      if (matches.length !== 1) {
        errors.push(matches.length === 0
          ? `${path}.targetProfileId must reference exactly one catalog profile`
          : `${path}.targetProfileId references a non-unique catalog profile id`);
        return;
      }
      validateAlternateEntryTarget(entry, matches[0].profile, path, errors);
    });
    if (errors.length) problems.push({ index: sourceIndex, id: source?.id, errors });
  });
  return problems;
}

function validateAlternateEntryTarget(entry, target, path, errors) {
  if (target?.pickerVisible !== false) {
    errors.push(`${path}.targetProfileId must reference a profile with pickerVisible=false`);
  }
  if (!isPlainObject(target?.template)) {
    errors.push(`${path}.targetProfileId target template must be an object`);
  } else {
    for (const key of ["id", "warehouseId"]) {
      if (!Number.isSafeInteger(target.template[key]) || target.template[key] <= 0) {
        errors.push(`${path}.targetProfileId target template.${key} must be a positive integer`);
      }
    }
    if (typeof target.template.sku !== "string" || !target.template.sku.trim()) {
      errors.push(`${path}.targetProfileId target template.sku is required`);
    }
  }
  const serialField = typeof target?.snFields?.primary === "string"
    ? target.snFields.primary.trim() : "";
  if (!serialField) {
    errors.push(`${path}.targetProfileId target snFields.primary is required`);
  }

  const knownFields = declaredAlternateTargetFields(target, path, errors);
  const resultKey = typeof entry.resultKey === "string" ? entry.resultKey.trim() : "";
  const result = alternateTargetResult(target, resultKey);
  if (!isPlainObject(result)) {
    errors.push(`${path}.resultKey must reference the target profile gradeMap`);
  } else {
    const resultField = typeof result.field === "string" ? result.field.trim() : "";
    if (!resultField) errors.push(`${path}.resultKey target field is required`);
    if (!Object.prototype.hasOwnProperty.call(result, "value")) {
      errors.push(`${path}.resultKey target value is required`);
    }
  }
  const canonicalResultField = typeof result?.field === "string"
    ? result.field.trim() : "";
  (Array.isArray(entry.resultPresets?.items) ? entry.resultPresets.items : [])
    .forEach((preset, index) => {
      const presetPath = `${path}.resultPresets.items[${index}]`;
      const presetKey = typeof preset?.resultKey === "string"
        ? preset.resultKey.trim() : "";
      const presetResult = alternateTargetResult(target, presetKey);
      if (!isPlainObject(presetResult)) {
        errors.push(`${presetPath}.resultKey must reference the target profile gradeMap`);
        return;
      }
      const presetField = typeof presetResult.field === "string"
        ? presetResult.field.trim() : "";
      if (!presetField) {
        errors.push(`${presetPath}.resultKey target field is required`);
      } else if (canonicalResultField && presetField !== canonicalResultField) {
        errors.push(`${presetPath}.resultKey must use the canonical result field`);
      }
      if (!Object.prototype.hasOwnProperty.call(presetResult, "value")) {
        errors.push(`${presetPath}.resultKey target value is required`);
      }
    });

  const photoFields = declaredAlternatePhotoFields(target, path, errors);
  (Array.isArray(entry.photoTargetFields) ? entry.photoTargetFields : [])
    .forEach((field, index) => {
      if (typeof field === "string" && field.trim() && !photoFields.has(field.trim())) {
        errors.push(`${path}.photoTargetFields[${index}] must reference a target profile photo field`);
      }
    });

  validateAlternateBaseFieldConflicts(entry, target, serialField, path, errors);
  const overrideOwners = new Map();
  validateAlternateOverrideReferences(entry.dataOverrides, `${path}.dataOverrides`,
    knownFields, serialField, overrideOwners, errors);
  (Array.isArray(entry.toggles) ? entry.toggles : []).forEach((toggle, index) => {
    validateAlternateOverrideReferences(toggle?.dataOverrides,
      `${path}.toggles[${index}].dataOverrides`, knownFields, serialField,
      overrideOwners, errors);
  });
  const dynamicOverrideOwners = new Map(overrideOwners);
  (Array.isArray(entry.resultPresets?.items) ? entry.resultPresets.items : [])
    .forEach((preset, index) => {
      const presetPath = `${path}.resultPresets.items[${index}].dataOverrides`;
      const presetOwners = new Map(overrideOwners);
      validateAlternateOverrideReferences(preset?.dataOverrides,
        presetPath, knownFields, serialField, presetOwners, errors);
      if (isPlainObject(preset?.dataOverrides)) {
        Object.keys(preset.dataOverrides).forEach((field) => {
          if (!dynamicOverrideOwners.has(field)) dynamicOverrideOwners.set(field, presetPath);
        });
      }
    });
  validateAlternateDynamicOverrideReferences(entry, target, path, knownFields,
    dynamicOverrideOwners, errors);
}

function validateAlternateDynamicOverrideReferences(entry, target, path, knownFields,
                                                    overrideOwners, errors) {
  const protectedFields = new Set();
  if (isPlainObject(target?.snFields)) {
    Object.values(target.snFields).forEach((field) => {
      if (typeof field === "string" && field.trim()) protectedFields.add(field.trim());
    });
  }
  if (isPlainObject(target?.gradeMap)) {
    Object.values(target.gradeMap).forEach((grade) => {
      if (typeof grade?.field === "string" && grade.field.trim()) {
        protectedFields.add(grade.field.trim());
      }
    });
  }
  for (const key of ["uploadFields", "photoSlots", "optionalSlots"]) {
    (Array.isArray(target?.[key]) ? target[key] : []).forEach((item) => {
      if (typeof item?.field === "string" && item.field.trim()) {
        protectedFields.add(item.field.trim());
      }
    });
  }
  (Array.isArray(entry.dynamicOverrideFields) ? entry.dynamicOverrideFields : [])
    .forEach((rawField, index) => {
      if (typeof rawField !== "string" || !rawField.trim()) return;
      const field = rawField.trim();
      const fieldPath = `${path}.dynamicOverrideFields[${index}]`;
      if (IDENTITY_OVERRIDE_FIELDS.has(field)) {
        errors.push(`${fieldPath} must not override target template identity`);
      } else if (!knownFields.has(field)) {
        errors.push(`${fieldPath} must reference a field declared by the target profile`);
      } else if (protectedFields.has(field)) {
        errors.push(`${fieldPath} must not override serial, result, or photo data`);
      }
      if (overrideOwners.has(field)) {
        errors.push(`${fieldPath} duplicates override ownership from ${overrideOwners.get(field)}`);
      } else {
        overrideOwners.set(field, fieldPath);
      }
    });
  (Array.isArray(entry.dynamicOverrideProviders) ? entry.dynamicOverrideProviders : [])
    .forEach((provider, index) => {
      if (!isPlainObject(provider) || !isPlainObject(target?.template)) return;
      if (Number.isSafeInteger(provider.templateId)
          && Number.isSafeInteger(target.template.id)
          && provider.templateId !== target.template.id) {
        errors.push(`${path}.dynamicOverrideProviders[${index}].templateId must match the target template.id`);
      }
    });
}

function declaredAlternateTargetFields(profile, entryPath, errors) {
  const fields = new Set();
  if (!isPlainObject(profile?.snFields)) {
    errors.push(`${entryPath}.targetProfileId target snFields must be an object`);
  } else {
    Object.values(profile.snFields).forEach((field) => {
      if (typeof field === "string" && field.trim()) fields.add(field.trim());
    });
  }
  if (!isPlainObject(profile?.gradeMap)) {
    errors.push(`${entryPath}.targetProfileId target gradeMap must be an object`);
  } else {
    Object.entries(profile.gradeMap).forEach(([key, item]) => {
      if (!isPlainObject(item)) {
        errors.push(`${entryPath}.targetProfileId target gradeMap.${key} must be an object`);
      } else if (typeof item.field !== "string" || !item.field.trim()) {
        errors.push(`${entryPath}.targetProfileId target gradeMap.${key}.field is required`);
      } else {
        fields.add(item.field.trim());
      }
    });
  }
  for (const key of [
    "snPlugins", "snPluginsHidden", "uploadFields", "photoSlots", "optionalSlots",
    "conditionalFields", "operationFields", "choiceFields", "materialGroups"
  ]) {
    if (profile?.[key] === undefined || profile[key] === null) continue;
    if (!Array.isArray(profile[key])) {
      errors.push(`${entryPath}.targetProfileId target ${key} must be an array`);
      continue;
    }
    profile[key].forEach((item, index) => {
      if (!isPlainObject(item)) {
        errors.push(`${entryPath}.targetProfileId target ${key}[${index}] must be an object`);
      } else if (typeof item.field !== "string" || !item.field.trim()) {
        errors.push(`${entryPath}.targetProfileId target ${key}[${index}].field is required`);
      } else {
        fields.add(item.field.trim());
      }
    });
  }
  return fields;
}

function declaredAlternatePhotoFields(profile, entryPath, errors) {
  const fields = new Set();
  for (const key of ["uploadFields", "photoSlots", "optionalSlots"]) {
    (Array.isArray(profile?.[key]) ? profile[key] : []).forEach((item, index) => {
      const field = typeof item?.field === "string" ? item.field.trim() : "";
      if (!field) return;
      if (fields.has(field)) {
        errors.push(`${entryPath}.targetProfileId target photo field ${JSON.stringify(field)} is duplicated`);
      }
      fields.add(field);
    });
  }
  return fields;
}

function validateAlternateBaseFieldConflicts(entry, target, serialField, path, errors) {
  const owners = new Map();
  const register = (field, owner) => {
    const value = typeof field === "string" ? field.trim() : "";
    if (!value) return;
    if (owners.has(value)) {
      errors.push(`${path} target field ${JSON.stringify(value)} conflicts between ${owners.get(value)} and ${owner}`);
    } else {
      owners.set(value, owner);
    }
  };
  register(serialField, "serial");
  const resultKey = typeof entry.resultKey === "string" ? entry.resultKey.trim() : "";
  register(alternateTargetResult(target, resultKey)?.field, "result");
  (Array.isArray(target?.operationFields) ? target.operationFields : [])
    .forEach((item, index) => {
      register(item?.field, `operationFields[${index}]`);
      if (isPlainObject(item) && !Object.prototype.hasOwnProperty.call(item, "value")) {
        errors.push(`${path}.targetProfileId target operationFields[${index}].value is required`);
      }
    });
  (Array.isArray(target?.choiceFields) ? target.choiceFields : [])
    .forEach((item, index) => {
      if (item?.visible !== false) {
        register(item?.field, `choiceFields[${index}]`);
        if (isPlainObject(item) && !Object.prototype.hasOwnProperty.call(item, "value")) {
          errors.push(`${path}.targetProfileId target choiceFields[${index}].value is required`);
        }
      }
    });
  (Array.isArray(entry.photoTargetFields) ? entry.photoTargetFields : [])
    .forEach((field, index) => register(field, `photoTargetFields[${index}]`));
}

function alternateTargetResult(target, resultKey) {
  return isPlainObject(target?.gradeMap) && resultKey
      && Object.prototype.hasOwnProperty.call(target.gradeMap, resultKey)
    ? target.gradeMap[resultKey] : undefined;
}

function validateAlternateOverrideReferences(value, path, knownFields, serialField,
                                             owners, errors) {
  if (!isPlainObject(value)) return;
  Object.keys(value).forEach((field) => validateAlternateOverrideField(field,
    `${path}.${field}`, knownFields, serialField, owners, errors));
}

function validateAlternateOverrideField(field, path, knownFields, serialField, owners, errors) {
  if (typeof field !== "string" || !field.trim()) return;
  const value = field.trim();
  if (value === serialField) {
    errors.push(`${path} must not override the target primary serial field`);
  } else if (IDENTITY_OVERRIDE_FIELDS.has(value)) {
    errors.push(`${path} must not override target template identity`);
  } else if (!knownFields.has(value)) {
    errors.push(`${path} must reference a field declared by the target profile`);
  }
  if (owners.has(value)) {
    errors.push(`${path} duplicates override ownership from ${owners.get(value)}`);
  } else {
    owners.set(value, path);
  }
}

