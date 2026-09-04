// Operations: upload, OCR, submit, previous steps and duplicate checks.
import { validateAlternateEntryOverrideResolvers } from "./backend-adapter-alternate-overrides.js";
import { validateDuplicateDateCompatibilityPolicy, validateDuplicateDateParsingConfig, validateDuplicateDateParsingOperation } from "./backend-adapter-duplicate-date.js";
import { validateDynamicPreviousStepOperation } from "./backend-adapter-dynamic-previous-step.js";
import { allowOnly, validatePreviousStepRecipeOutcomePolicy, validateSubmitOutcomePolicy } from "./backend-adapter-outcome-policy.js";
import { validatePreviousStepLookupResponseOperation, validatePreviousStepRecipeResponseOperation } from "./backend-adapter-previous-step-response.js";
import { addDistinctFieldNames, addRequiredString, addStringArray, isPlainObject } from "./backend-adapter-primitives.js";
import { validateControlledRecoveryOperation, validateExistingMaterialQuantityPolicy } from "./backend-adapter-recovery.js";

export function validateOperations(operations, endpoints, errors) {
  if (!isPlainObject(operations)) {
    errors.push("operations must be an object");
    return;
  }
  allowOnly(errors, operations,
    ["upload", "ocr", "submit", "previousSteps", "duplicateCheck", "templateDetail", "recovery"], "operations");
  if (!isPlainObject(operations.upload)) {
    errors.push("operations.upload must be an object");
  } else {
    allowOnly(errors, operations.upload, ["multipartField", "resultPath"], "operations.upload");
    addRequiredString(errors, operations.upload.multipartField, "operations.upload.multipartField");
    addRequiredString(errors, operations.upload.resultPath, "operations.upload.resultPath");
  }
  if (operations.ocr !== undefined && !isPlainObject(operations.ocr)) {
    errors.push("operations.ocr must be an object");
  } else if (isPlainObject(operations.ocr)) {
    allowOnly(errors, operations.ocr, ["multipartField", "userInfoUrlFields", "resultPaths"], "operations.ocr");
    addRequiredString(errors, operations.ocr.multipartField, "operations.ocr.multipartField");
    addStringArray(errors, operations.ocr.userInfoUrlFields, "operations.ocr.userInfoUrlFields");
    addStringArray(errors, operations.ocr.resultPaths, "operations.ocr.resultPaths");
  }
  if (!isPlainObject(operations.submit)) {
    errors.push("operations.submit must be an object");
  } else {
    allowOnly(errors, operations.submit,
      ["templateIdField", "warehouseIdField", "skuField", "dataField", "videoIdField", "videoIdValue", "materialItemMapping", "retryableMessagePatterns", "missingMaterialMessagePatterns", "outcomePolicy"],
      "operations.submit");
    for (const key of ["templateIdField", "warehouseIdField", "skuField", "dataField", "videoIdField"]) {
      addRequiredString(errors, operations.submit[key], `operations.submit.${key}`);
    }
    addDistinctFieldNames(errors, operations.submit,
      ["templateIdField", "warehouseIdField", "skuField", "dataField", "videoIdField"],
      "operations.submit");
    if (!isPlainObject(operations.submit.materialItemMapping)) {
      errors.push("operations.submit.materialItemMapping must be an object");
    } else {
      allowOnly(errors, operations.submit.materialItemMapping,
        ["codeField", "nameField", "quantityField"], "operations.submit.materialItemMapping");
      for (const key of ["codeField", "nameField", "quantityField"]) {
        addRequiredString(errors, operations.submit.materialItemMapping[key], `operations.submit.materialItemMapping.${key}`);
      }
      addDistinctFieldNames(errors, operations.submit.materialItemMapping,
        ["codeField", "nameField", "quantityField"],
        "operations.submit.materialItemMapping");
    }
    if (!Object.prototype.hasOwnProperty.call(operations.submit, "videoIdValue")) {
      errors.push("operations.submit.videoIdValue is required");
    }
    addStringArray(errors, operations.submit.retryableMessagePatterns,
      "operations.submit.retryableMessagePatterns", { allowEmpty: true });
    addStringArray(errors, operations.submit.missingMaterialMessagePatterns,
      "operations.submit.missingMaterialMessagePatterns", { allowEmpty: true });
    validateSubmitOutcomePolicy(operations.submit, errors, false);
  }
  if (operations.previousSteps !== undefined && !isPlainObject(operations.previousSteps)) {
    errors.push("operations.previousSteps must be an object");
  } else if (isPlainObject(operations.previousSteps)) {
    allowOnly(errors, operations.previousSteps,
      ["queryFields", "itemsPath", "itemDataPath", "serialPath",
        "missingResponseCodes", "missingMessagePatterns",
        "retryableMessagePatterns", "alreadyExistsMessagePatterns",
        "recipeOutcomePolicy", "recipeResolvers", "optionValueBuilders"],
      "operations.previousSteps");
    addRequiredString(errors, endpoints?.detectionData, "endpoints.detectionData");
    const query = operations.previousSteps.queryFields;
    if (!isPlainObject(query)) errors.push("operations.previousSteps.queryFields must be an object");
    else {
      allowOnly(errors, query, ["templateId", "warehouseId", "sku", "serial"], "operations.previousSteps.queryFields");
      for (const key of ["templateId", "warehouseId", "sku", "serial"]) {
        addRequiredString(errors, query[key], `operations.previousSteps.queryFields.${key}`);
      }
    }
    for (const key of ["itemsPath", "itemDataPath", "serialPath"]) {
      addRequiredString(errors, operations.previousSteps[key], `operations.previousSteps.${key}`);
    }
    const lookupPolicyKeys = ["missingResponseCodes", "missingMessagePatterns"];
    if (lookupPolicyKeys.some((key) => Object.prototype.hasOwnProperty.call(operations.previousSteps, key))) {
      validatePreviousStepLookupResponseOperation(operations.previousSteps, errors, true);
    }
    const recipePolicyKeys = ["retryableMessagePatterns", "alreadyExistsMessagePatterns"];
    if (recipePolicyKeys.some((key) => Object.prototype.hasOwnProperty.call(operations.previousSteps, key))) {
      validatePreviousStepRecipeResponseOperation(operations.previousSteps, errors, true);
    }
    validatePreviousStepRecipeOutcomePolicy(operations.previousSteps, errors, false);
    const dynamicRecipeKeys = ["recipeResolvers", "optionValueBuilders"];
    if (dynamicRecipeKeys.some((key) => Object.prototype.hasOwnProperty.call(operations.previousSteps, key))) {
      validateDynamicPreviousStepOperation(operations.previousSteps, errors, true);
    }
  }
  if (operations.duplicateCheck !== undefined && !isPlainObject(operations.duplicateCheck)) {
    errors.push("operations.duplicateCheck must be an object");
  } else if (isPlainObject(operations.duplicateCheck)) {
    allowOnly(errors, operations.duplicateCheck,
      ["queryFields", "itemsPath", "dateFields", "dateTransforms", "epochUnits", "dateFormats", "timeZone",
        "epochDigitLengths", "numericFractionPolicy", "textParseConsumption",
        "plausibilityScope", "timeZoneSource", "rootValueEnabled",
        "numericEpochPrecision"],
      "operations.duplicateCheck");
    addRequiredString(errors, endpoints?.snRepetition, "endpoints.snRepetition");
    const query = operations.duplicateCheck.queryFields;
    if (!isPlainObject(query)) errors.push("operations.duplicateCheck.queryFields must be an object");
    else {
      allowOnly(errors, query, ["templateId", "serial"], "operations.duplicateCheck.queryFields");
      for (const key of ["templateId", "serial"]) {
        addRequiredString(errors, query[key], `operations.duplicateCheck.queryFields.${key}`);
      }
    }
    addRequiredString(errors, operations.duplicateCheck.itemsPath, "operations.duplicateCheck.itemsPath");
    addStringArray(errors, operations.duplicateCheck.dateFields, "operations.duplicateCheck.dateFields");
    // A deployed v1 adapter may predate explicit date parsing. Keep it usable for Panel login and
    // migration, but reject partial new configuration here. Publishing a profile that actually
    // enables duplicate checking invokes validateDuplicateDateParsingConfig with required=true.
    const parsingKeys = ["dateTransforms", "epochUnits", "dateFormats", "timeZone"];
    if (parsingKeys.some((key) => Object.prototype.hasOwnProperty.call(operations.duplicateCheck, key))) {
      validateDuplicateDateParsingOperation(operations.duplicateCheck, errors, true);
    }
    validateDuplicateDateCompatibilityPolicy(operations.duplicateCheck, errors);
  }
  if (!isPlainObject(operations.templateDetail)) {
    errors.push("operations.templateDetail must be an object");
  } else {
    allowOnly(errors, operations.templateDetail,
      ["idParam", "alternateEntryResolvers", "existingQuantityPolicy"],
      "operations.templateDetail");
    addRequiredString(errors, operations.templateDetail.idParam, "operations.templateDetail.idParam");
    validateExistingMaterialQuantityPolicy(operations.templateDetail, errors);
    if (Object.prototype.hasOwnProperty.call(operations.templateDetail,
      "alternateEntryResolvers")) {
      validateAlternateEntryOverrideResolvers(operations.templateDetail, errors, true);
    }
  }
  if (Object.prototype.hasOwnProperty.call(operations, "recovery")) {
    validateControlledRecoveryOperation(operations.recovery, errors, true);
  }
}

