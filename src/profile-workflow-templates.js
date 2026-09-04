// Workflow artifacts and templates, including the dynamic ones.
import { validateUploadNameTemplate } from "./profile-alternate-entries.js";
import { validatePhotoInputSource } from "./profile-previous-step.js";
import { allowOnly, isPlainObject, requireString, validateI18n } from "./profile-primitives.js";

export function validateStringArrayIfPresent(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, index) => requireString(item, `${path}[${index}]`, errors));
}

export function validateResultKeyReferences(value, path, resultKeys, errors) {
  if (!Array.isArray(value) || resultKeys.size === 0) return;
  value.forEach((key, index) => {
    if (typeof key === "string" && key.trim() && !resultKeys.has(key)) {
      errors.push(`${path}[${index}] must reference gradeMap`);
    }
  });
}

export function validateWorkflowArtifacts(value, errors) {
  const path = "workflow.previousSteps.artifacts";
  const keys = new Set();
  if (value === undefined) return keys;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return keys;
  }
  value.forEach((artifact, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(artifact)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    allowOnly(artifact, ["key", "title", "titleI18n", "required", "uploadNameTemplate",
      "inputSource"],
      itemPath, errors);
    requireString(artifact.key, `${itemPath}.key`, errors);
    if (typeof artifact.key === "string" && artifact.key.trim()) {
      if (keys.has(artifact.key)) errors.push(`${itemPath}.key must be unique`);
      keys.add(artifact.key);
    }
    requireString(artifact.title, `${itemPath}.title`, errors);
    validateI18n(artifact, "titleI18n", `${itemPath}.titleI18n`, errors);
    if (typeof artifact.required !== "boolean") errors.push(`${itemPath}.required must be a boolean`);
    validateUploadNameTemplate(artifact.uploadNameTemplate,
      `${itemPath}.uploadNameTemplate`, errors, { requireIndex: false });
    validatePhotoInputSource(artifact.inputSource, `${itemPath}.inputSource`, errors);
  });
  return keys;
}

export function validateWorkflowTemplates(value, profile, artifactKeys, errors) {
  const path = "workflow.previousSteps.templates";
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > 16) errors.push(`${path} must contain at most 16 items`);
  value.forEach((template, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(template)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(template, "mode")) {
      validateDynamicWorkflowTemplate(template, profile, artifactKeys, itemPath, errors);
      return;
    }
    if (!Number.isInteger(template.templateId) || template.templateId <= 0) {
      errors.push(`${itemPath}.templateId must be a positive integer`);
    }
    for (const key of ["resolverId", "expectedStep", "sources"]) {
      if (Object.prototype.hasOwnProperty.call(template, key)) {
        errors.push(`${itemPath}.${key} is only supported when mode=template_detail`);
      }
    }
    if (!Number.isInteger(template.warehouseId) || template.warehouseId <= 0) {
      errors.push(`${itemPath}.warehouseId must be a positive integer`);
    }
    requireString(template.sku, `${itemPath}.sku`, errors);
    if (!isPlainObject(template.fixedData)) errors.push(`${itemPath}.fixedData must be an object`);
    const fixedDataKeys = new Set(isPlainObject(template.fixedData)
      ? Object.keys(template.fixedData) : []);
    requireString(template.serialField, `${itemPath}.serialField`, errors);
    const serialField = typeof template.serialField === "string"
      ? template.serialField.trim() : "";
    if (serialField && fixedDataKeys.has(serialField)) {
      errors.push(`${itemPath}.serialField must not overwrite ${itemPath}.fixedData`);
    }
    if (!Array.isArray(template.photoBindings)) {
      errors.push(`${itemPath}.photoBindings must be an array`);
    } else {
      const targetFields = new Set();
      template.photoBindings.forEach((binding, bindingIndex) => {
        const bindingPath = `${itemPath}.photoBindings[${bindingIndex}]`;
        if (!isPlainObject(binding)) {
          errors.push(`${bindingPath} must be an object`);
          return;
        }
        requireString(binding.targetField, `${bindingPath}.targetField`, errors);
        requireString(binding.source, `${bindingPath}.source`, errors);
        const targetField = typeof binding.targetField === "string"
          ? binding.targetField.trim() : "";
        if (targetField && targetFields.has(targetField)) {
          errors.push(`${bindingPath}.targetField must be unique within the template`);
        }
        if (targetField) targetFields.add(targetField);
        if (targetField && targetField === serialField) {
          errors.push(`${bindingPath}.targetField must not overwrite ${itemPath}.serialField`);
        }
        if (targetField && fixedDataKeys.has(targetField)) {
          errors.push(`${bindingPath}.targetField must not overwrite ${itemPath}.fixedData`);
        }
        if (typeof binding.source === "string" && binding.source.trim()) {
          const slotMode = Array.isArray(profile?.photoSlots) && profile.photoSlots.length > 0;
          const profileSources = (slotMode ? [
            ...profile.photoSlots,
            ...(profile?.workflow?.photos?.includeOptionalSlots === true
              && Array.isArray(profile.optionalSlots) ? profile.optionalSlots : [])
          ] : (Array.isArray(profile?.uploadFields) ? profile.uploadFields : []))
            .map((slot) => slot?.field).filter(Boolean);
          if (!artifactKeys.has(binding.source) && !profileSources.includes(binding.source)) {
            errors.push(`${bindingPath}.source must reference an artifact key or profile photo field`);
          }
        }
      });
    }
    if (!Number.isInteger(template.delayAfterMs) || template.delayAfterMs < 0) {
      errors.push(`${itemPath}.delayAfterMs must be a non-negative integer`);
    }
  });
}

function validateDynamicWorkflowTemplate(template, profile, artifactKeys, itemPath, errors) {
  allowOnly(template,
    ["templateId", "mode", "resolverId", "expectedStep", "sources", "delayAfterMs"],
    itemPath, errors);
  if (template.mode !== "template_detail") {
    errors.push(`${itemPath}.mode must be template_detail`);
  }
  const templateIdValid = (typeof template.templateId === "string"
      && template.templateId.trim() !== "")
    || (typeof template.templateId === "number" && Number.isSafeInteger(template.templateId));
  if (!templateIdValid) {
    errors.push(`${itemPath}.templateId must be a non-empty string or finite integer`);
  }
  requireString(template.resolverId, `${itemPath}.resolverId`, errors);
  if (typeof template.resolverId === "string" && (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(template.resolverId)
      || template.resolverId.length > 128
      || ["__proto__", "prototype", "constructor"].includes(template.resolverId))) {
    errors.push(`${itemPath}.resolverId must be a safe bounded resolver identifier`);
  }
  const expectedStepValid = (typeof template.expectedStep === "string"
      && template.expectedStep.trim() !== "")
    || (typeof template.expectedStep === "number" && Number.isSafeInteger(template.expectedStep));
  if (!expectedStepValid) {
    errors.push(`${itemPath}.expectedStep must be a non-empty string or finite integer`);
  }
  if (!isPlainObject(template.sources)) {
    errors.push(`${itemPath}.sources must be an object`);
  } else {
    const entries = Object.entries(template.sources);
    if (entries.length > 32) errors.push(`${itemPath}.sources must contain at most 32 entries`);
    const profileSources = activeProfilePhotoSources(profile);
    for (const [alias, source] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(alias)
          || ["__proto__", "prototype", "constructor"].includes(alias)) {
        errors.push(`${itemPath}.sources.${alias} alias must match [A-Za-z][A-Za-z0-9_-]{0,127}`);
      }
      requireString(source, `${itemPath}.sources.${alias}`, errors);
      if (typeof source === "string" && source.length > 4096) {
        errors.push(`${itemPath}.sources.${alias} must contain at most 4096 characters`);
      }
      if (typeof source === "string" && source.trim()
          && !artifactKeys.has(source) && !profileSources.includes(source)) {
        errors.push(`${itemPath}.sources.${alias} must reference an artifact key or profile photo field`);
      }
    }
  }
  if (!Number.isInteger(template.delayAfterMs) || template.delayAfterMs < 0
      || template.delayAfterMs > 120000) {
    errors.push(`${itemPath}.delayAfterMs must be an integer from 0 to 120000`);
  }
}

function activeProfilePhotoSources(profile) {
  const slotMode = Array.isArray(profile?.photoSlots) && profile.photoSlots.length > 0;
  return (slotMode ? [
    ...profile.photoSlots,
    ...(profile?.workflow?.photos?.includeOptionalSlots === true
      && Array.isArray(profile.optionalSlots) ? profile.optionalSlots : [])
  ] : (Array.isArray(profile?.uploadFields) ? profile.uploadFields : []))
    .map((slot) => slot?.field).filter(Boolean);
}

