// Alternate entry override resolvers and the references they must close.
import { RECIPE_LIMITS } from "./backend-adapter-constants.js";
import { allowOnly } from "./backend-adapter-outcome-policy.js";
import { addRequiredString, isPlainObject } from "./backend-adapter-primitives.js";
import { addBoundedAttributeArray, addRecipeId, selectorReferencesAttribute, validateRecipeBuilder, validateRecipeSelector } from "./backend-adapter-recipe-dsl.js";

function validateAlternateEntryOverrideResolver(resolver, path, errors) {
  if (!isPlainObject(resolver)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, resolver, [
    "version", "searchTextAttributes", "optionSearchTextAttributes",
    "fieldSelector", "optionSelector", "valueBuilder"
  ], path);
  if (resolver.version !== 1) errors.push(`${path}.version must be 1`);
  addBoundedAttributeArray(errors, resolver.searchTextAttributes,
    `${path}.searchTextAttributes`);
  addBoundedAttributeArray(errors, resolver.optionSearchTextAttributes,
    `${path}.optionSearchTextAttributes`);
  validateRecipeSelector(resolver.fieldSelector, `${path}.fieldSelector`, errors);
  validateRecipeSelector(resolver.optionSelector, `${path}.optionSelector`, errors);
  if (selectorReferencesAttribute(resolver.fieldSelector, "kind")) {
    errors.push(`${path}.fieldSelector must not reference kind`);
  }
  if (selectorReferencesAttribute(resolver.optionSelector, "kind")) {
    errors.push(`${path}.optionSelector must not reference kind`);
  }
  validateRecipeBuilder(resolver.valueBuilder, `${path}.valueBuilder`, errors, 0,
    ["template", "field", "option", "identity"], { count: 0, reported: false });
}

export function validateAlternateEntryOverrideResolvers(templateDetail, errors, required) {
  if (!isPlainObject(templateDetail)) {
    if (required) errors.push("operations.templateDetail must be configured");
    return;
  }
  const resolvers = templateDetail.alternateEntryResolvers;
  if (!isPlainObject(resolvers)) {
    if (required) {
      errors.push("operations.templateDetail.alternateEntryResolvers must be an object");
    }
    return;
  }
  const entries = Object.entries(resolvers);
  if (entries.length > RECIPE_LIMITS.mapEntries) {
    errors.push(`operations.templateDetail.alternateEntryResolvers must contain at most ${RECIPE_LIMITS.mapEntries} entries`);
  }
  entries.slice(0, RECIPE_LIMITS.mapEntries).forEach(([id, resolver]) => {
    addRecipeId(errors, id, `operations.templateDetail.alternateEntryResolvers.${id}`);
    validateAlternateEntryOverrideResolver(resolver,
      `operations.templateDetail.alternateEntryResolvers.${id}`, errors);
  });
}

/** Strict adapter capability check used when an entry declares live override providers. */
export function validateAlternateEntryOverrideConfig(adapter) {
  const errors = [];
  addRequiredString(errors, adapter?.endpoints?.templateDetail,
    "endpoints.templateDetail");
  addRequiredString(errors, adapter?.operations?.templateDetail?.idParam,
    "operations.templateDetail.idParam");
  validateAlternateEntryOverrideResolvers(adapter?.operations?.templateDetail, errors, true);
  return errors;
}

/** Cross-check every profile provider reference against the adapter resolver map. */
export function validateAlternateEntryOverrideReferences(adapter, providers) {
  const errors = [];
  const resolvers = adapter?.operations?.templateDetail?.alternateEntryResolvers;
  for (const item of Array.isArray(providers) ? providers : []) {
    const path = item?.path || "workflow.alternateEntries.entries[].dynamicOverrideProviders[]";
    const resolverId = item?.provider?.resolverId;
    if (typeof resolverId !== "string" || !isPlainObject(resolvers?.[resolverId])) {
      errors.push(`${path}.resolverId must reference operations.templateDetail.alternateEntryResolvers`);
    }
  }
  return errors;
}

