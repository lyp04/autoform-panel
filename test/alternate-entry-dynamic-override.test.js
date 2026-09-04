import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  validateAlternateEntryOverrideConfig,
  validateAlternateEntryOverrideReferences,
  validateBackendAdapter
} from "../src/backend-adapter.js";
import {
  validateAlternateEntryReferences,
  validateFormProfile
} from "../src/profile.js";
import { validateWorkflowCapabilities } from "../src/worker.js";
import { validBackendAdapter } from "./backend-adapter-fixture.js";

const seed = JSON.parse(await readFile(
  new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

function liveResolver() {
  return {
    version: 1,
    searchTextAttributes: ["title", "englishTitle", "id"],
    optionSearchTextAttributes: ["title", "englishTitle", "id"],
    fieldSelector: {
      allOf: [{
        attribute: "id",
        equalsAny: ["sample-live-choice"],
        caseSensitive: true
      }]
    },
    optionSelector: {
      allOf: [{
        attribute: "id",
        equalsAny: ["sample-live-value"],
        caseSensitive: true
      }]
    },
    valueBuilder: {
      type: "object",
      members: {
        code: { type: "present", path: "option.id", fallbackIfMissing: "" },
        label: { type: "firstNonEmpty", paths: ["option.title", "option.englishTitle"] },
        quantity: { type: "integer", path: "option.quantity", default: 1 }
      }
    }
  };
}

function configuredCase() {
  const source = clone(seed.profiles[0]);
  source.snPlugins.find((plugin) => plugin.key === "primary").scanner.expectedLength = 12;
  const target = clone(seed.profiles[1]);
  target.id = "sample-live-hidden-target";
  target.displayName = "Sample live hidden target";
  target.searchText = "sample live hidden target";
  target.pickerVisible = false;
  target.conditionalFields = [
    ...(Array.isArray(target.conditionalFields) ? target.conditionalFields : []),
    { field: "sample-live-choice" }
  ];
  source.workflow.alternateEntries = {
    enabled: true,
    entries: [{
      id: "sample-live-entry",
      title: "Sample live entry",
      targetProfileId: target.id,
      identifierRole: "primary",
      resultKey: "sample-ready",
      photoTargetFields: ["example_attachment"],
      joinWith: ",",
      minPhotos: 1,
      maxPhotos: 2,
      uploadNameTemplate: "{identifier}-sample-entry-{index}.jpg",
      scanner: { applyExpectedLengthTo: ["ocr", "barcode"] },
      toggles: [{
        key: "sample-live-toggle",
        label: "Sample live toggle",
        default: false,
        retainUntilExit: true,
        dataOverrides: {}
      }],
      flags: { duplicateCheck: false, previousSteps: false, printing: false },
      dataOverrides: {},
      dynamicOverrideFields: ["sample-live-choice"],
      dynamicOverrideProviders: [{
        id: "sample-live-provider",
        triggerToggleKey: "sample-live-toggle",
        templateId: target.template.id,
        expectedStep: 3,
        resolverId: "sample-alternate-live-option-v1",
        outputField: "sample-live-choice"
      }]
    }]
  };
  const adapter = validBackendAdapter();
  adapter.operations.templateDetail.alternateEntryResolvers = {
    "sample-alternate-live-option-v1": liveResolver()
  };
  return { source, target, adapter };
}

test("fictional alternate live override closes profile, target and adapter references", () => {
  const { source, target, adapter } = configuredCase();
  const provider = source.workflow.alternateEntries.entries[0].dynamicOverrideProviders[0];
  const providerRef = [{ path: "profiles[0].provider", provider }];

  assert.deepEqual(validateFormProfile(source), []);
  assert.deepEqual(validateAlternateEntryReferences([source], [source, target]), []);
  assert.deepEqual(validateBackendAdapter(adapter), []);
  assert.deepEqual(validateAlternateEntryOverrideConfig(adapter), []);
  assert.deepEqual(validateAlternateEntryOverrideReferences(adapter, providerRef), []);
  assert.deepEqual(validateWorkflowCapabilities([source, target], adapter), []);
});

test("provider envelope, allow-list, toggle and target identity fail closed", () => {
  const { source, target } = configuredCase();
  const entry = source.workflow.alternateEntries.entries[0];
  const provider = entry.dynamicOverrideProviders[0];
  provider.unknown = true;
  provider.triggerToggleKey = "sample-missing-toggle";
  provider.templateId += 1;
  entry.dynamicOverrideFields.push("sample-without-provider");

  const local = validateFormProfile(source);
  assert.ok(local.includes(
    "workflow.alternateEntries.entries[0].dynamicOverrideProviders[0].unknown is not supported"));
  assert.ok(local.includes(
    "workflow.alternateEntries.entries[0].dynamicOverrideProviders[0].triggerToggleKey must reference a toggle in the same entry"));
  assert.ok(local.includes(
    "workflow.alternateEntries.entries[0].dynamicOverrideFields must not contain fields without a provider"));
  assert.ok(validateAlternateEntryReferences([source], [source, target])[0].errors.includes(
    "workflow.alternateEntries.entries[0].dynamicOverrideProviders[0].templateId must match the target template.id"));
});

test("serial, result, photo, identity and static owners cannot be dynamic outputs", () => {
  for (const [outputField, expected] of [
    ["example_record_id", "must not override serial, result, or photo data"],
    ["example_result", "must not override serial, result, or photo data"],
    ["example_attachment", "must not override serial, result, or photo data"],
    ["sku", "must not override target template identity"],
    ["sample-live-choice", "duplicates override ownership"]
  ]) {
    const { source, target } = configuredCase();
    const entry = source.workflow.alternateEntries.entries[0];
    entry.dynamicOverrideFields = [outputField];
    entry.dynamicOverrideProviders[0].outputField = outputField;
    if (outputField === "sample-live-choice") {
      entry.dataOverrides[outputField] = "SAMPLE_STATIC";
      assert.ok(validateFormProfile(source).some((error) =>
        error.includes("must not overlap static, toggle, or result preset overrides")));
    }
    const problems = validateAlternateEntryReferences([source], [source, target]);
    assert.ok(problems[0].errors.some((error) => error.includes(expected)),
      `${outputField}: ${expected}`);
  }
});

test("resolver unknown keys, open selectors and missing references fail closed", () => {
  const { source, target, adapter } = configuredCase();
  const resolver = adapter.operations.templateDetail.alternateEntryResolvers[
    "sample-alternate-live-option-v1"];
  resolver.script = "sample";
  resolver.fieldSelector.allOf[0].attribute = "kind";
  const adapterErrors = validateBackendAdapter(adapter);
  assert.ok(adapterErrors.includes(
    "operations.templateDetail.alternateEntryResolvers.sample-alternate-live-option-v1.script is not supported"));
  assert.ok(adapterErrors.includes(
    "operations.templateDetail.alternateEntryResolvers.sample-alternate-live-option-v1.fieldSelector must not reference kind"));

  source.workflow.alternateEntries.entries[0].dynamicOverrideProviders[0].resolverId =
    "sample-missing-resolver";
  const capabilityErrors = validateWorkflowCapabilities([source, target], adapter);
  assert.ok(capabilityErrors.some((error) => error.includes(
    "resolverId must reference operations.templateDetail.alternateEntryResolvers")));
});

test("live providers require the template-detail endpoint, id parameter and resolver map", () => {
  const { source, target, adapter } = configuredCase();
  delete adapter.endpoints.templateDetail;
  delete adapter.operations.templateDetail.idParam;
  delete adapter.operations.templateDetail.alternateEntryResolvers;
  const errors = validateWorkflowCapabilities([source, target], adapter);
  assert.ok(errors.some((error) => error.includes("endpoints.templateDetail is required")));
  assert.ok(errors.some((error) => error.includes("operations.templateDetail.idParam is required")));
  assert.ok(errors.some((error) => error.includes(
    "operations.templateDetail.alternateEntryResolvers must be an object")));
});
