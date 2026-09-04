// Canonical backend-template -> FormProfile converter.
//
// Deployment-specific raw field types are normalized by backendAdapter.conversion before this
// module runs. This converter deliberately does not infer roles from deployment names, localized labels,
// option codes or backend-specific type literals. Existing profile-only modules are retained from
// `seed`; an operator can finish any workflow-specific mapping in the Panel before publishing.

import { preserveRuntimeProfileConfig } from "./profile.js";

const INPUT_KINDS = new Set(["serial", "scan", "number", "text"]);
const IDENTIFIER_KINDS = new Set(["serial", "scan"]);
const CHOICE_KINDS = new Set(["singleChoice", "multipleChoice"]);

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function fieldKind(field) {
  return String(field?.kind || "unknown");
}

function slug(template) {
  const base = String(template.name || template.sku || template.id || "profile")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return base || `template-${template.id}`;
}

function uniqueResultKey(candidate, index, used) {
  const base = String(candidate || `option-${index + 1}`).trim() || `option-${index + 1}`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}-${suffix++}`;
  used.add(key);
  return key;
}

function buildResultMap(field) {
  const used = new Set();
  const map = {};
  (field.option_list || [])
    .filter((option) => option && option.value !== undefined && option.value !== null && option.includeInResults !== false)
    .forEach((option, index) => {
      const key = uniqueResultKey(option.resultKey, index, used);
      const label = option.resultLabel || option.name || option.en_name || key;
      map[key] = {
        field: field.field,
        label,
        value: cloneValue(option.resultValue === undefined ? option.value : option.resultValue)
      };
      if (option.resultLabelI18n) map[key].labelI18n = JSON.parse(JSON.stringify(option.resultLabelI18n));
      if (option.resultOperatorLabel) map[key].operatorLabel = option.resultOperatorLabel;
      if (option.resultOperatorLabelI18n) {
        map[key].operatorLabelI18n = JSON.parse(
          JSON.stringify(option.resultOperatorLabelI18n));
      }
      if (option.resultUiColor) map[key].uiColor = option.resultUiColor;
    });
  return map;
}

function toInputPlugin(field, index, primaryField) {
  const kind = fieldKind(field);
  const primary = field === primaryField;
  const candidateKey = String(field.field || "").trim();
  const extraKey = candidateKey && !["primary", "secondary"].includes(candidateKey)
    ? candidateKey : `input-${index + 1}`;
  const placeholder = field.placeholder || "请输入";
  const plugin = {
    key: primary ? "primary" : extraKey,
    label: field.title || field.en_title || field.field,
    field: field.field,
    required: !!field.required,
    search: kind === "serial",
    // Only an explicitly normalized identifier kind may occupy the App's dedicated primary
    // camera route. Backend order alone must never turn an ordinary number/text field into an
    // identifier. Additional identifier-looking fields stay non-scanning until the Panel assigns
    // a reviewed secondary role and scanner policy.
    scan: primary,
    placeholder
  };
  if (field.placeholderI18n && typeof field.placeholderI18n === "object") {
    plugin.placeholderI18n = JSON.parse(JSON.stringify(field.placeholderI18n));
  } else if (placeholder === "请输入") {
    plugin.placeholderI18n = { en: "Enter", es: "Introduzca" };
  }
  return plugin;
}

function toChoiceField(field) {
  const options = (field.option_list || [])
    .filter((option) => option && option.value !== undefined && option.value !== null && option.value !== "")
    .map((option) => ({ value: option.value, label: option.name || option.en_name || option.value }));
  const multi = fieldKind(field) === "multipleChoice";
  const hidden = field.visible === false;
  const converted = {
    field: field.field,
    title: field.title || field.en_title || field.field,
    kind: multi ? "multi" : "single",
    options,
    // The canonical template has no default-value contract. Empty is therefore the only safe
    // generated state; selecting options[0] would silently manufacture a payload assertion.
    value: multi ? [] : "",
    required: !!field.required,
    visible: !hidden
  };
  // Hidden choices are omitted by the App and multi choices already have a neutral empty set.
  // A visible single choice has no unambiguous default, so make the Panel operator explicitly
  // select/confirm its submission value before the profile can pass validation.
  if (!multi && !hidden) converted.reviewRequired = true;
  return converted;
}

export function templateToProfile(template, seed = {}) {
  if (!template || !Array.isArray(template.field_list)) {
    throw new Error("template must include field_list");
  }
  const fields = template.field_list;
  const photos = fields.filter((field) => fieldKind(field) === "photo");
  const resultField = fields.find((field) => fieldKind(field) === "result");
  const itemFields = fields.filter((field) => fieldKind(field) === "items");
  const inputFields = fields.filter((field) => INPUT_KINDS.has(fieldKind(field)));
  const primaryInputField = inputFields.find((field) => IDENTIFIER_KINDS.has(fieldKind(field)));
  const resultMap = resultField ? buildResultMap(resultField) : {};
  const snPlugins = inputFields.map((field, index) => toInputPlugin(field, index, primaryInputField));
  const primaryInputIndex = primaryInputField ? inputFields.indexOf(primaryInputField) : -1;
  const primaryInput = primaryInputIndex >= 0 ? snPlugins[primaryInputIndex] : undefined;

  const profile = {
    id: seed.id || slug(template),
    brand: seed.brand || "",
    model: seed.model || template.name || "",
    color: seed.color || "",
    displayName: seed.displayName || template.name || String(template.id),
    searchText: seed.searchText || template.name || "",
    pickerVisible: seed.pickerVisible !== false,
    requiresSecondSn: Boolean(seed.requiresSecondSn),
    graded: Object.keys(resultMap).length > 0,
    discovery: { status: "api_confirmed", source: "configured-backend-template", templateId: template.id },
    template: { id: template.id, step: template.process_id, sku: template.sku, warehouseId: template.warehouse_id },
    snFields: {
      primary: primaryInput?.field || seed.snFields?.primary || "",
      secondary: seed.snFields?.secondary || ""
    },
    snPlugins,
    snPluginsHidden: [],
    photoSlots: photos
      .filter((field) => field.required)
      .map((field) => ({
        field: field.field,
        title: field.title || field.en_title || field.field,
        minPhotos: 1,
        maxPhotos: field.count || 10,
        required: true,
        conditional: field.visible === false
      })),
    optionalSlots: photos
      .filter((field) => !field.required)
      .map((field) => ({
        field: field.field,
        title: field.title || field.en_title || field.field,
        minPhotos: 0,
        maxPhotos: field.count || 10,
        required: false
      })),
    conditionalFields: [],
    operationFields: [],
    choiceFields: fields.filter((field) => CHOICE_KINDS.has(fieldKind(field))).map(toChoiceField),
    materialGroups: itemFields.map((field) => ({
      field: field.field,
      title: field.title || field.en_title,
      selectAll: false,
      materials: (field.option_list || []).map((option) => ({
        code: option.value,
        name: option.name || option.en_name || option.value,
        aliases: [option.en_name].filter(Boolean),
        defaultQty: option.num || 1
      }))
    })),
    uiColor: seed.uiColor || "#0F766E"
  };
  if (Object.keys(resultMap).length) profile.gradeMap = resultMap;
  // With no existing profile there is nothing to preserve. Passing an empty object through the
  // preservation gate would treat every newly generated runtime module as an AI invention and
  // remove it, leaving a template-derived draft without its result/photo/input contract.
  return Object.keys(seed).length === 0 ? profile : preserveRuntimeProfileConfig(profile, seed);
}
