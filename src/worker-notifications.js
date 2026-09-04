// Notification requests: their shape, round delivery, and the notify endpoint.
import { readProfiles } from "./catalog.js";
import { migrateNotificationAdapter, notificationEventTypes, notificationResponseSucceeded, renderNotificationBody, renderNotificationMessage, renderRoundDeliveryMessage, roundDeliveryResponseSucceeded, shouldSendRoundProblem, validateNotificationAdapter, validateNotificationEvent } from "./notification-adapter.js";
import { catalogReadAuthorized } from "./worker-catalog-routes.js";
import { json } from "./worker-http.js";

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

export async function handleNotification(request, env) {
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
