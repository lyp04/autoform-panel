// Entry point for profile validation: dispatches a profile to the per-concern rule modules.
import { validateChoiceFields } from "./profile-choice-fields.js";
import { validateConditionalFields, validateNotifySkipItems } from "./profile-conditional-fields.js";
import { validateOperationFields, validatePayloadFieldOwnership, validateUploadFields } from "./profile-payload-fields.js";
import { validatePhotoSlots } from "./profile-previous-step.js";
import { isPlainObject, requireString, validateI18n, validateOneOf, validateOperatorLabel, validateOperatorLabelI18n } from "./profile-primitives.js";
import { validateRuntimePolicy } from "./profile-runtime-policy.js";
import { validateEffectivePrimaryScannerFallback, validateMaterialGroups, validateScannerBindings, validateScannerPolicy, validateSnPlugins } from "./profile-scanner-policy.js";
import { PHOTO_ORDERS } from "./profile-shape.js";

export function validateFormProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== "object") {
    return ["profile must be an object"];
  }
  requireString(profile.id, "id", errors);
  requireString(profile.displayName, "displayName", errors);
  requireString(profile.searchText, "searchText", errors);
  if (profile.uiColor !== undefined
      && (typeof profile.uiColor !== "string"
        || !/^#[0-9a-fA-F]{6}$/.test(profile.uiColor))) {
    errors.push("uiColor must be a six-digit #RRGGBB color");
  }
  if (profile.pickerVisible !== undefined && typeof profile.pickerVisible !== "boolean") {
    errors.push("pickerVisible must be a boolean");
  }
  if (profile.defaultPhotoOrder) {
    validateOneOf(profile.defaultPhotoOrder, PHOTO_ORDERS, "defaultPhotoOrder", errors);
  }
  const gradeMapValid = profile.gradeMap === undefined || isPlainObject(profile.gradeMap);
  if (!gradeMapValid) errors.push("gradeMap must be an object");
  const resultKeys = new Set(Object.keys(isPlainObject(profile.gradeMap) ? profile.gradeMap : {}));
  if (isPlainObject(profile.gradeMap)) {
    for (const grade of Object.keys(profile.gradeMap)) {
      requireString(grade, `gradeMap.${grade}`, errors);
      const item = profile.gradeMap[grade];
      if (!isPlainObject(item)) {
        errors.push(`gradeMap.${grade} must be an object`);
        continue;
      }
      requireString(item?.field, `gradeMap.${grade}.field`, errors);
      requireString(item?.label, `gradeMap.${grade}.label`, errors);
      if (!("value" in item)) {
        errors.push(`gradeMap.${grade}.value is required`);
      }
      validateI18n(item, "labelI18n", `gradeMap.${grade}.labelI18n`, errors);
      validateOperatorLabel(item?.operatorLabel,
        `gradeMap.${grade}.operatorLabel`, errors);
      validateOperatorLabelI18n(item?.operatorLabelI18n,
        `gradeMap.${grade}.operatorLabelI18n`, errors);
      if (item?.uiColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(item.uiColor))) {
        errors.push(`gradeMap.${grade}.uiColor must be a six-digit hex color`);
      }
    }
  }
  validatePhotoSlots(profile.photoSlots, "photoSlots", errors);
  validatePhotoSlots(profile.optionalSlots, "optionalSlots", errors);
  validateUploadFields(profile.uploadFields, errors);
  validateScannerPolicy(profile.scanner, "scanner", errors);
  validateSnPlugins(profile.snPlugins, errors, "snPlugins");
  validateSnPlugins(profile.snPluginsHidden, errors, "snPluginsHidden");
  validateScannerBindings(profile, errors);
  validateEffectivePrimaryScannerFallback(profile, errors);
  const materialCodes = validateMaterialGroups(profile.materialGroups, errors);
  validateNotifySkipItems(profile.notifySkipMaterials, materialCodes, errors);
  validateConditionalFields(profile.conditionalFields, resultKeys, errors);
  validateOperationFields(profile.operationFields, errors);
  validateRuntimePolicy(profile, resultKeys, errors);
  validatePayloadFieldOwnership(profile, errors);
  // The App echoes choice values into the payload, so publish validates the complete authored
  // option/value contract rather than relying on preview controls to have produced safe JSON.
  validateChoiceFields(profile.choiceFields, errors);
  return errors;
}

