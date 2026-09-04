export const PHOTO_ORDERS = Object.freeze(["fronts_then_backs", "front_back_per_unit"]);
export const PHOTO_INPUT_SOURCES = Object.freeze(["camera", "gallery", "file"]);

export function normalizeSn(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function normalizeGrade(value, fallback = "") {
  const key = String(value || "").trim();
  return key || String(fallback || "").trim();
}

export function normalizePhotoOrder(value, fallback = "fronts_then_backs") {
  const order = String(value || "").trim();
  if (PHOTO_ORDERS.includes(order)) {
    return order;
  }
  return PHOTO_ORDERS.includes(fallback) ? fallback : "fronts_then_backs";
}

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

function validateChoiceFields(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("choiceFields must be an array");
    return;
  }
  value.forEach((choice, index) => {
    const path = `choiceFields[${index}]`;
    if (!isPlainObject(choice)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(choice.field, `${path}.field`, errors);
    for (const flag of ["required", "visible"]) {
      if (choice[flag] !== undefined && typeof choice[flag] !== "boolean") {
        errors.push(`${path}.${flag} must be a boolean`);
      }
    }
    if (choice.reviewRequired !== undefined && typeof choice.reviewRequired !== "boolean") {
      errors.push(`${path}.reviewRequired must be a boolean`);
    } else if (choice.reviewRequired === true) {
      errors.push(`${path}.reviewRequired must be false before publish`);
    }

    const optionValues = [];
    if (!Array.isArray(choice.options)) {
      errors.push(`${path}.options must be an array`);
    } else {
      if (choice.options.length === 0) errors.push(`${path}.options must not be empty`);
      choice.options.forEach((option, optionIndex) => {
        const optionPath = `${path}.options[${optionIndex}]`;
        if (!isPlainObject(option)) {
          errors.push(`${optionPath} must be an object`);
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(option, "value")) {
          errors.push(`${optionPath}.value is required`);
        } else if (!isChoiceOptionValue(option.value)) {
          errors.push(`${optionPath}.value must be a non-empty JSON scalar`);
        } else {
          if (optionValues.some((candidate) => jsonValuesEqual(candidate, option.value))) {
            errors.push(`${optionPath}.value must be unique`);
          }
          optionValues.push(option.value);
        }
        requireString(option.label, `${optionPath}.label`, errors);
      });
    }

    const isDeclaredOption = (selected) => optionValues.some(
      (candidate) => jsonValuesEqual(candidate, selected)
    );
    if (choice.kind === "multi") {
      if (!Array.isArray(choice.value)) {
        errors.push(`${path}.value must be an array for a multi choice`);
      } else {
        for (const selected of choice.value) {
          if (!isDeclaredOption(selected)) {
            errors.push(`${path}.value ${JSON.stringify(selected)} is not one of its options`);
          }
        }
        if (choice.required === true && choice.value.length === 0) {
          errors.push(`${path} is required but nothing is selected`);
        }
      }
    } else if (choice.kind === "single") {
      if (typeof choice.value !== "string") {
        errors.push(`${path}.value must be a string for a single choice`);
      } else if (choice.value === "") {
        if (choice.required === true) errors.push(`${path} is required but nothing is selected`);
      } else if (!isDeclaredOption(choice.value)) {
        errors.push(`${path}.value ${JSON.stringify(choice.value)} is not one of its options`);
      }
    } else {
      errors.push(`${path}.kind must be "single" or "multi"`);
    }
  });
}

function isChoiceOptionValue(value) {
  if (typeof value === "string") return value.trim() !== "";
  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} is required`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function allowOnly(value, allowed, path, errors) {
  if (!isPlainObject(value)) return;
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) errors.push(`${path}.${key} is not supported`);
  }
}

function validateRuntimePolicy(profile, resultKeys, errors) {
  if (profile.requiresSecondSn !== undefined && typeof profile.requiresSecondSn !== "boolean") {
    errors.push("requiresSecondSn must be a boolean");
  }
  if (profile.requiresSecondSn === true
      && (typeof profile?.snFields?.secondary !== "string"
          || !profile.snFields.secondary.trim())) {
    errors.push("snFields.secondary is required when requiresSecondSn=true");
  }
  if (profile.expectedSnLength !== undefined
      && (!Number.isInteger(profile.expectedSnLength) || profile.expectedSnLength <= 0)) {
    errors.push("expectedSnLength must be a positive integer");
  }
  if (profile.materialCodePattern !== undefined && typeof profile.materialCodePattern !== "string") {
    errors.push("materialCodePattern must be a string");
  }
  if (profile.workflow === undefined) return;
  if (!isPlainObject(profile.workflow)) {
    errors.push("workflow must be an object");
    return;
  }
  if (profile.workflow.compatibilityReviewed !== undefined
      && typeof profile.workflow.compatibilityReviewed !== "boolean") {
    errors.push("workflow.compatibilityReviewed must be a boolean");
  }
  const previous = profile.workflow.previousSteps;
  if (!isPlainObject(previous)) {
    errors.push("workflow.previousSteps must be an object");
  } else {
    for (const key of ["enabled", "scanPrecheck"]) {
      if (typeof previous[key] !== "boolean") errors.push(`workflow.previousSteps.${key} must be a boolean`);
    }
    validateStringArrayIfPresent(previous.scanPrecheckExcludedResultKeys,
      "workflow.previousSteps.scanPrecheckExcludedResultKeys", errors);
    validateStringArrayIfPresent(previous.triggerResultKeys,
      "workflow.previousSteps.triggerResultKeys", errors);
    validateStringArrayIfPresent(previous.directCreateResultKeys,
      "workflow.previousSteps.directCreateResultKeys", errors);
    validateResultKeyReferences(previous.scanPrecheckExcludedResultKeys,
      "workflow.previousSteps.scanPrecheckExcludedResultKeys", resultKeys, errors);
    validateResultKeyReferences(previous.triggerResultKeys,
      "workflow.previousSteps.triggerResultKeys", resultKeys, errors);
    if (Array.isArray(previous.directCreateResultKeys)) {
      const triggerResultKeys = new Set(Array.isArray(previous.triggerResultKeys)
        ? previous.triggerResultKeys : []);
      const directCreateResultKeys = new Set();
      previous.directCreateResultKeys.forEach((key, index) => {
        if (typeof key !== "string" || !key.trim()) return;
        const path = `workflow.previousSteps.directCreateResultKeys[${index}]`;
        if (!resultKeys.has(key)) errors.push(`${path} must reference gradeMap`);
        if (!triggerResultKeys.has(key)) errors.push(`${path} must reference triggerResultKeys`);
        if (directCreateResultKeys.has(key)) errors.push(`${path} must not be duplicated`);
        directCreateResultKeys.add(key);
      });
      if (previous.directCreateResultKeys.length > 0 && previous.enabled !== true) {
        errors.push("workflow.previousSteps.directCreateResultKeys requires enabled=true");
      }
    }
    if (previous.scanPrecheck === true && previous.enabled !== true) {
      errors.push("workflow.previousSteps.scanPrecheck requires enabled=true");
    }
    validateIdentifierCorrection(previous.identifierCorrection, errors);
    validateResultKeyReferences(previous.identifierCorrection?.resultKeys,
      "workflow.previousSteps.identifierCorrection.resultKeys", resultKeys, errors);
    if (previous.identifierCorrection?.enabled === true && previous.enabled !== true) {
      errors.push("workflow.previousSteps.identifierCorrection.enabled requires enabled=true");
    }
    if (previous.identifierCorrection?.enabled === true
        && (!Array.isArray(previous.identifierCorrection.substitutions)
            || previous.identifierCorrection.substitutions.length === 0)) {
      errors.push("workflow.previousSteps.identifierCorrection.substitutions must be non-empty when enabled=true");
    }
    if (previous.identifierCasePolicy !== undefined) {
      validateOneOf(previous.identifierCasePolicy, ["preserve", "match_existing"],
        "workflow.previousSteps.identifierCasePolicy", errors);
    }
    validateScanPrecheckPolicy(previous.scanPrecheckPolicy, errors);
    if (previous.verifyAttempts !== undefined) {
      validateIntegerRange(previous.verifyAttempts, 1, 10,
        "workflow.previousSteps.verifyAttempts", errors);
    }
    if (previous.verifyDelayMs !== undefined) {
      validateIntegerRange(previous.verifyDelayMs, 0, 30000,
        "workflow.previousSteps.verifyDelayMs", errors);
    }
    if (previous.recipeMaxAttempts !== undefined) {
      validateIntegerRange(previous.recipeMaxAttempts, 1, 10,
        "workflow.previousSteps.recipeMaxAttempts", errors);
    }
    if (previous.recipeRetryDelayMs !== undefined) {
      validateIntegerRange(previous.recipeRetryDelayMs, 0, 60000,
        "workflow.previousSteps.recipeRetryDelayMs", errors);
    }
    const artifactKeys = validateWorkflowArtifacts(previous.artifacts, errors);
    if (previous.legacyDraftArtifactKey !== undefined
        && typeof previous.legacyDraftArtifactKey !== "string") {
      errors.push("workflow.previousSteps.legacyDraftArtifactKey must be a string");
    } else if (typeof previous.legacyDraftArtifactKey === "string"
        && previous.legacyDraftArtifactKey.trim()
        && !artifactKeys.has(previous.legacyDraftArtifactKey.trim())) {
      errors.push("workflow.previousSteps.legacyDraftArtifactKey must reference artifacts[].key");
    }
    if (previous.scanPrecheckPolicy?.atLimitAction === "require_artifact"
        && (!Array.isArray(previous.artifacts)
            || !previous.artifacts.some((artifact) => artifact?.required === true))) {
      errors.push("workflow.previousSteps.scanPrecheckPolicy.atLimitAction=require_artifact requires at least one required artifact");
    }
    if (previous.scanPrecheckPolicy?.atLimitAction === "require_artifact") {
      const requiredArtifactKeys = new Set((Array.isArray(previous.artifacts)
        ? previous.artifacts : [])
        .filter((artifact) => artifact?.required === true && typeof artifact.key === "string")
        .map((artifact) => artifact.key));
      const boundSources = new Set((Array.isArray(previous.templates)
        ? previous.templates : []).flatMap((template) => {
          if (template?.mode === "template_detail" && isPlainObject(template.sources)) {
            return Object.values(template.sources).filter(Boolean);
          }
          return Array.isArray(template?.photoBindings)
            ? template.photoBindings.map((binding) => binding?.source).filter(Boolean) : [];
        }));
      if (!Array.isArray(previous.templates) || previous.templates.length === 0) {
        errors.push("workflow.previousSteps.scanPrecheckPolicy.atLimitAction=require_artifact requires at least one template");
      } else if (![...requiredArtifactKeys].some((key) => boundSources.has(key))) {
        errors.push("workflow.previousSteps.scanPrecheckPolicy.atLimitAction=require_artifact requires a template binding to a required artifact");
      }
    }
    if (previous.templates !== undefined) validateWorkflowTemplates(previous.templates, profile, artifactKeys, errors);
    if (Array.isArray(previous.triggerResultKeys) && previous.triggerResultKeys.length > 0
        && (!Array.isArray(previous.templates) || previous.templates.length === 0)) {
      errors.push("workflow.previousSteps.templates must be non-empty when triggerResultKeys is non-empty");
    }
  }
  const photos = profile.workflow.photos;
  if (photos === undefined) {
    // Compatibility: optionalSlots remain inactive until a reviewed profile opts in.
  } else if (!isPlainObject(photos)) {
    errors.push("workflow.photos must be an object");
  } else if (typeof photos.includeOptionalSlots !== "boolean") {
    errors.push("workflow.photos.includeOptionalSlots must be a boolean");
  } else if (photos.includeOptionalSlots === true
      && (!Array.isArray(profile.photoSlots) || profile.photoSlots.length === 0)) {
    errors.push("workflow.photos.includeOptionalSlots=true requires non-empty photoSlots");
  }
  if (isPlainObject(photos)) {
    validatePhotoInputSource(photos.inputSource,
      "workflow.photos.inputSource", errors);
  }
  const duplicate = profile.workflow.duplicateCheck;
  if (!isPlainObject(duplicate)) {
    errors.push("workflow.duplicateCheck must be an object");
  } else {
    if (typeof duplicate.enabled !== "boolean") errors.push("workflow.duplicateCheck.enabled must be a boolean");
    if (duplicate.agePolicy === undefined) {
      // Legacy catalogs used a fixed-day field. Keep them editable, but an enabled profile must
      // migrate to the explicit unit/value contract before it can be published for the new App.
      if (duplicate.minAgeDaysToResubmit !== undefined
          && (!Number.isInteger(duplicate.minAgeDaysToResubmit)
              || duplicate.minAgeDaysToResubmit < 0)) {
        errors.push("workflow.duplicateCheck.minAgeDaysToResubmit must be a non-negative integer");
      }
      if (duplicate.enabled === true) {
        errors.push("workflow.duplicateCheck.agePolicy must be an object when enabled=true");
      }
    } else if (!isPlainObject(duplicate.agePolicy)) {
      errors.push("workflow.duplicateCheck.agePolicy must be an object");
    } else {
      validateOneOf(duplicate.agePolicy.unit, ["days", "calendar_months"],
        "workflow.duplicateCheck.agePolicy.unit", errors);
      validateIntegerRange(duplicate.agePolicy.value, 0, 36500,
        "workflow.duplicateCheck.agePolicy.value", errors);
    }
    validateRequiredPolicyAction(duplicate, "unknownDateAction",
      ["skip_as_submitted", "confirm", "block"],
      "workflow.duplicateCheck.unknownDateAction", duplicate.enabled === true, errors);
    validateRequiredPolicyAction(duplicate, "recentAction", ["skip_as_submitted", "confirm", "block"],
      "workflow.duplicateCheck.recentAction", duplicate.enabled === true, errors);
    validateRequiredPolicyAction(duplicate, "eligibleAction", ["continue", "confirm", "block"],
      "workflow.duplicateCheck.eligibleAction", duplicate.enabled === true, errors);
  }
  const printing = profile.workflow.printing;
  if (printing === undefined) {
    // Compatibility: profiles published before this policy existed are fail-safe disabled.
  } else if (!isPlainObject(printing)) {
    errors.push("workflow.printing must be an object");
  } else {
    if (typeof printing.enabled !== "boolean") errors.push("workflow.printing.enabled must be a boolean");
    validateOneOf(printing.preflightAction, ["block", "confirm", "continue"],
      "workflow.printing.preflightAction", errors);
    validateOneOf(printing.onUnconfirmed, ["stop", "continue"],
      "workflow.printing.onUnconfirmed", errors);
    if (printing.batchEndRecheckMode !== undefined) {
      validateOneOf(printing.batchEndRecheckMode,
        ["inline_only", "deferred_missing_two_pass"],
        "workflow.printing.batchEndRecheckMode", errors);
    }
    if (printing.unknownStatusPresentation !== undefined) {
      validateOneOf(printing.unknownStatusPresentation, ["as_ongoing", "distinct"],
        "workflow.printing.unknownStatusPresentation", errors);
    }
    if (typeof printing.manualReprintEnabled !== "boolean") {
      errors.push("workflow.printing.manualReprintEnabled must be a boolean");
    }
    validateStringArrayIfPresent(printing.manualReprintStatuses,
      "workflow.printing.manualReprintStatuses", errors);
    if (Array.isArray(printing.manualReprintStatuses)) {
      const allowed = new Set(["failed", "ongoing", "unknown"]);
      const seen = new Set();
      printing.manualReprintStatuses.forEach((status, index) => {
        if (typeof status === "string" && !allowed.has(status)) {
          errors.push(`workflow.printing.manualReprintStatuses[${index}] must be failed, ongoing or unknown`);
        } else if (typeof status === "string" && seen.has(status)) {
          errors.push(`workflow.printing.manualReprintStatuses[${index}] must not be duplicated`);
        } else if (typeof status === "string") {
          seen.add(status);
        }
      });
      if (printing.manualReprintEnabled === true && printing.manualReprintStatuses.length === 0) {
        errors.push("workflow.printing.manualReprintStatuses must be non-empty when manualReprintEnabled=true");
      }
    }
    if (printing.manualReprintRequiresConfirmation !== undefined
        && typeof printing.manualReprintRequiresConfirmation !== "boolean") {
      errors.push("workflow.printing.manualReprintRequiresConfirmation must be a boolean");
    }
    validateIntegerRange(printing.confirmationPolls, 1, 12,
      "workflow.printing.confirmationPolls", errors);
    validateIntegerRange(printing.confirmationPollIntervalMs, 250, 30000,
      "workflow.printing.confirmationPollIntervalMs", errors);
    validateIntegerRange(printing.maxAutoReprints, 0, 3,
      "workflow.printing.maxAutoReprints", errors);
    validateIntegerRange(printing.finalRecheckDelayMs, 0, 120000,
      "workflow.printing.finalRecheckDelayMs", errors);
  }
  const materials = profile.workflow.materials;
  if (!isPlainObject(materials)) {
    errors.push("workflow.materials must be an object");
  } else {
    if (materials.refreshBeforeSubmit !== undefined && typeof materials.refreshBeforeSubmit !== "boolean") {
      errors.push("workflow.materials.refreshBeforeSubmit must be a boolean");
    } else if (materials.refreshBeforeSubmit === true) {
      if (!Array.isArray(profile.materialGroups) || profile.materialGroups.length === 0) {
        errors.push("workflow.materials.refreshBeforeSubmit=true requires non-empty materialGroups");
      } else {
        profile.materialGroups.forEach((group, index) => {
          if (!Array.isArray(group?.materials) || group.materials.length === 0) {
            errors.push(`workflow.materials.refreshBeforeSubmit=true requires materialGroups[${index}].materials to be non-empty`);
          }
        });
      }
    }
    const recovery = materials.missingRecovery;
    if (recovery === undefined) {
      // Compatibility: missing recovery is disabled unless the Panel writes it explicitly.
    } else if (!isPlainObject(recovery)) {
      errors.push("workflow.materials.missingRecovery must be an object");
    } else {
      if (typeof recovery.enabled !== "boolean") {
        errors.push("workflow.materials.missingRecovery.enabled must be a boolean");
      }
      if (typeof recovery.localNotice !== "boolean") {
        errors.push("workflow.materials.missingRecovery.localNotice must be a boolean");
      }
    }
  }
  const submission = profile.workflow.submission;
  if (submission === undefined) {
    // Compatibility: the App uses one attempt and no network replay.
  } else if (!isPlainObject(submission)) {
    errors.push("workflow.submission must be an object");
  } else {
    validateIntegerRange(submission.maxAttempts, 1, 10,
      "workflow.submission.maxAttempts", errors);
    validateIntegerRange(submission.retryDelayMs, 0, 60000,
      "workflow.submission.retryDelayMs", errors);
    if (submission.interUnitDelayMs !== undefined) {
      validateIntegerRange(submission.interUnitDelayMs, 0, 60000,
        "workflow.submission.interUnitDelayMs", errors);
    }
    if (submission.roundLedgerRetentionDays !== undefined) {
      validateIntegerRange(submission.roundLedgerRetentionDays, 1, 30,
        "workflow.submission.roundLedgerRetentionDays", errors);
    }
    validateIntegerRange(submission.maxConsecutiveFailures, 1, 100,
      "workflow.submission.maxConsecutiveFailures", errors);
    if (submission.structuredNonSuccessAction !== undefined) {
      validateOneOf(submission.structuredNonSuccessAction,
        ["lock", "reject_as_not_written"],
        "workflow.submission.structuredNonSuccessAction", errors);
    }
    const networkRetry = submission.networkRetry;
    if (!isPlainObject(networkRetry)) {
      errors.push("workflow.submission.networkRetry must be an object");
    } else {
      validateIntegerRange(networkRetry.maxAttempts, 0, 100,
        "workflow.submission.networkRetry.maxAttempts", errors);
      validateIntegerRange(networkRetry.baseDelayMs, 250, 60000,
        "workflow.submission.networkRetry.baseDelayMs", errors);
      validateIntegerRange(networkRetry.maxDelayMs, 250, 300000,
        "workflow.submission.networkRetry.maxDelayMs", errors);
      if (Number.isInteger(networkRetry.baseDelayMs)
          && Number.isInteger(networkRetry.maxDelayMs)
          && networkRetry.maxDelayMs < networkRetry.baseDelayMs) {
        errors.push("workflow.submission.networkRetry.maxDelayMs must be at least baseDelayMs");
      }
    }
  }
  if (materials?.missingRecovery?.enabled === true
      && (!isPlainObject(submission) || !Number.isInteger(submission.maxAttempts)
          || submission.maxAttempts < 2)) {
    errors.push("workflow.materials.missingRecovery.enabled requires workflow.submission.maxAttempts >= 2");
  }
  const notifications = profile.workflow.notifications;
  if (notifications === undefined) {
    // Compatibility: catalogs published before structured events existed default to no events.
  } else if (!isPlainObject(notifications)) {
    errors.push("workflow.notifications must be an object");
  } else {
    allowOnly(notifications, ["submissionSummary", "profileLabel"],
      "workflow.notifications", errors);
    if (typeof notifications.submissionSummary !== "boolean") {
      errors.push("workflow.notifications.submissionSummary must be a boolean");
    }
    if (notifications.profileLabel !== undefined
        && (typeof notifications.profileLabel !== "string"
          || !notifications.profileLabel.trim()
          || notifications.profileLabel.length > 160)) {
      errors.push("workflow.notifications.profileLabel must be a non-empty string not exceeding 160 characters");
    }
  }
  validateAlternateEntries(profile, profile.workflow.alternateEntries, errors);
}

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
const IDENTITY_OVERRIDE_FIELDS = new Set([
  "template", "identity", "templateId", "warehouseId", "sku",
  "template.id", "template.warehouseId", "template.sku"
]);

function validateAlternateEntries(profile, value, errors) {
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

function validateUploadNameTemplate(value, path, errors, { requireIndex = true } = {}) {
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

function validateOperationFields(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("operationFields must be an array");
    return;
  }
  value.forEach((item, index) => {
    const path = `operationFields[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(item.field, `${path}.field`, errors);
    if (!Object.prototype.hasOwnProperty.call(item, "value")) {
      errors.push(`${path}.value is required`);
    }
  });
}

function validateUploadFields(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("uploadFields must be an array");
    return;
  }
  value.forEach((item, index) => {
    const path = `uploadFields[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(item.field, `${path}.field`, errors);
    if (Object.prototype.hasOwnProperty.call(item, "sources")) {
      if (!Array.isArray(item.sources)) {
        errors.push(`${path}.sources must be an array`);
      } else {
        if (item.sources.length === 0) errors.push(`${path}.sources must not be empty`);
        const seen = new Set();
        item.sources.forEach((source, sourceIndex) => {
          const sourcePath = `${path}.sources[${sourceIndex}]`;
          if (source !== "front" && source !== "back") {
            errors.push(`${sourcePath} must be front or back`);
          } else if (seen.has(source)) {
            errors.push(`${sourcePath} must be unique`);
          } else {
            seen.add(source);
          }
        });
      }
    }
  });
}

function validatePayloadFieldOwnership(profile, errors) {
  const owners = new Map();
  const register = (field, owner) => {
    const value = typeof field === "string" ? field.trim() : "";
    if (!value) return;
    const existing = owners.get(value);
    if (existing && existing !== owner) {
      errors.push(`payload field ${JSON.stringify(value)} is owned by both ${existing} and ${owner}`);
      return;
    }
    owners.set(value, owner);
  };

  const primary = typeof profile?.snFields?.primary === "string"
    ? profile.snFields.primary.trim() : "";
  const secondary = typeof profile?.snFields?.secondary === "string"
    ? profile.snFields.secondary.trim() : "";
  register(primary, "snFields.primary");
  if (profile.requiresSecondSn === true) register(secondary, "snFields.secondary");

  (Array.isArray(profile.snPlugins) ? profile.snPlugins : []).forEach((plugin, index) => {
    if (!isPlainObject(plugin)) return;
    const key = typeof plugin.key === "string" ? plugin.key.trim() : "";
    const field = typeof plugin.field === "string" ? plugin.field.trim() : "";
    if (key === "primary") {
      if (field && primary && field !== primary) {
        errors.push(`snPlugins[${index}].field must equal snFields.primary for key=primary`);
      }
    } else if (key === "secondary") {
      if (field && secondary && field !== secondary) {
        errors.push(`snPlugins[${index}].field must equal snFields.secondary for key=secondary`);
      }
    } else {
      register(field, `snPlugins[${index}]`);
    }
  });

  const fieldLists = [
    ["uploadFields", profile.uploadFields],
    ["photoSlots", profile.photoSlots],
    ["optionalSlots", profile.optionalSlots],
    ["conditionalFields", profile.conditionalFields],
    ["operationFields", profile.operationFields],
    ["choiceFields", profile.choiceFields],
    ["materialGroups", profile.materialGroups]
  ];
  for (const [path, values] of fieldLists) {
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((item, index) => {
      const field = isPlainObject(item) && typeof item.field === "string"
        ? item.field.trim() : "";
      if (field && seen.has(field)) errors.push(`${path}[${index}].field must be unique`);
      if (field) seen.add(field);
    });
  }

  const slotMode = Array.isArray(profile.photoSlots) && profile.photoSlots.length > 0;
  const activeLists = slotMode
    ? [["photoSlots", profile.photoSlots],
      ...(profile?.workflow?.photos?.includeOptionalSlots === true
        ? [["optionalSlots", profile.optionalSlots]] : [])]
    : [["uploadFields", profile.uploadFields]];
  activeLists.push(
    ["conditionalFields", profile.conditionalFields],
    ["operationFields", profile.operationFields],
    ["choiceFields", profile.choiceFields],
    ["materialGroups", profile.materialGroups]
  );
  for (const [path, values] of activeLists) {
    (Array.isArray(values) ? values : []).forEach((item, index) => {
      if (isPlainObject(item)) register(item.field, `${path}[${index}]`);
    });
  }

  const gradeFields = new Set();
  if (isPlainObject(profile.gradeMap)) {
    for (const item of Object.values(profile.gradeMap)) {
      const field = typeof item?.field === "string" ? item.field.trim() : "";
      if (field) gradeFields.add(field);
    }
  }
  for (const field of gradeFields) register(field, "gradeMap");
}

function validateIdentifierCorrection(value, errors) {
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

function validateScanPrecheckPolicy(value, errors) {
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

function validateRequiredPolicyAction(value, key, allowed, path, required, errors) {
  if (!required && value[key] === undefined) return;
  validateOneOf(value[key], allowed, path, errors);
}

function validateIntegerRange(value, min, max, path, errors) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${path} must be an integer from ${min} to ${max}`);
  }
}

function validatePhotoSlots(value, path, errors) {
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

function validatePhotoInputSource(value, path, errors) {
  if (value === undefined) return;
  if (typeof value !== "string" || !PHOTO_INPUT_SOURCES.includes(value)) {
    errors.push(`${path} must be camera, gallery, or file`);
  }
}

function validateSnPlugins(value, errors, rootPath = "snPlugins") {
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

function validateScannerBindings(profile, errors) {
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
function validateEffectivePrimaryScannerFallback(profile, errors) {
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

function validateMaterialGroups(value, errors) {
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

function validateScannerPolicy(value, path, errors) {
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

function validateScannerSources(value, path, errors) {
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

function validateNotifySkipItems(value, materialCodes, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("notifySkipMaterials must be an array");
    return;
  }
  const seen = new Set();
  value.forEach((code, index) => {
    requireString(code, `notifySkipMaterials[${index}]`, errors);
    if (typeof code !== "string" || !code.trim()) return;
    if (seen.has(code)) errors.push(`notifySkipMaterials[${index}] must be unique`);
    else seen.add(code);
    if (!materialCodes.has(code)) errors.push(`notifySkipMaterials[${index}] must reference materialGroups`);
  });
}

function validateConditionalFields(value, resultKeys, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("conditionalFields must be an array");
    return;
  }
  value.forEach((field, index) => {
    const path = `conditionalFields[${index}]`;
    if (!isPlainObject(field)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(field.field, `${path}.field`, errors);
    for (const key of ["perResult", "perGrade"]) {
      validateConditionalResultMap(field[key], `${path}.${key}`, resultKeys, errors);
    }
    if (isPlainObject(field.perResult) && isPlainObject(field.perGrade)
        && !jsonValuesEqual(field.perResult, field.perGrade)) {
      errors.push(`${path}.perGrade must deeply equal perResult during staged migration`);
    }
  });
}

function validateConditionalResultMap(value, path, resultKeys, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const [key, selected] of Object.entries(value)) {
    if (resultKeys.size > 0 && !resultKeys.has(key)) {
      errors.push(`${path}.${key} must reference gradeMap`);
    }
    if (!Array.isArray(selected)) errors.push(`${path}.${key} must be an array`);
  }
}

function jsonValuesEqual(left, right) {
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

function validateStringArrayIfPresent(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, index) => requireString(item, `${path}[${index}]`, errors));
}

function validateResultKeyReferences(value, path, resultKeys, errors) {
  if (!Array.isArray(value) || resultKeys.size === 0) return;
  value.forEach((key, index) => {
    if (typeof key === "string" && key.trim() && !resultKeys.has(key)) {
      errors.push(`${path}[${index}] must reference gradeMap`);
    }
  });
}

function validateWorkflowArtifacts(value, errors) {
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

function validateWorkflowTemplates(value, profile, artifactKeys, errors) {
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

// Lenient validator for an optional {en,es} sibling map. undefined/null -> OK (zh-only is valid).
// Otherwise it must be a plain object whose only keys are "en"/"es", each mapping to a string.
function validateI18n(obj, key, path, errors) {
  const val = obj ? obj[key] : undefined;
  if (val === undefined || val === null) return;
  if (typeof val !== "object" || Array.isArray(val)) {
    errors.push(`${path} must be an object with en/es string values`);
    return;
  }
  for (const [k, v] of Object.entries(val)) {
    if (k !== "en" && k !== "es") {
      errors.push(`${path}.${k} is not a supported language (only en/es)`);
    } else if (typeof v !== "string") {
      errors.push(`${path}.${k} must be a string`);
    }
  }
}

const RESULT_OPERATOR_LABEL_MAX_LENGTH = 160;

function validateOperatorLabel(value, path, errors) {
  if (value === undefined) return;
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`);
    return;
  }
  if (value !== value.trim()) errors.push(`${path} must not have surrounding whitespace`);
  if (value.length > RESULT_OPERATOR_LABEL_MAX_LENGTH) {
    errors.push(`${path} must contain at most ${RESULT_OPERATOR_LABEL_MAX_LENGTH} characters`);
  }
}

function validateOperatorLabelI18n(value, path, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object with en/es string values`);
    return;
  }
  allowOnly(value, ["en", "es"], path, errors);
  for (const locale of ["en", "es"]) {
    if (!Object.prototype.hasOwnProperty.call(value, locale)) continue;
    validateOperatorLabel(value[locale], `${path}.${locale}`, errors);
  }
}

function validateOneOf(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}`);
  }
}
