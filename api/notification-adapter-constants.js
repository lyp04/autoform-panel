// Versions, allowed key sets, patterns, limits and the event schemas the contract is pinned to.

export const NOTIFICATION_ADAPTER_VERSION = 2;

export const NOTIFICATION_ADAPTER_ROUND_VERSION = 3;

export const V2_ALLOWED_KEYS = new Set([
  "version", "url", "method", "bodyTemplate", "eventTemplates", "successStatuses", "response"
]);

export const V3_ALLOWED_KEYS = new Set(["version", "deliveries"]);

export const V3_DELIVERY_NAMES = Object.freeze(["summary", "problem"]);

export const V3_DELIVERY_KEYS = new Set([
  "url", "method", "bodyTemplate", "messageTemplate", "formatters", "successStatuses",
  "response", "timeoutMs"
]);

export const V3_RESPONSE_KEYS = new Set(["textContains"]);

export const V3_FORMATTER_TYPES = new Set(["length", "list", "isoLocalSeconds", "groupedCountList"]);

export const V3_FORMATTER_KEYS = Object.freeze({
  length: new Set(["type"]),
  list: new Set(["type", "empty", "separator", "prefixEach"]),
  isoLocalSeconds: new Set(["type"]),
  groupedCountList: new Set([
    "type", "empty", "groupSeparator", "itemSeparator", "groupTemplate", "itemTemplate"
  ])
});

export const ALLOWED_METHODS = new Set(["POST", "PUT", "PATCH"]);

export const EVENT_TYPE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const DATA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const MAX_ROUND_COUNT = 1_000_000;

export const MAX_ROUND_ITEMS = 100;

export const MAX_LABEL_LENGTH = 160;

export const MAX_IDENTIFIER_LENGTH = 128;

export const MAX_DETAIL_LENGTH = 512;

export const MAX_TIMESTAMP_LENGTH = 40;

export const MAX_MESSAGE_TEMPLATE_TOKENS = 128;

export const MAX_MESSAGE_CONDITIONAL_DEPTH = 4;

export const MAX_FORMATTER_TEXT_LENGTH = 512;

export const MAX_FORMATTER_SEPARATOR_LENGTH = 64;

export const MAX_FORMATTER_TEMPLATE_LENGTH = 1000;

export const MAX_RENDERED_MESSAGE_LENGTH = 128_000;

export const NOTIFICATION_EVENT_SCHEMAS = Object.freeze({
  "submission.summary": Object.freeze({
    success: "boolean",
    submittedCount: "nonNegativeInteger",
    errorCount: "nonNegativeInteger",
    unconfirmedPrintCount: "nonNegativeInteger",
    missingMaterialTypeCount: "nonNegativeInteger",
    newMissingMaterialTypeCount: "nonNegativeInteger",
    recoveredMaterialTypeCount: "nonNegativeInteger",
    networkAffectedCount: "nonNegativeInteger"
  }),
  "runtime.failure": Object.freeze({
    stage: "failureStage",
    errorCode: "failureCode",
    subphase: "failureSubphase",
    fingerprint: "fingerprint",
    appVersion: "appVersion",
    gitHead: "gitHead",
    androidSdk: "nonNegativeInteger",
    networkTransport: "networkTransport",
    networkValidated: "boolean",
    networkCaptive: "boolean",
    networkInternet: "boolean",
    networkMetered: "boolean",
    networkVpn: "boolean"
  })
});

export const SUBMISSION_ROUND_FIELD_SHAPE = Object.freeze({
  success: "boolean",
  profileLabel: "string",
  operatorLabel: "string",
  completedAt: "isoOffsetDateTime",
  submittedCount: "integer",
  missingItems: "countedItemArray",
  newMissingItems: "stringArray",
  recoveredItems: "stringArray",
  errors: "stringArray",
  unconfirmedIdentifiers: "stringArray",
  networkAffectedIdentifiers: "stringArray"
});

export const SUBMISSION_ROUND_FIELDS = Object.freeze(Object.keys(SUBMISSION_ROUND_FIELD_SHAPE));

export const MIGRATED_SUBMISSION_TEMPLATE = [
  "Submission summary:",
  "submitted={{submittedCount}}, errors={{errorCount}},",
  "unconfirmed={{unconfirmedPrintCount}}, missing types={{missingMaterialTypeCount}},",
  "new missing types={{newMissingMaterialTypeCount}}, recovered types={{recoveredMaterialTypeCount}},",
  "network affected={{networkAffectedCount}}"
].join(" ");
