// Printing: status, jobs, query parameters, fields and accepted types.
import { allowOnly } from "./backend-adapter-outcome-policy.js";
import { addBusinessValueArray, addRequiredString, isPlainObject } from "./backend-adapter-primitives.js";

export function validatePrinting(adapter, errors) {
  const printing = adapter.printing;
  if (printing === undefined) return;
  if (!isPlainObject(printing)) {
    errors.push("printing must be an object");
    return;
  }
  allowOnly(errors, printing,
    ["enabled", "allowJobsArrayWhenCodeMissing", "online", "jobsPath", "query", "fields", "values", "retryIdField"], "printing");
  if (typeof printing.enabled !== "boolean") errors.push("printing.enabled must be a boolean");
  if (printing.allowJobsArrayWhenCodeMissing !== undefined
      && typeof printing.allowJobsArrayWhenCodeMissing !== "boolean") {
    errors.push("printing.allowJobsArrayWhenCodeMissing must be a boolean");
  }
  if (printing.enabled !== true) {
    if (isPlainObject(printing.online)) {
      allowOnly(errors, printing.online, ["statusPath", "values"], "printing.online");
    }
    if (isPlainObject(printing.query)) {
      allowOnly(errors, printing.query, ["serialParam", "pageParam", "pageStart"], "printing.query");
    }
    if (isPlainObject(printing.fields)) {
      allowOnly(errors, printing.fields, ["id", "serial", "type", "status"], "printing.fields");
    }
    if (isPlainObject(printing.values)) {
      allowOnly(errors, printing.values, ["acceptedTypes", "printed", "failed", "ongoing"], "printing.values");
    }
    return;
  }
  if (isPlainObject(adapter.endpoints)) {
    for (const key of ["printerState", "messageList", "labelRetry"]) {
      addRequiredString(errors, adapter.endpoints[key], `endpoints.${key}`);
    }
  }
  if (!isPlainObject(printing.online)) {
    errors.push("printing.online must be an object");
  } else {
    allowOnly(errors, printing.online, ["statusPath", "values"], "printing.online");
    addRequiredString(errors, printing.online.statusPath, "printing.online.statusPath");
    addBusinessValueArray(errors, printing.online.values, "printing.online.values");
  }
  addRequiredString(errors, printing.jobsPath, "printing.jobsPath");
  if (!isPlainObject(printing.query)) {
    errors.push("printing.query must be an object");
  } else {
    allowOnly(errors, printing.query, ["serialParam", "pageParam", "pageStart"], "printing.query");
    addRequiredString(errors, printing.query.serialParam, "printing.query.serialParam");
    addRequiredString(errors, printing.query.pageParam, "printing.query.pageParam");
    if (!Number.isInteger(printing.query.pageStart) || printing.query.pageStart < 0) {
      errors.push("printing.query.pageStart must be a non-negative integer");
    }
  }
  if (!isPlainObject(printing.fields)) {
    errors.push("printing.fields must be an object");
  } else {
    allowOnly(errors, printing.fields, ["id", "serial", "type", "status"], "printing.fields");
    for (const key of ["id", "serial", "type", "status"]) {
      addRequiredString(errors, printing.fields[key], `printing.fields.${key}`);
    }
  }
  if (!isPlainObject(printing.values)) {
    errors.push("printing.values must be an object");
  } else {
    allowOnly(errors, printing.values, ["acceptedTypes", "printed", "failed", "ongoing"], "printing.values");
    for (const key of ["acceptedTypes", "printed", "failed", "ongoing"]) {
      addBusinessValueArray(errors, printing.values[key], `printing.values.${key}`);
    }
    const statusOwners = new Map();
    for (const key of ["printed", "failed", "ongoing"]) {
      for (const value of Array.isArray(printing.values[key]) ? printing.values[key] : []) {
        const normalized = String(value).trim();
        if (!normalized) continue;
        if (statusOwners.has(normalized) && statusOwners.get(normalized) !== key) {
          errors.push(`printing.values status ${JSON.stringify(normalized)} appears in both ${statusOwners.get(normalized)} and ${key}`);
        } else {
          statusOwners.set(normalized, key);
        }
      }
    }
  }
  addRequiredString(errors, printing.retryIdField, "printing.retryIdField");
}

