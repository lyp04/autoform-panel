// Admin Worker: backend-gated panel for authoring form profiles and publishing them to the catalog
// repo, plus the app-facing /catalog/* endpoints. Static SPA is served from ./public via the
// ASSETS binding. Secrets (GITHUB_TOKEN) live only here; the backend token stays in the panel and is
// sent as a Bearer on each call (the panel also sends a stable X-Fp fingerprint per session).

// Relative import of the shared profile validator (a plain ESM module with no deps) so the panel
// bundles standalone with `npx wrangler`, without an npm workspace install.
import {
  PHOTO_ORDERS,
  preserveRuntimeProfileConfig,
  validateAlternateEntryReferences,
  validateFormProfile
} from "./profile.js";
// Only verifyToken is used here. The browser performs configured authoring requests directly; the
// Worker validates its resulting session before allowing catalog mutations.
import { verifyToken } from "./backend.js";
import {
  BackendConfigurationError,
  panelBootstrapAdapter,
  resolveBackendAdapter,
  validateAlternateEntryOverrideConfig,
  validateAlternateEntryOverrideReferences,
  validateBackendAdapter,
  validateDynamicPreviousStepConfig,
  validateDynamicPreviousStepReferences,
  validateDuplicateDateParsingConfig,
  validateMaterialRefreshConfig,
  validatePreviousStepRecipeOutcomePolicyConfig,
  validatePreviousStepRecipeResponseConfig,
  validateSubmitOutcomePolicyConfig
} from "./backend-adapter.js";
import { templateToProfile } from "./convert.js";
import { aiRefineProfile, allowedRefs } from "./ai.js";
import { translateProfileTitles } from "./translate.js";
import {
  CatalogPublishConflictError,
  hasCatalogStorage,
  publishCatalog,
  readProfiles,
  readCatalogFile,
  sha256Hex
} from "./catalog.js";
import {
  migrateNotificationAdapter,
  notificationEventTypes,
  notificationResponseSucceeded,
  renderRoundDeliveryMessage,
  renderNotificationBody,
  renderNotificationMessage,
  roundDeliveryResponseSucceeded,
  shouldSendRoundProblem,
  validateNotificationEvent,
  validateNotificationAdapter
} from "./notification-adapter.js";
import {
  legacyUpdateCoordinates,
  normalizeUpdateSource,
  safeUpdateSourceForApp,
  validateUpdateSource,
  validateUpdateSourceCompatibility
} from "./update-source.js";
import { panelRuntimeFromVersionMetadata } from "./panel-runtime.js";
import {
  validateDailyStats,
  validateDailyStatsAlternateEntries,
  validateDailyStatsV2
} from "./daily-stats.js";
import {
  AppPairingTicketStore,
  handleAppPairingRequest,
  isAppPairingPath
} from "./app-pairing.js";

// Wrangler discovers Durable Object classes from the main Worker module's exports.
export { AppPairingTicketStore };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

function auth(request) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const fingerprint = request.headers.get("X-Fp") || "";
  return { token, fingerprint };
}

function validSessionInvalidCodes(value) {
  return Array.isArray(value) && value.every((item) =>
    (typeof item === "string" && item.trim() !== "")
    || (typeof item === "number" && Number.isFinite(item)));
}

function validSessionInvalidHttpStatuses(value) {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every((item) => Number.isInteger(item) && item >= 100 && item <= 599);
}

function validSessionInvalidMessagePatterns(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function normalizedUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/u, "") : "";
}

function normalizedScalarSet(value, { lowerCase = false } = {}) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((item) => {
    const text = String(item).trim();
    return lowerCase ? text.toLowerCase() : text;
  }).filter(Boolean))].sort();
}

/**
 * During the signed-v1 migration window, old and new Apps must resolve the same backend contract.
 * Flat fields remain private Panel data, but if they are retained they cannot contradict the
 * structured adapter delivered to the new App.
 */
export function validateLegacyAppCompatibility(settings, backendAdapter) {
  const source = settings && typeof settings === "object" && !Array.isArray(settings)
    ? settings : {};
  const adapter = backendAdapter && typeof backendAdapter === "object"
    && !Array.isArray(backendAdapter) ? backendAdapter : {};
  const errors = [];
  if (typeof source.backendApiBase === "string" && source.backendApiBase.trim()
      && normalizedUrl(source.backendApiBase) !== normalizedUrl(adapter.baseUrl)) {
    errors.push("legacy backendApiBase must equal backendAdapter.baseUrl during the old-App migration window");
  }
  if (source.endpoints && typeof source.endpoints === "object"
      && !Array.isArray(source.endpoints)) {
    for (const [key, value] of Object.entries(source.endpoints)) {
      if (typeof value !== "string" || !value.trim()
          || value.trim() !== String(adapter.endpoints?.[key] || "").trim()) {
        errors.push(`legacy endpoints.${key} must equal backendAdapter.endpoints.${key} during the old-App migration window`);
      }
    }
  }
  for (const [key, lowerCase] of [
    ["sessionInvalidHttpStatuses", false],
    ["sessionInvalidCodes", false],
    ["sessionInvalidMessagePatterns", true]
  ]) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const legacy = normalizedScalarSet(source[key], { lowerCase });
    const modern = normalizedScalarSet(adapter.auth?.[key], { lowerCase });
    if (legacy === null || modern === null || JSON.stringify(legacy) !== JSON.stringify(modern)) {
      errors.push(`legacy ${key} must equal backendAdapter.auth.${key} during the old-App migration window`);
    }
  }
  return errors;
}

function validDiagnosticsPolicy(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => key === "enabled")
    && typeof value.enabled === "boolean";
}

export function validateWorkflowCapabilities(profiles, backendAdapter) {
  const errors = [];
  const configuredProfiles = Array.isArray(profiles) ? profiles : [];
  const previousStepsRequested = Array.isArray(profiles) && profiles.some((profile) =>
    profile?.workflow?.previousSteps?.enabled === true);
  if (previousStepsRequested) {
    if (typeof backendAdapter?.endpoints?.detectionData !== "string"
        || !backendAdapter.endpoints.detectionData.trim()) {
      errors.push("a profile enables workflow.previousSteps but backendAdapter.endpoints.detectionData is not configured");
    }
    if (!backendAdapter?.operations?.previousSteps
        || typeof backendAdapter.operations.previousSteps !== "object"
        || Array.isArray(backendAdapter.operations.previousSteps)) {
      errors.push("a profile enables workflow.previousSteps but backendAdapter.operations.previousSteps is not configured");
    } else {
      for (const error of validatePreviousStepRecipeResponseConfig(backendAdapter)) {
        errors.push(`a profile enables workflow.previousSteps but ${error}`);
      }
    }
  }
  const dynamicRecipes = [];
  (Array.isArray(profiles) ? profiles : []).forEach((profile, profileIndex) => {
    if (profile?.workflow?.previousSteps?.enabled !== true) return;
    (Array.isArray(profile.workflow.previousSteps.templates)
      ? profile.workflow.previousSteps.templates : []).forEach((template, templateIndex) => {
      if (template?.mode === "template_detail") {
        dynamicRecipes.push({
          path: `profiles[${profileIndex}].workflow.previousSteps.templates[${templateIndex}]`,
          template
        });
      }
    });
  });
  if (dynamicRecipes.length > 0) {
    if (typeof backendAdapter?.endpoints?.templateDetail !== "string"
        || !backendAdapter.endpoints.templateDetail.trim()) {
      errors.push("a profile enables a dynamic previous-step recipe but backendAdapter.endpoints.templateDetail is not configured");
    }
    if (typeof backendAdapter?.operations?.templateDetail?.idParam !== "string"
        || !backendAdapter.operations.templateDetail.idParam.trim()) {
      errors.push("a profile enables a dynamic previous-step recipe but backendAdapter.operations.templateDetail.idParam is not configured");
    }
    for (const error of validateDynamicPreviousStepConfig(backendAdapter)) {
      errors.push(`a profile enables a dynamic previous-step recipe but ${error}`);
    }
    for (const error of validateDynamicPreviousStepReferences(backendAdapter, dynamicRecipes)) {
      errors.push(`a profile enables a dynamic previous-step recipe but ${error}`);
    }
  }
  const executablePreviousStepRecipes = configuredProfiles.filter((profile) => {
    const previousSteps = profile?.workflow?.previousSteps;
    return previousSteps?.enabled === true
      && Array.isArray(previousSteps.triggerResultKeys)
      && previousSteps.triggerResultKeys.length > 0
      && Array.isArray(previousSteps.templates)
      && previousSteps.templates.length > 0;
  });
  const previousStepRecipeRetryRequested = executablePreviousStepRecipes.some((profile) =>
    profile.workflow.previousSteps.recipeMaxAttempts > 1);
  const legacyAlreadyExistsConfigured = executablePreviousStepRecipes.length > 0
    && Array.isArray(
      backendAdapter?.operations?.previousSteps?.alreadyExistsMessagePatterns)
    && backendAdapter.operations.previousSteps.alreadyExistsMessagePatterns.length > 0;
  if (previousStepRecipeRetryRequested || legacyAlreadyExistsConfigured) {
    for (const error of validatePreviousStepRecipeOutcomePolicyConfig(backendAdapter, {
      required: true,
      requireRetryRules: previousStepRecipeRetryRequested,
      requireAlreadyExistsRules: legacyAlreadyExistsConfigured
    })) {
      errors.push(`an executable previous-step recipe requires attested outcome handling but ${error}`);
    }
  }
  const alternateOverrideProviders = [];
  (Array.isArray(profiles) ? profiles : []).forEach((profile, profileIndex) => {
    const entries = profile?.workflow?.alternateEntries?.entries;
    (Array.isArray(entries) ? entries : []).forEach((entry, entryIndex) => {
      (Array.isArray(entry?.dynamicOverrideProviders)
        ? entry.dynamicOverrideProviders : []).forEach((provider, providerIndex) => {
        alternateOverrideProviders.push({
          path: `profiles[${profileIndex}].workflow.alternateEntries.entries[${entryIndex}].dynamicOverrideProviders[${providerIndex}]`,
          provider
        });
      });
    });
  });
  if (alternateOverrideProviders.length > 0) {
    for (const error of validateAlternateEntryOverrideConfig(backendAdapter)) {
      errors.push(`an alternate entry enables live template overrides but ${error}`);
    }
    for (const error of validateAlternateEntryOverrideReferences(
      backendAdapter, alternateOverrideProviders)) {
      errors.push(`an alternate entry enables live template overrides but ${error}`);
    }
  }
  const printingRequested = Array.isArray(profiles) && profiles.some((profile) =>
    profile?.workflow?.printing?.enabled === true);
  if (printingRequested && backendAdapter?.printing?.enabled !== true) {
    errors.push("a profile enables workflow.printing but backendAdapter.printing.enabled is not true");
  }
  const duplicateCheckRequested = Array.isArray(profiles) && profiles.some((profile) =>
    profile?.workflow?.duplicateCheck?.enabled === true);
  if (duplicateCheckRequested) {
    if (typeof backendAdapter?.endpoints?.snRepetition !== "string"
        || !backendAdapter.endpoints.snRepetition.trim()) {
      errors.push("a profile enables workflow.duplicateCheck but backendAdapter.endpoints.snRepetition is not configured");
    }
    for (const error of validateDuplicateDateParsingConfig(backendAdapter)) {
      errors.push(`a profile enables workflow.duplicateCheck but ${error}`);
    }
  }
  const missingRecoveryProfiles = configuredProfiles
    .map((profile, profileIndex) => ({ profile, profileIndex }))
    .filter(({ profile }) =>
      profile?.workflow?.materials?.missingRecovery?.enabled === true);
  const missingRecoveryRequested = missingRecoveryProfiles.length > 0;
  const missingPatterns = backendAdapter?.operations?.submit?.missingMaterialMessagePatterns;
  if (missingRecoveryRequested && (!Array.isArray(missingPatterns)
      || missingPatterns.length === 0)) {
    errors.push("a profile enables workflow.materials.missingRecovery but backendAdapter.operations.submit.missingMaterialMessagePatterns is empty");
  }
  if (missingRecoveryRequested) {
    for (const error of validateSubmitOutcomePolicyConfig(backendAdapter, {
      required: true,
      requireMissingMaterialRules: true
    })) {
      errors.push(`a profile enables workflow.materials.missingRecovery but ${error}`);
    }
    for (const { profile, profileIndex } of missingRecoveryProfiles) {
      const hasMaterials = Array.isArray(profile?.materialGroups)
        && profile.materialGroups.some((group) =>
          Array.isArray(group?.materials) && group.materials.length > 0);
      if (!hasMaterials) continue;
      const pattern = profile?.materialCodePattern;
      if (typeof pattern !== "string" || !pattern.trim()) {
        errors.push(`profiles[${profileIndex}].materialCodePattern must be non-empty when missing-material recovery is enabled for a profile with materials`);
      }
    }
  }
  const mainRetryRequested = configuredProfiles.some((profile) =>
    profile?.workflow?.submission?.maxAttempts > 1);
  const alternateRetryRequested = configuredProfiles.some((profile) =>
    (Array.isArray(profile?.workflow?.alternateEntries?.entries)
      ? profile.workflow.alternateEntries.entries : [])
      .some((entry) => entry?.submissionRetry?.maxAttempts > 1));
  if (mainRetryRequested || alternateRetryRequested) {
    const reason = alternateRetryRequested
      ? "an alternate entry enables submission retry"
      : "a profile enables workflow.submission retry";
    for (const error of validateSubmitOutcomePolicyConfig(backendAdapter, {
      required: true,
      requireRetryRules: true
    })) {
      errors.push(`${reason} but ${error}`);
    }
  }
  const materialRefreshRequested = Array.isArray(profiles) && profiles.some((profile) =>
    profile?.workflow?.materials?.refreshBeforeSubmit === true);
  if (materialRefreshRequested) {
    for (const error of validateMaterialRefreshConfig(backendAdapter)) {
      errors.push(`a profile enables workflow.materials.refreshBeforeSubmit but ${error}`);
    }
  }
  return errors;
}

export function validateNotificationWorkflowCapabilities(profiles, notificationAdapter) {
  const requested = [];
  (Array.isArray(profiles) ? profiles : []).forEach((profile, profileIndex) => {
    if (profile?.workflow?.notifications?.submissionSummary === true) {
      requested.push({ profile, profileIndex });
    }
  });
  if (requested.length === 0) return [];

  const adapter = migrateNotificationAdapter(notificationAdapter);
  if (validateNotificationAdapter(adapter).length > 0) {
    return [
      "a profile enables workflow.notifications.submissionSummary but notificationAdapter is not configured"
    ];
  }

  const events = notificationEventTypes(adapter);
  if (adapter.version === 3) {
    const errors = [];
    if (!events.includes("submission.round")) {
      errors.push("a profile enables workflow.notifications.submissionSummary but notificationAdapter does not provide submission.round");
    }
    for (const { profile, profileIndex } of requested) {
      const label = profile?.workflow?.notifications?.profileLabel;
      if (typeof label !== "string" || !label.trim()) {
        errors.push(`profiles[${profileIndex}].workflow.notifications.profileLabel is required by notificationAdapter version 3`);
      }
    }
    return errors;
  }

  return events.includes("submission.summary") ? [] : [
    "a profile enables workflow.notifications.submissionSummary but notificationAdapter does not provide submission.summary"
  ];
}

const APP_CATALOG_SETTING_KEYS = Object.freeze([
  "backendAdapter",
  "backendApiBase",
  "notifyWebhook",
  "brand",
  "updateOwner",
  "updateRepo",
  "updateSource",
  "dailyStats",
  "dailyStatsV2",
  "dailyStatsAlternateEntries",
  "webOrigin",
  "webReferer",
  "endpoints",
  "sessionInvalidHttpStatuses",
  "sessionInvalidCodes",
  "sessionInvalidMessagePatterns",
  "minAppVersionCode",
  "updatedAt"
]);

export function clientCatalog(catalog) {
  const copy = JSON.parse(JSON.stringify(catalog || {}));
  if (copy.settings && typeof copy.settings === "object") {
    copy.settings = Object.fromEntries(APP_CATALOG_SETTING_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(copy.settings, key))
      .map((key) => [key, copy.settings[key]]));
    if (Object.prototype.hasOwnProperty.call(copy.settings, "updateSource")) {
      copy.settings.updateSource = safeUpdateSourceForApp(copy.settings);
    }
    if (validateDailyStats(copy.settings.dailyStats, copy.profiles).length > 0) {
      delete copy.settings.dailyStats;
    }
    if (validateDailyStatsV2(copy.settings.dailyStatsV2, copy.profiles).length > 0) {
      delete copy.settings.dailyStatsV2;
    }
    if (validateDailyStatsAlternateEntries(copy.settings.dailyStatsAlternateEntries,
        copy.settings.dailyStatsV2, copy.profiles).length > 0) {
      delete copy.settings.dailyStatsAlternateEntries;
      // Never serve a v2 flat summary whose ordinary selectors are empty after its
      // required alternate-entry mapping has been rejected or omitted.
      if (validateDailyStatsAlternateEntries(undefined,
          copy.settings.dailyStatsV2, copy.profiles).length > 0) {
        delete copy.settings.dailyStatsV2;
      }
    }
  }
  return copy;
}

export function panelCatalog(catalog) {
  const copy = JSON.parse(JSON.stringify(catalog || {}));
  if (copy.settings?.notificationAdapter) {
    copy.settings.notificationAdapter = migrateNotificationAdapter(copy.settings.notificationAdapter);
  }
  return copy;
}

export function validateNotificationRequest(value) {
  return validateNotificationEvent(value);
}

async function sendRoundDelivery(adapter, deliveryName, data) {
  const delivery = adapter.deliveries[deliveryName];
  try {
    // Adapter and request validation run before this function. Rendering can still reject a
    // bounded-but-expansive template at the final message-size gate; treat that as a failed
    // delivery and never contact the provider with a partial or guessed payload.
    const message = renderRoundDeliveryMessage(adapter, deliveryName, data);
    const providerBody = renderNotificationBody(delivery.bodyTemplate, {
      type: "submission.round",
      message
    });
    const response = await fetch(delivery.url, {
      method: delivery.method.toUpperCase(),
      headers: { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(providerBody),
      signal: AbortSignal.timeout(delivery.timeoutMs)
    });
    const rawBody = await response.text();
    return roundDeliveryResponseSucceeded(delivery, response.status, rawBody);
  } catch {
    return false;
  }
}

async function handleRoundNotification(adapter, data) {
  const names = ["summary"];
  if (shouldSendRoundProblem(data)) names.push("problem");
  // Start every applicable delivery independently. A summary rejection must not suppress the
  // problem delivery, and vice versa.
  const results = await Promise.all(names.map(async (name) => ({
    name,
    success: await sendRoundDelivery(adapter, name, data)
  })));
  const failed = results.filter((result) => !result.success).map((result) => result.name);
  if (failed.length > 0) {
    return json({ error: "notification provider rejected one or more deliveries", failed }, 502);
  }
  return json({
    ok: true,
    deliveries: {
      summary: "sent",
      problem: names.includes("problem") ? "sent" : "skipped"
    }
  });
}

async function handleNotification(request, env) {
  if (!catalogReadAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
  const { settings } = await readProfiles(env);
  if (settings?.notificationsEnabled === false) {
    return json({ error: "notifications are disabled" }, 403);
  }
  const adapter = migrateNotificationAdapter(settings?.notificationAdapter);
  const adapterErrors = validateNotificationAdapter(adapter);
  if (adapterErrors.length) return json({ error: "notifications are not configured" }, 503);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "invalid JSON" }, 400); }
  const errors = validateNotificationRequest(body);
  if (errors.length) return json({ error: "validation failed", problems: [{ errors }] }, 400);
  if (body.type === "runtime.failure" && settings?.diagnosticsPolicy?.enabled !== true) {
    return json({ error: "runtime diagnostics are disabled" }, 403);
  }
  if (!notificationEventTypes(adapter).includes(body.type)) {
    return json({ error: "notification event is not configured" }, 403);
  }
  if (adapter.version === 3) {
    return handleRoundNotification(adapter, body.data);
  }
  const message = renderNotificationMessage(adapter, body.type, body.data);
  const providerBody = renderNotificationBody(adapter.bodyTemplate, { type: body.type, message });
  let response;
  try {
    response = await fetch(adapter.url, {
      method: adapter.method.toUpperCase(),
      headers: { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(providerBody),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    return json({ error: "notification provider unavailable" }, 502);
  }
  let responseBody;
  if (adapter.response && adapter.successStatuses.includes(response.status)) {
    try { responseBody = await response.json(); }
    catch { return json({ error: "notification provider returned an invalid response" }, 502); }
  }
  if (!notificationResponseSucceeded(adapter, response.status, responseBody)) {
    return json({ error: "notification provider rejected request", status: response.status }, 502);
  }
  return json({ ok: true, status: response.status });
}

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

/** Build the LLM user message: real template fields (the only legal ids) + draft + instructions. */
function aiUserPrompt(template, draft, instructions) {
  const fields = (template?.field_list || []).map((f) => ({
    field: f.field,
    kind: f.kind,
    title: f.title || f.en_title,
    required: !!f.required,
    conditional: f.visible === false,
    maxCount: f.count,
    options: (f.option_list || []).map((o) => ({ value: o.value, name: o.name || o.en_name }))
  }));
  return [
    "【后端模板字段（只能使用这里出现的 field 和 option value）】",
    JSON.stringify(fields, null, 2),
    "",
    "【当前草稿 profile】",
    JSON.stringify(draft, null, 2),
    "",
    "【指令】",
    instructions || "把草稿整理成可用的 v2 profile。",
    "",
    "只输出更新后的完整 profile JSON。"
  ].join("\n");
}

async function handleApi(request, env, url) {
  const path = url.pathname;

  // ---- Catalog read: app uses the read-key; panel browser uses its logged-in backend token.
  // 没有任一有效凭证 → 401(不对公网匿名开放,堵掉目录被人直接爬走的洞)。----
  if (path === "/api/profiles" && request.method === "GET") {
    const current = await readProfiles(env);
    const a = auth(request);
    let panelUser = false;
    if (a.token) {
      try {
        await verifyToken(env, a.token, a.fingerprint, resolveBackendAdapter(env, current.settings));
        panelUser = true;
      } catch {}
    }
    if (panelUser) return json(panelCatalog(current));
    if (!catalogReadAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    return json(clientCatalog(current));
  }

  // ---- Everything below requires a configured backend session. The browser obtains the session and
  // the Worker verifies it through the adapter before allowing catalog reads or mutations. ----
  const { token, fingerprint } = auth(request);
  if (!token) return json({ error: "请先登录" }, 401);
  const currentCatalog = await readProfiles(env);
  const backendAdapter = resolveBackendAdapter(env, currentCatalog.settings);
  let backendUser;
  try {
    backendUser = await verifyToken(env, token, fingerprint, backendAdapter);
  } catch {
    return json({ error: "登录已失效，请重新登录" }, 401);
  }

  if (path === "/api/me" && request.method === "GET") {
    return json(backendUser);
  }

  // Pure transform: a raw backend template (fetched browser-side, direct from the backend) -> draft profile.
  if (path === "/api/convert" && request.method === "POST") {
    const b = await request.json();
    if (!b.template) return json({ error: "template required" }, 400);
    try {
      return json({ template: b.template, draft: templateToProfile(b.template) });
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 400);
    }
  }

  if (path === "/api/ai/draft" && request.method === "POST") {
    const b = await request.json();
    const template = b.template || null; // the browser fetches templateDetail directly and passes it inline
    const draft = b.draft || (template ? templateToProfile(template) : null);
    if (!draft) return json({ error: "需要 draft 或 template" }, 400);
    const refined = await aiRefineProfile({
      baseUrl: env.AI_BASE_URL,
      apiKey: env.AI_API_KEY,
      model: env.AI_MODEL,
      user: aiUserPrompt(template || {}, draft, b.instructions),
      allowed: allowedRefs(template, draft)
    });
    const candidate = preserveRuntimeProfileConfig(refined.profile, draft);
    const profile = refined.violations.length ? draft : candidate;
    return json({ profile, violations: refined.violations });
  }

  if (path === "/api/publish" && request.method === "POST") {
    const b = await request.json();
    if (Object.prototype.hasOwnProperty.call(b, "settings")) {
      return json({ error: "global settings must be changed through /api/settings" }, 400);
    }
    if (!Number.isInteger(b.baseVersion) || b.baseVersion < 0) {
      return json({ error: "baseVersion must be a non-negative integer" }, 400);
    }
    if (b.baseVersion !== currentCatalog.version) throw new CatalogPublishConflictError();
    const incoming = Array.isArray(b.profiles) ? b.profiles : [];
    if (!incoming.length) return json({ error: "no profiles to publish" }, 400);
    // Best-effort auto-translate of zh UI labels -> {en,es} sibling maps, BEFORE validation/upsert.
    // Gated by the AI key + an opt-out (translate:false). Fill-only-when-absent unless retranslate.
    // A translate failure never blocks publish — it just surfaces a warning and stays zh-only.
    const warnings = [];
    if (env.AI_API_KEY && b.translate !== false) {
      const cfg = { baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL };
      const opts = { retranslate: b.retranslate === true };
      let anyFailed = false;
      for (const p of incoming) {
        try {
          const r = await translateProfileTitles(p, cfg, opts);
          if (r.failed) anyFailed = true;
        } catch {
          anyFailed = true; // defensive: translateProfileTitles shouldn't throw, but never block publish
        }
      }
      if (anyFailed) warnings.push("翻译失败，仅中文");
    }
    // Default: upsert by id — publishing one profile must NOT wipe the others. With replace:true, write
    // EXACTLY the given set (the only way to REMOVE a profile from the catalog).
    let finalProfiles;
    if (b.replace) {
      finalProfiles = incoming;
    } else {
      const byId = new Map(currentCatalog.profiles.map((p) => [p.id, p]));
      for (const p of incoming) byId.set(p.id, p);
      finalProfiles = [...byId.values()];
    }
    // Preserve the incoming-relative validation response (including duplicate IDs in one upsert),
    // then validate the exact merged collection that will be published. A retained legacy profile
    // may no longer ride through an otherwise valid single-profile update and create an App-invalid
    // catalog pair.
    const incomingProblems = validateProfilesForPublish(incoming, finalProfiles);
    if (incomingProblems.length) {
      return json({
        error: "validation failed",
        problems: incomingProblems
      }, 422);
    }
    const finalProblems = validateProfilesForPublish(finalProfiles);
    if (finalProblems.length) {
      return json({ error: "validation failed", problems: finalProblems }, 422);
    }
    const dailyStatsErrors = validateDailyStats(
      currentCatalog.settings?.dailyStats, finalProfiles);
    if (dailyStatsErrors.length) {
      return json({
        error: "dailyStats validation failed",
        problems: [{ errors: dailyStatsErrors }]
      }, 422);
    }
    const dailyStatsV2Errors = validateDailyStatsV2(
      currentCatalog.settings?.dailyStatsV2, finalProfiles);
    if (dailyStatsV2Errors.length) {
      return json({
        error: "dailyStatsV2 validation failed",
        problems: [{ errors: dailyStatsV2Errors }]
      }, 422);
    }
    const dailyStatsAlternateEntriesErrors = validateDailyStatsAlternateEntries(
      currentCatalog.settings?.dailyStatsAlternateEntries,
      currentCatalog.settings?.dailyStatsV2, finalProfiles);
    if (dailyStatsAlternateEntriesErrors.length) {
      return json({
        error: "dailyStatsAlternateEntries validation failed",
        problems: [{ errors: dailyStatsAlternateEntriesErrors }]
      }, 422);
    }
    const capabilityErrors = validateWorkflowCapabilities(finalProfiles, backendAdapter);
    capabilityErrors.push(...validateNotificationWorkflowCapabilities(
      finalProfiles, currentCatalog.settings?.notificationAdapter));
    if (capabilityErrors.length) {
      return json({ error: "workflow capability validation failed", problems: [{ errors: capabilityErrors }] }, 422);
    }
    const result = await publishCatalog(env, finalProfiles, {
      publicUrl: env.PUBLIC_URL || url.origin,
      notes: b.notes || "",
      expectedVersion: b.baseVersion
    });
    return json({ ok: true, ...result, total: finalProfiles.length, ...(warnings.length ? { warnings } : {}) });
  }

  // Global Panel settings. App-facing values stay beside profiles; Worker-only provider settings
  // are split into panel-settings.json by publishCatalog.
  // Optionally reorders profiles: `profiles` may be a full array or a list of ids giving the new order.
  if (path === "/api/settings" && request.method === "POST") {
    const b = await request.json();
    if (!Number.isInteger(b.baseVersion) || b.baseVersion < 0) {
      return json({ error: "baseVersion must be a non-negative integer" }, 400);
    }
    if (b.baseVersion !== currentCatalog.version) throw new CatalogPublishConflictError();
    const current = currentCatalog;
    let finalProfiles = current.profiles;
    if (Array.isArray(b.profiles) && b.profiles.length) {
      if (typeof b.profiles[0] === "string") {
        // id-order: reorder existing profiles by the given id list; unknown ids ignored, missing appended.
        const byId = new Map(current.profiles.map((p) => [p.id, p]));
        const ordered = [];
        for (const id of b.profiles) {
          if (byId.has(id)) {
            ordered.push(byId.get(id));
            byId.delete(id);
          }
        }
        finalProfiles = [...ordered, ...byId.values()];
      } else {
        // full array of profile objects -> the new set verbatim.
        finalProfiles = b.profiles;
      }
    }
    // Settings publication advances the same catalog version/hash pair consumed by the App. Even a
    // settings-only change must therefore prove that every retained profile remains executable.
    const profileProblems = validateProfilesForPublish(finalProfiles);
    if (profileProblems.length) {
      return json({ error: "validation failed", problems: profileProblems }, 422);
    }
    const settings = {};
    if (typeof b.notifyWebhook === "string") settings.notifyWebhook = b.notifyWebhook;
    if (Object.prototype.hasOwnProperty.call(b, "notificationsEnabled")) {
      if (typeof b.notificationsEnabled !== "boolean") {
        return json({ error: "notificationsEnabled must be a boolean" }, 400);
      }
      settings.notificationsEnabled = b.notificationsEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(b, "notificationAdapter")) {
      if (b.notificationAdapter === null) settings.notificationAdapter = null;
      else {
        const migrated = migrateNotificationAdapter(b.notificationAdapter);
        const errors = validateNotificationAdapter(migrated);
        if (errors.length) return json({ error: "notificationAdapter validation failed", problems: [{ errors }] }, 400);
        settings.notificationAdapter = migrated;
      }
    }
    if (Object.prototype.hasOwnProperty.call(b, "diagnosticsPolicy")) {
      if (!validDiagnosticsPolicy(b.diagnosticsPolicy)) {
        return json({ error: "diagnosticsPolicy must contain only enabled:boolean" }, 400);
      }
      settings.diagnosticsPolicy = b.diagnosticsPolicy;
    }
    if (Object.prototype.hasOwnProperty.call(b, "dailyStats")) {
      // null is an API-only deletion command. publishCatalog's object merge retains undefined in
      // memory and JSON serialization omits it, so null is never stored or served as catalog data.
      settings.dailyStats = b.dailyStats === null ? undefined : b.dailyStats;
    }
    if (Object.prototype.hasOwnProperty.call(b, "dailyStatsV2")) {
      // null is the deletion command; undefined is omitted from the published catalog JSON.
      settings.dailyStatsV2 = b.dailyStatsV2 === null ? undefined : b.dailyStatsV2;
    }
    if (Object.prototype.hasOwnProperty.call(b, "dailyStatsAlternateEntries")) {
      // null is the deletion command; undefined is omitted from the published catalog JSON.
      settings.dailyStatsAlternateEntries = b.dailyStatsAlternateEntries === null
        ? undefined : b.dailyStatsAlternateEntries;
    }
    if (typeof b.backendApiBase === "string") settings.backendApiBase = b.backendApiBase;
    if (typeof b.brand === "string") settings.brand = b.brand;
    if (Object.prototype.hasOwnProperty.call(b, "updateSource")) {
      const updateSourceErrors = validateUpdateSource(b.updateSource);
      if (updateSourceErrors.length) {
        return json({ error: "updateSource validation failed", problems: [{ errors: updateSourceErrors }] }, 400);
      }
      const updateSource = normalizeUpdateSource(b.updateSource);
      if (updateSource) {
        if (typeof b.updateOwner === "string" && b.updateOwner.trim()
            && b.updateOwner.trim() !== updateSource.owner) {
          return json({ error: "updateSource owner must match legacy updateOwner" }, 400);
        }
        if (typeof b.updateRepo === "string" && b.updateRepo.trim()
            && b.updateRepo.trim() !== updateSource.repo) {
          return json({ error: "updateSource repo must match legacy updateRepo" }, 400);
        }
        settings.updateSource = updateSource;
        // v1.0.4/v1.0.6 continue reading these exact flat coordinates.
        settings.updateOwner = updateSource.owner;
        settings.updateRepo = updateSource.repo;
      } else {
        settings.updateSource = null;
        if (typeof b.updateOwner === "string") settings.updateOwner = b.updateOwner.trim();
        if (typeof b.updateRepo === "string") settings.updateRepo = b.updateRepo.trim();
      }
    } else {
      // Legacy settings clients remain valid. With no structured contract they keep the exact old
      // owner/repo behavior; channel, tag and manifest asset are never Panel overrides.
      if (typeof b.updateOwner === "string") settings.updateOwner = b.updateOwner.trim();
      if (typeof b.updateRepo === "string") settings.updateRepo = b.updateRepo.trim();
    }
    if (typeof b.webOrigin === "string") settings.webOrigin = b.webOrigin;
    if (typeof b.webReferer === "string") settings.webReferer = b.webReferer;
    if (Object.prototype.hasOwnProperty.call(b, "minAppVersionCode")) {
      if (!Number.isInteger(b.minAppVersionCode) || b.minAppVersionCode < 0) {
        return json({ error: "minAppVersionCode must be a non-negative integer" }, 400);
      }
      settings.minAppVersionCode = b.minAppVersionCode;
    }
    if (b.endpoints && typeof b.endpoints === "object" && !Array.isArray(b.endpoints)) {
      settings.endpoints = b.endpoints;
    }
    if (Object.prototype.hasOwnProperty.call(b, "backendAdapter")) {
      const errors = validateBackendAdapter(b.backendAdapter);
      if (errors.length) return json({ error: "backendAdapter validation failed", problems: [{ errors }] }, 400);
      settings.backendAdapter = b.backendAdapter;
    }
    if (Object.prototype.hasOwnProperty.call(b, "sessionInvalidCodes")) {
      if (!validSessionInvalidCodes(b.sessionInvalidCodes)) {
        return json({ error: "sessionInvalidCodes must be an array of non-empty strings or numbers" }, 400);
      }
      settings.sessionInvalidCodes = b.sessionInvalidCodes;
    }
    if (Object.prototype.hasOwnProperty.call(b, "sessionInvalidHttpStatuses")) {
      if (!validSessionInvalidHttpStatuses(b.sessionInvalidHttpStatuses)) {
        return json({ error: "sessionInvalidHttpStatuses must contain unique integer HTTP statuses from 100 to 599" }, 400);
      }
      settings.sessionInvalidHttpStatuses = b.sessionInvalidHttpStatuses;
    }
    if (Object.prototype.hasOwnProperty.call(b, "sessionInvalidMessagePatterns")) {
      if (!validSessionInvalidMessagePatterns(b.sessionInvalidMessagePatterns)) {
        return json({ error: "sessionInvalidMessagePatterns must be an array of non-empty strings" }, 400);
      }
      settings.sessionInvalidMessagePatterns = b.sessionInvalidMessagePatterns;
    }
    settings.updatedAt = new Date().toISOString();
    const effectiveSettings = {
      ...currentCatalog.settings,
      ...settings
    };
    const dailyStatsErrors = validateDailyStats(
      effectiveSettings.dailyStats, finalProfiles);
    if (dailyStatsErrors.length) {
      return json({
        error: "dailyStats validation failed",
        problems: [{ errors: dailyStatsErrors }]
      }, 400);
    }
    const dailyStatsV2Errors = validateDailyStatsV2(
      effectiveSettings.dailyStatsV2, finalProfiles);
    if (dailyStatsV2Errors.length) {
      return json({
        error: "dailyStatsV2 validation failed",
        problems: [{ errors: dailyStatsV2Errors }]
      }, 400);
    }
    const dailyStatsAlternateEntriesErrors = validateDailyStatsAlternateEntries(
      effectiveSettings.dailyStatsAlternateEntries,
      effectiveSettings.dailyStatsV2, finalProfiles);
    if (dailyStatsAlternateEntriesErrors.length) {
      return json({
        error: "dailyStatsAlternateEntries validation failed",
        problems: [{ errors: dailyStatsAlternateEntriesErrors }]
      }, 400);
    }
    const updateCompatibilityErrors =
      validateUpdateSourceCompatibility(effectiveSettings);
    if (updateCompatibilityErrors.length) {
      return json({
        error: "updateSource compatibility validation failed",
        problems: [{ errors: updateCompatibilityErrors }]
      }, 400);
    }
    const effectiveAdapter = resolveBackendAdapter(env, {
      ...currentCatalog.settings,
      ...settings
    });
    const capabilityErrors = validateWorkflowCapabilities(finalProfiles, effectiveAdapter);
    capabilityErrors.push(...validateLegacyAppCompatibility({
      ...currentCatalog.settings,
      ...settings
    }, effectiveAdapter));
    const effectiveNotificationAdapter = Object.prototype.hasOwnProperty.call(settings, "notificationAdapter")
      ? settings.notificationAdapter : currentCatalog.settings?.notificationAdapter;
    capabilityErrors.push(...validateNotificationWorkflowCapabilities(
      finalProfiles, effectiveNotificationAdapter));
    if (capabilityErrors.length) {
      return json({ error: "workflow capability validation failed", problems: [{ errors: capabilityErrors }] }, 422);
    }
    const result = await publishCatalog(env, finalProfiles, {
      publicUrl: env.PUBLIC_URL || url.origin,
      settings,
      expectedVersion: b.baseVersion
    });
    return json({ ok: true, version: result.version });
  }

  return json({ error: "not found" }, 404);
}

function catalogTimingSafeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 目录读取鉴权:配置了 CATALOG_READ_KEY 就要求带匹配的 Bearer(app 侧);没配置则开放(本地 dev / 未启用)。
function catalogReadAuthorized(request, env) {
  if (!env.CATALOG_READ_KEY) return true;
  return catalogTimingSafeEqual(auth(request).token, env.CATALOG_READ_KEY);
}

async function handleCatalog(request, env, path) {
  if (!catalogReadAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
  const which = path.endsWith("/manifest") ? "manifest" : "form-profiles.json";
  const text = await readCatalogFile(env, which);
  if (text == null) return json({ error: "catalog not initialized" }, 404);
  return new Response(text, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      // Pairing is deliberately isolated from both the browser backend session and the catalog read
      // gate. The issuer has its own server-to-server secret; redeem consumes a short one-time ticket.
      if (isAppPairingPath(path)) return await handleAppPairingRequest(request, env, url);
      // Deployment provenance is intentionally separate from /api/config: Worker versions may
      // change while the catalog version does not, and the App treats config/catalog as one exact
      // immutable pair. This endpoint is read-key protected but never enters that pair.
      if (path === "/api/runtime-provenance" && request.method === "GET") {
        if (!catalogReadAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
        return json({
          panelRuntime: panelRuntimeFromVersionMetadata(env.CF_VERSION_METADATA)
        });
      }
      // Browser bootstrap is intentionally available before backend login so the Panel can render the
      // deployment-owned captcha/login contract without a second shared credential. It exposes only
      // the authoring subset; every catalog read and mutation still requires either the App read key
      // or a backend session verified below. Private catalog settings override the Cloudflare bootstrap.
      if (path === "/api/panel-config" && request.method === "GET") {
        let settings = {};
        if (hasCatalogStorage(env)) settings = (await readProfiles(env)).settings;
        const adapter = resolveBackendAdapter(env, settings);
        return json({ backendAdapter: panelBootstrapAdapter(adapter) });
      }
      // App-facing backend config. Same read-key gate as /catalog/* (open when CATALOG_READ_KEY unset).
      // Intercepted here (before the /api/ routing) so it uses catalogReadAuthorized, NOT the login gate.
      if (path === "/api/config" && request.method === "GET") {
        if (!catalogReadAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
        const { version: catalogVersion, settings, catalogSha256 } = await readProfiles(env);
        if (!Number.isSafeInteger(catalogVersion) || catalogVersion <= 0) {
          return json({ error: "catalog version is not a positive integer" }, 503);
        }
        if (!/^[0-9a-f]{64}$/u.test(catalogSha256)) {
          return json({ error: "catalog content digest is unavailable" }, 503);
        }
        const backendAdapter = resolveBackendAdapter(env, settings);
        const legacyCompatibilityErrors = validateLegacyAppCompatibility(
          settings, backendAdapter);
        if (legacyCompatibilityErrors.length) {
          return json({
            error: "legacy App compatibility validation failed",
            problems: [{ errors: legacyCompatibilityErrors }]
          }, 503);
        }
        const notificationAdapter = migrateNotificationAdapter(settings.notificationAdapter);
        const notificationEnabled = settings.notificationsEnabled !== false
          && validateNotificationAdapter(notificationAdapter).length === 0;
        const eventTypes = notificationEnabled
          ? notificationEventTypes(notificationAdapter) : [];
        const requestKeySha256 = await sha256Hex(auth(request).token);
        const updateSource = safeUpdateSourceForApp(settings);
        const legacyUpdate = legacyUpdateCoordinates(settings);
        return json({
          // Binds this adapter/settings response to the same immutable catalog snapshot.
          catalogVersion,
          // Old Apps preserve unknown /api/config fields verbatim. After a Panel-first rollout,
          // the next App can use this non-secret proof to bind that old cache without a network
          // round trip. It must verify every field and the exact catalog bytes before stamping;
          // a missing/mismatched proof fails closed and performs the normal online bootstrap.
          _autoFormKitLegacyCacheProof: {
            version: 1,
            panelBase: normalizedUrl(url.origin),
            keySha256: requestKeySha256,
            catalogSha256,
            catalogVersion
          },
          backendAdapter,
          notification: {
            version: notificationAdapter?.version === 3 ? 3 : 2,
            enabled: notificationEnabled,
            endpoint: "/api/notify",
            eventTypes,
            diagnosticsEnabled: settings.diagnosticsPolicy?.enabled === true
              && eventTypes.includes("runtime.failure")
          },
          // Kept during the old-App migration window. New clients consume backendAdapter only.
          backendApiBase: settings.backendApiBase || backendAdapter.baseUrl,
          notifyWebhook: settings.notifyWebhook || "",
          brand: settings.brand || "",
          updateOwner: legacyUpdate.owner,
          updateRepo: legacyUpdate.repo,
          ...(updateSource ? { updateSource } : {}),
          webOrigin: settings.webOrigin || "",
          webReferer: settings.webReferer || "",
          endpoints: backendAdapter.endpoints,
          sessionInvalidHttpStatuses: backendAdapter.auth.sessionInvalidHttpStatuses,
          sessionInvalidCodes: backendAdapter.auth.sessionInvalidCodes,
          sessionInvalidMessagePatterns: backendAdapter.auth.sessionInvalidMessagePatterns,
          updatedAt: settings.updatedAt || ""
        });
      }
      if (path === "/api/notify" && request.method === "POST") {
        return await handleNotification(request, env);
      }
      if (path.startsWith("/api/")) return await handleApi(request, env, url);
      if (path.startsWith("/catalog/")) return await handleCatalog(request, env, path);
      return env.ASSETS.fetch(request); // static SPA
    } catch (err) {
      const status = err instanceof BackendConfigurationError
        ? 503
        : (err instanceof CatalogPublishConflictError ? 409 : 500);
      return json({ error: String(err && err.message ? err.message : err) }, status);
    }
}
