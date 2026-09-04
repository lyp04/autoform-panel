// Whether a settings and adapter pair stays usable by an already-signed app.
import { auth } from "./worker-http.js";
import { normalizedScalarSet, normalizedUrl } from "./worker-settings-values.js";

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

export function validDiagnosticsPolicy(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => key === "enabled")
    && typeof value.enabled === "boolean";
}
