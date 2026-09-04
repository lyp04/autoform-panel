// Runtime policy: previous steps, photos, duplicate checks, printing, materials, submission
// and notifications.
import { validateAlternateEntries } from "./profile-alternate-entries.js";
import { validateIdentifierCorrection, validatePhotoInputSource, validateScanPrecheckPolicy } from "./profile-previous-step.js";
import { allowOnly, isPlainObject, validateIntegerRange, validateOneOf, validateRequiredPolicyAction } from "./profile-primitives.js";
import { validateResultKeyReferences, validateStringArrayIfPresent, validateWorkflowArtifacts, validateWorkflowTemplates } from "./profile-workflow-templates.js";

export function validateRuntimePolicy(profile, resultKeys, errors) {
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

