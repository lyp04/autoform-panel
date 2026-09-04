// Dynamic previous step: its operation, config and the references it must close.
import { RECIPE_LIMITS, RECIPE_PATH_KEYS } from "./backend-adapter-constants.js";
import { isPlainObject } from "./backend-adapter-primitives.js";
import { addRecipeId, validateRecipeBuilder, validateRecipeResolver } from "./backend-adapter-recipe-dsl.js";

export function validateDynamicPreviousStepOperation(operation, errors, required) {
  if (!isPlainObject(operation)) {
    if (required) errors.push("operations.previousSteps must be configured");
    return;
  }
  const builders = operation.optionValueBuilders;
  const builderIds = new Set(isPlainObject(builders) ? Object.keys(builders) : []);
  const namedBuilderBudget = { count: 0, reported: false };
  if (!isPlainObject(builders)) {
    errors.push("operations.previousSteps.optionValueBuilders must be an object");
  } else {
    const entries = Object.entries(builders);
    if (entries.length > RECIPE_LIMITS.mapEntries) {
      errors.push(`operations.previousSteps.optionValueBuilders must contain at most ${RECIPE_LIMITS.mapEntries} entries`);
    }
    entries.slice(0, RECIPE_LIMITS.mapEntries).forEach(([id, builder]) => {
      addRecipeId(errors, id, `operations.previousSteps.optionValueBuilders.${id}`);
      validateRecipeBuilder(builder, `operations.previousSteps.optionValueBuilders.${id}`, errors,
        0, Object.keys(RECIPE_PATH_KEYS), namedBuilderBudget);
    });
  }
  const resolvers = operation.recipeResolvers;
  if (!isPlainObject(resolvers)) {
    errors.push("operations.previousSteps.recipeResolvers must be an object");
  } else {
    const entries = Object.entries(resolvers);
    if (entries.length > RECIPE_LIMITS.mapEntries) {
      errors.push(`operations.previousSteps.recipeResolvers must contain at most ${RECIPE_LIMITS.mapEntries} entries`);
    }
    entries.slice(0, RECIPE_LIMITS.mapEntries).forEach(([id, resolver]) => {
      addRecipeId(errors, id, `operations.previousSteps.recipeResolvers.${id}`);
      validateRecipeResolver(resolver,
        `operations.previousSteps.recipeResolvers.${id}`, errors, builderIds,
        { count: namedBuilderBudget.count, reported: namedBuilderBudget.reported });
    });
  }
}

/** Strict schema check used only when a profile selects dynamic template-detail recipes. */
export function validateDynamicPreviousStepConfig(adapter) {
  const errors = [];
  validateDynamicPreviousStepOperation(adapter?.operations?.previousSteps, errors, true);
  return errors;
}

/** Cross-check profile resolver and photo-source aliases after both documents validate. */
export function validateDynamicPreviousStepReferences(adapter, recipes) {
  const errors = [];
  const resolvers = adapter?.operations?.previousSteps?.recipeResolvers;
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const path = recipe?.path || "workflow.previousSteps.templates[]";
    const resolverId = recipe?.template?.resolverId;
    const resolver = isPlainObject(resolvers) ? resolvers[resolverId] : undefined;
    if (!isPlainObject(resolver)) {
      errors.push(`${path}.resolverId must reference operations.previousSteps.recipeResolvers`);
      continue;
    }
    const aliases = new Set(isPlainObject(recipe.template.sources)
      ? Object.keys(recipe.template.sources) : []);
    const usedAliases = new Set();
    (Array.isArray(resolver.rules) ? resolver.rules : []).forEach((rule, index) => {
      if (rule?.action?.type === "photo" && typeof rule.action.source === "string") {
        usedAliases.add(rule.action.source);
        if (!aliases.has(rule.action.source)) {
          errors.push(`${path}.sources must define alias ${JSON.stringify(rule.action.source)} used by resolver rule ${index}`);
        }
      }
    });
    for (const alias of aliases) {
      if (!usedAliases.has(alias)) {
        errors.push(`${path}.sources alias ${JSON.stringify(alias)} is not used by its resolver`);
      }
    }
  }
  return errors;
}

