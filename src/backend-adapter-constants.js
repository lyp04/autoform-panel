// Endpoint keys, required field names, canonical field kinds and the version constants the
// contract is pinned to.

export const BACKEND_ADAPTER_VERSION = 1;

export const RESULT_OPERATOR_LABEL_MAX_LENGTH = 160;

export const AUTHORING_ENDPOINTS = Object.freeze([
  "captcha",
  "login",
  "userInfo",
  "templateList",
  "templateDetail"
]);

export const CORE_APP_ENDPOINTS = Object.freeze([
  "uploadFile",
  "submitEntry"
]);

export const REQUIRED_TEMPLATE_FIELDS = Object.freeze([
  "id",
  "name",
  "sku",
  "step",
  "warehouseId",
  "fieldList"
]);

export const REQUIRED_FORM_FIELDS = Object.freeze([
  "id",
  "type",
  "parentType",
  "typeName",
  "title",
  "englishTitle",
  "required",
  "visible",
  "maxCount",
  "options"
]);

export const REQUIRED_OPTION_FIELDS = Object.freeze(["value", "label", "englishLabel", "quantity"]);

export const CANONICAL_FIELD_KINDS = Object.freeze([
  "photo",
  "result",
  "items",
  "serial",
  "scan",
  "number",
  "singleChoice",
  "multipleChoice",
  "text"
]);

export const RECIPE_SELECTOR_ATTRIBUTES = Object.freeze([
  "id",
  "kind",
  "type",
  "parentType",
  "typeName",
  "title",
  "englishTitle",
  "searchText",
  "required",
  "visible",
  "hasOptions"
]);

export const RECIPE_SEARCH_TEXT_ATTRIBUTES = Object.freeze([
  "id", "type", "parentType", "typeName", "title", "englishTitle"
]);

export const RECIPE_BUILDER_TYPES = Object.freeze([
  "literal", "present", "firstNonEmpty", "integer", "object"
]);

export const RECIPE_CARDINALITIES = Object.freeze([
  "exactly_one", "first_in_backend_order"
]);

export const RECIPE_ACTION_TYPES = Object.freeze([
  "serial", "photo", "fixedOption", "omit"
]);

export const RECIPE_PATH_KEYS = Object.freeze({
  template: Object.freeze(["id", "name", "sku", "step", "warehouseId", "fieldList"]),
  field: Object.freeze([
    "id", "type", "parentType", "typeName", "title", "englishTitle", "required",
    "visible", "maxCount", "options", "kind", "searchText", "hasOptions"
  ]),
  option: Object.freeze(["id", "title", "englishTitle", "quantity", "searchText", "hasOptions"]),
  input: Object.freeze(["serial"]),
  identity: Object.freeze(["templateId", "expectedStep", "warehouseId", "sku"])
});

export const RECIPE_LIMITS = Object.freeze({
  mapEntries: 32,
  rules: 32,
  selectorPredicates: 16,
  selectorTotalPredicates: 32,
  arrayItems: 16,
  builderDepth: 8,
  builderNodes: 512,
  objectMembers: 32,
  literalDepth: 12,
  literalItems: 256,
  idLength: 128,
  stringLength: 4096
});

export const CONTROLLED_RECOVERY_VERSION = 1;

export const CONTROLLED_RECOVERY_OPERATIONS = Object.freeze([
  "FINAL_SUBMISSION",
  "PREVIOUS_STEP_RECIPE",
  "MULTIPART_UPLOAD"
]);

export const SUBMIT_OUTCOME_POLICY_VERSION = 1;

export const PREVIOUS_STEP_RECIPE_OUTCOME_POLICY_VERSION = 1;

export const ENDPOINT_KEYS = Object.freeze([
  ...AUTHORING_ENDPOINTS,
  ...CORE_APP_ENDPOINTS,
  "loginVerify",
  "printerState",
  "messageList",
  "labelRetry",
  "detectionData",
  "snRepetition"
]);

