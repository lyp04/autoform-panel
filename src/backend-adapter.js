// Versioned contract shared by the panel browser, Worker and Android app.
//
// Deployment-specific values come from BACKEND_ADAPTER_JSON (Cloudflare var/secret) or from the
// private catalog's settings.backendAdapter. Public source code deliberately contains no live API
// host, endpoint path, business success code or backend field name.

// The contract is split across backend-adapter-*.js by concern; this file is the public entry
// point and re-exports it, so importers do not need to know the internal layout.

export { BACKEND_ADAPTER_VERSION, CONTROLLED_RECOVERY_VERSION, CONTROLLED_RECOVERY_OPERATIONS, SUBMIT_OUTCOME_POLICY_VERSION, PREVIOUS_STEP_RECIPE_OUTCOME_POLICY_VERSION } from "./backend-adapter-constants.js";
export { BackendConfigurationError } from "./backend-adapter-primitives.js";
export { validateSubmitOutcomePolicyConfig, validatePreviousStepRecipeOutcomePolicyConfig } from "./backend-adapter-outcome-policy.js";
export { validateBackendAdapter } from "./backend-adapter-schema.js";
export { validateControlledRecoveryConfig } from "./backend-adapter-recovery.js";
export { validatePreviousStepRecipeResponseConfig } from "./backend-adapter-previous-step-response.js";
export { validateDynamicPreviousStepConfig, validateDynamicPreviousStepReferences } from "./backend-adapter-dynamic-previous-step.js";
export { validateAlternateEntryOverrideConfig, validateAlternateEntryOverrideReferences } from "./backend-adapter-alternate-overrides.js";
export { validateDuplicateDateParsingConfig, validateMaterialRefreshConfig } from "./backend-adapter-duplicate-date.js";
export { resolveBackendAdapter, panelBootstrapAdapter } from "./backend-adapter-resolve.js";
export { valueAt, firstValueAt, canonicalTemplate, templateItems } from "./backend-adapter-template.js";
