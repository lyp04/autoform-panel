// The recipe language: predicates, selectors, paths, literals, builders, actions and
// resolvers.
import { RECIPE_ACTION_TYPES, RECIPE_BUILDER_TYPES, RECIPE_CARDINALITIES, RECIPE_LIMITS, RECIPE_PATH_KEYS, RECIPE_SEARCH_TEXT_ATTRIBUTES, RECIPE_SELECTOR_ATTRIBUTES } from "./backend-adapter-constants.js";
import { allowOnly } from "./backend-adapter-outcome-policy.js";
import { isPlainObject } from "./backend-adapter-primitives.js";

function recipeId(value) {
  return typeof value === "string" && value.trim() !== ""
    && value.length <= RECIPE_LIMITS.idLength
    && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

export function addRecipeId(errors, value, path) {
  if (!recipeId(value)) {
    errors.push(`${path} must match [A-Za-z][A-Za-z0-9_.-]* and contain at most ${RECIPE_LIMITS.idLength} characters`);
  }
}

export function addBoundedAttributeArray(errors, value, path) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > RECIPE_SEARCH_TEXT_ATTRIBUTES.length) {
    errors.push(`${path} must contain at most ${RECIPE_SEARCH_TEXT_ATTRIBUTES.length} items`);
  }
  const seen = new Set();
  value.forEach((attribute, index) => {
    if (!RECIPE_SEARCH_TEXT_ATTRIBUTES.includes(attribute)) {
      errors.push(`${path}[${index}] must be one of: ${RECIPE_SEARCH_TEXT_ATTRIBUTES.join(", ")}`);
    } else if (seen.has(attribute)) {
      errors.push(`${path}[${index}] must not be duplicated`);
    }
    seen.add(attribute);
  });
}

function validateRecipePredicate(predicate, path, errors, knownKinds) {
  if (!isPlainObject(predicate)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, predicate,
    ["attribute", "caseSensitive", "equalsAny", "containsAny", "present"], path);
  if (!RECIPE_SELECTOR_ATTRIBUTES.includes(predicate.attribute)) {
    errors.push(`${path}.attribute must be one of: ${RECIPE_SELECTOR_ATTRIBUTES.join(", ")}`);
  }
  if (typeof predicate.caseSensitive !== "boolean") {
    errors.push(`${path}.caseSensitive must be a boolean`);
  }
  const operators = ["equalsAny", "containsAny", "present"]
    .filter((key) => Object.prototype.hasOwnProperty.call(predicate, key));
  if (operators.length !== 1) {
    errors.push(`${path} must contain exactly one of: equalsAny, containsAny, present`);
    return;
  }
  const operator = operators[0];
  if (operator === "present") {
    if (typeof predicate.present !== "boolean") errors.push(`${path}.present must be a boolean`);
    return;
  }
  const values = predicate[operator];
  if (!Array.isArray(values) || values.length === 0) {
    errors.push(`${path}.${operator} must be a non-empty array`);
    return;
  }
  if (values.length > RECIPE_LIMITS.arrayItems) {
    errors.push(`${path}.${operator} must contain at most ${RECIPE_LIMITS.arrayItems} items`);
  }
  values.forEach((item, index) => {
    if (operator === "containsAny") {
      if (typeof item !== "string" || item.length === 0
          || item.length > RECIPE_LIMITS.stringLength) {
        errors.push(`${path}.${operator}[${index}] must be a non-empty string of at most ${RECIPE_LIMITS.stringLength} characters`);
      }
      return;
    }
    const scalar = item === null || typeof item === "string" || typeof item === "boolean"
      || (typeof item === "number" && Number.isFinite(item));
    if (!scalar || (typeof item === "string" && item.length > RECIPE_LIMITS.stringLength)) {
      errors.push(`${path}.${operator}[${index}] must be a bounded JSON scalar`);
    }
  });
  if (predicate.attribute === "kind" && operator === "containsAny") {
    errors.push(`${path}.containsAny is not supported for attribute=kind`);
  }
  if (predicate.attribute === "kind" && operator === "equalsAny" && knownKinds instanceof Set) {
    values.forEach((item, index) => {
      if (typeof item !== "string" || !knownKinds.has(item)) {
        errors.push(`${path}.equalsAny[${index}] must reference kindSelectors.kind`);
      }
    });
  }
}

export function validateRecipeSelector(selector, path, errors, knownKinds = null) {
  if (!isPlainObject(selector)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, selector, ["allOf", "anyOf", "noneOf"], path);
  let count = 0;
  for (const key of ["allOf", "anyOf", "noneOf"]) {
    if (!Object.prototype.hasOwnProperty.call(selector, key)) continue;
    const predicates = selector[key];
    if (!Array.isArray(predicates) || predicates.length === 0) {
      errors.push(`${path}.${key} must be a non-empty array`);
      continue;
    }
    if (predicates.length > RECIPE_LIMITS.selectorPredicates) {
      errors.push(`${path}.${key} must contain at most ${RECIPE_LIMITS.selectorPredicates} predicates`);
    }
    count += predicates.length;
    predicates.slice(0, RECIPE_LIMITS.selectorPredicates).forEach((predicate, index) =>
      validateRecipePredicate(predicate, `${path}.${key}[${index}]`, errors, knownKinds));
  }
  if (count === 0) errors.push(`${path} must contain at least one predicate`);
  if (count > RECIPE_LIMITS.selectorTotalPredicates) {
    errors.push(`${path} must contain at most ${RECIPE_LIMITS.selectorTotalPredicates} predicates in total`);
  }
}

export function selectorReferencesAttribute(selector, attribute) {
  if (!isPlainObject(selector)) return false;
  return ["allOf", "anyOf", "noneOf"].some((key) =>
    Array.isArray(selector[key])
      && selector[key].some((predicate) => predicate?.attribute === attribute));
}

function validateRecipePath(value, path, errors, allowedRoots = Object.keys(RECIPE_PATH_KEYS)) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    errors.push(`${path} must be a non-empty path of at most 512 characters`);
    return;
  }
  const segments = value.split(".");
  if (!allowedRoots.includes(segments[0]) || segments.length < 2 || segments.length > 16
      || segments.some((segment) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(segment)
        || ["__proto__", "prototype", "constructor"].includes(segment))) {
    errors.push(`${path} must be a bounded mapped path rooted at template, field, option, input or identity`);
  } else if (!RECIPE_PATH_KEYS[segments[0]].includes(segments[1])) {
    errors.push(`${path} must reference a supported ${segments[0]} attribute`);
  }
}

function validateRecipeLiteral(value, path, errors, depth = 0, state = { items: 0 }) {
  if (depth > RECIPE_LIMITS.literalDepth) {
    errors.push(`${path} exceeds maximum literal depth ${RECIPE_LIMITS.literalDepth}`);
    return;
  }
  state.items += 1;
  if (state.items > RECIPE_LIMITS.literalItems) {
    if (state.items === RECIPE_LIMITS.literalItems + 1) {
      errors.push(`${path} exceeds maximum literal size ${RECIPE_LIMITS.literalItems}`);
    }
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} must contain only finite JSON numbers`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > RECIPE_LIMITS.stringLength) {
      errors.push(`${path} string must contain at most ${RECIPE_LIMITS.stringLength} characters`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > RECIPE_LIMITS.literalItems) {
      errors.push(`${path} array must contain at most ${RECIPE_LIMITS.literalItems} items`);
    }
    value.slice(0, RECIPE_LIMITS.literalItems).forEach((item, index) =>
      validateRecipeLiteral(item, `${path}[${index}]`, errors, depth + 1, state));
    return;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > RECIPE_LIMITS.literalItems) {
      errors.push(`${path} object must contain at most ${RECIPE_LIMITS.literalItems} members`);
    }
    entries.slice(0, RECIPE_LIMITS.literalItems).forEach(([key, item]) => {
      if (!recipeId(key) || ["__proto__", "prototype", "constructor"].includes(key)) {
        errors.push(`${path}.${key} is not a safe bounded member name`);
      }
      validateRecipeLiteral(item, `${path}.${key}`, errors, depth + 1, state);
    });
    return;
  }
  errors.push(`${path} must be JSON data`);
}

export function validateRecipeBuilder(builder, path, errors, depth = 0,
                               allowedRoots = Object.keys(RECIPE_PATH_KEYS),
                               budget = { count: 0, reported: false }) {
  if (!isPlainObject(builder)) {
    errors.push(`${path} must be a builder object`);
    return;
  }
  budget.count += 1;
  if (budget.count > RECIPE_LIMITS.builderNodes) {
    if (!budget.reported) {
      errors.push(`${path} exceeds maximum builder node count ${RECIPE_LIMITS.builderNodes}`);
      budget.reported = true;
    }
    return;
  }
  if (depth > RECIPE_LIMITS.builderDepth) {
    errors.push(`${path} exceeds maximum builder depth ${RECIPE_LIMITS.builderDepth}`);
    return;
  }
  if (!RECIPE_BUILDER_TYPES.includes(builder.type)) {
    errors.push(`${path}.type must be one of: ${RECIPE_BUILDER_TYPES.join(", ")}`);
    return;
  }
  if (builder.type === "literal") {
    allowOnly(errors, builder, ["type", "value"], path);
    if (!Object.prototype.hasOwnProperty.call(builder, "value")) errors.push(`${path}.value is required`);
    else validateRecipeLiteral(builder.value, `${path}.value`, errors);
    return;
  }
  if (builder.type === "present") {
    allowOnly(errors, builder, ["type", "path", "fallbackIfMissing"], path);
    validateRecipePath(builder.path, `${path}.path`, errors, allowedRoots);
    if (!Object.prototype.hasOwnProperty.call(builder, "fallbackIfMissing")) {
      errors.push(`${path}.fallbackIfMissing is required`);
    } else {
      validateRecipeLiteral(builder.fallbackIfMissing, `${path}.fallbackIfMissing`, errors);
    }
    return;
  }
  if (builder.type === "firstNonEmpty") {
    allowOnly(errors, builder, ["type", "paths"], path);
    if (!Array.isArray(builder.paths) || builder.paths.length === 0) {
      errors.push(`${path}.paths must be a non-empty array`);
    } else {
      if (builder.paths.length > RECIPE_LIMITS.arrayItems) {
        errors.push(`${path}.paths must contain at most ${RECIPE_LIMITS.arrayItems} items`);
      }
      const seen = new Set();
      builder.paths.slice(0, RECIPE_LIMITS.arrayItems).forEach((item, index) => {
        validateRecipePath(item, `${path}.paths[${index}]`, errors, allowedRoots);
        if (seen.has(item)) errors.push(`${path}.paths[${index}] must not be duplicated`);
        seen.add(item);
      });
    }
    return;
  }
  if (builder.type === "integer") {
    allowOnly(errors, builder, ["type", "path", "default"], path);
    validateRecipePath(builder.path, `${path}.path`, errors, allowedRoots);
    if (!Number.isSafeInteger(builder.default)) errors.push(`${path}.default must be a safe integer`);
    return;
  }
  allowOnly(errors, builder, ["type", "members"], path);
  if (!isPlainObject(builder.members) || Object.keys(builder.members).length === 0) {
    errors.push(`${path}.members must be a non-empty object`);
    return;
  }
  const entries = Object.entries(builder.members);
  if (entries.length > RECIPE_LIMITS.objectMembers) {
    errors.push(`${path}.members must contain at most ${RECIPE_LIMITS.objectMembers} members`);
  }
  entries.slice(0, RECIPE_LIMITS.objectMembers).forEach(([key, member]) => {
    if (!recipeId(key) || key.includes(".")
        || ["__proto__", "prototype", "constructor"].includes(key)) {
      errors.push(`${path}.members.${key} is not a safe bounded member name`);
    }
    validateRecipeBuilder(member, `${path}.members.${key}`, errors, depth + 1,
      allowedRoots, budget);
  });
}

function validateOptionSelector(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, value, ["selector", "cardinality", "literalOverride"], path);
  validateRecipeSelector(value.selector, `${path}.selector`, errors);
  if (!RECIPE_CARDINALITIES.includes(value.cardinality)) {
    errors.push(`${path}.cardinality must be one of: ${RECIPE_CARDINALITIES.join(", ")}`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "literalOverride")) {
    validateRecipeLiteral(value.literalOverride, `${path}.literalOverride`, errors);
  }
}

function validateRecipeAction(action, path, errors, builderIds) {
  if (!isPlainObject(action)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!RECIPE_ACTION_TYPES.includes(action.type)) {
    errors.push(`${path}.type must be one of: ${RECIPE_ACTION_TYPES.join(", ")}`);
    return;
  }
  if (action.type === "serial") {
    allowOnly(errors, action, ["type"], path);
    return;
  }
  if (action.type === "photo") {
    allowOnly(errors, action, ["type", "source", "joinWith"], path);
    addRecipeId(errors, action.source, `${path}.source`);
    if (typeof action.joinWith !== "string"
        || action.joinWith.length > RECIPE_LIMITS.stringLength) {
      errors.push(`${path}.joinWith must be a string of at most ${RECIPE_LIMITS.stringLength} characters`);
    }
    return;
  }
  if (action.type === "omit") {
    allowOnly(errors, action, ["type", "allowRequired"], path);
    if (typeof action.allowRequired !== "boolean") errors.push(`${path}.allowRequired must be a boolean`);
    return;
  }
  allowOnly(errors, action,
    ["type", "optionSelectors", "valueBuilder", "onNoMatch"], path);
  if (!Array.isArray(action.optionSelectors) || action.optionSelectors.length === 0) {
    errors.push(`${path}.optionSelectors must be a non-empty array`);
  } else {
    if (action.optionSelectors.length > RECIPE_LIMITS.arrayItems) {
      errors.push(`${path}.optionSelectors must contain at most ${RECIPE_LIMITS.arrayItems} items`);
    }
    action.optionSelectors.slice(0, RECIPE_LIMITS.arrayItems).forEach((selector, index) =>
      validateOptionSelector(selector, `${path}.optionSelectors[${index}]`, errors));
  }
  addRecipeId(errors, action.valueBuilder, `${path}.valueBuilder`);
  if (recipeId(action.valueBuilder) && !builderIds.has(action.valueBuilder)) {
    errors.push(`${path}.valueBuilder must reference operations.previousSteps.optionValueBuilders`);
  }
  if (!["reject", "use_value_builder"].includes(action.onNoMatch)) {
    errors.push(`${path}.onNoMatch must be one of: reject, use_value_builder`);
  }
}

export function validateRecipeResolver(resolver, path, errors, builderIds, builderBudget) {
  if (!isPlainObject(resolver)) {
    errors.push(`${path} must be an object`);
    return;
  }
  allowOnly(errors, resolver,
    ["version", "identity", "searchTextAttributes", "optionSearchTextAttributes", "kindSelectors", "rules"], path);
  if (resolver.version !== 1) errors.push(`${path}.version must be 1`);
  if (!isPlainObject(resolver.identity)) {
    errors.push(`${path}.identity must be an object`);
  } else {
    allowOnly(errors, resolver.identity,
      ["templateId", "expectedStep", "warehouseId", "sku"], `${path}.identity`);
    for (const key of ["templateId", "expectedStep", "warehouseId", "sku"]) {
      if (!Object.prototype.hasOwnProperty.call(resolver.identity, key)) {
        errors.push(`${path}.identity.${key} is required`);
      } else {
        validateRecipeBuilder(resolver.identity[key], `${path}.identity.${key}`, errors, 0,
          ["template", "input"], builderBudget);
      }
    }
  }
  addBoundedAttributeArray(errors, resolver.searchTextAttributes,
    `${path}.searchTextAttributes`);
  addBoundedAttributeArray(errors, resolver.optionSearchTextAttributes,
    `${path}.optionSearchTextAttributes`);
  const kinds = new Set();
  if (!Array.isArray(resolver.kindSelectors)) {
    errors.push(`${path}.kindSelectors must be an array`);
  } else {
    if (resolver.kindSelectors.length === 0) {
      errors.push(`${path}.kindSelectors must be non-empty`);
    }
    if (resolver.kindSelectors.length > RECIPE_LIMITS.rules) {
      errors.push(`${path}.kindSelectors must contain at most ${RECIPE_LIMITS.rules} items`);
    }
    resolver.kindSelectors.slice(0, RECIPE_LIMITS.rules).forEach((item, index) => {
      const itemPath = `${path}.kindSelectors[${index}]`;
      if (!isPlainObject(item)) {
        errors.push(`${itemPath} must be an object`);
        return;
      }
      allowOnly(errors, item, ["kind", "selector"], itemPath);
      addRecipeId(errors, item.kind, `${itemPath}.kind`);
      if (recipeId(item.kind) && kinds.has(item.kind)) errors.push(`${itemPath}.kind must be unique`);
      kinds.add(item.kind);
      validateRecipeSelector(item.selector, `${itemPath}.selector`, errors);
      if (selectorReferencesAttribute(item.selector, "kind")) {
        errors.push(`${itemPath}.selector must not derive kind from kind`);
      }
    });
  }
  if (!Array.isArray(resolver.rules) || resolver.rules.length === 0) {
    errors.push(`${path}.rules must be a non-empty array`);
  } else {
    if (resolver.rules.length > RECIPE_LIMITS.rules) {
      errors.push(`${path}.rules must contain at most ${RECIPE_LIMITS.rules} items`);
    }
    resolver.rules.slice(0, RECIPE_LIMITS.rules).forEach((rule, index) => {
      const rulePath = `${path}.rules[${index}]`;
      if (!isPlainObject(rule)) {
        errors.push(`${rulePath} must be an object`);
        return;
      }
      allowOnly(errors, rule, ["selector", "cardinality", "action"], rulePath);
      validateRecipeSelector(rule.selector, `${rulePath}.selector`, errors, kinds);
      if (!RECIPE_CARDINALITIES.includes(rule.cardinality)) {
        errors.push(`${rulePath}.cardinality must be one of: ${RECIPE_CARDINALITIES.join(", ")}`);
      }
      validateRecipeAction(rule.action, `${rulePath}.action`, errors, builderIds);
    });
    const serialActions = resolver.rules.filter((rule) => rule?.action?.type === "serial").length;
    if (serialActions !== 1) errors.push(`${path}.rules must contain exactly one serial action`);
  }
}

