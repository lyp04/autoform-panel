// Ownership of payload and upload fields, and the conflicts between them.
import { isPlainObject, requireString } from "./profile-primitives.js";

export function validateOperationFields(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("operationFields must be an array");
    return;
  }
  value.forEach((item, index) => {
    const path = `operationFields[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(item.field, `${path}.field`, errors);
    if (!Object.prototype.hasOwnProperty.call(item, "value")) {
      errors.push(`${path}.value is required`);
    }
  });
}

export function validateUploadFields(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("uploadFields must be an array");
    return;
  }
  value.forEach((item, index) => {
    const path = `uploadFields[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(item.field, `${path}.field`, errors);
    if (Object.prototype.hasOwnProperty.call(item, "sources")) {
      if (!Array.isArray(item.sources)) {
        errors.push(`${path}.sources must be an array`);
      } else {
        if (item.sources.length === 0) errors.push(`${path}.sources must not be empty`);
        const seen = new Set();
        item.sources.forEach((source, sourceIndex) => {
          const sourcePath = `${path}.sources[${sourceIndex}]`;
          if (source !== "front" && source !== "back") {
            errors.push(`${sourcePath} must be front or back`);
          } else if (seen.has(source)) {
            errors.push(`${sourcePath} must be unique`);
          } else {
            seen.add(source);
          }
        });
      }
    }
  });
}

export function validatePayloadFieldOwnership(profile, errors) {
  const owners = new Map();
  const register = (field, owner) => {
    const value = typeof field === "string" ? field.trim() : "";
    if (!value) return;
    const existing = owners.get(value);
    if (existing && existing !== owner) {
      errors.push(`payload field ${JSON.stringify(value)} is owned by both ${existing} and ${owner}`);
      return;
    }
    owners.set(value, owner);
  };

  const primary = typeof profile?.snFields?.primary === "string"
    ? profile.snFields.primary.trim() : "";
  const secondary = typeof profile?.snFields?.secondary === "string"
    ? profile.snFields.secondary.trim() : "";
  register(primary, "snFields.primary");
  if (profile.requiresSecondSn === true) register(secondary, "snFields.secondary");

  (Array.isArray(profile.snPlugins) ? profile.snPlugins : []).forEach((plugin, index) => {
    if (!isPlainObject(plugin)) return;
    const key = typeof plugin.key === "string" ? plugin.key.trim() : "";
    const field = typeof plugin.field === "string" ? plugin.field.trim() : "";
    if (key === "primary") {
      if (field && primary && field !== primary) {
        errors.push(`snPlugins[${index}].field must equal snFields.primary for key=primary`);
      }
    } else if (key === "secondary") {
      if (field && secondary && field !== secondary) {
        errors.push(`snPlugins[${index}].field must equal snFields.secondary for key=secondary`);
      }
    } else {
      register(field, `snPlugins[${index}]`);
    }
  });

  const fieldLists = [
    ["uploadFields", profile.uploadFields],
    ["photoSlots", profile.photoSlots],
    ["optionalSlots", profile.optionalSlots],
    ["conditionalFields", profile.conditionalFields],
    ["operationFields", profile.operationFields],
    ["choiceFields", profile.choiceFields],
    ["materialGroups", profile.materialGroups]
  ];
  for (const [path, values] of fieldLists) {
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((item, index) => {
      const field = isPlainObject(item) && typeof item.field === "string"
        ? item.field.trim() : "";
      if (field && seen.has(field)) errors.push(`${path}[${index}].field must be unique`);
      if (field) seen.add(field);
    });
  }

  const slotMode = Array.isArray(profile.photoSlots) && profile.photoSlots.length > 0;
  const activeLists = slotMode
    ? [["photoSlots", profile.photoSlots],
      ...(profile?.workflow?.photos?.includeOptionalSlots === true
        ? [["optionalSlots", profile.optionalSlots]] : [])]
    : [["uploadFields", profile.uploadFields]];
  activeLists.push(
    ["conditionalFields", profile.conditionalFields],
    ["operationFields", profile.operationFields],
    ["choiceFields", profile.choiceFields],
    ["materialGroups", profile.materialGroups]
  );
  for (const [path, values] of activeLists) {
    (Array.isArray(values) ? values : []).forEach((item, index) => {
      if (isPlainObject(item)) register(item.field, `${path}[${index}]`);
    });
  }

  const gradeFields = new Set();
  if (isPlainObject(profile.gradeMap)) {
    for (const item of Object.values(profile.gradeMap)) {
      const field = typeof item?.field === "string" ? item.field.trim() : "";
      if (field) gradeFields.add(field);
    }
  }
  for (const field of gradeFields) register(field, "gradeMap");
}

