// Reading values out of backend payloads, and normalizing a backend template into the
// canonical shape.
import { CANONICAL_FIELD_KINDS } from "./backend-adapter-constants.js";
import { clone } from "./backend-adapter-primitives.js";

/** Dot-path accessor shared by response and field mapping code. Empty path means the root value. */
export function valueAt(value, path) {
  if (path === undefined || path === null || path === "" || path === "$") return value;
  return String(path).split(".").reduce((current, key) =>
    current === undefined || current === null ? undefined : current[key], value);
}

export function firstValueAt(value, paths) {
  for (const path of paths || []) {
    const found = valueAt(value, path);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return undefined;
}

function sameBusinessValue(left, right) {
  if (typeof left === typeof right) return left === right;
  return String(left) === String(right);
}

function canonicalFieldKind(rawType, fieldKinds) {
  for (const kind of CANONICAL_FIELD_KINDS) {
    const configured = fieldKinds?.[kind] || [];
    if (configured.some((value) => sameBusinessValue(value, rawType))) return kind;
  }
  return "unknown";
}

function canonicalOption(raw, map) {
  return {
    value: valueAt(raw, map.value),
    name: valueAt(raw, map.label),
    en_name: valueAt(raw, map.englishLabel),
    num: valueAt(raw, map.quantity)
  };
}

function resultMapping(option, mappings) {
  const label = `${option.name || ""} ${option.en_name || ""}`.trim();
  return (mappings || []).find((mapping) =>
    (mapping.matchValues || []).some((value) => sameBusinessValue(value, option.value))
      || (mapping.matchLabelPatterns || []).some((pattern) => new RegExp(pattern, "i").test(label)));
}

function canonicalFormField(raw, map, optionMap, conversion) {
  const rawOptions = valueAt(raw, map.options);
  const rawType = valueAt(raw, map.type);
  const kind = canonicalFieldKind(rawType, conversion?.fieldKinds);
  const options = Array.isArray(rawOptions) ? rawOptions.map((option) => canonicalOption(option, optionMap)) : [];
  if (kind === "result") {
    options.forEach((option, index) => {
      const mapping = resultMapping(option, conversion?.result?.mappings);
      option.resultKey = mapping?.key || `option-${index + 1}`;
      option.resultLabel = mapping?.label || option.name || option.en_name || option.resultKey;
      if (mapping?.labelI18n) option.resultLabelI18n = clone(mapping.labelI18n);
      if (mapping?.operatorLabel) option.resultOperatorLabel = mapping.operatorLabel;
      if (mapping?.operatorLabelI18n) {
        option.resultOperatorLabelI18n = clone(mapping.operatorLabelI18n);
      }
      if (mapping?.uiColor) option.resultUiColor = mapping.uiColor;
      option.resultValue = mapping && Object.prototype.hasOwnProperty.call(mapping, "submitValue")
        ? clone(mapping.submitValue)
        : clone(option.value);
      option.includeInResults = mapping ? mapping.include !== false : conversion?.result?.includeUnmapped !== false;
    });
  }
  return {
    field: valueAt(raw, map.id),
    kind,
    type: rawType,
    parent_type: valueAt(raw, map.parentType),
    type_name: valueAt(raw, map.typeName),
    title: valueAt(raw, map.title),
    en_title: valueAt(raw, map.englishTitle),
    required: valueAt(raw, map.required),
    visible: valueAt(raw, map.visible),
    count: valueAt(raw, map.maxCount),
    option_list: options
  };
}

/** Convert a deployment-specific template envelope to the converter's stable public schema. */
export function canonicalTemplate(raw, adapter) {
  const map = adapter.fields.template;
  const rawFields = valueAt(raw, map.fieldList);
  return {
    id: valueAt(raw, map.id),
    name: valueAt(raw, map.name),
    sku: valueAt(raw, map.sku),
    process_id: valueAt(raw, map.step),
    warehouse_id: valueAt(raw, map.warehouseId),
    field_list: Array.isArray(rawFields)
      ? rawFields.map((field) => canonicalFormField(field, adapter.fields.formField, adapter.fields.option, adapter.conversion))
      : []
  };
}

export function templateItems(data, adapter) {
  for (const path of adapter.fields.templateList) {
    const items = valueAt(data, path);
    if (Array.isArray(items)) return items.map((item) => canonicalTemplate(item, adapter));
  }
  return [];
}

