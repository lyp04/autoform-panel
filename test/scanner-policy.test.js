import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { validateFormProfile } from "../src/profile.js";
import { templateToProfile } from "../src/convert.js";
import { clientCatalog, validateProfilesForPublish } from "../src/worker.js";

function profileWithScanner() {
  return {
    id: "fictional-scanner-form",
    displayName: "Fictional Scanner Form",
    searchText: "FICTIONAL",
    requiresSecondSn: true,
    snFields: { primary: "example_primary", secondary: "example_secondary" },
    snPlugins: [
      {
        key: "primary", field: "example_primary", label: "Primary", scan: true,
        scanner: {
          expectedLength: 10,
          applyExpectedLengthTo: ["ocr", "barcode", "entered"],
          allowedLengths: [9, 10, 11],
          applyAllowedLengthsTo: ["ocr", "barcode", "entered"],
          preferredPrefixes: ["ZX"],
          autoTextMode: "always",
          rejectNumericOnly: true,
          candidateMode: "ordered",
          candidateOrder: ["label", "prefix", "general"],
          minLength: 8,
          maxLength: 12,
          requireLetterAndDigit: true,
          rejectedSubstrings: ["IGNORE"],
          stripLabels: ["S/N"],
          labelMatchMode: "compact_optional_slash",
          candidateCharacterMode: "alphanumeric",
          applyCandidateRulesTo: ["ocr"],
          stripLabelsFrom: ["ocr"],
          caseMode: "upper",
          removeWhitespace: true,
          prompt: "Scan fictional identifier"
        }
      },
      {
        key: "secondary", field: "example_secondary", label: "Secondary", scan: true,
        scanner: {
          expectedLength: 8,
          applyExpectedLengthTo: ["ocr", "barcode"],
          autoTextMode: "fallback",
          rejectNumericOnly: false,
          candidateMode: "ranked",
          minLength: 6,
          maxLength: 16,
          requireLetterAndDigit: false,
          rejectedSubstrings: [],
          stripLabels: [],
          labelMatchMode: "literal",
          candidateCharacterMode: "identifier",
          applyCandidateRulesTo: ["ocr", "barcode", "entered"],
          stripLabelsFrom: [],
          caseMode: "upper",
          removeWhitespace: true
        }
      },
      { key: "note", field: "example_note", label: "Note", scan: false }
    ]
  };
}

test("complete fictional primary and secondary scanner policies validate", () => {
  assert.deepEqual(validateFormProfile(profileWithScanner()), []);
});

test("identifier placeholders accept Panel-owned en/es translations", () => {
  const profile = profileWithScanner();
  profile.snPlugins[0].placeholder = "请输入";
  profile.snPlugins[0].placeholderI18n = { en: "Enter", es: "Introduzca" };
  assert.deepEqual(validateFormProfile(profile), []);

  profile.snPlugins[0].placeholder = "";
  profile.snPlugins[0].placeholderI18n = { en: "", es: "" };
  assert.deepEqual(validateFormProfile(profile), []);

  profile.snPlugins[0].placeholder = false;
  profile.snPlugins[0].placeholderI18n = { fr: "Saisir" };
  const errors = validateFormProfile(profile);
  assert.ok(errors.includes("snPlugins[0].placeholder must be a string"));
  assert.ok(errors.includes(
    "snPlugins[0].placeholderI18n.fr is not a supported language (only en/es)"));
});

test("new explicit scan routes fail closed when their scanner policy is missing", () => {
  const profile = profileWithScanner();
  delete profile.snPlugins[0].scanner;
  delete profile.snPlugins[1].scanner;
  assert.deepEqual(validateFormProfile(profile).filter((error) => error.includes("scanner is required")), [
    "snPlugins[0].scanner is required when scan=true",
    "snPlugins[1].scanner is required when scan=true"
  ]);

  // Omitted scan is the documented legacy state: it keeps the pre-policy generic scanner while an
  // existing catalog is being migrated, rather than silently writing guessed production rules.
  profile.snPlugins[0].scan = undefined;
  profile.snPlugins[1].scan = undefined;
  assert.deepEqual(validateFormProfile(profile), []);

  profile.snPlugins[0].scan = true;
  profile.snPlugins[0].scanner = {};
  assert.ok(validateFormProfile(profile).includes(
    "snPlugins[0].scanner is required when scan=true"));
});

test("unsupported extra scanners and ambiguous candidate policies are rejected", () => {
  const profile = profileWithScanner();
  profile.snPlugins[2].scan = true;
  profile.snPlugins[2].scanner = { autoTextMode: "always" };
  profile.snPlugins[0].scanner.candidateOrder = ["label", "label", "unknown"];
  profile.snPlugins[0].scanner.stripLabels = [];
  profile.snPlugins[0].scanner.typoSetting = true;

  const errors = validateFormProfile(profile);
  assert.ok(errors.includes("snPlugins[2].scan=true is supported only for key=primary or key=secondary"));
  assert.ok(errors.includes("snPlugins[2].scanner is supported only for key=primary or key=secondary"));
  assert.ok(errors.includes("snPlugins[0].scanner.candidateOrder[1] must be unique"));
  assert.ok(errors.includes("snPlugins[0].scanner.candidateOrder[2] must be one of: label, prefix, general"));
  assert.ok(errors.includes("snPlugins[0].scanner.stripLabels must be non-empty when candidateOrder includes label"));
  assert.ok(errors.includes("snPlugins[0].scanner.typoSetting is not a supported scanner setting"));
});

test("expected-length source scope is strict and requires an expected length", () => {
  const profile = profileWithScanner();
  profile.snPlugins[0].scanner.applyExpectedLengthTo = [];
  assert.ok(validateFormProfile(profile).includes(
    "snPlugins[0].scanner.applyExpectedLengthTo must not be empty"));

  delete profile.snPlugins[0].scanner.expectedLength;
  profile.snPlugins[0].scanner.applyExpectedLengthTo = ["ocr", "ocr", "camera"];
  const errors = validateFormProfile(profile);
  assert.ok(errors.includes(
    "snPlugins[0].scanner.expectedLength is required when applyExpectedLengthTo is configured"));
  assert.ok(errors.includes(
    "snPlugins[0].scanner.applyExpectedLengthTo[1] must be unique"));
  assert.ok(errors.includes(
    "snPlugins[0].scanner.applyExpectedLengthTo[2] must be one of: ocr, barcode, entered"));
});

test("allowed lengths support a compatible exact fallback and default to every source", () => {
  const profile = profileWithScanner();
  assert.deepEqual(validateFormProfile(profile), []);

  delete profile.snPlugins[0].scanner.applyAllowedLengthsTo;
  assert.deepEqual(validateFormProfile(profile), []);

  delete profile.snPlugins[0].scanner.expectedLength;
  delete profile.snPlugins[0].scanner.applyExpectedLengthTo;
  profile.snPlugins[0].scanner.allowedLengths = [8, 12];
  assert.deepEqual(validateFormProfile(profile), []);
});

test("legacy profile expectedSnLength is validated as the effective primary fallback", () => {
  const compatible = profileWithScanner();
  const scanner = compatible.snPlugins[0].scanner;
  delete scanner.expectedLength;
  delete scanner.applyExpectedLengthTo;
  compatible.expectedSnLength = 10;
  assert.deepEqual(validateFormProfile(compatible), []);

  compatible.expectedSnLength = 12;
  assert.ok(validateFormProfile(compatible).includes(
    "expectedSnLength must be included in snPlugins[0].scanner.allowedLengths when used as primary scanner fallback"));

  compatible.expectedSnLength = 257;
  assert.ok(validateFormProfile(compatible).includes(
    "expectedSnLength must be at most 256 when used as primary scanner fallback"));
});

test("a 16-or-17 policy preserves a compatible exact fallback and legacy-only profiles", async () => {
  const dual = profileWithScanner();
  Object.assign(dual.snPlugins[0].scanner, {
    expectedLength: 17,
    allowedLengths: [16, 17],
    minLength: 8,
    maxLength: 32,
    applyExpectedLengthTo: ["ocr", "barcode", "entered"],
    applyAllowedLengthsTo: ["ocr", "barcode", "entered"]
  });
  assert.deepEqual(validateFormProfile(dual), []);

  const legacyOnly = structuredClone(dual);
  delete legacyOnly.snPlugins[0].scanner.allowedLengths;
  delete legacyOnly.snPlugins[0].scanner.applyAllowedLengthsTo;
  assert.deepEqual(validateFormProfile(legacyOnly), []);

  const publicSeed = JSON.parse(await readFile(
    new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"));
  const publishable = structuredClone(publicSeed.profiles[0]);
  const publishablePrimary = publishable.snPlugins.find(
    (plugin) => plugin.key === "primary").scanner;
  publishable.expectedSnLength = 17;
  Object.assign(publishablePrimary, {
    allowedLengths: [16, 17],
    minLength: 8,
    maxLength: 32,
    applyAllowedLengthsTo: ["ocr", "barcode", "entered"]
  });
  delete publishablePrimary.expectedLength;
  delete publishablePrimary.applyExpectedLengthTo;
  assert.deepEqual(validateProfilesForPublish([publishable]), []);

  publishablePrimary.allowedLengths = [16];
  assert.ok(validateProfilesForPublish([publishable])[0].errors.includes(
    "expectedSnLength must be included in snPlugins[0].scanner.allowedLengths when used as primary scanner fallback"));

  delete publishablePrimary.allowedLengths;
  delete publishablePrimary.applyAllowedLengthsTo;
  assert.deepEqual(validateProfilesForPublish([publishable]), []);
});

test("allowed lengths are strict, scoped and compatible with exact and candidate bounds", () => {
  const malformed = profileWithScanner();
  Object.assign(malformed.snPlugins[0].scanner, {
    allowedLengths: [7, 10, 10, 257],
    applyAllowedLengthsTo: ["ocr", "ocr", "camera"]
  });
  const errors = validateFormProfile(malformed);
  for (const expected of [
    "snPlugins[0].scanner.allowedLengths[0] must be at least minLength",
    "snPlugins[0].scanner.allowedLengths[2] must be unique",
    "snPlugins[0].scanner.allowedLengths[3] must be an integer from 1 to 256",
    "snPlugins[0].scanner.allowedLengths[3] must be at most maxLength",
    "snPlugins[0].scanner.applyAllowedLengthsTo[1] must be unique",
    "snPlugins[0].scanner.applyAllowedLengthsTo[2] must be one of: ocr, barcode, entered"
  ]) assert.ok(errors.includes(expected), expected);

  const incompatibleFallback = profileWithScanner();
  incompatibleFallback.snPlugins[0].scanner.allowedLengths = [8, 9, 11];
  assert.ok(validateFormProfile(incompatibleFallback).includes(
    "snPlugins[0].scanner.expectedLength must be included in allowedLengths when both are configured"));

  const missingLengths = profileWithScanner();
  delete missingLengths.snPlugins[0].scanner.allowedLengths;
  assert.ok(validateFormProfile(missingLengths).includes(
    "snPlugins[0].scanner.allowedLengths is required when applyAllowedLengthsTo is configured"));

  const emptyLengths = profileWithScanner();
  emptyLengths.snPlugins[0].scanner.allowedLengths = [];
  emptyLengths.snPlugins[0].scanner.applyAllowedLengthsTo = [];
  const emptyErrors = validateFormProfile(emptyLengths);
  assert.ok(emptyErrors.includes("snPlugins[0].scanner.allowedLengths must not be empty"));
  assert.ok(emptyErrors.includes("snPlugins[0].scanner.applyAllowedLengthsTo must not be empty"));
});

test("conversion, App delivery and publish validation preserve allowed-length policy", () => {
  const seed = profileWithScanner();
  const converted = templateToProfile({
    id: 43,
    name: "Fictional refreshed template",
    sku: "EXAMPLE_REFRESHED_SKU",
    warehouse_id: 8,
    field_list: [
      { field: "example_primary", title: "Primary", kind: "serial", required: true }
    ]
  }, seed);
  assert.deepEqual(converted.snPlugins[0].scanner, seed.snPlugins[0].scanner);

  const served = clientCatalog({ version: 8, profiles: [converted], settings: {} });
  assert.deepEqual(served.profiles[0].snPlugins[0].scanner.allowedLengths, [9, 10, 11]);
  assert.deepEqual(served.profiles[0].snPlugins[0].scanner.applyAllowedLengthsTo,
    ["ocr", "barcode", "entered"]);

  converted.snPlugins[0].scanner.expectedLength = 12;
  const publishErrors = validateProfilesForPublish([converted])[0].errors;
  assert.ok(publishErrors.includes(
    "snPlugins[0].scanner.expectedLength must be included in allowedLengths when both are configured"));
});

test("label source scope requires an explicit non-empty label list", () => {
  const profile = profileWithScanner();
  profile.snPlugins[1].scanner.stripLabelsFrom = ["barcode"];
  assert.ok(validateFormProfile(profile).includes(
    "snPlugins[1].scanner.stripLabels must be non-empty when stripLabelsFrom is non-empty"));
});

test("template conversion never advertises camera scanning for extra plugins", () => {
  const converted = templateToProfile({
    id: 42,
    name: "Fictional Template",
    sku: "EXAMPLE_SKU",
    warehouse_id: 7,
    field_list: [
      { field: "example_primary", title: "Primary", kind: "serial", required: true },
      { field: "example_extra", title: "Extra", kind: "scan", required: false }
    ]
  });
  assert.equal(converted.snPlugins[0].scan, true);
  assert.equal(converted.snPlugins[1].scan, false);
});

test("Panel exposes structured role-scanner controls instead of requiring raw JSON", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const marker of [
    "自动文字识别", "候选选择", "候选来源顺序", "候选约束应用入口", "精确长度应用入口",
    "允许长度（逗号分隔）", "允许长度作用入口", "精确长度可同时保留为旧版 App fallback",
    "标签匹配", "候选字符", "识别并剥离的标签", "剥离标签的入口",
    "请先配置至少一个需识别并剥离的标签",
    "拒绝纯数字", "必须同时含字母和数字", "移除空白"
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.match(html, /numberList\("allowedLengths"/u);
  assert.match(html, /list\("applyAllowedLengthsTo"/u);
  assert.match(html,
    /key==="allowedLengths"[\s\S]{0,120}delete next\.applyAllowedLengthsTo/u);
});
