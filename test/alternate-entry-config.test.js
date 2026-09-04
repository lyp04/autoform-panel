import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  validateAlternateEntryReferences,
  validateFormProfile
} from "../src/profile.js";
import { clientCatalog, validateProfilesForPublish } from "../src/worker.js";

const seed = JSON.parse(await readFile(
  new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

function configuredCatalog() {
  const source = clone(seed.profiles[0]);
  source.snPlugins.find((plugin) => plugin.key === "primary").scanner.expectedLength = 12;
  const target = clone(seed.profiles[1]);
  target.id = "sample-hidden-target";
  target.displayName = "Sample hidden target";
  target.searchText = "sample hidden target";
  target.pickerVisible = false;
  target.conditionalFields = [
    { field: "example_toggle_field" },
    { field: "example_dynamic_field" }
  ];
  source.workflow.alternateEntries = {
    enabled: true,
    entries: [{
      id: "sample-independent-entry",
      title: "示例独立入口",
      titleI18n: { en: "Sample independent entry", es: "Entrada independiente de ejemplo" },
      targetProfileId: target.id,
      identifierRole: "primary",
      resultKey: "sample-ready",
      photoTargetFields: ["example_attachment"],
      joinWith: ",",
      minPhotos: 1,
      maxPhotos: 2,
      uploadNameTemplate: "{identifier}-alternate-entry-{index}.jpg",
      scanner: { applyExpectedLengthTo: ["ocr", "barcode"] },
      submissionRetry: { maxAttempts: 3, retryDelayMs: 4000 },
      toggles: [{
        key: "sample-option",
        label: "示例选项",
        labelI18n: { en: "Sample option", es: "Opción de ejemplo" },
        default: false,
        retainUntilExit: true,
        dataOverrides: { example_toggle_field: "SAMPLE_OPTION" }
      }],
      flags: { duplicateCheck: false, previousSteps: false, printing: false },
      dataOverrides: { example_reference_id: "SAMPLE_REFERENCE" },
      dynamicOverrideFields: [],
      dynamicOverrideProviders: []
    }]
  };
  return { source, target };
}

function errorsFor(source, catalog) {
  return validateAlternateEntryReferences([source], catalog)[0]?.errors || [];
}

test("public seed keeps alternate entries explicit, fictional and disabled", () => {
  for (const profile of seed.profiles) {
    assert.deepEqual(profile.workflow.alternateEntries, { enabled: false, entries: [] });
    assert.deepEqual(validateFormProfile(profile), []);
  }
});

test("a fully closed fictional alternate entry passes local and catalog validation", () => {
  const { source, target } = configuredCatalog();
  assert.deepEqual(validateFormProfile(source), []);
  assert.deepEqual(validateFormProfile(target), []);
  assert.deepEqual(validateAlternateEntryReferences([source], [source, target]), []);
  assert.deepEqual(validateProfilesForPublish([source, target]), []);
  // A one-profile Panel upsert validates against the final merged catalog, not just its request body.
  assert.deepEqual(validateProfilesForPublish([source], [source, target]), []);
});

test("alternate-entry photo source is Panel-owned and strictly bounded", () => {
  for (const inputSource of ["camera", "gallery", "file"]) {
    const { source, target } = configuredCatalog();
    source.workflow.alternateEntries.entries[0].inputSource = inputSource;
    assert.deepEqual(validateFormProfile(source), []);
    assert.deepEqual(validateProfilesForPublish([source, target]), []);
  }
  const { source } = configuredCatalog();
  source.workflow.alternateEntries.entries[0].inputSource = "photos";
  assert(validateFormProfile(source).includes(
    "workflow.alternateEntries.entries[0].inputSource must be camera, gallery, or file"));
});

test("Panel-owned result presets provide strict mutually exclusive A/B/C choices", () => {
  const { source, target } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  target.gradeMap["sample-hold"] = {
    ...clone(target.gradeMap["sample-ready"]),
    value: "HOLD"
  };
  entry.resultPresets = {
    defaultKey: "appearance",
    retainUntilExit: true,
    showCodes: false,
    splitLabelsOnPlus: true,
    items: [
      {
        key: "appearance", code: "A", label: "外观", uiColor: "#16A34A",
        resultKey: "sample-ready", activeToggleKeys: [],
        dataOverrides: { example_dynamic_field: "APPEARANCE" }
      },
      {
        key: "combined", code: "B", label: "外观+功能", uiColor: "#D97706",
        resultKey: "sample-ready", activeToggleKeys: ["sample-option"],
        dataOverrides: { example_dynamic_field: "COMBINED" }
      },
      {
        key: "function", code: "C", label: "功能", uiColor: "#DC2626",
        resultKey: "sample-hold", activeToggleKeys: ["sample-option"],
        dataOverrides: { example_dynamic_field: "FUNCTION" }
      }
    ]
  };

  assert.deepEqual(validateFormProfile(source), []);
  assert.deepEqual(validateAlternateEntryReferences([source], [source, target]), []);
  assert.deepEqual(validateProfilesForPublish([source, target]), []);

  entry.resultPresets.showCodes = true;
  entry.resultPresets.items[0].uiColor = "green";
  entry.resultPresets.items[1].activeToggleKeys = ["missing-toggle"];
  entry.resultPresets.items[2].dataOverrides = {
    example_reference_id: "conflicts-with-entry"
  };
  const localErrors = validateFormProfile(source);
  assert(localErrors.includes(
    "workflow.alternateEntries.entries[0].resultPresets cannot show codes while splitting labels on plus"));
  assert(localErrors.includes(
    "workflow.alternateEntries.entries[0].resultPresets.items[0].uiColor must be #RRGGBB"));
  assert(localErrors.includes(
    "workflow.alternateEntries.entries[0].resultPresets.items[1].activeToggleKeys[0] must reference a toggle in the same entry"));
  assert(errorsFor(source, [source, target]).some((error) =>
    error.includes("resultPresets.items[2].dataOverrides.example_reference_id duplicates override ownership")));
});

test("an alternate entry may inherit a discrete allowed-length policy without a single exact length", () => {
  const { source, target } = configuredCatalog();
  const scanner = source.snPlugins.find((plugin) => plugin.key === "primary").scanner;
  delete scanner.expectedLength;
  delete scanner.applyExpectedLengthTo;
  delete source.expectedSnLength;
  scanner.allowedLengths = [16, 17];
  scanner.applyAllowedLengthsTo = ["ocr", "barcode", "entered"];

  assert.deepEqual(validateFormProfile(source), []);
  assert.deepEqual(validateAlternateEntryReferences([source], [source, target]), []);
  assert.deepEqual(validateProfilesForPublish([source, target]), []);
});

test("an explicit alternate allowed-length scope survives publish and App catalog delivery", () => {
  const { source, target } = configuredCatalog();
  const sourceScanner = source.snPlugins.find((plugin) => plugin.key === "primary").scanner;
  sourceScanner.allowedLengths = [11, 12];
  sourceScanner.applyAllowedLengthsTo = ["ocr", "barcode"];
  const entryScanner = source.workflow.alternateEntries.entries[0].scanner;
  entryScanner.applyAllowedLengthsTo = ["barcode", "entered"];

  assert.deepEqual(validateFormProfile(source), []);
  assert.deepEqual(validateProfilesForPublish([source, target]), []);
  const delivered = clientCatalog({
    schemaVersion: 2,
    version: 8,
    settings: {},
    profiles: [source, target]
  });
  assert.deepEqual(delivered.profiles[0].workflow.alternateEntries.entries[0].scanner, {
    applyExpectedLengthTo: ["ocr", "barcode"],
    applyAllowedLengthsTo: ["barcode", "entered"]
  });
});

test("alternate entry schema is strict and toggle display labels are explicit", () => {
  const { source } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  source.workflow.alternateEntries.unknown = true;
  entry.unknown = true;
  entry.toggles[0].unknown = true;
  entry.flags.unknown = true;
  delete entry.toggles[0].label;
  entry.toggles[0].labelI18n = { fr: "Exemple", en: "" };
  entry.flags.printing = true;
  delete entry.dataOverrides;
  delete entry.dynamicOverrideFields;
  delete entry.dynamicOverrideProviders;
  delete entry.uploadNameTemplate;
  const errors = validateFormProfile(source);
  for (const expected of [
    "workflow.alternateEntries.unknown is not supported",
    "workflow.alternateEntries.entries[0].unknown is not supported",
    "workflow.alternateEntries.entries[0].toggles[0].unknown is not supported",
    "workflow.alternateEntries.entries[0].flags.unknown is not supported",
    "workflow.alternateEntries.entries[0].toggles[0].label is required",
    "workflow.alternateEntries.entries[0].toggles[0].labelI18n.fr is not supported",
    "workflow.alternateEntries.entries[0].toggles[0].labelI18n.en is required",
    "workflow.alternateEntries.entries[0].flags.printing must be false",
    "workflow.alternateEntries.entries[0].dataOverrides must be an object",
    "workflow.alternateEntries.entries[0].dynamicOverrideFields must be an array",
    "workflow.alternateEntries.entries[0].dynamicOverrideProviders must be an array",
    "workflow.alternateEntries.entries[0].uploadNameTemplate is required"
  ]) assert.ok(errors.includes(expected), expected);
});

test("enabled entries and photo bounds fail closed", () => {
  const profile = clone(seed.profiles[0]);
  profile.workflow.alternateEntries = { enabled: true, entries: [] };
  assert.ok(validateFormProfile(profile).includes(
    "workflow.alternateEntries.entries must be non-empty when enabled=true"));

  const { source: disabledSource } = configuredCatalog();
  disabledSource.workflow.alternateEntries.enabled = false;
  assert.ok(validateFormProfile(disabledSource).includes(
    "workflow.alternateEntries.entries must be empty when enabled=false"));

  const { source } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  entry.photoTargetFields = ["example_attachment", "example_attachment"];
  entry.minPhotos = 3;
  entry.maxPhotos = 2147483648;
  const errors = validateFormProfile(source);
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].photoTargetFields[1] must be unique"));
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].maxPhotos must be an integer from 0 to 2147483647"));

  entry.maxPhotos = 2;
  assert.ok(validateFormProfile(source).includes(
    "workflow.alternateEntries.entries[0].maxPhotos must be at least minPhotos"));

  entry.maxPhotos = 3;
  entry.id = "e".repeat(256);
  assert.equal(validateFormProfile(source).some((error) => error.includes(".id")), false);
  entry.id += "e";
  assert.ok(validateFormProfile(source).includes(
    "workflow.alternateEntries.entries[0].id must contain at most 256 characters"));
});

test("alternate explicit-rejection retry policy is bounded and strict", () => {
  const { source } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  assert.deepEqual(validateFormProfile(source), []);

  entry.submissionRetry.unknown = true;
  entry.submissionRetry.maxAttempts = 11;
  entry.submissionRetry.retryDelayMs = -1;
  let errors = validateFormProfile(source);
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].submissionRetry.unknown is not supported"));
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].submissionRetry.maxAttempts must be an integer from 1 to 10"));
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].submissionRetry.retryDelayMs must be an integer from 0 to 60000"));

  entry.submissionRetry = "retry";
  errors = validateFormProfile(source);
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].submissionRetry must be an object"));
});

test("publish requires every alternate entry retry decision to be explicit", () => {
  const { source, target } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];

  delete entry.submissionRetry;
  let errors = validateProfilesForPublish([source, target])[0].errors;
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].submissionRetry is required before publish"));

  entry.submissionRetry = { retryDelayMs: 0 };
  errors = validateProfilesForPublish([source, target])[0].errors;
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].submissionRetry.maxAttempts is required before publish"));

  entry.submissionRetry = { maxAttempts: 1 };
  errors = validateProfilesForPublish([source, target])[0].errors;
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].submissionRetry.retryDelayMs is required before publish"));
});

test("maxPhotos zero explicitly preserves the legacy unlimited-photo policy", () => {
  const { source } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  entry.minPhotos = 1;
  entry.maxPhotos = 0;
  assert.deepEqual(validateFormProfile(source), []);
});

test("alternate entry scanner scope preserves a path-specific length policy", () => {
  const { source } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  assert.deepEqual(validateFormProfile(source), []);

  delete entry.scanner;
  assert.ok(validateFormProfile(source).includes(
    "workflow.alternateEntries.entries[0].scanner must be an object"));

  const sourceScanner = source.snPlugins.find((plugin) => plugin.key === "primary").scanner;
  sourceScanner.allowedLengths = [11, 12];
  entry.scanner = {
    applyExpectedLengthTo: ["ocr", "barcode", "barcode", "camera"],
    applyAllowedLengthsTo: ["entered", "entered", "camera"]
  };
  const errors = validateFormProfile(source);
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.applyExpectedLengthTo[2] must be unique"));
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.applyExpectedLengthTo[3] must be one of: ocr, barcode, entered"));
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.applyAllowedLengthsTo[1] must be unique"));
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.applyAllowedLengthsTo[2] must be one of: ocr, barcode, entered"));
});

test("alternate scanner scopes fail closed without required entry and source policies", () => {
  const { source } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  const sourceScanner = source.snPlugins.find((plugin) => plugin.key === "primary").scanner;

  entry.scanner = { applyAllowedLengthsTo: ["ocr"] };
  let errors = validateFormProfile(source);
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.applyExpectedLengthTo must not be empty"));
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.applyAllowedLengthsTo requires source primary allowedLengths"));

  entry.scanner = { applyExpectedLengthTo: ["ocr"], applyAllowedLengthsTo: [] };
  errors = validateFormProfile(source);
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.applyAllowedLengthsTo must not be empty"));
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.applyAllowedLengthsTo requires source primary allowedLengths"));

  entry.scanner = { applyExpectedLengthTo: ["ocr"], unknownScope: ["ocr"] };
  errors = validateFormProfile(source);
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner.unknownScope is not supported"));

  delete sourceScanner.expectedLength;
  entry.scanner = { applyExpectedLengthTo: ["ocr"] };
  errors = validateFormProfile(source);
  assert.ok(errors.includes(
    "workflow.alternateEntries.entries[0].scanner requires source primary expectedLength or allowedLengths"));
});

test("target resolution requires exactly one different hidden profile", () => {
  const { source, target } = configuredCatalog();
  assert.ok(errorsFor(source, [source]).includes(
    "workflow.alternateEntries.entries[0].targetProfileId must reference exactly one catalog profile"));

  target.pickerVisible = true;
  assert.ok(errorsFor(source, [source, target]).includes(
    "workflow.alternateEntries.entries[0].targetProfileId must reference a profile with pickerVisible=false"));

  target.pickerVisible = false;
  assert.ok(errorsFor(source, [source, target, clone(target)]).includes(
    "workflow.alternateEntries.entries[0].targetProfileId references a non-unique catalog profile id"));

  source.workflow.alternateEntries.entries[0].targetProfileId = source.id;
  assert.ok(errorsFor(source, [source, target]).includes(
    "workflow.alternateEntries.entries[0].targetProfileId must differ from the source profile id"));
});

test("result, photo and override references close over target-declared fields", () => {
  const { source, target } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  entry.resultKey = "sample-missing-result";
  entry.photoTargetFields = ["example_missing_photo"];
  entry.dataOverrides = { example_missing_field: true };
  entry.toggles[0].dataOverrides = { example_record_id: true };
  entry.dynamicOverrideFields = ["example_dynamic_field"];
  const errors = errorsFor(source, [source, target]);
  const localErrors = validateFormProfile(source);
  for (const expected of [
    "workflow.alternateEntries.entries[0].resultKey must reference the target profile gradeMap",
    "workflow.alternateEntries.entries[0].photoTargetFields[0] must reference a target profile photo field",
    "workflow.alternateEntries.entries[0].dataOverrides.example_missing_field must reference a field declared by the target profile",
    "workflow.alternateEntries.entries[0].toggles[0].dataOverrides.example_record_id must not override the target primary serial field"
  ]) assert.ok(errors.includes(expected), expected);
  assert.ok(localErrors.includes(
    "workflow.alternateEntries.entries[0].dynamicOverrideFields must not contain fields without a provider"));
});

test("override ownership is unique and live-provider output declarations fail closed", () => {
  const { source, target } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  entry.dataOverrides = { example_toggle_field: "SAMPLE_FIXED" };
  entry.dynamicOverrideFields = ["example_toggle_field"];
  entry.dynamicOverrideProviders = [{
    id: "sample-live-option",
    triggerToggleKey: "sample-option",
    templateId: target.template.id,
    expectedStep: 3,
    resolverId: "sample-alternate-live-option-v1",
    outputField: "example_toggle_field"
  }];
  const errors = errorsFor(source, [source, target]);
  assert.ok(errors.some((error) => error.includes(
    "toggles[0].dataOverrides.example_toggle_field duplicates override ownership")));
  assert.ok(validateFormProfile(source).includes(
    "workflow.alternateEntries.entries[0].dynamicOverrideProviders[0].outputField must not overlap static, toggle, or result preset overrides"));
  assert.ok(errors.some((error) => error.includes(
    "dynamicOverrideFields[0] duplicates override ownership")));
});

test("upload filename template is explicit, placeholder-only and path-safe", () => {
  const { source } = configuredCatalog();
  const entry = source.workflow.alternateEntries.entries[0];
  assert.deepEqual(validateFormProfile(source), []);

  entry.uploadNameTemplate = "";
  assert.ok(validateFormProfile(source).includes(
    "workflow.alternateEntries.entries[0].uploadNameTemplate is required"));

  for (const [template, expected] of [
    ["alternate-entry-{index}.jpg",
      "workflow.alternateEntries.entries[0].uploadNameTemplate must contain {identifier}"],
    ["{identifier}-alternate-entry.jpg",
      "workflow.alternateEntries.entries[0].uploadNameTemplate must contain {index}"],
    ["{identifier}-{unknown}-{index}.jpg",
      "workflow.alternateEntries.entries[0].uploadNameTemplate may only use {identifier} and {index} placeholders"],
    ["folder/{identifier}-{index}.jpg",
      "workflow.alternateEntries.entries[0].uploadNameTemplate must not contain path separators, colon, quotes, or control characters"],
    ["folder\\{identifier}-{index}.jpg",
      "workflow.alternateEntries.entries[0].uploadNameTemplate must not contain path separators, colon, quotes, or control characters"]
  ]) {
    entry.uploadNameTemplate = template;
    assert.ok(validateFormProfile(source).includes(expected), `${template}: ${expected}`);
  }
});

test("publish requires an explicit alternate-entry policy and never auto-reviews it", () => {
  const profile = clone(seed.profiles[0]);
  delete profile.workflow.alternateEntries;
  assert.ok(validateProfilesForPublish([profile])[0].errors.includes(
    "workflow.alternateEntries.enabled is required before publish"));
  assert.ok(validateProfilesForPublish([profile])[0].errors.includes(
    "workflow.alternateEntries.entries is required before publish"));

  profile.workflow.alternateEntries = { enabled: false, entries: [] };
  profile.workflow.compatibilityReviewed = false;
  assert.ok(validateProfilesForPublish([profile])[0].errors.includes(
    "workflow.compatibilityReviewed must be true before publish"));
  assert.equal(profile.workflow.compatibilityReviewed, false);
});

test("Panel exposes structured alternate-entry, target, toggle, label and flag controls", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const marker of [
    "启用独立入口",
    "独立入口（结构化配置）",
    "隐藏目标 profile",
    "照片目标字段（可多选）",
    "上传文件名模板",
    "{identifier}-alternate-entry-{index}.jpg",
    "明确拒绝时 POST 总尝试次数",
    "只复用同一 payload 与已上传 URL；超时、断线或未知响应绝不重试。",
    "精确长度作用入口",
    "允许长度作用入口",
    "（继承来源）",
    "恢复继承",
    "来源主标识未配置允许长度，当前不可用",
    "来源当前无精确长度；该兼容范围保留但不生效",
    "固定字段覆盖（值为明确 JSON）",
    "实时模板覆盖 provider（高级配置）",
    "字段 allow-list 与 provider 输出必须完全一致",
    "互斥结果预设（可选，等宽按钮）",
    "showCodes 控制短代码是否显示",
    "splitLabelsOnPlus 可把唯一加号单独排成一行",
    "入口开关（显示文案由 profile 提供）",
    "开关文案",
    "英文文案（可选）",
    "独立入口：重复检查",
    "恢复三个安全关闭标志"
  ]) assert.ok(html.includes(marker), marker);
  assert.ok(html.includes('uploadTemplate.placeholder="必填，例如 {identifier}-alternate-entry-{index}.jpg"'));
  assert.match(html,
    /next\.push\(\{[\s\S]{0,500}uploadNameTemplate:"",toggles:\[\],[\s\S]{0,250}submissionRetry:\{maxAttempts:1,retryDelayMs:0\}/);
  assert.match(html,
    /const scanner=\{applyExpectedLengthTo:\[\.\.\.scannerSources\]\};/u);
  assert.match(html,
    /const selectedScope=hasExplicitScope[\s\S]{0,140}sourcePolicies\.inheritedAllowedScope/u);
  assert.match(html,
    /if\(!selected\.length\)\{[\s\S]{0,220}render\(\);[\s\S]{0,80}return;/u);
  assert.match(html, /delete scanner\.applyAllowedLengthsTo;/u);
  const scannerScopeUi = html.slice(
    html.indexOf('const scannerScope=document.createElement("div")'),
    html.indexOf("card.appendChild(scannerScope)")
  );
  assert.ok(scannerScopeUi.length > 0);
  assert.doesNotMatch(scannerScopeUi, /rangeNumCtl|inputCtl|allowedLengths\]/u);
  assert.doesNotMatch(html, /a-step-entry/);
});
