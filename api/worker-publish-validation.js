// Publish-time gate: the operational policies a profile must set explicitly before it ships.
import { PHOTO_ORDERS, validateAlternateEntryReferences, validateFormProfile } from "./profile.js";
import { json } from "./worker-http.js";

/** Publish-readiness check. Grade is optional (a profile may have no gradeMap); photos may be
 *  expressed as photoSlots (v2) or legacy uploadFields. validateFormProfile already tolerates a
 *  missing gradeMap, so we add only the submit-time requirements here. */
const REQUIRED_OPERATIONAL_POLICY_PATHS = Object.freeze([
  "workflow.previousSteps.enabled",
  "workflow.previousSteps.scanPrecheck",
  "workflow.previousSteps.scanPrecheckExcludedResultKeys",
  "workflow.previousSteps.triggerResultKeys",
  "workflow.previousSteps.directCreateResultKeys",
  "workflow.previousSteps.artifacts",
  "workflow.previousSteps.legacyDraftArtifactKey",
  "workflow.previousSteps.templates",
  "workflow.previousSteps.identifierCorrection.enabled",
  "workflow.previousSteps.identifierCorrection.substitutions",
  "workflow.previousSteps.identifierCorrection.resultKeys",
  "workflow.previousSteps.identifierCorrection.applyAction",
  "workflow.previousSteps.identifierCasePolicy",
  "workflow.previousSteps.scanPrecheckPolicy.maxMissingAttempts",
  "workflow.previousSteps.scanPrecheckPolicy.beforeLimitAction",
  "workflow.previousSteps.scanPrecheckPolicy.atLimitAction",
  "workflow.previousSteps.verifyAttempts",
  "workflow.previousSteps.verifyDelayMs",
  "workflow.previousSteps.recipeMaxAttempts",
  "workflow.previousSteps.recipeRetryDelayMs",
  "workflow.photos.includeOptionalSlots",
  "workflow.alternateEntries.enabled",
  "workflow.alternateEntries.entries",
  "workflow.duplicateCheck.enabled",
  "workflow.duplicateCheck.agePolicy.unit",
  "workflow.duplicateCheck.agePolicy.value",
  "workflow.duplicateCheck.unknownDateAction",
  "workflow.duplicateCheck.recentAction",
  "workflow.duplicateCheck.eligibleAction",
  "workflow.printing.enabled",
  "workflow.printing.preflightAction",
  "workflow.printing.onUnconfirmed",
  "workflow.printing.batchEndRecheckMode",
  "workflow.printing.unknownStatusPresentation",
  "workflow.printing.manualReprintEnabled",
  "workflow.printing.manualReprintStatuses",
  "workflow.printing.manualReprintRequiresConfirmation",
  "workflow.printing.confirmationPolls",
  "workflow.printing.confirmationPollIntervalMs",
  "workflow.printing.maxAutoReprints",
  "workflow.printing.finalRecheckDelayMs",
  "workflow.materials.refreshBeforeSubmit",
  "workflow.materials.missingRecovery.enabled",
  "workflow.materials.missingRecovery.localNotice",
  "workflow.submission.maxAttempts",
  "workflow.submission.retryDelayMs",
  "workflow.submission.interUnitDelayMs",
  "workflow.submission.roundLedgerRetentionDays",
  "workflow.submission.maxConsecutiveFailures",
  "workflow.submission.networkRetry.maxAttempts",
  "workflow.submission.networkRetry.baseDelayMs",
  "workflow.submission.networkRetry.maxDelayMs",
  "workflow.notifications.submissionSummary"
]);

function hasOwnPath(value, path) {
  let current = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)
        || !Object.prototype.hasOwnProperty.call(current, key)) return false;
    current = current[key];
  }
  return true;
}

const ANDROID_INT_MAX = 2147483647;

function isPositiveAndroidInt(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= ANDROID_INT_MAX;
}

function validateForPublish(profile) {
  const errors = validateFormProfile(profile);
  if (profile?.workflow?.compatibilityReviewed !== true) {
    errors.push("workflow.compatibilityReviewed must be true before publish");
  }
  for (const path of REQUIRED_OPERATIONAL_POLICY_PATHS) {
    if (!hasOwnPath(profile, path)) errors.push(`${path} is required before publish`);
  }
  const alternateEntries = profile?.workflow?.alternateEntries?.entries;
  if (Array.isArray(alternateEntries)) {
    alternateEntries.forEach((entry, index) => {
      const path = `workflow.alternateEntries.entries[${index}].submissionRetry`;
      if (!hasOwnPath(entry, "submissionRetry")) {
        errors.push(`${path} is required before publish`);
        return;
      }
      for (const key of ["maxAttempts", "retryDelayMs"]) {
        if (!hasOwnPath(entry.submissionRetry, key)) {
          errors.push(`${path}.${key} is required before publish`);
        }
      }
    });
  }
  if (!PHOTO_ORDERS.includes(profile?.defaultPhotoOrder)) {
    errors.push("defaultPhotoOrder must be explicitly set to a supported value before publish");
  }
  if (!profile?.id) errors.push("id is required");
  // org.json only admits integral submit identities through CatalogPromotionValidator's
  // positiveInt helper (Java int range). Keep Panel publication at least as strict so it can
  // never create a catalog that the App must reject after synchronization.
  if (!isPositiveAndroidInt(profile?.template?.id)) {
    errors.push("template.id must be a positive 32-bit integer");
  }
  if (!isPositiveAndroidInt(profile?.template?.warehouseId)) {
    errors.push("template.warehouseId must be a positive 32-bit integer");
  }
  const sku = profile?.template?.sku;
  if (typeof sku !== "string" || sku === "" || sku !== sku.trim()) {
    errors.push("template.sku is required and must not contain surrounding whitespace");
  }
  if (typeof profile?.snFields?.primary !== "string" || !profile.snFields.primary.trim()) {
    errors.push("snFields.primary is required");
  }
  const slots = Array.isArray(profile?.photoSlots) ? profile.photoSlots : [];
  const uploads = Array.isArray(profile?.uploadFields) ? profile.uploadFields : [];
  if (!slots.length && !uploads.length) errors.push("photoSlots or uploadFields is required");
  for (const s of slots) if (!s?.field) errors.push("photoSlots[].field is required");
  uploads.forEach((upload, index) => {
    if (!Object.prototype.hasOwnProperty.call(upload || {}, "sources")) {
      errors.push(`uploadFields[${index}].sources is required before publish`);
    }
  });
  if (profile?.graded && (!profile?.gradeMap || !Object.keys(profile.gradeMap).length)) {
    errors.push("graded profile requires a non-empty gradeMap");
  }
  return errors;
}

export function validateProfilesForPublish(profiles, catalogProfiles = profiles) {
  const sourceProfiles = Array.isArray(profiles) ? profiles : [];
  const errorsByIndex = new Map();
  const appendErrors = (index, id, errors) => {
    if (!errors.length) return;
    if (!errorsByIndex.has(index)) errorsByIndex.set(index, { index, id, errors: [] });
    const target = errorsByIndex.get(index).errors;
    errors.forEach((error) => { if (!target.includes(error)) target.push(error); });
  };
  const firstIndexById = new Map();
  sourceProfiles.forEach((profile, index) => {
    const errors = validateForPublish(profile);
    const id = typeof profile?.id === "string" ? profile.id.trim() : "";
    if (id && firstIndexById.has(id)) {
      errors.push(`id duplicates profile at index ${firstIndexById.get(id)}`);
    } else if (id) {
      firstIndexById.set(id, index);
    }
    appendErrors(index, profile?.id, errors);
  });
  for (const problem of validateAlternateEntryReferences(sourceProfiles, catalogProfiles)) {
    appendErrors(problem.index, problem.id, problem.errors);
  }
  return [...errorsByIndex.values()].sort((left, right) => left.index - right.index);
}
