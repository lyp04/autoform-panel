import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { templateToProfile } from "../src/convert.js";
import { confirmChoiceValue } from "../public/form-preview.js";
import { validateFormProfile } from "../src/profile.js";
import { clientCatalog, validateProfilesForPublish } from "../src/worker.js";

const seed = JSON.parse(await readFile(
  new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"));

function template(fields) {
  return {
    id: 101,
    name: "Fictional conversion safety form",
    process_id: 2,
    sku: "FICTIONAL-SKU",
    warehouse_id: 3,
    field_list: fields
  };
}

test("number/text fields never become the primary scanner because of backend order", () => {
  const profile = templateToProfile(template([
    { field: "example_count", title: "Count", kind: "number", required: false },
    { field: "example_note", title: "Note", kind: "text", required: false },
    { field: "example_identifier", title: "Identifier", kind: "serial", required: true },
    { field: "example_extra_scan", title: "Other input", kind: "scan", required: false }
  ]));

  assert.equal(profile.snFields.primary, "example_identifier");
  assert.deepEqual(profile.snPlugins.map((plugin) => ({
    field: plugin.field, key: plugin.key, search: plugin.search, scan: plugin.scan
  })), [
    { field: "example_count", key: "example_count", search: false, scan: false },
    { field: "example_note", key: "example_note", search: false, scan: false },
    { field: "example_identifier", key: "primary", search: true, scan: true },
    { field: "example_extra_scan", key: "example_extra_scan", search: false, scan: false }
  ]);
});

test("configured input labels survive template conversion and App catalog delivery", () => {
  const profile = templateToProfile(template([
    {
      field: "example_primary_identifier",
      title: "Configured primary label",
      kind: "serial",
      required: true
    },
    {
      field: "example_replacement_identifier",
      title: "Configured replacement label",
      kind: "text",
      required: false
    }
  ]));
  profile.snPlugins[0].labelI18n = {
    en: "Localized primary label",
    es: "Etiqueta principal localizada"
  };

  assert.deepEqual(profile.snPlugins.map(({ field, label }) => ({ field, label })), [
    {
      field: "example_primary_identifier",
      label: "Configured primary label"
    },
    {
      field: "example_replacement_identifier",
      label: "Configured replacement label"
    }
  ]);

  const served = clientCatalog({
    version: 7,
    profiles: [profile],
    settings: { brand: "Fictional" }
  });
  assert.deepEqual(served.profiles[0].snPlugins, profile.snPlugins);
  assert.deepEqual(served.profiles[0].snPlugins[0].labelI18n,
    profile.snPlugins[0].labelI18n);
  assert.deepEqual(profile.snPlugins[0].placeholderI18n,
    { en: "Enter", es: "Introduzca" });
  assert.deepEqual(served.profiles[0].snPlugins[0].placeholderI18n,
    profile.snPlugins[0].placeholderI18n);
});

test("a template with only ordinary inputs remains unbound instead of inventing an identifier", () => {
  const profile = templateToProfile(template([
    { field: "example_count", title: "Count", kind: "number", required: true },
    { field: "example_note", title: "Note", kind: "text", required: false }
  ]));

  assert.equal(profile.snFields.primary, "");
  assert.equal(profile.snPlugins.some((plugin) => plugin.key === "primary"), false);
  assert.equal(profile.snPlugins.every((plugin) => plugin.scan === false), true);
});

test("ordinary backend field ids cannot impersonate reserved scanner role keys", () => {
  const profile = templateToProfile(template([
    { field: "primary", title: "Ordinary count", kind: "number", required: false },
    { field: "secondary", title: "Ordinary note", kind: "text", required: false }
  ]));

  assert.equal(profile.snFields.primary, "");
  assert.deepEqual(profile.snPlugins.map((plugin) => plugin.key), ["input-1", "input-2"]);
  assert.equal(profile.snPlugins.every((plugin) => plugin.scan === false), true);
});

test("visible single choices require an explicit Panel selection instead of options[0]", () => {
  const profile = templateToProfile(template([
    {
      field: "example_decision",
      title: "Decision",
      kind: "singleChoice",
      required: true,
      visible: true,
      option_list: [
        { value: "example-one", name: "One" },
        { value: "example-two", name: "Two" }
      ]
    }
  ]));
  const choice = profile.choiceFields[0];

  assert.equal(choice.value, "");
  assert.equal(choice.reviewRequired, true);
  let errors = validateFormProfile(profile);
  assert.ok(errors.includes("choiceFields[0].reviewRequired must be false before publish"));
  assert.ok(errors.includes("choiceFields[0] is required but nothing is selected"));

  confirmChoiceValue(choice, "example-two");
  assert.equal(choice.value, "example-two");
  assert.equal(choice.reviewRequired, false);
  errors = validateFormProfile(profile);
  assert.equal(errors.some((error) => error.startsWith("choiceFields[0]")), false);
});

test("hidden single and multi choices retain neutral values without a review guess", () => {
  const profile = templateToProfile(template([
    {
      field: "example_hidden",
      title: "Hidden",
      kind: "singleChoice",
      required: false,
      visible: false,
      option_list: [{ value: "example-hidden-value", name: "Hidden value" }]
    },
    {
      field: "example_multi",
      title: "Multiple",
      kind: "multipleChoice",
      required: false,
      visible: true,
      option_list: [{ value: "example-multi-value", name: "Multi value" }]
    }
  ]));

  assert.equal(profile.choiceFields[0].value, "");
  assert.equal(Object.hasOwn(profile.choiceFields[0], "reviewRequired"), false);
  assert.deepEqual(profile.choiceFields[1].value, []);
  assert.equal(Object.hasOwn(profile.choiceFields[1], "reviewRequired"), false);
});

test("legacy choices without reviewRequired remain compatible but malformed/new pending flags fail", () => {
  const base = {
    id: "fictional-legacy-profile",
    displayName: "Fictional legacy profile",
    searchText: "FICTIONAL",
    choiceFields: [{
      field: "example_choice",
      kind: "single",
      options: [{ value: "example-one", label: "One" }],
      value: "example-one",
      required: true,
      visible: true
    }]
  };

  assert.deepEqual(validateFormProfile(base), []);
  base.choiceFields[0].reviewRequired = "yes";
  assert.ok(validateFormProfile(base).includes(
    "choiceFields[0].reviewRequired must be a boolean"));
  base.choiceFields[0].reviewRequired = true;
  assert.ok(validateFormProfile(base).includes(
    "choiceFields[0].reviewRequired must be false before publish"));
});

test("the real publish validator blocks an unreviewed generated choice and accepts explicit selection", () => {
  const profile = structuredClone(seed.profiles[0]);
  profile.choiceFields = [{
    field: "fictional_publish_choice",
    title: "Fictional publish choice",
    kind: "single",
    options: [
      { value: "fictional-option-one", label: "Option one" },
      { value: "fictional-option-two", label: "Option two" }
    ],
    value: "",
    required: true,
    visible: true,
    reviewRequired: true
  }];

  let problems = validateProfilesForPublish([profile]);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].errors.includes(
    "choiceFields[0].reviewRequired must be false before publish"));

  confirmChoiceValue(profile.choiceFields[0], "fictional-option-two");
  problems = validateProfilesForPublish([profile]);
  assert.deepEqual(problems, []);
});
