import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  validateBackendAdapter,
  validateDynamicPreviousStepConfig
} from "../src/backend-adapter.js";
import { validateFormProfile } from "../src/profile.js";
import { validateProfilesForPublish, validateWorkflowCapabilities } from "../src/worker.js";
import { validBackendAdapter } from "./backend-adapter-fixture.js";

const seed = JSON.parse(await readFile(
  new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

function dynamicProfile() {
  const profile = clone(seed.profiles[0]);
  profile.workflow.previousSteps.enabled = true;
  profile.workflow.previousSteps.templates = [{
    templateId: 7001,
    mode: "template_detail",
    resolverId: "sample-template-detail-v1",
    expectedStep: 7,
    sources: { "sample-evidence": "example_overview_photo" },
    delayAfterMs: 0
  }];
  return profile;
}

test("static recipes remain compatible and do not require the dynamic resolver capability", () => {
  for (const publicProfile of seed.profiles) {
    assert.equal(publicProfile.workflow.previousSteps.enabled, false);
    assert.equal(publicProfile.workflow.previousSteps.templates.some((item) =>
      item?.mode === "template_detail"), false);
  }
  const profile = clone(seed.profiles[0]);
  profile.workflow.previousSteps.enabled = true;
  profile.workflow.previousSteps.templates = [{
    templateId: 7001,
    warehouseId: 71,
    sku: "SAMPLE-STATIC",
    fixedData: {},
    serialField: "sample-serial",
    photoBindings: [{
      targetField: "sample-photo",
      source: "example_overview_photo"
    }],
    delayAfterMs: 0
  }];
  assert.deepEqual(validateFormProfile(profile), []);

  const adapter = validBackendAdapter();
  delete adapter.operations.previousSteps.recipeResolvers;
  delete adapter.operations.previousSteps.optionValueBuilders;
  assert.deepEqual(validateBackendAdapter(adapter), []);
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), []);

  const disabledDynamic = dynamicProfile();
  disabledDynamic.workflow.previousSteps.enabled = false;
  assert.deepEqual(validateFormProfile(disabledDynamic), []);
  assert.deepEqual(validateWorkflowCapabilities([disabledDynamic], adapter), []);
});

test("a fictional dynamic recipe validates and its resolver references are closed", () => {
  const profile = dynamicProfile();
  const adapter = validBackendAdapter();
  assert.deepEqual(validateFormProfile(profile), []);
  assert.deepEqual(validateDynamicPreviousStepConfig(adapter), []);
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), []);

  const artifactProfile = dynamicProfile();
  artifactProfile.workflow.previousSteps.artifacts = [{
    key: "sample-artifact",
    title: "Sample artifact",
    required: true,
    uploadNameTemplate: "{identifier}-sample-evidence.jpg"
  }];
  artifactProfile.workflow.previousSteps.scanPrecheckPolicy.atLimitAction = "require_artifact";
  artifactProfile.workflow.previousSteps.templates[0].sources["sample-evidence"] = "sample-artifact";
  assert.deepEqual(validateFormProfile(artifactProfile), []);
});

test("a dynamic second-step recipe may explicitly have no photo source", () => {
  const profile = dynamicProfile();
  profile.workflow.previousSteps.templates[0].resolverId = "sample-no-photo-step-v1";
  profile.workflow.previousSteps.templates[0].sources = {};

  const adapter = validBackendAdapter();
  const resolver = clone(
    adapter.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]);
  resolver.kindSelectors = resolver.kindSelectors.filter((item) =>
    item.kind !== "sample-photo");
  resolver.rules = resolver.rules.filter((item) => item?.action?.type !== "photo");
  adapter.operations.previousSteps.recipeResolvers["sample-no-photo-step-v1"] = resolver;

  assert.deepEqual(validateFormProfile(profile), []);
  assert.deepEqual(validateDynamicPreviousStepConfig(adapter), []);
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), []);
});

test("dynamic configuration never marks compatibility review on the operator's behalf", () => {
  const profile = dynamicProfile();
  profile.workflow.compatibilityReviewed = false;
  assert.equal(validateFormProfile(profile).includes(
    "workflow.compatibilityReviewed must be true before publish"), false);
  assert.ok(validateProfilesForPublish([profile])[0].errors.includes(
    "workflow.compatibilityReviewed must be true before publish"));
  assert.equal(profile.workflow.compatibilityReviewed, false);
});

test("an enabled dynamic recipe requires template-detail and resolver capabilities", () => {
  const profile = dynamicProfile();
  const adapter = validBackendAdapter();
  delete adapter.endpoints.templateDetail;
  delete adapter.operations.templateDetail;
  delete adapter.operations.previousSteps.recipeResolvers;
  delete adapter.operations.previousSteps.optionValueBuilders;
  const errors = validateWorkflowCapabilities([profile], adapter);
  for (const expected of [
    "a profile enables a dynamic previous-step recipe but backendAdapter.endpoints.templateDetail is not configured",
    "a profile enables a dynamic previous-step recipe but backendAdapter.operations.templateDetail.idParam is not configured",
    "a profile enables a dynamic previous-step recipe but operations.previousSteps.optionValueBuilders must be an object",
    "a profile enables a dynamic previous-step recipe but operations.previousSteps.recipeResolvers must be an object"
  ]) assert.ok(errors.includes(expected), expected);

  const partial = validBackendAdapter();
  delete partial.operations.previousSteps.optionValueBuilders;
  const partialErrors = validateWorkflowCapabilities([profile], partial);
  assert.ok(partialErrors.includes(
    "a profile enables a dynamic previous-step recipe but operations.previousSteps.optionValueBuilders must be an object"));
});

test("dynamic and static recipe fields are mutually exclusive", () => {
  const profile = dynamicProfile();
  Object.assign(profile.workflow.previousSteps.templates[0], {
    warehouseId: 71,
    sku: "SAMPLE-MIXED",
    serialField: "sample-serial",
    fixedData: {},
    photoBindings: []
  });
  const errors = validateFormProfile(profile);
  for (const key of ["warehouseId", "sku", "serialField", "fixedData", "photoBindings"]) {
    assert.ok(errors.includes(
      `workflow.previousSteps.templates[0].${key} is not supported`));
  }

  const staticWithDynamicKey = clone(seed.profiles[0]);
  staticWithDynamicKey.workflow.previousSteps.templates = [{
    templateId: 7001,
    warehouseId: 71,
    sku: "SAMPLE-STATIC",
    fixedData: {},
    serialField: "sample-serial",
    photoBindings: [],
    resolverId: "sample-template-detail-v1",
    delayAfterMs: 0
  }];
  assert.ok(validateFormProfile(staticWithDynamicKey).includes(
    "workflow.previousSteps.templates[0].resolverId is only supported when mode=template_detail"));
});

test("unknown resolver, builder and photo aliases fail closed", () => {
  const missingResolver = dynamicProfile();
  missingResolver.workflow.previousSteps.templates[0].resolverId = "missing-resolver";
  assert.ok(validateWorkflowCapabilities([missingResolver], validBackendAdapter()).includes(
    "a profile enables a dynamic previous-step recipe but profiles[0].workflow.previousSteps.templates[0].resolverId must reference operations.previousSteps.recipeResolvers"));

  const missingAlias = dynamicProfile();
  missingAlias.workflow.previousSteps.templates[0].sources = {};
  assert.ok(validateWorkflowCapabilities([missingAlias], validBackendAdapter()).includes(
    "a profile enables a dynamic previous-step recipe but profiles[0].workflow.previousSteps.templates[0].sources must define alias \"sample-evidence\" used by resolver rule 1"));

  const unusedAlias = dynamicProfile();
  unusedAlias.workflow.previousSteps.templates[0].sources["sample-unused"] =
    "example_detail_photo";
  assert.ok(validateWorkflowCapabilities([unusedAlias], validBackendAdapter()).includes(
    "a profile enables a dynamic previous-step recipe but profiles[0].workflow.previousSteps.templates[0].sources alias \"sample-unused\" is not used by its resolver"));

  const missingBuilder = validBackendAdapter();
  missingBuilder.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .rules[2].action.valueBuilder = "missing-builder";
  assert.ok(validateBackendAdapter(missingBuilder).includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.rules[2].action.valueBuilder must reference operations.previousSteps.optionValueBuilders"));
});

test("selectors reject ambiguous operators and executable expression escape hatches", () => {
  const adapter = validBackendAdapter();
  const predicate = adapter.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .rules[0].selector.allOf[0];
  predicate.containsAny = ["sample"];
  predicate.regex = ".*";
  adapter.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .rules[0].action.eval = "input.serial";

  const errors = validateBackendAdapter(adapter);
  assert.ok(errors.includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.rules[0].selector.allOf[0].regex is not supported"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.rules[0].selector.allOf[0] must contain exactly one of: equalsAny, containsAny, present"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.rules[0].action.eval is not supported"));

  const jsonPath = validBackendAdapter();
  jsonPath.operations.previousSteps.optionValueBuilders["sample-option-object"]
    .members.code.path = "$.option.id";
  assert.ok(validateBackendAdapter(jsonPath).includes(
    "operations.previousSteps.optionValueBuilders.sample-option-object.members.code.path must be a bounded mapped path rooted at template, field, option, input or identity"));
});

test("the closed DSL accepts present predicates, all selector groups and literal builders", () => {
  const adapter = validBackendAdapter();
  adapter.operations.previousSteps.optionValueBuilders["sample-literal"] = {
    type: "literal",
    value: { state: "sample" }
  };
  adapter.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .rules[3].selector = {
      allOf: [{ attribute: "visible", present: true, caseSensitive: true }],
      anyOf: [{ attribute: "required", equalsAny: [false, true], caseSensitive: true }],
      noneOf: [{ attribute: "id", containsAny: ["sample-never"], caseSensitive: false }]
    };
  adapter.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .searchTextAttributes = [];
  adapter.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .optionSearchTextAttributes = [];
  assert.deepEqual(validateBackendAdapter(adapter), []);
});

test("kind rules and builder roots reference only declared canonical values", () => {
  const unknownKind = validBackendAdapter();
  unknownKind.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .rules[0].selector.allOf[0].equalsAny = ["missing-kind"];
  assert.ok(validateBackendAdapter(unknownKind).includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.rules[0].selector.allOf[0].equalsAny[0] must reference kindSelectors.kind"));

  const fuzzyKind = validBackendAdapter();
  fuzzyKind.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .rules[0].selector.allOf[0] = {
      attribute: "kind", containsAny: ["serial"], caseSensitive: false
    };
  assert.ok(validateBackendAdapter(fuzzyKind).includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.rules[0].selector.allOf[0].containsAny is not supported for attribute=kind"));

  const unknownPath = validBackendAdapter();
  unknownPath.operations.previousSteps.optionValueBuilders["sample-option-object"]
    .members.code.path = "option.backendPrivateField";
  assert.ok(validateBackendAdapter(unknownPath).includes(
    "operations.previousSteps.optionValueBuilders.sample-option-object.members.code.path must reference a supported option attribute"));

  const contextualPath = validBackendAdapter();
  contextualPath.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .identity.sku = { type: "firstNonEmpty", paths: ["field.title"] };
  assert.ok(validateBackendAdapter(contextualPath).includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.identity.sku.paths[0] must be a bounded mapped path rooted at template, field, option, input or identity"));

  const recursiveKind = validBackendAdapter();
  recursiveKind.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .kindSelectors[0].selector.allOf[0] = {
      attribute: "kind", equalsAny: ["sample-serial"], caseSensitive: true
    };
  assert.ok(validateBackendAdapter(recursiveKind).includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.kindSelectors[0].selector must not derive kind from kind"));

  const dottedMember = validBackendAdapter();
  dottedMember.operations.previousSteps.optionValueBuilders["sample-option-object"]
    .members["sample.member"] = { type: "literal", value: "sample" };
  assert.ok(validateBackendAdapter(dottedMember).includes(
    "operations.previousSteps.optionValueBuilders.sample-option-object.members.sample.member is not a safe bounded member name"));
});

test("dynamic recipe maps, arrays, literals and builders have finite bounds", () => {
  const tooManyResolvers = validBackendAdapter();
  const sample = tooManyResolvers.operations.previousSteps.recipeResolvers["sample-template-detail-v1"];
  tooManyResolvers.operations.previousSteps.recipeResolvers = Object.fromEntries(
    Array.from({ length: 33 }, (_, index) => [`sample-resolver-${index}`, clone(sample)]));
  assert.ok(validateBackendAdapter(tooManyResolvers).includes(
    "operations.previousSteps.recipeResolvers must contain at most 32 entries"));

  const tooManyPredicates = validBackendAdapter();
  const selector = tooManyPredicates.operations.previousSteps
    .recipeResolvers["sample-template-detail-v1"].rules[0].selector;
  selector.allOf = Array.from({ length: 33 }, () => ({
    attribute: "kind", equalsAny: ["sample-serial"], caseSensitive: true
  }));
  const predicateErrors = validateBackendAdapter(tooManyPredicates);
  assert.ok(predicateErrors.includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.rules[0].selector.allOf must contain at most 16 predicates"));
  assert.ok(predicateErrors.includes(
    "operations.previousSteps.recipeResolvers.sample-template-detail-v1.rules[0].selector must contain at most 32 predicates in total"));

  const deepBuilder = validBackendAdapter();
  let builder = { type: "literal", value: "sample" };
  for (let index = 0; index < 10; index += 1) {
    builder = { type: "object", members: { nested: builder } };
  }
  deepBuilder.operations.previousSteps.optionValueBuilders.deep = builder;
  assert.ok(validateBackendAdapter(deepBuilder).some((error) =>
    error.includes("exceeds maximum builder depth 8")));

  const largeLiteral = validBackendAdapter();
  largeLiteral.operations.previousSteps.recipeResolvers["sample-template-detail-v1"]
    .rules[2].action.optionSelectors[0].literalOverride = Array.from({ length: 257 }, () => 1);
  assert.ok(validateBackendAdapter(largeLiteral).some((error) =>
    error.includes("array must contain at most 256 items")));
});

test("dynamic profile sources are bounded and must reference Panel-owned photos", () => {
  const profile = dynamicProfile();
  profile.workflow.previousSteps.templates[0].sources = Object.fromEntries(
    Array.from({ length: 33 }, (_, index) => [`sample-${index}`, "example_overview_photo"]));
  const errors = validateFormProfile(profile);
  assert.ok(errors.includes(
    "workflow.previousSteps.templates[0].sources must contain at most 32 entries"));

  profile.workflow.previousSteps.templates[0].sources = {
    "sample-evidence": "unknown-photo"
  };
  assert.ok(validateFormProfile(profile).includes(
    "workflow.previousSteps.templates[0].sources.sample-evidence must reference an artifact key or profile photo field"));

  profile.workflow.previousSteps.templates[0].sources = {
    "bad alias": "example_overview_photo"
  };
  profile.workflow.previousSteps.templates[0].expectedStep = 1.5;
  const malformed = validateFormProfile(profile);
  assert.ok(malformed.includes(
    "workflow.previousSteps.templates[0].sources.bad alias alias must match [A-Za-z][A-Za-z0-9_-]{0,127}"));
  assert.ok(malformed.includes(
    "workflow.previousSteps.templates[0].expectedStep must be a non-empty string or finite integer"));
});
