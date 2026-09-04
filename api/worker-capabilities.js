// Whether the configured adapter and notification provider can actually run the workflows the
// profiles declare.
import { validateAlternateEntryOverrideConfig, validateAlternateEntryOverrideReferences, validateDuplicateDateParsingConfig, validateDynamicPreviousStepConfig, validateDynamicPreviousStepReferences, validateMaterialRefreshConfig, validatePreviousStepRecipeOutcomePolicyConfig, validatePreviousStepRecipeResponseConfig, validateSubmitOutcomePolicyConfig } from "./backend-adapter.js";
import { migrateNotificationAdapter, notificationEventTypes, validateNotificationAdapter } from "./notification-adapter.js";

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
