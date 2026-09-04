// The /api/* routes: catalog reads, session-gated authoring, publishing and settings.
import { aiRefineProfile, allowedRefs } from "./ai.js";
import { resolveBackendAdapter, validateBackendAdapter } from "./backend-adapter.js";
import { verifyToken } from "./backend.js";
import { CatalogPublishConflictError, publishCatalog, readProfiles } from "./catalog.js";
import { templateToProfile } from "./convert.js";
import { validateDailyStats, validateDailyStatsAlternateEntries, validateDailyStatsV2 } from "./daily-stats.js";
import { migrateNotificationAdapter, validateNotificationAdapter } from "./notification-adapter.js";
import { preserveRuntimeProfileConfig } from "./profile.js";
import { translateProfileTitles } from "./translate.js";
import { normalizeUpdateSource, validateUpdateSource, validateUpdateSourceCompatibility } from "./update-source.js";
import { aiUserPrompt } from "./worker-ai-prompt.js";
import { validateNotificationWorkflowCapabilities, validateWorkflowCapabilities } from "./worker-capabilities.js";
import { catalogReadAuthorized } from "./worker-catalog-routes.js";
import { clientCatalog, panelCatalog } from "./worker-catalog-views.js";
import { validDiagnosticsPolicy, validateLegacyAppCompatibility } from "./worker-compatibility.js";
import { auth, json } from "./worker-http.js";
import { validateProfilesForPublish } from "./worker-publish-validation.js";
import { validSessionInvalidCodes, validSessionInvalidHttpStatuses, validSessionInvalidMessagePatterns } from "./worker-settings-values.js";

export async function handleApi(request, env, url) {
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
