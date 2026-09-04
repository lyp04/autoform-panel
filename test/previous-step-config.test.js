import test from "node:test";
import assert from "node:assert/strict";

import { preserveRuntimeProfileConfig, validateFormProfile } from "../api/profile.js";
import { templateToProfile } from "../api/convert.js";

function baseProfile(extra = {}) {
  return { id: "sample-form", displayName: "Sample Form", searchText: "SAMPLE", ...extra };
}

function workflowPolicy(overrides = {}) {
  const base = {
    compatibilityReviewed: true,
    previousSteps: {
      enabled: false,
      scanPrecheck: false,
      scanPrecheckExcludedResultKeys: [],
      triggerResultKeys: [],
      directCreateResultKeys: [],
      artifacts: [],
      legacyDraftArtifactKey: "",
      templates: [],
      identifierCorrection: { enabled: false, substitutions: [], resultKeys: [], applyAction: "block" },
      identifierCasePolicy: "preserve",
      scanPrecheckPolicy: {
        maxMissingAttempts: 1,
        beforeLimitAction: "block",
        atLimitAction: "block"
      },
      verifyAttempts: 1,
      verifyDelayMs: 0,
      recipeMaxAttempts: 1,
      recipeRetryDelayMs: 0
    },
    photos: { includeOptionalSlots: false },
    duplicateCheck: {
      enabled: false,
      agePolicy: { unit: "days", value: 0 },
      unknownDateAction: "block",
      recentAction: "block",
      eligibleAction: "block"
    },
    printing: {
      enabled: false,
      preflightAction: "block",
      onUnconfirmed: "stop",
      batchEndRecheckMode: "deferred_missing_two_pass",
      unknownStatusPresentation: "distinct",
      manualReprintEnabled: false,
      manualReprintStatuses: [],
      manualReprintRequiresConfirmation: true,
      confirmationPolls: 1,
      confirmationPollIntervalMs: 250,
      maxAutoReprints: 0,
      finalRecheckDelayMs: 0
    },
    materials: {
      refreshBeforeSubmit: false,
      missingRecovery: { enabled: false, localNotice: false }
    },
    submission: {
      maxAttempts: 1,
      retryDelayMs: 0,
      interUnitDelayMs: 0,
      roundLedgerRetentionDays: 1,
      maxConsecutiveFailures: 1,
      networkRetry: { maxAttempts: 0, baseDelayMs: 250, maxDelayMs: 250 }
    },
    notifications: { submissionSummary: false }
  };
  const next = { ...base, ...overrides };
  for (const key of ["previousSteps", "photos", "duplicateCheck", "printing", "materials", "submission", "notifications"]) {
    next[key] = { ...base[key], ...(overrides[key] || {}) };
  }
  next.materials.missingRecovery = {
    ...base.materials.missingRecovery,
    ...(overrides.materials?.missingRecovery || {})
  };
  next.submission.networkRetry = {
    ...base.submission.networkRetry,
    ...(overrides.submission?.networkRetry || {})
  };
  next.previousSteps.identifierCorrection = {
    ...base.previousSteps.identifierCorrection,
    ...(overrides.previousSteps?.identifierCorrection || {})
  };
  next.previousSteps.scanPrecheckPolicy = {
    ...base.previousSteps.scanPrecheckPolicy,
    ...(overrides.previousSteps?.scanPrecheckPolicy || {})
  };
  return next;
}

test("enabled identifier correction and artifact recovery cannot be configured as no-ops", () => {
  const profile = baseProfile({
    workflow: workflowPolicy({
      previousSteps: {
        enabled: false,
        identifierCorrection: { enabled: true, substitutions: [], resultKeys: [], applyAction: "auto" },
        scanPrecheckPolicy: {
          maxMissingAttempts: 2,
          beforeLimitAction: "remove",
          atLimitAction: "require_artifact"
        },
        artifacts: []
      }
    })
  });
  const errors = validateFormProfile(profile);
  assert.ok(errors.includes(
    "workflow.previousSteps.identifierCorrection.enabled requires enabled=true"));
  assert.ok(errors.includes(
    "workflow.previousSteps.identifierCorrection.substitutions must be non-empty when enabled=true"));
  assert.ok(errors.includes(
    "workflow.previousSteps.scanPrecheckPolicy.atLimitAction=require_artifact requires at least one required artifact"));
  assert.ok(errors.includes(
    "workflow.previousSteps.scanPrecheckPolicy.atLimitAction=require_artifact requires at least one template"));
});

test("legacy draft evidence requires an explicit exact artifact mapping", () => {
  const profile = baseProfile({
    workflow: workflowPolicy({
      previousSteps: {
        artifacts: [{
          key: "sample-evidence",
          title: "Sample evidence",
          required: true,
          uploadNameTemplate: "{identifier}-sample-evidence.jpg"
        }]
      }
    })
  });
  assert.deepEqual(validateFormProfile(profile), []);

  profile.workflow.previousSteps.legacyDraftArtifactKey = "missing-evidence";
  assert.ok(validateFormProfile(profile).includes(
    "workflow.previousSteps.legacyDraftArtifactKey must reference artifacts[].key"));

  profile.workflow.previousSteps.legacyDraftArtifactKey = "sample-evidence";
  assert.deepEqual(validateFormProfile(profile), []);
  profile.workflow.previousSteps.legacyDraftArtifactKey = true;
  assert.ok(validateFormProfile(profile).includes(
    "workflow.previousSteps.legacyDraftArtifactKey must be a string"));
});

test("AI and template conversion preserve runtime-only modules", () => {
  const current = baseProfile({
    brand: "Sample brand",
    model: "Sample model",
    uiColor: "#2563EB",
    pickerVisible: false,
    expectedSnLength: 12,
    scanner: { preferredSnPrefixes: ["SAMPLE"] },
    materialCodePattern: "^[A-Z0-9_-]+$",
    workflow: workflowPolicy({
      previousSteps: {
        enabled: true,
        scanPrecheck: true,
        scanPrecheckExcludedResultKeys: ["review"],
        triggerResultKeys: ["accepted"],
        directCreateResultKeys: ["accepted"],
        artifacts: [],
        templates: []
      },
      duplicateCheck: {
        enabled: true,
        agePolicy: { unit: "calendar_months", value: 1 },
        unknownDateAction: "skip_as_submitted",
        recentAction: "confirm",
        eligibleAction: "continue"
      },
      printing: {
        enabled: true,
        preflightAction: "confirm",
        onUnconfirmed: "stop",
        batchEndRecheckMode: "deferred_missing_two_pass",
        unknownStatusPresentation: "distinct",
        manualReprintEnabled: true,
        manualReprintStatuses: ["failed"],
        manualReprintRequiresConfirmation: true,
        confirmationPolls: 3,
        confirmationPollIntervalMs: 500,
        maxAutoReprints: 1,
        finalRecheckDelayMs: 1000
      },
      materials: { missingRecovery: { enabled: true, localNotice: true } },
      submission: {
        maxAttempts: 3,
        retryDelayMs: 500,
        interUnitDelayMs: 750,
        roundLedgerRetentionDays: 9,
        maxConsecutiveFailures: 5,
        networkRetry: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 2000 }
      },
      notifications: { submissionSummary: true }
    }),
    futureExtension: { preserved: true }
  });
  const refined = preserveRuntimeProfileConfig({
    id: "sample-form", displayName: "Sample Form updated", searchText: "SAMPLE",
    pickerVisible: true,
    expectedSnLength: 5,
    scanner: { preferredSnPrefixes: ["OTHER"] },
    materialCodePattern: ".*",
    workflow: workflowPolicy()
  }, current);
  assert.equal(refined.pickerVisible, false);
  assert.equal(refined.expectedSnLength, 12);
  assert.deepEqual(refined.scanner, current.scanner);
  assert.equal(refined.materialCodePattern, current.materialCodePattern);
  assert.deepEqual(refined.workflow, current.workflow);
  assert.deepEqual(refined.futureExtension, current.futureExtension);

  const currentBeforeConversion = structuredClone(current);
  const converted = templateToProfile({
    id: 2104, name: "Changed backend template", process_id: 4, sku: "CHANGED_SKU", warehouse_id: 1,
    field_list: []
  }, current);
  assert.equal(converted.brand, current.brand);
  assert.equal(converted.model, current.model);
  assert.equal(converted.uiColor, current.uiColor);
  assert.equal(converted.pickerVisible, false);
  assert.equal(converted.expectedSnLength, 12);
  assert.deepEqual(converted.scanner, current.scanner);
  assert.equal(converted.materialCodePattern, current.materialCodePattern);
  assert.deepEqual(converted.workflow, current.workflow);
  assert.deepEqual(converted.futureExtension, current.futureExtension);
  assert.deepEqual(converted, current);
  assert.deepEqual(current, currentBeforeConversion);
  assert.notStrictEqual(converted.workflow, current.workflow);
  assert.notStrictEqual(converted.futureExtension, current.futureExtension);
});

test("profile-specific scanner and workflow policy is validated", () => {
  assert.deepEqual(validateFormProfile(baseProfile({
    expectedSnLength: 12,
    scanner: { preferredSnPrefixes: [] },
    materialCodePattern: "^[A-Z0-9_-]+$",
    workflow: workflowPolicy({
      previousSteps: {
        enabled: false,
        scanPrecheck: false,
        scanPrecheckExcludedResultKeys: [],
        triggerResultKeys: [],
        directCreateResultKeys: [],
        artifacts: [],
        templates: []
      }
    })
  })), []);

  const invalidWorkflow = workflowPolicy();
  invalidWorkflow.previousSteps.scanPrecheckExcludedResultKeys = ["review"];
  invalidWorkflow.duplicateCheck.agePolicy.value = -1;
  invalidWorkflow.materials.refreshBeforeSubmit = "no";
  invalidWorkflow.notifications.submissionSummary = "yes";
  assert.deepEqual(validateFormProfile(baseProfile({
    scanner: { preferredSnPrefixes: [""] },
    workflow: invalidWorkflow
  })), [
    "scanner.preferredSnPrefixes[0] is required",
    "workflow.duplicateCheck.agePolicy.value must be an integer from 0 to 36500",
    "workflow.materials.refreshBeforeSubmit must be a boolean",
    "workflow.notifications.submissionSummary must be a boolean"
  ]);
});

test("direct-create results must be declared result keys and a trigger subset", () => {
  const profile = baseProfile({
    gradeMap: {
      accepted: { field: "decision", label: "Accepted", value: "accepted" },
      review: { field: "decision", label: "Review", value: "review" }
    },
    workflow: workflowPolicy({
      previousSteps: {
        enabled: true,
        triggerResultKeys: ["accepted"],
        directCreateResultKeys: ["accepted"],
        templates: [{
          templateId: 7001,
          warehouseId: 71,
          sku: "SAMPLE-STATIC",
          fixedData: {},
          serialField: "sample-serial",
          photoBindings: [],
          delayAfterMs: 0
        }]
      }
    })
  });
  assert.deepEqual(validateFormProfile(profile), []);

  profile.workflow.previousSteps.directCreateResultKeys = ["review"];
  assert.ok(validateFormProfile(profile).includes(
    "workflow.previousSteps.directCreateResultKeys[0] must reference triggerResultKeys"));

  profile.workflow.previousSteps.directCreateResultKeys = ["unknown-result"];
  const unknownErrors = validateFormProfile(profile);
  assert.ok(unknownErrors.includes(
    "workflow.previousSteps.directCreateResultKeys[0] must reference gradeMap"));
  assert.ok(unknownErrors.includes(
    "workflow.previousSteps.directCreateResultKeys[0] must reference triggerResultKeys"));

  profile.workflow.previousSteps.directCreateResultKeys = ["accepted", "accepted"];
  assert.ok(validateFormProfile(profile).includes(
    "workflow.previousSteps.directCreateResultKeys[1] must not be duplicated"));

  delete profile.gradeMap;
  profile.workflow.previousSteps.directCreateResultKeys = ["accepted"];
  assert.ok(validateFormProfile(profile).includes(
    "workflow.previousSteps.directCreateResultKeys[0] must reference gradeMap"));

  profile.gradeMap = {
    accepted: { field: "decision", label: "Accepted", value: "accepted" }
  };
  profile.workflow.previousSteps.enabled = false;
  assert.ok(validateFormProfile(profile).includes(
    "workflow.previousSteps.directCreateResultKeys requires enabled=true"));

  profile.workflow.previousSteps.directCreateResultKeys = "accepted";
  assert.ok(validateFormProfile(profile).includes(
    "workflow.previousSteps.directCreateResultKeys must be an array"));
});

test("notification profileLabel is optional, explicit and bounded", () => {
  assert.deepEqual(validateFormProfile(baseProfile({ workflow: workflowPolicy({
    notifications: { submissionSummary: true, profileLabel: "Example line" }
  }) })), []);
  assert.deepEqual(validateFormProfile(baseProfile({ workflow: workflowPolicy({
    notifications: { submissionSummary: true }
  }) })), []);

  const blank = workflowPolicy({
    notifications: { submissionSummary: true, profileLabel: "   " }
  });
  assert.deepEqual(validateFormProfile(baseProfile({ workflow: blank })), [
    "workflow.notifications.profileLabel must be a non-empty string not exceeding 160 characters"
  ]);

  const unknown = workflowPolicy({
    notifications: { submissionSummary: true, inferredProfileLabel: "must not be guessed" }
  });
  assert.deepEqual(validateFormProfile(baseProfile({ workflow: unknown })), [
    "workflow.notifications.inferredProfileLabel is not supported"
  ]);
});

test("second identifiers and operation fields cannot fail only at App runtime", () => {
  const profile = baseProfile({
    requiresSecondSn: true,
    snFields: { primary: "sample-primary" },
    operationFields: [{ field: "" }, "invalid"]
  });
  const errors = validateFormProfile(profile);
  assert.ok(errors.includes("snFields.secondary is required when requiresSecondSn=true"));
  assert.ok(errors.includes("operationFields[0].field is required"));
  assert.ok(errors.includes("operationFields[0].value is required"));
  assert.ok(errors.includes("operationFields[1] must be an object"));
});

test("payload field ownership and profile collection structures are unambiguous", () => {
  const malformedGradeMap = baseProfile({ gradeMap: [] });
  assert.ok(validateFormProfile(malformedGradeMap).includes("gradeMap must be an object"));

  const profile = baseProfile({
    requiresSecondSn: true,
    snFields: { primary: "sample-primary", secondary: "sample-secondary" },
    snPlugins: [
      { key: "primary", field: "wrong-primary", label: "Primary" },
      { key: "extra", field: "shared-field", label: "Extra" }
    ],
    photoSlots: [{
      field: "shared-field", title: "Photo", minPhotos: 1, maxPhotos: 1
    }],
    operationFields: [{ field: "sample-operation", value: "ready" }],
    materialGroups: [
      { field: "materials-one", materials: [{ code: "SAMPLE", name: "One", defaultQty: 1 }] },
      { field: "materials-two", materials: [{ code: "SAMPLE", name: "Two", defaultQty: 1 }] }
    ]
  });
  const errors = validateFormProfile(profile);
  assert.ok(errors.includes(
    "snPlugins[0].field must equal snFields.primary for key=primary"));
  assert.ok(errors.includes(
    "payload field \"shared-field\" is owned by both snPlugins[1] and photoSlots[0]"));
  assert.ok(errors.includes(
    "materialGroups[1].materials[0].code must be unique across materialGroups"));

  const whitespaceRole = baseProfile({
    snFields: { primary: "sample-primary" },
    snPlugins: [
      { key: "primary", field: "sample-primary", label: "Primary" },
      { key: " primary ", field: "sample-primary", label: "Duplicate primary" }
    ]
  });
  const whitespaceErrors = validateFormProfile(whitespaceRole);
  assert.ok(whitespaceErrors.includes("snPlugins[1].key must not have surrounding whitespace"));
  assert.ok(whitespaceErrors.includes("snPlugins[1].key must be unique"));
});

test("generic result keys and declarative previous-step artifacts are validated", () => {
  const profile = baseProfile({
    pickerVisible: true,
    photoSlots: [{
      field: "current-photo",
      title: "Current photo",
      minPhotos: 1,
      maxPhotos: 1,
      required: true,
      conditional: false
    }],
    gradeMap: {
      accepted: {
        field: "decision",
        label: "Accepted",
        labelI18n: { en: "Accepted", es: "Aceptado" },
        uiColor: "#2563EB",
        value: { sku: "accepted", name: "Accepted" }
      }
    },
    workflow: workflowPolicy({
      previousSteps: {
        enabled: true,
        scanPrecheck: true,
        scanPrecheckExcludedResultKeys: [],
        triggerResultKeys: ["accepted"],
        directCreateResultKeys: ["accepted"],
        artifacts: [{
          key: "overview",
          title: "Overview",
          titleI18n: { en: "Overview" },
          required: true,
          uploadNameTemplate: "{identifier}-sample-overview.jpg"
        }],
        identifierCorrection: {
          enabled: true,
          substitutions: [{ from: "O", to: "0" }],
          resultKeys: ["accepted"],
          applyAction: "confirm"
        },
        identifierCasePolicy: "match_existing",
        scanPrecheckPolicy: {
          maxMissingAttempts: 3,
          beforeLimitAction: "remove",
          atLimitAction: "require_artifact"
        },
        verifyAttempts: 2,
        verifyDelayMs: 500,
        templates: [{
          templateId: 3001,
          warehouseId: 41,
          sku: "EXAMPLE-SKU",
          fixedData: {},
          serialField: "serial",
          photoBindings: [
            { targetField: "first-photo", source: "overview" },
            { targetField: "second-photo", source: "current-photo" }
          ],
          delayAfterMs: 0
        }]
      }
    })
  });
  assert.deepEqual(validateFormProfile(profile), []);

  const invalidUploadName = structuredClone(profile);
  invalidUploadName.workflow.previousSteps.artifacts[0].uploadNameTemplate =
    "../{identifier}.jpg";
  assert.ok(validateFormProfile(invalidUploadName).includes(
    "workflow.previousSteps.artifacts[0].uploadNameTemplate must not contain path separators, colon, quotes, or control characters"));

  profile.workflow.previousSteps.templates[0].photoBindings[0].source = "missing";
  assert.deepEqual(validateFormProfile(profile), [
    "workflow.previousSteps.scanPrecheckPolicy.atLimitAction=require_artifact requires a template binding to a required artifact",
    "workflow.previousSteps.templates[0].photoBindings[0].source must reference an artifact key or profile photo field"
  ]);
});

test("previous-step recipes cannot overwrite serial, fixed or sibling photo payload fields", () => {
  const validProfile = baseProfile({
    photoSlots: [{
      field: "current-photo",
      title: "Current photo",
      minPhotos: 1,
      maxPhotos: 1,
      required: true,
      conditional: false
    }],
    workflow: workflowPolicy({
      previousSteps: {
        templates: [{
          templateId: 3001,
          warehouseId: 41,
          sku: "EXAMPLE-SKU",
          fixedData: { "fixed-state": "ready" },
          serialField: "serial",
          photoBindings: [{ targetField: "photo", source: "current-photo" }],
          delayAfterMs: 0
        }]
      }
    })
  });
  assert.deepEqual(validateFormProfile(validProfile), []);

  const serialOverwritesFixed = JSON.parse(JSON.stringify(validProfile));
  serialOverwritesFixed.workflow.previousSteps.templates[0].serialField = "fixed-state";
  assert.ok(validateFormProfile(serialOverwritesFixed).includes(
    "workflow.previousSteps.templates[0].serialField must not overwrite workflow.previousSteps.templates[0].fixedData"));

  const photoOverwritesSerial = JSON.parse(JSON.stringify(validProfile));
  photoOverwritesSerial.workflow.previousSteps.templates[0].photoBindings[0].targetField = "serial";
  assert.ok(validateFormProfile(photoOverwritesSerial).includes(
    "workflow.previousSteps.templates[0].photoBindings[0].targetField must not overwrite workflow.previousSteps.templates[0].serialField"));

  const photoOverwritesFixed = JSON.parse(JSON.stringify(validProfile));
  photoOverwritesFixed.workflow.previousSteps.templates[0].photoBindings[0].targetField = "fixed-state";
  assert.ok(validateFormProfile(photoOverwritesFixed).includes(
    "workflow.previousSteps.templates[0].photoBindings[0].targetField must not overwrite workflow.previousSteps.templates[0].fixedData"));

  const duplicatePhotos = JSON.parse(JSON.stringify(validProfile));
  duplicatePhotos.workflow.previousSteps.templates[0].photoBindings.push(
    { targetField: "photo", source: "current-photo" });
  assert.ok(validateFormProfile(duplicatePhotos).includes(
    "workflow.previousSteps.templates[0].photoBindings[1].targetField must be unique within the template"));
});

test("identifier correction and scan-precheck decisions are strictly validated", () => {
  const profile = baseProfile({ workflow: workflowPolicy() });
  profile.workflow.previousSteps.identifierCorrection = {
    enabled: "yes",
    substitutions: [
      { from: "A", to: "1" },
      { from: "A", to: "2" },
      { from: "AB", to: "3" },
      { from: "C", to: " " },
      { from: "D", to: "4" },
      { from: "E", to: "5" },
      { from: "F", to: "6" },
      { from: "G", to: "7" },
      { from: "H", to: "8" }
    ],
    applyAction: "guess"
  };
  profile.workflow.previousSteps.identifierCasePolicy = "upper";
  profile.workflow.previousSteps.scanPrecheckPolicy = {
    maxMissingAttempts: 0,
    beforeLimitAction: "retry",
    atLimitAction: "continue"
  };
  profile.workflow.previousSteps.verifyAttempts = 11;
  profile.workflow.previousSteps.verifyDelayMs = -1;
  profile.workflow.previousSteps.recipeMaxAttempts = 0;
  profile.workflow.previousSteps.recipeRetryDelayMs = 60001;

  const errors = validateFormProfile(profile);
  for (const expected of [
    "workflow.previousSteps.identifierCorrection.enabled must be a boolean",
    "workflow.previousSteps.identifierCorrection.applyAction must be one of: auto, confirm, block",
    "workflow.previousSteps.identifierCorrection.substitutions must contain at most 8 items",
    "workflow.previousSteps.identifierCorrection.substitutions[1].from must be unique",
    "workflow.previousSteps.identifierCorrection.substitutions[2].from must be exactly one non-whitespace character",
    "workflow.previousSteps.identifierCorrection.substitutions[3].to must be exactly one non-whitespace character",
    "workflow.previousSteps.identifierCasePolicy must be one of: preserve, match_existing",
    "workflow.previousSteps.scanPrecheckPolicy.maxMissingAttempts must be an integer from 1 to 10",
    "workflow.previousSteps.scanPrecheckPolicy.beforeLimitAction must be one of: remove, block",
    "workflow.previousSteps.scanPrecheckPolicy.atLimitAction must be one of: require_artifact, block",
    "workflow.previousSteps.verifyAttempts must be an integer from 1 to 10",
    "workflow.previousSteps.verifyDelayMs must be an integer from 0 to 30000",
    "workflow.previousSteps.recipeMaxAttempts must be an integer from 1 to 10",
    "workflow.previousSteps.recipeRetryDelayMs must be an integer from 0 to 60000"
  ]) {
    assert.ok(errors.includes(expected), expected);
  }
});

test("legacy previous-step profiles may omit new decision sections", () => {
  const profile = baseProfile({ workflow: workflowPolicy() });
  for (const key of [
    "directCreateResultKeys", "identifierCorrection", "identifierCasePolicy", "scanPrecheckPolicy",
    "verifyAttempts", "verifyDelayMs", "recipeMaxAttempts", "recipeRetryDelayMs"
  ]) delete profile.workflow.previousSteps[key];
  assert.deepEqual(validateFormProfile(profile), []);
});
