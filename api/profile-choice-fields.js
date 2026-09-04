// Choice fields: option shape, uniqueness, and the values a choice may submit.
import { isPlainObject, requireString } from "./profile-primitives.js";
import { jsonValuesEqual } from "./profile-runtime-config.js";

export function validateChoiceFields(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("choiceFields must be an array");
    return;
  }
  value.forEach((choice, index) => {
    const path = `choiceFields[${index}]`;
    if (!isPlainObject(choice)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireString(choice.field, `${path}.field`, errors);
    for (const flag of ["required", "visible"]) {
      if (choice[flag] !== undefined && typeof choice[flag] !== "boolean") {
        errors.push(`${path}.${flag} must be a boolean`);
      }
    }
    if (choice.reviewRequired !== undefined && typeof choice.reviewRequired !== "boolean") {
      errors.push(`${path}.reviewRequired must be a boolean`);
    } else if (choice.reviewRequired === true) {
      errors.push(`${path}.reviewRequired must be false before publish`);
    }

    const optionValues = [];
    if (!Array.isArray(choice.options)) {
      errors.push(`${path}.options must be an array`);
    } else {
      if (choice.options.length === 0) errors.push(`${path}.options must not be empty`);
      choice.options.forEach((option, optionIndex) => {
        const optionPath = `${path}.options[${optionIndex}]`;
        if (!isPlainObject(option)) {
          errors.push(`${optionPath} must be an object`);
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(option, "value")) {
          errors.push(`${optionPath}.value is required`);
        } else if (!isChoiceOptionValue(option.value)) {
          errors.push(`${optionPath}.value must be a non-empty JSON scalar`);
        } else {
          if (optionValues.some((candidate) => jsonValuesEqual(candidate, option.value))) {
            errors.push(`${optionPath}.value must be unique`);
          }
          optionValues.push(option.value);
        }
        requireString(option.label, `${optionPath}.label`, errors);
      });
    }

    const isDeclaredOption = (selected) => optionValues.some(
      (candidate) => jsonValuesEqual(candidate, selected)
    );
    if (choice.kind === "multi") {
      if (!Array.isArray(choice.value)) {
        errors.push(`${path}.value must be an array for a multi choice`);
      } else {
        for (const selected of choice.value) {
          if (!isDeclaredOption(selected)) {
            errors.push(`${path}.value ${JSON.stringify(selected)} is not one of its options`);
          }
        }
        if (choice.required === true && choice.value.length === 0) {
          errors.push(`${path} is required but nothing is selected`);
        }
      }
    } else if (choice.kind === "single") {
      if (typeof choice.value !== "string") {
        errors.push(`${path}.value must be a string for a single choice`);
      } else if (choice.value === "") {
        if (choice.required === true) errors.push(`${path} is required but nothing is selected`);
      } else if (!isDeclaredOption(choice.value)) {
        errors.push(`${path}.value ${JSON.stringify(choice.value)} is not one of its options`);
      }
    } else {
      errors.push(`${path}.kind must be "single" or "multi"`);
    }
  });
}

function isChoiceOptionValue(value) {
  if (typeof value === "string") return value.trim() !== "";
  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

