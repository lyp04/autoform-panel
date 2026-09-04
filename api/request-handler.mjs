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

import { handleApi } from "./worker-api-routes.js";
import { catalogReadAuthorized, handleCatalog } from "./worker-catalog-routes.js";
import { validateLegacyAppCompatibility } from "./worker-compatibility.js";
import { auth, json } from "./worker-http.js";
import { handleNotification } from "./worker-notifications.js";
import { normalizedUrl } from "./worker-settings-values.js";

// The request pipeline lives in worker-*.js by concern; this file wires them to the Worker
// entry point and re-exports the pieces other modules and the tests import.

export { validateLegacyAppCompatibility } from "./worker-compatibility.js";
export { validateWorkflowCapabilities, validateNotificationWorkflowCapabilities } from "./worker-capabilities.js";
export { clientCatalog, panelCatalog } from "./worker-catalog-views.js";
export { validateNotificationRequest } from "./worker-notifications.js";
export { validateProfilesForPublish } from "./worker-publish-validation.js";

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
