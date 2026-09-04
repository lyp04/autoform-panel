import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { templateToProfile } from "../api/convert.js";
import { deriveResultOptions } from "../public/form-preview.js";
import { validateFormProfile } from "../api/profile.js";

function templateWithResults(options) {
  return {
    id: 2001,
    name: "Sample form",
    process_id: 4,
    sku: "SAMPLE-SKU",
    warehouse_id: 1,
    field_list: [{ field: "decision", kind: "result", option_list: options }]
  };
}

function option(name, value, resultKey, includeInResults = true, resultValue) {
  return { name, value, resultKey, includeInResults, resultValue };
}

test("converter preserves adapter-provided result keys and opaque submit values", () => {
  const profile = templateToProfile(templateWithResults([
    option("First label", "value-1", "accepted", true, { state: "accepted", score: 1 }),
    option("Second label", "value-2", "manual-review")
  ]));

  assert.deepEqual(profile.gradeMap.accepted.value, { state: "accepted", score: 1 });
  assert.equal(profile.gradeMap["manual-review"].value, "value-2");
});

test("converter carries separate operator labels without changing legacy label or value", () => {
  const profile = templateToProfile(templateWithResults([{
    name: "Imported sample label",
    value: { state: "sample-imported" },
    resultKey: "sample-result",
    resultLabel: "Mapped legacy sample label",
    resultLabelI18n: { en: "Mapped legacy sample label" },
    resultOperatorLabel: "Sample operator label",
    resultOperatorLabelI18n: {
      en: "Sample operator label",
      es: "Etiqueta de operador de ejemplo"
    },
    includeInResults: true,
    resultValue: { state: "sample-submit" }
  }]));

  assert.deepEqual(profile.gradeMap["sample-result"], {
    field: "decision",
    label: "Mapped legacy sample label",
    value: { state: "sample-submit" },
    labelI18n: { en: "Mapped legacy sample label" },
    operatorLabel: "Sample operator label",
    operatorLabelI18n: {
      en: "Sample operator label",
      es: "Etiqueta de operador de ejemplo"
    }
  });
  assert.deepEqual(deriveResultOptions(profile), [{
    key: "sample-result",
    label: "Sample operator label"
  }]);
});

test("adapter-excluded options do not become selectable results", () => {
  const profile = templateToProfile(templateWithResults([
    option("Visible", "visible", "visible"),
    option("Hidden", "hidden", "hidden", false)
  ]));

  assert.deepEqual(Object.keys(profile.gradeMap), ["visible"]);
});

test("unmapped and duplicate result keys receive stable neutral keys", () => {
  const profile = templateToProfile(templateWithResults([
    option("One", "one"),
    option("Two", "two", "same"),
    option("Three", "three", "same")
  ]));

  assert.deepEqual(Object.keys(profile.gradeMap), ["option-1", "same", "same-2"]);
});

test("validator accepts deployment-defined result keys and checks structure only", () => {
  const profile = {
    id: "generic-result-map",
    displayName: "Generic result map",
    searchText: "Generic result map",
    gradeMap: {
      accepted: { field: "decision", label: "Accepted", value: { state: "value-1" } },
      "manual-review": { field: "decision", label: "Manual review", value: "value-2" }
    }
  };

  assert.deepEqual(validateFormProfile(profile), []);
});

test("operator labels are optional, bounded, trimmed and limited to en/es", () => {
  const profile = {
    id: "sample-operator-labels",
    displayName: "Sample operator labels",
    searchText: "sample operator labels",
    gradeMap: {
      "sample-result": {
        field: "sample-decision",
        label: "Imported sample label",
        labelI18n: { en: "Imported sample label" },
        operatorLabel: "Sample operator label",
        operatorLabelI18n: {
          en: "Sample operator label",
          es: "Etiqueta de operador de ejemplo"
        },
        value: { state: "sample-submit" }
      }
    }
  };
  assert.deepEqual(validateFormProfile(profile), []);

  profile.gradeMap["sample-result"].operatorLabel = " Sample operator label ";
  profile.gradeMap["sample-result"].operatorLabelI18n = {
    en: "",
    es: "x".repeat(161),
    fr: "Exemple"
  };
  const errors = validateFormProfile(profile);
  assert.ok(errors.includes(
    "gradeMap.sample-result.operatorLabel must not have surrounding whitespace"));
  assert.ok(errors.includes(
    "gradeMap.sample-result.operatorLabelI18n.en must be a non-empty string"));
  assert.ok(errors.includes(
    "gradeMap.sample-result.operatorLabelI18n.es must contain at most 160 characters"));
  assert.ok(errors.includes(
    "gradeMap.sample-result.operatorLabelI18n.fr is not supported"));
});

test("structured result editor changes only operator labels and keeps legacy fields read-only", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf("function resultOptionsEditor(p)");
  const end = html.indexOf("function photoSlotRow", start);
  const editor = html.slice(start, end);
  assert.match(editor, /item\.operatorLabel=value/);
  assert.match(editor, /item\.operatorLabelI18n=map/);
  assert.match(editor, /item\.uiColor=color\.value/);
  assert.match(editor, /field\("颜色",color\)/);
  assert.match(editor, /旧版\/导入标签（只读）/);
  assert.match(editor, /legacy\.disabled=true/);
  assert.doesNotMatch(editor, /item\.label\s*=\s*value/);
  assert.doesNotMatch(editor, /item\.value\s*=/);
});

test("result uiColor accepts only an exact six-digit Panel color", () => {
  const profile = {
    id: "sample-result-colors",
    displayName: "Sample result colors",
    searchText: "sample result colors",
    gradeMap: {
      "sample-result": {
        field: "sample-decision",
        label: "Sample result",
        value: "sample-submit",
        uiColor: "#2563EB"
      }
    }
  };
  assert.deepEqual(validateFormProfile(profile), []);

  profile.gradeMap["sample-result"].uiColor = "2563EB";
  assert.ok(validateFormProfile(profile).includes(
    "gradeMap.sample-result.uiColor must be a six-digit hex color"));
});

test("conditional result maps support an equal staged perGrade alias", () => {
  const profile = {
    id: "sample-conditional-alias",
    displayName: "Sample conditional alias",
    searchText: "sample conditional alias",
    gradeMap: {
      accepted: { field: "sample-result", label: "Accepted", value: "sample-accepted" },
      review: { field: "sample-result", label: "Review", value: "sample-review" }
    },
    conditionalFields: [{
      field: "sample-conditional-field",
      perResult: { accepted: ["sample-one"], review: ["sample-two"] },
      perGrade: { review: ["sample-two"], accepted: ["sample-one"] }
    }]
  };

  assert.deepEqual(validateFormProfile(profile), []);
});

test("conditional perGrade uses result-key and array validation and cannot diverge", () => {
  const profile = {
    id: "sample-conditional-alias-invalid",
    displayName: "Sample conditional alias invalid",
    searchText: "sample conditional alias invalid",
    gradeMap: {
      accepted: { field: "sample-result", label: "Accepted", value: "sample-accepted" }
    },
    conditionalFields: [{
      field: "sample-conditional-field",
      perResult: { accepted: ["sample-one"] },
      perGrade: { missing: "sample-not-an-array" }
    }]
  };

  const errors = validateFormProfile(profile);
  assert.ok(errors.includes(
    "conditionalFields[0].perGrade.missing must reference gradeMap"));
  assert.ok(errors.includes(
    "conditionalFields[0].perGrade.missing must be an array"));
  assert.ok(errors.includes(
    "conditionalFields[0].perGrade must deeply equal perResult during staged migration"));
});
