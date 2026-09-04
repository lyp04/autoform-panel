// Resolving the effective adapter from env and catalog settings, and the redacted subset the
// browser bootstrap may see.
import { BackendConfigurationError, clone, configuredValues, isPlainObject, mergeObjects, parseObject } from "./backend-adapter-primitives.js";
import { validateBackendAdapter } from "./backend-adapter-schema.js";

/** Resolve catalog > env > legacy flat settings, while never supplying a production fallback. */
export function resolveBackendAdapter(env = {}, settings = {}) {
  const legacy = {
    baseUrl: settings.backendApiBase || env.BACKEND_API_BASE || "",
    endpoints: isPlainObject(settings.endpoints) ? settings.endpoints : {}
  };
  const fromEnv = parseObject(env.BACKEND_ADAPTER_JSON, "BACKEND_ADAPTER_JSON");
  const fromCatalog = parseObject(settings.backendAdapter, "settings.backendAdapter");
  let adapter = mergeObjects(mergeObjects(legacy, fromEnv), fromCatalog);

  // One-release migration input for deployments that already configured this old secret. It does
  // not add a business code by itself and never appears in the tracked example.
  if (adapter.auth && adapter.auth.sessionProofCodes === undefined && env.BACKEND_SESSION_PROOF_CODES) {
    adapter.auth.sessionProofCodes = configuredValues(env.BACKEND_SESSION_PROOF_CODES);
  }
  if (adapter.auth && !Object.prototype.hasOwnProperty.call(fromCatalog.auth || {}, "sessionInvalidCodes")
      && Array.isArray(settings.sessionInvalidCodes)) {
    adapter.auth.sessionInvalidCodes = clone(settings.sessionInvalidCodes);
  }
  if (adapter.auth && !Object.prototype.hasOwnProperty.call(fromCatalog.auth || {}, "sessionInvalidHttpStatuses")
      && Array.isArray(settings.sessionInvalidHttpStatuses)) {
    adapter.auth.sessionInvalidHttpStatuses = clone(settings.sessionInvalidHttpStatuses);
  }
  if (adapter.auth && !Object.prototype.hasOwnProperty.call(fromCatalog.auth || {}, "sessionInvalidMessagePatterns")
      && Array.isArray(settings.sessionInvalidMessagePatterns)) {
    adapter.auth.sessionInvalidMessagePatterns = clone(settings.sessionInvalidMessagePatterns);
  }

  const errors = validateBackendAdapter(adapter);
  if (errors.length) throw new BackendConfigurationError(errors);
  adapter.baseUrl = adapter.baseUrl.replace(/\/+$/, "");
  return adapter;
}

/** Restrict the unauthenticated bootstrap response to values required by the browser login/editor. */
export function panelBootstrapAdapter(adapter) {
  const endpointNames = ["captcha", "loginVerify", "login", "userInfo", "templateList", "templateDetail"];
  const endpoints = {};
  for (const name of endpointNames) {
    if (typeof adapter.endpoints[name] === "string" && adapter.endpoints[name]) endpoints[name] = adapter.endpoints[name];
  }
  return {
    version: adapter.version,
    baseUrl: adapter.baseUrl,
    endpoints,
    request: clone(adapter.request),
    response: clone(adapter.response),
    auth: {
      loginFields: clone(adapter.auth.loginFields),
      tokenFields: clone(adapter.auth.tokenFields),
      userNameFields: clone(adapter.auth.userNameFields),
      successFieldsWhenCodeMissing:
        clone(adapter.auth.successFieldsWhenCodeMissing),
      dataRootWhenCodeMissing: adapter.auth.dataRootWhenCodeMissing
    },
    pagination: clone(adapter.pagination),
    fields: clone(adapter.fields),
    conversion: clone(adapter.conversion)
  };
}

