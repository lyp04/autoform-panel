import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { validateFormProfile } from "../src/profile.js";
import { validateProfilesForPublish, validateWorkflowCapabilities } from "../src/worker.js";

const seed = JSON.parse(await readFile(new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const submitOutcomePolicy = ({ retryRules = [], missingRules = [] } = {}) => ({
  version: 1,
  evidenceSha256: "a".repeat(64),
  retryableNotWrittenRules: retryRules,
  missingMaterialNotWrittenRules: missingRules
});
const previousStepRecipeOutcomePolicy = ({ retryRules = [], alreadyExistsRules = [] } = {}) => ({
  version: 1,
  evidenceSha256: "b".repeat(64),
  retryableNotWrittenRules: retryRules,
  alreadyExistsAcknowledgedRules: alreadyExistsRules
});
const REQUIRED_PUBLISH_POLICY_PATHS = [
  "defaultPhotoOrder",
  "workflow.compatibilityReviewed",
  "workflow.previousSteps.enabled",
  "workflow.previousSteps.scanPrecheck",
  "workflow.previousSteps.scanPrecheckExcludedResultKeys",
  "workflow.previousSteps.triggerResultKeys",
  "workflow.previousSteps.directCreateResultKeys",
  "workflow.previousSteps.artifacts",
  "workflow.previousSteps.legacyDraftArtifactKey",
  "workflow.previousSteps.templates",
  "workflow.previousSteps.identifierCorrection.enabled",
  "workflow.previousSteps.identifierCorrection.substitutions",
  "workflow.previousSteps.identifierCorrection.resultKeys",
  "workflow.previousSteps.identifierCorrection.applyAction",
  "workflow.previousSteps.identifierCasePolicy",
  "workflow.previousSteps.scanPrecheckPolicy.maxMissingAttempts",
  "workflow.previousSteps.scanPrecheckPolicy.beforeLimitAction",
  "workflow.previousSteps.scanPrecheckPolicy.atLimitAction",
  "workflow.previousSteps.verifyAttempts",
  "workflow.previousSteps.verifyDelayMs",
  "workflow.previousSteps.recipeMaxAttempts",
  "workflow.previousSteps.recipeRetryDelayMs",
  "workflow.photos.includeOptionalSlots",
  "workflow.alternateEntries.enabled",
  "workflow.alternateEntries.entries",
  "workflow.duplicateCheck.enabled",
  "workflow.duplicateCheck.agePolicy.unit",
  "workflow.duplicateCheck.agePolicy.value",
  "workflow.duplicateCheck.unknownDateAction",
  "workflow.duplicateCheck.recentAction",
  "workflow.duplicateCheck.eligibleAction",
  "workflow.printing.enabled",
  "workflow.printing.preflightAction",
  "workflow.printing.onUnconfirmed",
  "workflow.printing.batchEndRecheckMode",
  "workflow.printing.unknownStatusPresentation",
  "workflow.printing.manualReprintEnabled",
  "workflow.printing.manualReprintStatuses",
  "workflow.printing.manualReprintRequiresConfirmation",
  "workflow.printing.confirmationPolls",
  "workflow.printing.confirmationPollIntervalMs",
  "workflow.printing.maxAutoReprints",
  "workflow.printing.finalRecheckDelayMs",
  "workflow.materials.refreshBeforeSubmit",
  "workflow.materials.missingRecovery.enabled",
  "workflow.materials.missingRecovery.localNotice",
  "workflow.submission.maxAttempts",
  "workflow.submission.retryDelayMs",
  "workflow.submission.interUnitDelayMs",
  "workflow.submission.roundLedgerRetentionDays",
  "workflow.submission.maxConsecutiveFailures",
  "workflow.submission.networkRetry.maxAttempts",
  "workflow.submission.networkRetry.baseDelayMs",
  "workflow.submission.networkRetry.maxDelayMs",
  "workflow.notifications.submissionSummary"
];

function deletePath(value, path) {
  const keys = path.split(".");
  let current = value;
  for (const key of keys.slice(0, -1)) current = current[key];
  delete current[keys.at(-1)];
}

test("public sample profiles use explicit fail-safe workflow policies", () => {
  assert.equal(seed.profiles.length, 2);
  for (const profile of seed.profiles) {
    assert.deepEqual(validateFormProfile(profile), []);
    assert.equal(profile.workflow.compatibilityReviewed, true);
    assert.deepEqual(profile.workflow.previousSteps.identifierCorrection, {
      enabled: false,
      substitutions: [],
      resultKeys: [],
      applyAction: "block"
    });
    assert.equal(profile.workflow.previousSteps.identifierCasePolicy, "preserve");
    assert.deepEqual(profile.workflow.previousSteps.scanPrecheckPolicy, {
      maxMissingAttempts: 1,
      beforeLimitAction: "block",
      atLimitAction: "block"
    });
    assert.equal(profile.workflow.previousSteps.verifyAttempts, 1);
    assert.equal(profile.workflow.previousSteps.verifyDelayMs, 0);
    assert.equal(profile.workflow.previousSteps.recipeMaxAttempts, 1);
    assert.equal(profile.workflow.previousSteps.recipeRetryDelayMs, 0);
    assert.equal(profile.workflow.previousSteps.legacyDraftArtifactKey, "");
    assert.deepEqual(profile.workflow.previousSteps.directCreateResultKeys, []);
    assert.deepEqual(profile.workflow.photos, { includeOptionalSlots: false });
    assert.deepEqual(profile.workflow.alternateEntries, { enabled: false, entries: [] });
    assert.deepEqual(profile.workflow.duplicateCheck, {
      enabled: false,
      agePolicy: { unit: "days", value: 0 },
      unknownDateAction: "block",
      recentAction: "block",
      eligibleAction: "block"
    });
    assert.deepEqual(profile.workflow.printing, {
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
    });
    assert.deepEqual(profile.workflow.materials, {
      refreshBeforeSubmit: false,
      missingRecovery: { enabled: false, localNotice: false }
    });
    assert.deepEqual(profile.workflow.submission, {
      maxAttempts: 1,
      retryDelayMs: 0,
      interUnitDelayMs: 0,
      roundLedgerRetentionDays: 1,
      maxConsecutiveFailures: 1,
      networkRetry: { maxAttempts: 0, baseDelayMs: 250, maxDelayMs: 250 }
    });
  }
});

test("all routes that can replace profiles share the complete publish validator", () => {
  const profile = clone(seed.profiles[0]);
  delete profile.template.sku;
  assert.deepEqual(validateProfilesForPublish([profile]), [{
    index: 0,
    id: profile.id,
    errors: ["template.sku is required and must not contain surrounding whitespace"]
  }]);
});

test("publish template identity matches the App positive-int and trimmed-SKU contract", () => {
  const valid = clone(seed.profiles[0]);
  valid.template.id = 2147483647;
  valid.template.warehouseId = 1;
  assert.deepEqual(validateProfilesForPublish([valid]), []);

  for (const [path, value, expected] of [
    ["id", 0, "template.id must be a positive 32-bit integer"],
    ["id", -1, "template.id must be a positive 32-bit integer"],
    ["id", 1.5, "template.id must be a positive 32-bit integer"],
    ["id", "1", "template.id must be a positive 32-bit integer"],
    ["id", 2147483648, "template.id must be a positive 32-bit integer"],
    ["warehouseId", 0, "template.warehouseId must be a positive 32-bit integer"],
    ["warehouseId", "1", "template.warehouseId must be a positive 32-bit integer"]
  ]) {
    const profile = clone(seed.profiles[0]);
    profile.template[path] = value;
    assert.ok(validateProfilesForPublish([profile])[0].errors.includes(expected),
      `${path}=${JSON.stringify(value)}`);
  }

  for (const sku of ["", "   ", " SAMPLE-SKU ", 123]) {
    const profile = clone(seed.profiles[0]);
    profile.template.sku = sku;
    assert.ok(validateProfilesForPublish([profile])[0].errors.includes(
      "template.sku is required and must not contain surrounding whitespace"),
      `sku=${JSON.stringify(sku)}`);
  }
});

test("catalog profile ids must be unique across the published collection", () => {
  const first = clone(seed.profiles[0]);
  const duplicate = clone(seed.profiles[1]);
  duplicate.id = first.id;
  const problems = validateProfilesForPublish([first, duplicate]);
  assert.equal(problems.length, 1);
  assert.deepEqual(problems[0], {
    index: 1,
    id: first.id,
    errors: ["id duplicates profile at index 0"]
  });
});

test("a profile cannot be published until compatibility has been explicitly reviewed", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.compatibilityReviewed = false;
  assert.ok(validateProfilesForPublish([profile])[0].errors.includes(
    "workflow.compatibilityReviewed must be true before publish"));
});

test("publish rejects every operational policy key that the App requires explicitly", () => {
  for (const path of REQUIRED_PUBLISH_POLICY_PATHS) {
    const profile = clone(seed.profiles[0]);
    deletePath(profile, path);
    const problems = validateProfilesForPublish([profile]);
    assert.equal(problems.length, 1, path);
    const expected = path === "defaultPhotoOrder"
      ? "defaultPhotoOrder must be explicitly set to a supported value before publish"
      : path === "workflow.compatibilityReviewed"
        ? "workflow.compatibilityReviewed must be true before publish"
        : `${path} is required before publish`;
    assert.ok(problems[0].errors.includes(expected), path);
  }
});

test("publish rejects an unsupported default photo order", () => {
  const profile = clone(seed.profiles[0]);
  profile.defaultPhotoOrder = "sample-unknown-order";
  const errors = validateProfilesForPublish([profile])[0].errors;
  assert.ok(errors.includes(
    "defaultPhotoOrder must be explicitly set to a supported value before publish"));
});

test("enabled duplicate handling requires explicit Panel-owned actions", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.duplicateCheck.enabled = true;
  delete profile.workflow.duplicateCheck.agePolicy;
  delete profile.workflow.duplicateCheck.unknownDateAction;
  delete profile.workflow.duplicateCheck.recentAction;
  delete profile.workflow.duplicateCheck.eligibleAction;
  const missingErrors = validateFormProfile(profile);
  assert.ok(missingErrors.includes(
    "workflow.duplicateCheck.agePolicy must be an object when enabled=true"
  ));
  assert.ok(missingErrors.includes(
    "workflow.duplicateCheck.unknownDateAction must be one of: skip_as_submitted, confirm, block"
  ));
  assert.ok(missingErrors.includes(
    "workflow.duplicateCheck.recentAction must be one of: skip_as_submitted, confirm, block"
  ));
  assert.ok(missingErrors.includes(
    "workflow.duplicateCheck.eligibleAction must be one of: continue, confirm, block"
  ));

  profile.workflow.duplicateCheck.agePolicy = { unit: "calendar_months", value: 1 };
  profile.workflow.duplicateCheck.unknownDateAction = "skip_as_submitted";
  profile.workflow.duplicateCheck.recentAction = "confirm";
  profile.workflow.duplicateCheck.eligibleAction = "continue";
  assert.deepEqual(validateFormProfile(profile), []);

  profile.workflow.duplicateCheck.enabled = false;
  delete profile.workflow.duplicateCheck.recentAction;
  delete profile.workflow.duplicateCheck.eligibleAction;
  delete profile.workflow.duplicateCheck.agePolicy;
  delete profile.workflow.duplicateCheck.unknownDateAction;
  assert.deepEqual(validateFormProfile(profile), []);
});

test("duplicate age units and unknown-date actions are validated", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.duplicateCheck.agePolicy = { unit: "weeks", value: 36501 };
  profile.workflow.duplicateCheck.unknownDateAction = "continue";
  const errors = validateFormProfile(profile);
  assert.ok(errors.includes(
    "workflow.duplicateCheck.agePolicy.unit must be one of: days, calendar_months"));
  assert.ok(errors.includes(
    "workflow.duplicateCheck.agePolicy.value must be an integer from 0 to 36500"));
  assert.ok(errors.includes(
    "workflow.duplicateCheck.unknownDateAction must be one of: skip_as_submitted, confirm, block"));
});

test("optional photo submission requires an explicit modern slot profile", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.photos.includeOptionalSlots = true;
  profile.optionalSlots = [{
    field: "sample-optional-photo",
    title: "Optional photo",
    minPhotos: 0,
    maxPhotos: 1
  }];
  assert.deepEqual(validateFormProfile(profile), []);

  delete profile.photoSlots;
  assert.ok(validateFormProfile(profile).includes(
    "workflow.photos.includeOptionalSlots=true requires non-empty photoSlots"));
});

test("printing and submission policy bounds are enforced", () => {
  const profile = clone(seed.profiles[0]);
  Object.assign(profile.workflow.printing, {
    enabled: true,
    preflightAction: "guess",
    onUnconfirmed: "guess",
    batchEndRecheckMode: "unbounded",
    unknownStatusPresentation: "guess",
    manualReprintEnabled: "yes",
    manualReprintStatuses: ["printed", "failed", "failed"],
    manualReprintRequiresConfirmation: "yes",
    confirmationPolls: 13,
    confirmationPollIntervalMs: 249,
    maxAutoReprints: 4,
    finalRecheckDelayMs: 120001
  });
  Object.assign(profile.workflow.submission, {
    maxAttempts: 0,
    retryDelayMs: 60001,
    interUnitDelayMs: 60001,
    roundLedgerRetentionDays: 31,
    maxConsecutiveFailures: 101,
    structuredNonSuccessAction: "guess"
  });
  Object.assign(profile.workflow.submission.networkRetry, {
    maxAttempts: 101,
    baseDelayMs: 60001,
    maxDelayMs: 249
  });
  Object.assign(profile.workflow.previousSteps, {
    recipeMaxAttempts: 0,
    recipeRetryDelayMs: 60001
  });

  const errors = validateFormProfile(profile);
  for (const expected of [
    "workflow.printing.preflightAction must be one of: block, confirm, continue",
    "workflow.printing.onUnconfirmed must be one of: stop, continue",
    "workflow.printing.batchEndRecheckMode must be one of: inline_only, deferred_missing_two_pass",
    "workflow.printing.unknownStatusPresentation must be one of: as_ongoing, distinct",
    "workflow.printing.manualReprintEnabled must be a boolean",
    "workflow.printing.manualReprintStatuses[0] must be failed, ongoing or unknown",
    "workflow.printing.manualReprintStatuses[2] must not be duplicated",
    "workflow.printing.manualReprintRequiresConfirmation must be a boolean",
    "workflow.printing.confirmationPolls must be an integer from 1 to 12",
    "workflow.printing.confirmationPollIntervalMs must be an integer from 250 to 30000",
    "workflow.printing.maxAutoReprints must be an integer from 0 to 3",
    "workflow.printing.finalRecheckDelayMs must be an integer from 0 to 120000",
    "workflow.submission.maxAttempts must be an integer from 1 to 10",
    "workflow.submission.retryDelayMs must be an integer from 0 to 60000",
    "workflow.submission.interUnitDelayMs must be an integer from 0 to 60000",
    "workflow.submission.roundLedgerRetentionDays must be an integer from 1 to 30",
    "workflow.submission.maxConsecutiveFailures must be an integer from 1 to 100",
    "workflow.submission.structuredNonSuccessAction must be one of: lock, reject_as_not_written",
    "workflow.submission.networkRetry.maxAttempts must be an integer from 0 to 100",
    "workflow.submission.networkRetry.baseDelayMs must be an integer from 250 to 60000",
    "workflow.submission.networkRetry.maxDelayMs must be an integer from 250 to 300000",
    "workflow.submission.networkRetry.maxDelayMs must be at least baseDelayMs",
    "workflow.previousSteps.recipeMaxAttempts must be an integer from 1 to 10",
    "workflow.previousSteps.recipeRetryDelayMs must be an integer from 0 to 60000"
  ]) {
    assert.ok(errors.includes(expected), expected);
  }
});

test("manual reprint requires an explicit allowed status and supports an explicit confirmation policy", () => {
  const profile = clone(seed.profiles[0]);
  Object.assign(profile.workflow.printing, {
    enabled: true,
    manualReprintEnabled: true,
    manualReprintStatuses: [],
    manualReprintRequiresConfirmation: false
  });
  assert.ok(validateFormProfile(profile).includes(
    "workflow.printing.manualReprintStatuses must be non-empty when manualReprintEnabled=true"));

  profile.workflow.printing.manualReprintStatuses = ["failed", "ongoing", "unknown"];
  assert.deepEqual(validateFormProfile(profile), []);
});

test("enabled printing cannot rely on implicit decision defaults", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.printing = { enabled: true };
  const errors = validateFormProfile(profile);
  for (const expected of [
    "workflow.printing.preflightAction must be one of: block, confirm, continue",
    "workflow.printing.onUnconfirmed must be one of: stop, continue",
    "workflow.printing.manualReprintEnabled must be a boolean",
    "workflow.printing.confirmationPolls must be an integer from 1 to 12",
    "workflow.printing.confirmationPollIntervalMs must be an integer from 250 to 30000",
    "workflow.printing.maxAutoReprints must be an integer from 0 to 3",
    "workflow.printing.finalRecheckDelayMs must be an integer from 0 to 120000"
  ]) {
    assert.ok(errors.includes(expected), expected);
  }
});

test("legacy profiles without new workflow sections remain editable but cannot be published", () => {
  const profile = clone(seed.profiles[0]);
  delete profile.workflow.previousSteps.identifierCorrection;
  delete profile.workflow.previousSteps.identifierCasePolicy;
  delete profile.workflow.previousSteps.scanPrecheckPolicy;
  delete profile.workflow.previousSteps.verifyAttempts;
  delete profile.workflow.previousSteps.verifyDelayMs;
  delete profile.workflow.photos;
  delete profile.workflow.alternateEntries;
  delete profile.workflow.printing;
  delete profile.workflow.materials.missingRecovery;
  delete profile.workflow.submission;
  assert.deepEqual(validateFormProfile(profile), []);
  assert.ok(validateProfilesForPublish([profile])[0].errors.includes(
    "workflow.photos.includeOptionalSlots is required before publish"));
});

test("legacy print compatibility defaults remain editable but new publishes require both keys", () => {
  const profile = clone(seed.profiles[0]);
  delete profile.workflow.printing.batchEndRecheckMode;
  delete profile.workflow.printing.unknownStatusPresentation;

  assert.deepEqual(validateFormProfile(profile), []);
  const errors = validateProfilesForPublish([profile])[0].errors;
  assert.ok(errors.includes(
    "workflow.printing.batchEndRecheckMode is required before publish"));
  assert.ok(errors.includes(
    "workflow.printing.unknownStatusPresentation is required before publish"));
});

test("Panel exposes structured controls for each workflow decision", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const marker of [
    "近期重复记录处理",
    "达到重录年龄后的处理",
    "重复记录时间无法解析时",
    "已逐项核对旧版行为兼容性",
    "让 App 拍摄并提交可选照片框",
    "提交后打印（不勾选则不检查打印机）",
    "发送飞书提交通知（需同时开启全局通知）",
    "启用飞书通知（总开关；关闭后保留配置但不发送）",
    "打印预检未通过时",
    "打印状态未确认时",
    "批次结束打印复查",
    "未知打印状态显示",
    "允许手动补打",
    "手动补打前再次确认",
    "失败任务可手动补打",
    "进行中任务可手动补打",
    "未知状态任务可手动补打",
    "启用标识字符纠正",
    "标识纠正应用方式",
    "标识大小写策略",
    "预检缺失最多尝试次数",
    "达到上限前的缺失处理",
    "达到上限时的缺失处理",
    "前置步骤复核次数",
    "前置步骤复核等待（毫秒）",
    "前置配方提交最多尝试",
    "前置配方重试等待（毫秒）",
    "跳过创建前查询并直接创建的结果（逗号分隔）",
    "标识字符替换（最多 8 项；每格恰好一个字符）",
    "启用缺失列表项恢复",
    "提交前刷新列表项",
    "单条提交最多尝试",
    "单条之间等待（毫秒）",
    "本地提交记录保留天数",
    "网络额外重试次数"
  ]) {
    assert.ok(html.includes(marker), marker);
  }
});

test("a profile cannot enable printing without the adapter capability", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.printing.enabled = true;
  assert.deepEqual(validateWorkflowCapabilities([profile], { printing: { enabled: false } }), [
    "a profile enables workflow.printing but backendAdapter.printing.enabled is not true"
  ]);
  assert.deepEqual(validateWorkflowCapabilities([profile], { printing: { enabled: true } }), []);
});

test("a profile cannot enable duplicate checking without explicit date parsing", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.duplicateCheck.enabled = true;
  const legacyAdapter = {
    endpoints: { snRepetition: "/entries/serial-repetition" },
    operations: { duplicateCheck: { dateFields: ["createdAt"] } }
  };
  const errors = validateWorkflowCapabilities([profile], legacyAdapter);
  assert.ok(errors.includes(
    "a profile enables workflow.duplicateCheck but operations.duplicateCheck.dateTransforms must be an array"
  ));
  assert.ok(errors.includes(
    "a profile enables workflow.duplicateCheck but operations.duplicateCheck.epochUnits must be an array"
  ));
  assert.ok(errors.includes(
    "a profile enables workflow.duplicateCheck but operations.duplicateCheck.timeZone is required"
  ));

  Object.assign(legacyAdapter.operations.duplicateCheck, {
    dateTransforms: [],
    epochUnits: ["seconds", "milliseconds"],
    dateFormats: [],
    timeZone: "UTC"
  });
  assert.deepEqual(validateWorkflowCapabilities([profile], legacyAdapter), []);
});

test("previous-step workflows require the matching adapter operation", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.previousSteps.enabled = true;
  const errors = validateWorkflowCapabilities([profile], { endpoints: {}, operations: {} });
  assert.deepEqual(errors, [
    "a profile enables workflow.previousSteps but backendAdapter.endpoints.detectionData is not configured",
    "a profile enables workflow.previousSteps but backendAdapter.operations.previousSteps is not configured"
  ]);
  assert.deepEqual(validateWorkflowCapabilities([profile], {
    endpoints: { detectionData: "/entries/detection-data" },
    operations: { previousSteps: {} }
  }), [
    "a profile enables workflow.previousSteps but operations.previousSteps.missingResponseCodes must be an array",
    "a profile enables workflow.previousSteps but operations.previousSteps.missingMessagePatterns must be an array",
    "a profile enables workflow.previousSteps but operations.previousSteps.retryableMessagePatterns must be an array",
    "a profile enables workflow.previousSteps but operations.previousSteps.alreadyExistsMessagePatterns must be an array"
  ]);
  assert.deepEqual(validateWorkflowCapabilities([profile], {
    endpoints: { detectionData: "/entries/detection-data" },
    operations: {
      previousSteps: {
        missingResponseCodes: [],
        missingMessagePatterns: [],
        retryableMessagePatterns: [],
        alreadyExistsMessagePatterns: []
      }
    }
  }), []);
});

test("executable previous-step recipe retries require independent attested rules", () => {
  const profile = clone(seed.profiles[0]);
  Object.assign(profile.workflow.previousSteps, {
    enabled: true,
    triggerResultKeys: ["sample-ready"],
    recipeMaxAttempts: 2,
    templates: [{
      templateId: 7001,
      warehouseId: 71,
      sku: "SAMPLE-STATIC",
      fixedData: {},
      serialField: "sample-serial",
      photoBindings: [],
      delayAfterMs: 0
    }]
  });
  assert.deepEqual(validateFormProfile(profile), []);
  const adapter = {
    endpoints: { detectionData: "/entries/detection-data" },
    operations: {
      previousSteps: {
        missingResponseCodes: [],
        missingMessagePatterns: [],
        // Legacy classifiers stay present for old Apps but cannot attest the new retry.
        retryableMessagePatterns: ["sample legacy retry"],
        alreadyExistsMessagePatterns: []
      }
    }
  };

  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), [
    "an executable previous-step recipe requires attested outcome handling but operations.previousSteps.recipeOutcomePolicy must be configured"
  ]);
  adapter.operations.previousSteps.recipeOutcomePolicy =
    previousStepRecipeOutcomePolicy();
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), [
    "an executable previous-step recipe requires attested outcome handling but operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules must be non-empty"
  ]);
  adapter.operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules = [{
    codeValues: ["sample recipe definitely not written"],
    messagePatterns: []
  }];
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), []);
});

test("executable previous-step legacy already-exists handling requires acknowledged rules", () => {
  const profile = clone(seed.profiles[0]);
  Object.assign(profile.workflow.previousSteps, {
    enabled: true,
    triggerResultKeys: ["sample-ready"],
    recipeMaxAttempts: 1,
    templates: [{
      templateId: 7001,
      warehouseId: 71,
      sku: "SAMPLE-STATIC",
      fixedData: {},
      serialField: "sample-serial",
      photoBindings: [],
      delayAfterMs: 0
    }]
  });
  const adapter = {
    endpoints: { detectionData: "/entries/detection-data" },
    operations: {
      previousSteps: {
        missingResponseCodes: [],
        missingMessagePatterns: [],
        retryableMessagePatterns: [],
        alreadyExistsMessagePatterns: ["sample legacy existing"]
      }
    }
  };

  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), [
    "an executable previous-step recipe requires attested outcome handling but operations.previousSteps.recipeOutcomePolicy must be configured"
  ]);
  adapter.operations.previousSteps.recipeOutcomePolicy =
    previousStepRecipeOutcomePolicy();
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), [
    "an executable previous-step recipe requires attested outcome handling but operations.previousSteps.recipeOutcomePolicy.alreadyExistsAcknowledgedRules must be non-empty"
  ]);
  adapter.operations.previousSteps.recipeOutcomePolicy
    .alreadyExistsAcknowledgedRules = [{
      codeValues: [],
      messagePatterns: ["sample recipe was already applied"]
    }];
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), []);
});

test("previous-step outcome gate ignores profiles without an executable recipe path", () => {
  const base = clone(seed.profiles[0]);
  Object.assign(base.workflow.previousSteps, {
    enabled: true,
    triggerResultKeys: ["sample-ready"],
    recipeMaxAttempts: 2,
    templates: [{ templateId: 7001 }]
  });
  const adapter = {
    endpoints: { detectionData: "/entries/detection-data" },
    operations: {
      previousSteps: {
        missingResponseCodes: [],
        missingMessagePatterns: [],
        retryableMessagePatterns: ["sample legacy retry"],
        alreadyExistsMessagePatterns: ["sample legacy existing"]
      }
    }
  };

  const disabled = clone(base);
  disabled.workflow.previousSteps.enabled = false;
  assert.deepEqual(validateWorkflowCapabilities([disabled], adapter), []);

  const noTriggers = clone(base);
  noTriggers.workflow.previousSteps.triggerResultKeys = [];
  assert.deepEqual(validateWorkflowCapabilities([noTriggers], adapter), []);

  const noTemplates = clone(base);
  noTemplates.workflow.previousSteps.templates = [];
  assert.deepEqual(validateWorkflowCapabilities([noTemplates], adapter), []);

  const executableSingleAttempt = clone(base);
  executableSingleAttempt.workflow.previousSteps.recipeMaxAttempts = 1;
  adapter.operations.previousSteps.alreadyExistsMessagePatterns = [];
  assert.deepEqual(validateWorkflowCapabilities(
    [noTemplates, executableSingleAttempt], adapter), []);
});

test("missing-material recovery must be actionable in both profile and adapter", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.materials.missingRecovery.enabled = true;
  assert.ok(validateFormProfile(profile).includes(
    "workflow.materials.missingRecovery.enabled requires workflow.submission.maxAttempts >= 2"
  ));

  profile.workflow.submission.maxAttempts = 2;
  assert.deepEqual(validateFormProfile(profile), []);
  const missingAdapter = {
    operations: { submit: { missingMaterialMessagePatterns: [] } }
  };
  assert.deepEqual(validateWorkflowCapabilities([profile], missingAdapter), [
    "a profile enables workflow.materials.missingRecovery but backendAdapter.operations.submit.missingMaterialMessagePatterns is empty",
    "a profile enables workflow.materials.missingRecovery but operations.submit.outcomePolicy must be configured",
    "a profile enables workflow.submission retry but operations.submit.outcomePolicy must be configured"
  ]);

  missingAdapter.operations.submit.missingMaterialMessagePatterns = ["sample missing"];
  assert.deepEqual(validateWorkflowCapabilities([profile], missingAdapter), [
    "a profile enables workflow.materials.missingRecovery but operations.submit.outcomePolicy must be configured",
    "a profile enables workflow.submission retry but operations.submit.outcomePolicy must be configured"
  ]);

  missingAdapter.operations.submit.outcomePolicy = submitOutcomePolicy();
  assert.deepEqual(validateWorkflowCapabilities([profile], missingAdapter), [
    "a profile enables workflow.materials.missingRecovery but operations.submit.outcomePolicy.missingMaterialNotWrittenRules must be non-empty",
    "a profile enables workflow.submission retry but operations.submit.outcomePolicy.retryableNotWrittenRules must be non-empty"
  ]);

  missingAdapter.operations.submit.outcomePolicy.missingMaterialNotWrittenRules = [{
    codeValues: [],
    messagePatterns: ["sample material not written"]
  }];
  assert.deepEqual(validateWorkflowCapabilities([profile], missingAdapter), [
    "a profile enables workflow.submission retry but operations.submit.outcomePolicy.retryableNotWrittenRules must be non-empty"
  ]);
  missingAdapter.operations.submit.outcomePolicy.retryableNotWrittenRules = [{
    codeValues: ["sample retry not written"],
    messagePatterns: []
  }];
  assert.deepEqual(validateWorkflowCapabilities([profile], missingAdapter), []);

  missingAdapter.operations.submit.outcomePolicy.evidenceSha256 = "not-a-digest";
  assert.ok(validateWorkflowCapabilities([profile], missingAdapter).includes(
    "a profile enables workflow.materials.missingRecovery but operations.submit.outcomePolicy.evidenceSha256 must be lowercase SHA-256"));
  missingAdapter.operations.submit.outcomePolicy.evidenceSha256 = "a".repeat(64);

  profile.materialGroups = [{
    field: "sample-items",
    title: "Sample items",
    materials: [{ code: "SAMPLE-A", name: "Sample A", defaultQty: 1 }]
  }];
  profile.materialCodePattern = "";
  assert.deepEqual(validateWorkflowCapabilities([profile], missingAdapter), [
    "profiles[0].materialCodePattern must be non-empty when missing-material recovery is enabled for a profile with materials"
  ]);
  // The App contract uses Java Pattern syntax. Panel must not reject it with the subtly different
  // JavaScript RegExp engine; Android promotion validates the actual expression fail-closed.
  profile.materialCodePattern = "[";
  assert.deepEqual(validateWorkflowCapabilities([profile], missingAdapter), []);
  profile.materialCodePattern = "^SAMPLE-[A-Z]+$";
  assert.deepEqual(validateWorkflowCapabilities([profile], missingAdapter), []);
});

test("submission retries require explicit not-written outcome rules before publish", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.submission.maxAttempts = 2;
  const adapter = {
    operations: {
      submit: {
        retryableMessagePatterns: [],
        missingMaterialMessagePatterns: []
      }
    }
  };

  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), [
    "a profile enables workflow.submission retry but operations.submit.outcomePolicy must be configured"
  ]);
  adapter.operations.submit.outcomePolicy = submitOutcomePolicy();
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), [
    "a profile enables workflow.submission retry but operations.submit.outcomePolicy.retryableNotWrittenRules must be non-empty"
  ]);
  adapter.operations.submit.outcomePolicy.retryableNotWrittenRules = [{
    codeValues: ["sample retry not written"],
    messagePatterns: []
  }];
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), []);
});

test("alternate-entry retries require explicit not-written outcome rules before publish", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.alternateEntries = {
    enabled: true,
    entries: [{ submissionRetry: { maxAttempts: 2, retryDelayMs: 0 } }]
  };
  const adapter = {
    operations: {
      submit: {
        retryableMessagePatterns: [],
        missingMaterialMessagePatterns: [],
        outcomePolicy: submitOutcomePolicy()
      }
    }
  };

  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), [
    "an alternate entry enables submission retry but operations.submit.outcomePolicy.retryableNotWrittenRules must be non-empty"
  ]);
  adapter.operations.submit.outcomePolicy.retryableNotWrittenRules = [{
    codeValues: [],
    messagePatterns: ["sample alternate not written"]
  }];
  assert.deepEqual(validateWorkflowCapabilities([profile], adapter), []);
});

test("pre-submit item refresh requires Panel groups and a complete adapter mapping", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.materials.refreshBeforeSubmit = true;
  assert.ok(validateFormProfile(profile).includes(
    "workflow.materials.refreshBeforeSubmit=true requires non-empty materialGroups"
  ));

  profile.materialGroups = [{
    field: "sample-items",
    title: "Sample items",
    materials: [{ code: "SAMPLE-A", name: "Sample A", defaultQty: 1 }]
  }];
  assert.deepEqual(validateFormProfile(profile), []);

  const incomplete = {
    endpoints: { templateDetail: "/forms/detail" },
    operations: { templateDetail: { idParam: "formId" } },
    fields: {
      template: { fieldList: "elements" },
      formField: {
        id: "key", type: "kind", parentType: "parentKind", typeName: "kindLabel",
        title: "label", englishTitle: "englishLabel", options: "choices"
      },
      option: { value: "key", label: "label", englishLabel: "englishLabel" }
    },
    conversion: { fieldKinds: { items: ["items"] } }
  };
  assert.deepEqual(validateWorkflowCapabilities([profile], incomplete), [
    "a profile enables workflow.materials.refreshBeforeSubmit but fields.option.quantity is required"
  ]);

  incomplete.fields.option.quantity = "quantity";
  assert.deepEqual(validateWorkflowCapabilities([profile], incomplete), []);
});
