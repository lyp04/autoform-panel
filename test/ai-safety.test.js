import test from "node:test";
import assert from "node:assert/strict";

import { allowedRefs, checkProfileRefs } from "../api/ai.js";
import { preserveRuntimeProfileConfig } from "../api/profile.js";

function sourceProfile() {
  return {
    id: "sample-profile",
    brand: "Sample brand",
    model: "Sample model",
    displayName: "Sample profile",
    searchText: "SAMPLE PROFILE",
    uiColor: "#2563EB",
    template: { id: 1001, warehouseId: 2001, sku: "SAMPLE-SKU" },
    snFields: { primary: "sample-serial", secondary: "sample-related" },
    snPlugins: [{ key: "sample-extra", field: "sample-extra-field" }],
    gradeMap: {
      accepted: { field: "sample-result", label: "Accepted", value: { state: "accepted", score: 1 } }
    },
    choiceFields: [{
      field: "sample-choice",
      options: [{ label: "One", value: "choice-one" }],
      value: "",
      reviewRequired: true
    }],
    operationFields: [{ field: "sample-operation", value: ["operation-one"] }],
    conditionalFields: [{ field: "sample-condition", perResult: { accepted: ["condition-one"] } }],
    photoSlots: [{ field: "sample-photo", title: "Sample photo", minPhotos: 1, maxPhotos: 1 }],
    workflow: {
      submission: {
        maxAttempts: 1,
        networkRetry: { maxAttempts: 0 }
      }
    },
    futureExtension: {
      nested: { enabled: true },
      values: ["preserve", "deeply"]
    }
  };
}

test("AI reference gate checks every identifier role and opaque submit value", () => {
  const current = sourceProfile();
  const allowed = allowedRefs({}, current);
  const candidate = JSON.parse(JSON.stringify(current));
  candidate.snFields.primary = "invented-primary";
  candidate.gradeMap.accepted.value = { state: "invented", score: 1 };
  candidate.choiceFields[0].options[0].value = "invented-choice";

  const violations = checkProfileRefs(candidate, allowed);
  assert.equal(violations.some((item) => item.includes("snFields.primary")), true);
  assert.equal(violations.some((item) => item.includes("gradeMap.accepted.value")), true);
  assert.equal(violations.some((item) => item.includes("choiceFields[0].options[0].value")), true);
});

test("whole-profile AI response cannot modify the submission contract", () => {
  const current = sourceProfile();
  const currentBefore = structuredClone(current);
  const candidate = {
    ...JSON.parse(JSON.stringify(current)),
    displayName: "Shorter sample label",
    searchText: "SHORT SAMPLE",
    brand: "Invented brand",
    model: "Invented model",
    uiColor: "#FFFFFF",
    template: { id: 9999, warehouseId: 9999, sku: "INVENTED" },
    snFields: { primary: "invented-primary" },
    gradeMap: { accepted: { field: "sample-result", value: "invented" } },
    workflow: {
      submission: {
        maxAttempts: 99,
        networkRetry: { maxAttempts: 99 }
      }
    },
    futureExtension: {
      nested: { enabled: false },
      values: ["tampered"]
    },
    inventedTopLevel: { unsafe: true }
  };
  delete candidate.operationFields;
  candidate.choiceFields[0].value = "choice-one";
  candidate.choiceFields[0].reviewRequired = false;

  const preserved = preserveRuntimeProfileConfig(candidate, current);
  assert.equal(preserved.displayName, "Shorter sample label");
  assert.equal(preserved.searchText, "SHORT SAMPLE");
  assert.equal(preserved.brand, current.brand);
  assert.equal(preserved.model, current.model);
  assert.equal(preserved.uiColor, current.uiColor);
  assert.deepEqual(preserved.template, current.template);
  assert.deepEqual(preserved.snFields, current.snFields);
  assert.deepEqual(preserved.gradeMap, current.gradeMap);
  assert.deepEqual(preserved.choiceFields, current.choiceFields);
  assert.deepEqual(preserved.workflow, current.workflow);
  assert.deepEqual(preserved.futureExtension, current.futureExtension);
  assert.deepEqual(preserved.operationFields, current.operationFields);
  assert.equal(preserved.choiceFields[0].reviewRequired, true);
  assert.equal(Object.hasOwn(preserved, "inventedTopLevel"), false);
  assert.deepEqual(current, currentBefore);

  assert.notStrictEqual(preserved.template, current.template);
  assert.notStrictEqual(preserved.workflow, current.workflow);
  assert.notStrictEqual(preserved.workflow.submission, current.workflow.submission);
  assert.notStrictEqual(preserved.futureExtension, current.futureExtension);
  assert.notStrictEqual(preserved.futureExtension.nested, current.futureExtension.nested);
  preserved.futureExtension.nested.enabled = false;
  preserved.operationFields[0].value.push("mutated-result");
  assert.equal(current.futureExtension.nested.enabled, true);
  assert.deepEqual(current.operationFields[0].value, ["operation-one"]);
});

test("whole-profile preservation restores omitted fields and drops every non-display invention", () => {
  const current = sourceProfile();
  const preserved = preserveRuntimeProfileConfig({
    displayName: "Updated display name",
    searchText: "UPDATED SEARCH",
    newMetadata: "must not survive",
    newRuntimePolicy: { enabled: true }
  }, current);

  assert.deepEqual(preserved, {
    ...current,
    displayName: "Updated display name",
    searchText: "UPDATED SEARCH"
  });
  assert.equal(Object.hasOwn(preserved, "newMetadata"), false);
  assert.equal(Object.hasOwn(preserved, "newRuntimePolicy"), false);
  assert.notStrictEqual(preserved.futureExtension, current.futureExtension);
});
