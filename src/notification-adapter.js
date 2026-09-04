// Versioned JSON notification contract stored in Worker-only panel settings.
//
// Custom headers are intentionally unsupported: this private Worker setting must not become a
// general-purpose secret-header store. The App receives only the same-origin proxy endpoint. A
// deployment that needs header-based credentials can place a server-side relay in front of its provider.

// The provider contract is split across notification-adapter-*.js by concern; this file is the
// public entry point and re-exports it.

export { NOTIFICATION_ADAPTER_VERSION, NOTIFICATION_ADAPTER_ROUND_VERSION, NOTIFICATION_EVENT_SCHEMAS, SUBMISSION_ROUND_FIELDS } from "./notification-adapter-constants.js";
export { migrateNotificationAdapter, validateNotificationAdapter, notificationEventTypes, validateNotificationEvent } from "./notification-adapter-validate.js";
export { renderNotificationMessage, renderRoundDeliveryMessage, shouldSendRoundProblem, renderNotificationBody, notificationResponseSucceeded, roundDeliveryResponseSucceeded } from "./notification-adapter-render.js";
