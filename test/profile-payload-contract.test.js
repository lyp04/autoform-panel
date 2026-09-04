import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { validateFormProfile } from "../src/profile.js";
import { validateProfilesForPublish } from "../src/worker.js";

const seed = JSON.parse(await readFile(
  new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"
));
const clone = (value) => JSON.parse(JSON.stringify(value));
const sampleProfile = () => clone(seed.profiles[0]);

function validChoice() {
  return {
    field: "example_choice",
    title: "Example choice",
    kind: "single",
    options: [
      { value: "example-one", label: "Example one" },
      { value: "example-two", label: "Example two" }
    ],
    value: "example-one",
    required: true,
    visible: true,
    reviewRequired: false
  };
}

test("Panel photo input sources are explicit, bounded, and camera-compatible by default", () => {
  for (const inputSource of ["camera", "gallery", "file"]) {
    const profile = sampleProfile();
    profile.photoSlots[0].inputSource = inputSource;
    profile.workflow.photos.inputSource = inputSource;
    profile.workflow.previousSteps.artifacts = [{
      key: "sample-evidence",
      title: "Sample evidence",
      required: true,
      uploadNameTemplate: "{identifier}-sample-evidence.jpg",
      inputSource
    }];
    assert.deepEqual(validateFormProfile(profile), []);
  }

  const invalid = sampleProfile();
  invalid.photoSlots[0].inputSource = "camera_or_gallery";
  invalid.workflow.photos.inputSource = true;
  invalid.workflow.previousSteps.artifacts = [{
    key: "sample-evidence",
    title: "Sample evidence",
    required: true,
    uploadNameTemplate: "{identifier}-sample-evidence.jpg",
    inputSource: " gallery"
  }];
  const errors = validateFormProfile(invalid);
  assert(errors.includes("photoSlots[0].inputSource must be camera, gallery, or file"));
  assert(errors.includes("workflow.photos.inputSource must be camera, gallery, or file"));
  assert(errors.includes("workflow.previousSteps.artifacts[0].inputSource must be camera, gallery, or file"));
});

test("legacy upload sources stay inside the bounded front/back wire contract", () => {
  const compatible = sampleProfile();
  delete compatible.photoSlots;
  compatible.uploadFields = [{ field: "example_legacy_photo" }];
  // Draft validation remains backward-compatible, but no newly published catalog may rely on the
  // App's positional legacy inference.
  assert.deepEqual(validateFormProfile(compatible), []);
  assert.ok(validateProfilesForPublish([compatible])[0].errors.includes(
    "uploadFields[0].sources is required before publish"));

  compatible.uploadFields[0].sources = ["front", "back"];
  assert.deepEqual(validateProfilesForPublish([compatible]), []);

  for (const [sources, expected] of [
    [[], "uploadFields[0].sources must not be empty"],
    [["front", "example-unknown"], "uploadFields[0].sources[1] must be front or back"],
    [["front", "front"], "uploadFields[0].sources[1] must be unique"],
    [null, "uploadFields[0].sources must be an array"]
  ]) {
    const profile = clone(compatible);
    profile.uploadFields[0].sources = sources;
    assert.ok(validateFormProfile(profile).includes(expected), expected);
  }
});

test("choice fields require a complete reviewed option/value contract", () => {
  const compatible = sampleProfile();
  compatible.choiceFields = [validChoice()];
  assert.deepEqual(validateFormProfile(compatible), []);

  const cases = [
    [(choice) => { delete choice.options; }, "choiceFields[0].options must be an array"],
    [(choice) => { choice.options = []; }, "choiceFields[0].options must not be empty"],
    [(choice) => { choice.options = [{ value: "example-one" }]; },
      "choiceFields[0].options[0].label is required"],
    [(choice) => { choice.options.push({ value: "example-one", label: "Duplicate" }); },
      "choiceFields[0].options[2].value must be unique"],
    [(choice) => { choice.reviewRequired = true; },
      "choiceFields[0].reviewRequired must be false before publish"],
    [(choice) => { choice.reviewRequired = "false"; },
      "choiceFields[0].reviewRequired must be a boolean"],
    [(choice) => { choice.required = "false"; },
      "choiceFields[0].required must be a boolean"],
    [(choice) => { choice.value = "example-unknown"; },
      "choiceFields[0].value \"example-unknown\" is not one of its options"],
    [(choice) => { choice.value = ["example-one"]; },
      "choiceFields[0].value must be a string for a single choice"],
    [(choice) => { choice.kind = "multi"; choice.value = "example-one"; },
      "choiceFields[0].value must be an array for a multi choice"],
    [(choice) => { choice.kind = "multi"; choice.value = []; },
      "choiceFields[0] is required but nothing is selected"]
  ];

  for (const [mutate, expected] of cases) {
    const profile = clone(compatible);
    mutate(profile.choiceFields[0]);
    assert.ok(validateFormProfile(profile).includes(expected), expected);
  }
});

test("material items keep the explicit positive-quantity and global-code contract", () => {
  const compatible = sampleProfile();
  compatible.materialGroups = [{
    field: "example_materials_one",
    materials: [{ code: "EXAMPLE-ITEM-01", name: "Example item", defaultQty: 1 }]
  }];
  assert.deepEqual(validateFormProfile(compatible), []);

  const duplicate = clone(compatible);
  duplicate.materialGroups.push({
    field: "example_materials_two",
    materials: [{ code: "EXAMPLE-ITEM-01", name: "Duplicate item", defaultQty: 1 }]
  });
  assert.ok(validateFormProfile(duplicate).includes(
    "materialGroups[1].materials[0].code must be unique across materialGroups"
  ));

  const missingQuantity = clone(compatible);
  delete missingQuantity.materialGroups[0].materials[0].defaultQty;
  assert.ok(validateFormProfile(missingQuantity).includes(
    "materialGroups[0].materials[0].defaultQty must be a positive integer"
  ));
});
