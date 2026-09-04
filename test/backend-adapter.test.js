import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";

import {
  BackendConfigurationError,
  canonicalTemplate,
  panelBootstrapAdapter,
  resolveBackendAdapter,
  templateItems,
  validateBackendAdapter,
  validateControlledRecoveryConfig,
  validateDuplicateDateParsingConfig,
  validateMaterialRefreshConfig,
  validatePreviousStepRecipeOutcomePolicyConfig,
  validatePreviousStepRecipeResponseConfig,
  validateSubmitOutcomePolicyConfig
} from "../api/backend-adapter.js";
import {
  canonicalTemplate as browserCanonicalTemplate,
  createBackendClient
} from "../public/backend-client.js";
import {
  R2_CATALOG_POINTER_KEY,
  buildR2CatalogObjects,
  sha256Hex
} from "../api/catalog.js";
import { handleRequest } from "../api/request-handler.mjs";
const worker = { fetch: handleRequest };
import { validBackendAdapter } from "./backend-adapter-fixture.js";

async function seededR2Catalog(settings) {
  const profilesText = JSON.stringify({
    schemaVersion: 2,
    version: 1,
    profiles: []
  }, null, 2) + "\n";
  const manifestText = JSON.stringify({
    schemaVersion: 2,
    version: 1,
    sha256: await sha256Hex(profilesText),
    profilesUrl: "https://panel.test.invalid/catalog/form-profiles.json",
    minAppVersionCode: 1,
    updatedAt: "2030-01-01T00:00:00.000Z"
  }, null, 2) + "\n";
  const panelSettingsText = JSON.stringify({
    schemaVersion: 1,
    settings
  }, null, 2) + "\n";
  const objects = await buildR2CatalogObjects({
    "form-profiles.json": profilesText,
    "manifest.json": manifestText,
    "panel-settings.json": panelSettingsText
  });
  const entries = new Map([
    [R2_CATALOG_POINTER_KEY, { text: objects.pointerText, etag: "current-etag" }],
    [objects.snapshotKey, { text: objects.stateText, etag: "snapshot-etag" }]
  ]);
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      return {
        etag: entry.etag,
        async text() { return entry.text; }
      };
    },
    async put() {
      throw new Error("panel-config must not write catalog storage");
    }
  };
}

function unseededR2Catalog() {
  return {
    async get() { return null; },
    async put() {
      throw new Error("panel-config must not write catalog storage");
    }
  };
}

function validControlledRecovery() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    version: 1,
    issuanceMode: "panel_signed_exact_reconciliation",
    evidenceAlgorithm: "RS256",
    keyId: "sample-recovery-key-1",
    publicKeySpkiHex: publicKey.export({ type: "spki", format: "der" }).toString("hex"),
    maxEvidenceAgeSeconds: 300,
    reconciliationContractSha256: "a".repeat(64),
    enabledOperations: [
      "FINAL_SUBMISSION",
      "PREVIOUS_STEP_RECIPE",
      "MULTIPART_UPLOAD"
    ]
  };
}

function validSubmitOutcomePolicy() {
  return {
    version: 1,
    evidenceSha256: "a".repeat(64),
    retryableNotWrittenRules: [{
      codeValues: ["sample-retry"],
      messagePatterns: []
    }],
    missingMaterialNotWrittenRules: [{
      codeValues: [],
      messagePatterns: ["sample material missing"]
    }]
  };
}

function validPreviousStepRecipeOutcomePolicy() {
  return {
    version: 1,
    evidenceSha256: "b".repeat(64),
    retryableNotWrittenRules: [{
      codeValues: ["sample-recipe-retry"],
      messagePatterns: []
    }],
    alreadyExistsAcknowledgedRules: [{
      codeValues: [],
      messagePatterns: ["sample recipe already exists"]
    }]
  };
}

test("tracked adapter example is generic, complete and intentionally non-deployable", () => {
  const text = readFileSync(new URL("../config/backend-adapter.example.json", import.meta.url), "utf8");
  const example = JSON.parse(text);
  assert.deepEqual(validateBackendAdapter(example), ["baseUrl is still an example placeholder"]);
  assert.deepEqual({
    epochDigitLengths: example.operations.duplicateCheck.epochDigitLengths,
    numericFractionPolicy: example.operations.duplicateCheck.numericFractionPolicy,
    numericEpochPrecision: example.operations.duplicateCheck.numericEpochPrecision,
    textParseConsumption: example.operations.duplicateCheck.textParseConsumption,
    plausibilityScope: example.operations.duplicateCheck.plausibilityScope,
    timeZoneSource: example.operations.duplicateCheck.timeZoneSource,
    rootValueEnabled: example.operations.duplicateCheck.rootValueEnabled
  }, {
    epochDigitLengths: [],
    numericFractionPolicy: "reject",
    numericEpochPrecision: "exact",
    textParseConsumption: "full",
    plausibilityScope: "all",
    timeZoneSource: "configured",
    rootValueEnabled: false
  });
});

test("missing and placeholder deployment config fail explicitly", async () => {
  assert.throws(() => resolveBackendAdapter(), (error) => {
    assert.ok(error instanceof BackendConfigurationError);
    assert.match(error.message, /baseUrl is required/);
    assert.match(error.message, /endpoints\.captcha is required/);
    return true;
  });

  const placeholder = validBackendAdapter({ baseUrl: "https://backend.example.com/api" });
  assert.deepEqual(validateBackendAdapter(placeholder), ["baseUrl is still an example placeholder"]);

  const response = await worker.fetch(new Request("https://panel.test.invalid/api/panel-config"), {});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /backend adapter is not configured/);
});

test("panel bootstrap does not require the App catalog read key", async () => {
  const env = {
    BACKEND_ADAPTER_JSON: JSON.stringify(validBackendAdapter()),
    CATALOG_READ_KEY: "sample-panel-access-key"
  };
  const url = "https://panel.test.invalid/api/panel-config";
  for (const request of [
    new Request(url),
    new Request(url, { headers: { Authorization: "Bearer wrong-key" } }),
    new Request(url, { headers: { Authorization: "Bearer sample-panel-access-key" } })
  ]) {
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.backendAdapter.baseUrl, "https://api.test.invalid/v1");
    assert.equal("submitEntry" in body.backendAdapter.endpoints, false);
  }
});

test("panel bootstrap reads authoring settings from seeded R2 without GitHub", async () => {
  const catalogAdapter = validBackendAdapter({
    baseUrl: "https://catalog-authoring.test.invalid/v1",
    endpoints: { templateList: "/catalog/forms" }
  });
  const envAdapter = validBackendAdapter({
    baseUrl: "https://cloudflare-bootstrap.test.invalid/v1",
    endpoints: { templateList: "/bootstrap/forms" }
  });
  const response = await worker.fetch(
    new Request("https://panel.test.invalid/api/panel-config"),
    {
      CATALOG_R2: await seededR2Catalog({ backendAdapter: catalogAdapter }),
      BACKEND_ADAPTER_JSON: JSON.stringify(envAdapter)
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.backendAdapter.baseUrl, "https://catalog-authoring.test.invalid/v1");
  assert.equal(body.backendAdapter.endpoints.templateList, "/catalog/forms");
  assert.equal("submitEntry" in body.backendAdapter.endpoints, false);
});

test("panel bootstrap uses the Cloudflare adapter when no catalog storage exists", async () => {
  const response = await worker.fetch(
    new Request("https://panel.test.invalid/api/panel-config"),
    {
      BACKEND_ADAPTER_JSON: JSON.stringify(validBackendAdapter({
        baseUrl: "https://cloudflare-bootstrap.test.invalid/v1",
        endpoints: { templateList: "/bootstrap/forms" }
      }))
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.backendAdapter.baseUrl, "https://cloudflare-bootstrap.test.invalid/v1");
  assert.equal(body.backendAdapter.endpoints.templateList, "/bootstrap/forms");
});

test("panel bootstrap fails closed for unseeded R2 without GitHub", async () => {
  const response = await worker.fetch(
    new Request("https://panel.test.invalid/api/panel-config"),
    {
      CATALOG_R2: unseededR2Catalog(),
      BACKEND_ADAPTER_JSON: JSON.stringify(validBackendAdapter({
        baseUrl: "https://must-not-be-used.test.invalid/v1"
      }))
    }
  );

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.error, /GITHUB_REPO env is not set/);
  assert.equal(JSON.stringify(body).includes("must-not-be-used"), false);
});

test("catalog adapter overrides env and legacy flat values without inventing fallbacks", () => {
  const fromEnv = validBackendAdapter();
  const resolved = resolveBackendAdapter({
    BACKEND_API_BASE: "https://legacy.test.invalid",
    BACKEND_ADAPTER_JSON: JSON.stringify(fromEnv)
  }, {
    backendApiBase: "https://flat.test.invalid",
    endpoints: { userInfo: "/flat/me", loginVerify: "/legacy/verify" },
    sessionInvalidHttpStatuses: [419],
    sessionInvalidCodes: ["EXPIRED"],
    sessionInvalidMessagePatterns: ["session ended"],
    backendAdapter: {
      baseUrl: "https://catalog.test.invalid/api",
      endpoints: { userInfo: "/catalog/me" }
    }
  });

  assert.equal(resolved.baseUrl, "https://catalog.test.invalid/api");
  assert.equal(resolved.endpoints.userInfo, "/catalog/me");
  assert.equal(resolved.endpoints.loginVerify, "/legacy/verify");
  assert.equal(resolved.endpoints.templateList, "/forms");
  assert.deepEqual(resolved.auth.sessionInvalidHttpStatuses, [419]);
  assert.deepEqual(resolved.auth.sessionInvalidCodes, ["EXPIRED"]);
  assert.deepEqual(resolved.auth.sessionInvalidMessagePatterns, ["session ended"]);
});

test("adapter schema rejects unknown keys that could carry credentials or custom headers", () => {
  const topLevel = validBackendAdapter();
  topLevel.apiKey = "must-not-be-stored";
  assert.ok(validateBackendAdapter(topLevel).includes("backendAdapter.apiKey is not supported"));

  const nested = validBackendAdapter();
  nested.request.headers = { "X-Api-Key": "must-not-be-stored" };
  assert.ok(validateBackendAdapter(nested).includes("request.headers is not supported"));

  const disabled = validBackendAdapter();
  disabled.printing = { enabled: false, values: { headers: { Authorization: "must-not-be-stored" } } };
  assert.ok(validateBackendAdapter(disabled).includes("printing.values.headers is not supported"));

  const implicitRequestIdentity = validBackendAdapter();
  delete implicitRequestIdentity.request.webUserAgent;
  delete implicitRequestIdentity.request.webAcceptLanguage;
  assert.ok(validateBackendAdapter(implicitRequestIdentity)
    .includes("request.webUserAgent must be an explicit string"));
  assert.ok(validateBackendAdapter(implicitRequestIdentity)
    .includes("request.webAcceptLanguage must be an explicit string"));

  const implicitSessionStatuses = validBackendAdapter();
  delete implicitSessionStatuses.auth.sessionInvalidHttpStatuses;
  assert.ok(validateBackendAdapter(implicitSessionStatuses)
    .includes("auth.sessionInvalidHttpStatuses must be an array"));

  const invalidAuthCompatibility = validBackendAdapter();
  invalidAuthCompatibility.auth.successFieldsWhenCodeMissing = ["payload", "payload"];
  invalidAuthCompatibility.auth.dataRootWhenCodeMissing = "true";
  const compatibilityErrors = validateBackendAdapter(invalidAuthCompatibility);
  assert.ok(compatibilityErrors.includes(
    "auth.successFieldsWhenCodeMissing[1] must not be duplicated"));
  assert.ok(compatibilityErrors.includes(
    "auth.dataRootWhenCodeMissing must be a boolean"));
});

test("global code-missing response compatibility is optional, unique and all-or-nothing", () => {
  assert.deepEqual(validateBackendAdapter(validBackendAdapter()), []);

  const configured = validBackendAdapter({
    response: {
      successFieldsWhenCodeMissing: ["payload", "receipt.value"],
      dataRootWhenCodeMissing: true,
      rejectMessageWhenCodeMissing: true
    }
  });
  assert.deepEqual(validateBackendAdapter(configured), []);

  const partial = validBackendAdapter();
  partial.response.successFieldsWhenCodeMissing = ["payload"];
  assert.ok(validateBackendAdapter(partial).includes(
    "response.dataRootWhenCodeMissing must be declared with the code-missing compatibility group"));
  assert.ok(validateBackendAdapter(partial).includes(
    "response.rejectMessageWhenCodeMissing must be declared with the code-missing compatibility group"));

  const booleansOnly = validBackendAdapter();
  booleansOnly.response.dataRootWhenCodeMissing = true;
  booleansOnly.response.rejectMessageWhenCodeMissing = false;
  assert.ok(validateBackendAdapter(booleansOnly).includes(
    "response.successFieldsWhenCodeMissing must be declared with the code-missing compatibility group"));

  const invalid = validBackendAdapter({
    response: {
      successFieldsWhenCodeMissing: ["payload", " payload ", ""],
      dataRootWhenCodeMissing: "true",
      rejectMessageWhenCodeMissing: 1
    }
  });
  const errors = validateBackendAdapter(invalid);
  assert.ok(errors.includes(
    "response.successFieldsWhenCodeMissing[1] must not be duplicated"));
  assert.ok(errors.includes(
    "response.successFieldsWhenCodeMissing[2] must be a non-empty string"));
  assert.ok(errors.includes("response.dataRootWhenCodeMissing must be a boolean"));
  assert.ok(errors.includes("response.rejectMessageWhenCodeMissing must be a boolean"));

  const empty = validBackendAdapter({
    response: {
      successFieldsWhenCodeMissing: [],
      dataRootWhenCodeMissing: false,
      rejectMessageWhenCodeMissing: true
    }
  });
  assert.ok(validateBackendAdapter(empty).includes(
    "response.successFieldsWhenCodeMissing must be a non-empty array"));
});

test("submit envelope and material item field names must be pairwise unique", () => {
  const adapter = validBackendAdapter();
  adapter.operations.submit.warehouseIdField = adapter.operations.submit.templateIdField;
  adapter.operations.submit.materialItemMapping.nameField =
    adapter.operations.submit.materialItemMapping.codeField;

  const errors = validateBackendAdapter(adapter);
  assert.ok(errors.includes(
    "operations.submit.warehouseIdField must differ from operations.submit.templateIdField"));
  assert.ok(errors.includes(
    "operations.submit.materialItemMapping.nameField must differ from operations.submit.materialItemMapping.codeField"));
});

test("submit outcome policy is optional for migration and strict when declared", () => {
  const migrating = validBackendAdapter();
  assert.deepEqual(validateBackendAdapter(migrating), []);
  assert.deepEqual(validateSubmitOutcomePolicyConfig(migrating), [
    "operations.submit.outcomePolicy must be configured"
  ]);

  const configured = validBackendAdapter();
  configured.operations.submit.outcomePolicy = validSubmitOutcomePolicy();
  assert.deepEqual(validateBackendAdapter(configured), []);
  assert.deepEqual(validateSubmitOutcomePolicyConfig(configured, {
    requireRetryRules: true,
    requireMissingMaterialRules: true
  }), []);

  configured.operations.submit.outcomePolicy.retryableNotWrittenRules = [];
  configured.operations.submit.outcomePolicy.missingMaterialNotWrittenRules = [];
  assert.deepEqual(validateBackendAdapter(configured), []);
  assert.deepEqual(validateSubmitOutcomePolicyConfig(configured, {
    requireRetryRules: true,
    requireMissingMaterialRules: true
  }), [
    "operations.submit.outcomePolicy.retryableNotWrittenRules must be non-empty",
    "operations.submit.outcomePolicy.missingMaterialNotWrittenRules must be non-empty"
  ]);
});

test("submit outcome policy rejects unsupported, ambiguous or invalid evidence rules", () => {
  const adapter = validBackendAdapter();
  adapter.operations.submit.outcomePolicy = validSubmitOutcomePolicy();
  const policy = adapter.operations.submit.outcomePolicy;
  policy.unknown = true;
  policy.version = 2;
  policy.evidenceSha256 = "A".repeat(64);
  policy.retryableNotWrittenRules = [{
    codeValues: [404, "404", null],
    messagePatterns: ["sample retry", " sample retry ", ""],
    action: "retry"
  }];
  policy.missingMaterialNotWrittenRules = [{}];

  const errors = validateBackendAdapter(adapter);
  assert.ok(errors.includes("operations.submit.outcomePolicy.unknown is not supported"));
  assert.ok(errors.includes("operations.submit.outcomePolicy.version must be 1"));
  assert.ok(errors.includes(
    "operations.submit.outcomePolicy.evidenceSha256 must be lowercase SHA-256"));
  assert.ok(errors.includes(
    "operations.submit.outcomePolicy.retryableNotWrittenRules[0].action is not supported"));
  assert.ok(errors.includes(
    "operations.submit.outcomePolicy.retryableNotWrittenRules[0].codeValues[1] must not be duplicated"));
  assert.ok(errors.includes(
    "operations.submit.outcomePolicy.retryableNotWrittenRules[0].codeValues[2] must be a string, number or boolean"));
  assert.ok(errors.includes(
    "operations.submit.outcomePolicy.retryableNotWrittenRules[0].messagePatterns[1] must not be duplicated"));
  assert.ok(errors.includes(
    "operations.submit.outcomePolicy.retryableNotWrittenRules[0].messagePatterns[2] must be a non-empty string"));
  assert.ok(errors.includes(
    "operations.submit.outcomePolicy.missingMaterialNotWrittenRules[0] must configure at least one code value or message pattern"));
});

test("previous-step recipe outcome policy is optional for migration and strict when declared", () => {
  const migrating = validBackendAdapter();
  assert.deepEqual(validateBackendAdapter(migrating), []);
  assert.deepEqual(validatePreviousStepRecipeOutcomePolicyConfig(migrating), [
    "operations.previousSteps.recipeOutcomePolicy must be configured"
  ]);

  const configured = validBackendAdapter();
  configured.operations.previousSteps.recipeOutcomePolicy =
    validPreviousStepRecipeOutcomePolicy();
  assert.deepEqual(validateBackendAdapter(configured), []);
  assert.deepEqual(validatePreviousStepRecipeOutcomePolicyConfig(configured, {
    requireRetryRules: true,
    requireAlreadyExistsRules: true
  }), []);

  configured.operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules = [];
  configured.operations.previousSteps.recipeOutcomePolicy
    .alreadyExistsAcknowledgedRules = [];
  assert.deepEqual(validateBackendAdapter(configured), []);
  assert.deepEqual(validatePreviousStepRecipeOutcomePolicyConfig(configured, {
    requireRetryRules: true,
    requireAlreadyExistsRules: true
  }), [
    "operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules must be non-empty",
    "operations.previousSteps.recipeOutcomePolicy.alreadyExistsAcknowledgedRules must be non-empty"
  ]);
});

test("previous-step recipe outcome policy rejects unsupported or ambiguous rules", () => {
  const adapter = validBackendAdapter();
  adapter.operations.previousSteps.recipeOutcomePolicy =
    validPreviousStepRecipeOutcomePolicy();
  const policy = adapter.operations.previousSteps.recipeOutcomePolicy;
  policy.unknown = true;
  policy.version = 2;
  policy.evidenceSha256 = "B".repeat(64);
  policy.retryableNotWrittenRules = [{
    codeValues: [409, "409", null],
    messagePatterns: ["sample retry", " sample retry ", ""],
    action: "retry"
  }];
  policy.alreadyExistsAcknowledgedRules = [{}];

  const errors = validateBackendAdapter(adapter);
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.unknown is not supported"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.version must be 1"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.evidenceSha256 must be lowercase SHA-256"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules[0].action is not supported"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules[0].codeValues[1] must not be duplicated"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules[0].codeValues[2] must be a string, number or boolean"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules[0].messagePatterns[1] must not be duplicated"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.retryableNotWrittenRules[0].messagePatterns[2] must be a non-empty string"));
  assert.ok(errors.includes(
    "operations.previousSteps.recipeOutcomePolicy.alreadyExistsAcknowledgedRules[0] must configure at least one code value or message pattern"));
});

test("bootstrap is the authoring subset of the same adapter", () => {
  const adapter = validBackendAdapter({
    endpoints: { submitEntry: "/entries", printerState: "/printers/state" },
    printing: { enabled: false }
  });
  const bootstrap = panelBootstrapAdapter(adapter);
  assert.equal(bootstrap.endpoints.templateList, "/forms");
  assert.equal("submitEntry" in bootstrap.endpoints, false);
  assert.equal("printing" in bootstrap, false);
  assert.deepEqual(bootstrap.response, adapter.response);
  assert.deepEqual(bootstrap.auth.successFieldsWhenCodeMissing,
    adapter.auth.successFieldsWhenCodeMissing);
  assert.equal(bootstrap.auth.dataRootWhenCodeMissing,
    adapter.auth.dataRootWhenCodeMissing);
});

test("controlled recovery capability is optional for migration but strict for release", () => {
  const migrating = validBackendAdapter();
  assert.deepEqual(validateBackendAdapter(migrating), []);
  assert.deepEqual(validateControlledRecoveryConfig(migrating), [
    "operations.recovery must be configured"
  ]);

  const releaseReady = validBackendAdapter();
  releaseReady.operations.recovery = validControlledRecovery();
  assert.deepEqual(validateBackendAdapter(releaseReady), []);
  assert.deepEqual(validateControlledRecoveryConfig(releaseReady), []);

  releaseReady.operations.recovery.enabledOperations = ["FINAL_SUBMISSION"];
  assert.deepEqual(validateBackendAdapter(releaseReady), []);
  assert.deepEqual(validateControlledRecoveryConfig(releaseReady), [
    "operations.recovery.enabledOperations must include PREVIOUS_STEP_RECIPE",
    "operations.recovery.enabledOperations must include MULTIPART_UPLOAD"
  ]);
});

test("controlled recovery rejects editable outcomes, random keys and partial declarations", () => {
  const adapter = validBackendAdapter();
  adapter.operations.recovery = validControlledRecovery();
  adapter.operations.recovery.operatorOutcome = "NOT_WRITTEN";
  adapter.operations.recovery.publicKeySpkiHex = "a".repeat(600);
  adapter.operations.recovery.maxEvidenceAgeSeconds = 3601;
  adapter.operations.recovery.reconciliationContractSha256 = "not-a-digest";
  adapter.operations.recovery.enabledOperations = [
    "FINAL_SUBMISSION", "FINAL_SUBMISSION", "CLEAR_ANYTHING"
  ];

  const errors = validateBackendAdapter(adapter);
  assert.ok(errors.includes("operations.recovery.operatorOutcome is not supported"));
  assert.ok(errors.includes(
    "operations.recovery.publicKeySpkiHex must be a bounded lowercase RSA SPKI DER value"));
  assert.ok(errors.includes(
    "operations.recovery.maxEvidenceAgeSeconds must be an integer from 1 to 3600"));
  assert.ok(errors.includes(
    "operations.recovery.reconciliationContractSha256 must be lowercase SHA-256"));
  assert.ok(errors.includes(
    "operations.recovery.enabledOperations[1] must not be duplicated"));
  assert.ok(errors.some((error) => error.startsWith(
    "operations.recovery.enabledOperations[2] must be one of:")));
});

test("unused optional capabilities do not require routes or protocol blocks", () => {
  const adapter = validBackendAdapter();
  delete adapter.endpoints.detectionData;
  delete adapter.endpoints.snRepetition;
  delete adapter.endpoints.printerState;
  delete adapter.endpoints.messageList;
  delete adapter.endpoints.labelRetry;
  delete adapter.operations.ocr;
  delete adapter.operations.previousSteps;
  delete adapter.operations.duplicateCheck;
  adapter.printing = { enabled: false };
  assert.deepEqual(validateBackendAdapter(adapter), []);

  delete adapter.printing;
  assert.deepEqual(validateBackendAdapter(adapter), []);
});

test("legacy duplicate adapters remain usable for migration but parsing must be explicit before use", () => {
  const adapter = validBackendAdapter();
  delete adapter.operations.duplicateCheck.dateTransforms;
  delete adapter.operations.duplicateCheck.epochUnits;
  delete adapter.operations.duplicateCheck.dateFormats;
  delete adapter.operations.duplicateCheck.timeZone;

  assert.deepEqual(validateBackendAdapter(adapter), []);
  assert.deepEqual(validateDuplicateDateParsingConfig(adapter), [
    "operations.duplicateCheck.dateTransforms must be an array",
    "operations.duplicateCheck.epochUnits must be an array",
    "operations.duplicateCheck.dateFormats must be an array",
    "operations.duplicateCheck.timeZone is required"
  ]);

  adapter.operations.duplicateCheck.dateTransforms = [];
  assert.ok(validateBackendAdapter(adapter).includes(
    "operations.duplicateCheck.epochUnits must be an array"));
  assert.ok(validateBackendAdapter(adapter).includes(
    "operations.duplicateCheck.dateFormats must be an array"));
  assert.ok(validateBackendAdapter(adapter).includes(
    "operations.duplicateCheck.timeZone is required"));

  delete adapter.operations.duplicateCheck.dateTransforms;
  adapter.operations.duplicateCheck.epochUnits = ["milliseconds"];
  assert.ok(validateBackendAdapter(adapter).includes(
    "operations.duplicateCheck.dateTransforms must be an array"));
  assert.ok(validateBackendAdapter(adapter).includes(
    "operations.duplicateCheck.dateFormats must be an array"));
  assert.ok(validateBackendAdapter(adapter).includes(
    "operations.duplicateCheck.timeZone is required"));
});

test("legacy previous-step adapters remain editable but recipe response handling must be explicit before use", () => {
  const adapter = validBackendAdapter();
  delete adapter.operations.previousSteps.missingResponseCodes;
  delete adapter.operations.previousSteps.missingMessagePatterns;
  delete adapter.operations.previousSteps.retryableMessagePatterns;
  delete adapter.operations.previousSteps.alreadyExistsMessagePatterns;

  assert.deepEqual(validateBackendAdapter(adapter), []);
  assert.deepEqual(validatePreviousStepRecipeResponseConfig(adapter), [
    "operations.previousSteps.missingResponseCodes must be an array",
    "operations.previousSteps.missingMessagePatterns must be an array",
    "operations.previousSteps.retryableMessagePatterns must be an array",
    "operations.previousSteps.alreadyExistsMessagePatterns must be an array"
  ]);

  // Existing private adapters may already have the old recipe pair. They remain editable until
  // the Panel-owned lookup classifier is explicitly added, but cannot publish an enabled flow.
  adapter.operations.previousSteps.retryableMessagePatterns = ["sample retry signal"];
  adapter.operations.previousSteps.alreadyExistsMessagePatterns = ["sample existing signal"];
  assert.deepEqual(validateBackendAdapter(adapter), []);
  assert.deepEqual(validatePreviousStepRecipeResponseConfig(adapter), [
    "operations.previousSteps.missingResponseCodes must be an array",
    "operations.previousSteps.missingMessagePatterns must be an array"
  ]);

  adapter.operations.previousSteps.missingResponseCodes = ["sample-absent"];
  assert.ok(validateBackendAdapter(adapter).includes(
    "operations.previousSteps.missingMessagePatterns must be an array"));
  adapter.operations.previousSteps.missingMessagePatterns = [];
  assert.deepEqual(validateBackendAdapter(adapter), []);
  assert.deepEqual(validatePreviousStepRecipeResponseConfig(adapter), []);

  adapter.operations.previousSteps.missingResponseCodes = [404, "404"];
  assert.ok(validatePreviousStepRecipeResponseConfig(adapter).includes(
    "operations.previousSteps.missingResponseCodes[1] must not be duplicated"));
  adapter.operations.previousSteps.missingResponseCodes = ["sample-absent"];

  adapter.operations.previousSteps.retryableMessagePatterns = [""];
  assert.ok(validatePreviousStepRecipeResponseConfig(adapter).includes(
    "operations.previousSteps.retryableMessagePatterns[0] must be a non-empty string"));
});

test("duplicate dates support an explicit seconds/milliseconds set without guessing", () => {
  const adapter = validBackendAdapter();
  adapter.operations.duplicateCheck.epochUnits = ["seconds", "milliseconds"];
  assert.deepEqual(validateDuplicateDateParsingConfig(adapter), []);

  adapter.operations.duplicateCheck.epochUnits = ["seconds", "seconds"];
  assert.ok(validateDuplicateDateParsingConfig(adapter).includes(
    "operations.duplicateCheck.epochUnits[1] must not be duplicated"));

  adapter.operations.duplicateCheck.epochUnits = ["automatic"];
  assert.ok(validateDuplicateDateParsingConfig(adapter).includes(
    "operations.duplicateCheck.epochUnits[0] must be seconds or milliseconds"));

  adapter.operations.duplicateCheck.epochUnits = [];
  adapter.operations.duplicateCheck.dateFormats = [];
  assert.ok(validateDuplicateDateParsingConfig(adapter).includes(
    "operations.duplicateCheck must configure at least one epoch unit or date format"));
});

test("duplicate date transforms are explicit, ordered, unique and closed to known values", () => {
  const adapter = validBackendAdapter();
  const configuredOrder = [
    "strip_trailing_z",
    "strip_fractional_suffix",
    "iso_t_to_space",
    "localized_ymd_to_dashes",
    "truncate_after_seconds"
  ];
  adapter.operations.duplicateCheck.dateTransforms = [...configuredOrder];
  assert.deepEqual(validateDuplicateDateParsingConfig(adapter), []);
  assert.deepEqual(adapter.operations.duplicateCheck.dateTransforms, configuredOrder);

  adapter.operations.duplicateCheck.dateTransforms = ["iso_t_to_space", "iso_t_to_space"];
  assert.ok(validateDuplicateDateParsingConfig(adapter).includes(
    "operations.duplicateCheck.dateTransforms[1] must not be duplicated"));

  adapter.operations.duplicateCheck.dateTransforms = ["automatic_cleanup"];
  assert.ok(validateDuplicateDateParsingConfig(adapter).includes(
    "operations.duplicateCheck.dateTransforms[0] must be one of: iso_t_to_space, localized_ymd_to_dashes, strip_fractional_suffix, strip_trailing_z, truncate_after_seconds"));
});

test("duplicate date compatibility policy is optional but all-or-none when present", () => {
  const adapter = validBackendAdapter();
  const policyKeys = [
    "epochDigitLengths",
    "numericFractionPolicy",
    "textParseConsumption",
    "plausibilityScope",
    "timeZoneSource",
    "rootValueEnabled"
  ];
  for (const key of policyKeys) delete adapter.operations.duplicateCheck[key];

  assert.deepEqual(validateBackendAdapter(adapter), []);
  assert.deepEqual(validateDuplicateDateParsingConfig(adapter), []);

  adapter.operations.duplicateCheck.epochDigitLengths = [];
  const errors = validateBackendAdapter(adapter);
  assert.ok(errors.includes(
    "operations.duplicateCheck.numericFractionPolicy must be one of: reject, truncate"));
  assert.ok(errors.includes(
    "operations.duplicateCheck.textParseConsumption must be one of: full, prefix"));
  assert.ok(errors.includes(
    "operations.duplicateCheck.plausibilityScope must be one of: all, epoch_only"));
  assert.ok(errors.includes(
    "operations.duplicateCheck.timeZoneSource must be one of: configured, device"));
  assert.ok(errors.includes(
    "operations.duplicateCheck.rootValueEnabled must be a boolean"));
});

test("duplicate date compatibility policy accepts only canonical values", () => {
  const valid = validBackendAdapter();
  valid.operations.duplicateCheck.epochDigitLengths = [1, 19];
  valid.operations.duplicateCheck.numericFractionPolicy = "truncate";
  valid.operations.duplicateCheck.textParseConsumption = "prefix";
  valid.operations.duplicateCheck.plausibilityScope = "epoch_only";
  valid.operations.duplicateCheck.timeZoneSource = "device";
  valid.operations.duplicateCheck.rootValueEnabled = true;
  assert.equal(Object.prototype.hasOwnProperty.call(
    valid.operations.duplicateCheck, "numericEpochPrecision"), false);
  assert.deepEqual(validateDuplicateDateParsingConfig(valid), []);

  valid.operations.duplicateCheck.numericEpochPrecision = "exact";
  assert.deepEqual(validateDuplicateDateParsingConfig(valid), []);
  valid.operations.duplicateCheck.numericEpochPrecision = "minute_floor";
  assert.deepEqual(validateDuplicateDateParsingConfig(valid), []);

  for (const [key, value, expected] of [
    ["epochDigitLengths", [10, 10],
      "operations.duplicateCheck.epochDigitLengths[1] must be a unique integer from 1 to 19"],
    ["epochDigitLengths", [0, 20, 1.5, "10"],
      "operations.duplicateCheck.epochDigitLengths[0] must be a unique integer from 1 to 19"],
    ["numericFractionPolicy", "round",
      "operations.duplicateCheck.numericFractionPolicy must be one of: reject, truncate"],
    ["numericEpochPrecision", "second_round",
      "operations.duplicateCheck.numericEpochPrecision must be one of: exact, minute_floor"],
    ["textParseConsumption", "partial",
      "operations.duplicateCheck.textParseConsumption must be one of: full, prefix"],
    ["plausibilityScope", "none",
      "operations.duplicateCheck.plausibilityScope must be one of: all, epoch_only"],
    ["timeZoneSource", "automatic",
      "operations.duplicateCheck.timeZoneSource must be one of: configured, device"],
    ["rootValueEnabled", "false",
      "operations.duplicateCheck.rootValueEnabled must be a boolean"]
  ]) {
    const adapter = validBackendAdapter();
    adapter.operations.duplicateCheck[key] = value;
    assert.ok(validateDuplicateDateParsingConfig(adapter).includes(expected), key);
  }

  const precisionWithoutCompatibilityGroup = validBackendAdapter();
  for (const key of ["epochDigitLengths", "numericFractionPolicy", "textParseConsumption",
    "plausibilityScope", "timeZoneSource", "rootValueEnabled"]) {
    delete precisionWithoutCompatibilityGroup.operations.duplicateCheck[key];
  }
  precisionWithoutCompatibilityGroup.operations.duplicateCheck.numericEpochPrecision = "exact";
  assert.ok(validateDuplicateDateParsingConfig(precisionWithoutCompatibilityGroup).includes(
    "operations.duplicateCheck.epochDigitLengths must be an array"));
  assert.ok(validateDuplicateDateParsingConfig(precisionWithoutCompatibilityGroup).includes(
    "operations.duplicateCheck.rootValueEnabled must be a boolean"));
});

test("material refresh capability requires every response path used by the App", () => {
  const adapter = validBackendAdapter();
  assert.deepEqual(validateMaterialRefreshConfig(adapter), []);

  adapter.operations.templateDetail.existingQuantityPolicy = "profile_authoritative";
  assert.deepEqual(validateMaterialRefreshConfig(adapter), []);

  delete adapter.fields.option.quantity;
  adapter.conversion.fieldKinds.items = [];
  assert.deepEqual(validateMaterialRefreshConfig(adapter), [
    "fields.option.quantity is required",
    "conversion.fieldKinds.items must be a non-empty array"
  ]);
});

test("material refresh quantity policy defaults strict and rejects unknown modes", () => {
  const defaultStrict = validBackendAdapter();
  assert.equal(Object.prototype.hasOwnProperty.call(
    defaultStrict.operations.templateDetail, "existingQuantityPolicy"), false);
  assert.deepEqual(validateMaterialRefreshConfig(defaultStrict), []);

  const invalid = validBackendAdapter();
  invalid.operations.templateDetail.existingQuantityPolicy = "guess_from_label";
  const expected = "operations.templateDetail.existingQuantityPolicy must be one of: strict_live_match, profile_authoritative";
  assert.ok(validateBackendAdapter(invalid).includes(expected));
  assert.deepEqual(validateMaterialRefreshConfig(invalid), [expected]);
});

test("enabled printing requires explicit type and status classifications", () => {
  const adapter = validBackendAdapter();
  adapter.printing.enabled = true;
  const errors = validateBackendAdapter(adapter);
  for (const key of ["acceptedTypes", "printed", "failed", "ongoing"]) {
    assert.ok(errors.includes(`printing.values.${key} must be a non-empty array`));
  }
});

test("printing status classifications cannot overlap", () => {
  const adapter = validBackendAdapter();
  adapter.printing = {
    enabled: true,
    online: { statusPath: "state", values: ["online"] },
    jobsPath: "rows",
    query: { serialParam: "serial", pageParam: "pageIndex", pageStart: 0 },
    fields: { id: "id", serial: "serial", type: "type", status: "state" },
    values: {
      acceptedTypes: ["label"], printed: ["done"], failed: ["failed"], ongoing: ["done"]
    },
    retryIdField: "id"
  };
  assert.ok(validateBackendAdapter(adapter).includes(
    'printing.values status "done" appears in both printed and ongoing'));
});

test("enabled printing requires a non-negative first page", () => {
  const adapter = validBackendAdapter();
  adapter.printing = {
    enabled: true,
    online: { statusPath: "state", values: ["online"] },
    jobsPath: "rows",
    query: { serialParam: "serial", pageParam: "pageIndex", pageStart: -1 },
    fields: { id: "id", serial: "serial", type: "type", status: "state" },
    values: {
      acceptedTypes: ["label"], printed: ["done"], failed: ["failed"], ongoing: ["running"]
    },
    retryIdField: "id"
  };
  assert.ok(validateBackendAdapter(adapter).includes(
    "printing.query.pageStart must be a non-negative integer"));
});

test("printing code-missing jobs compatibility is explicit and boolean", () => {
  const adapter = validBackendAdapter();
  adapter.printing.allowJobsArrayWhenCodeMissing = "yes";
  assert.ok(validateBackendAdapter(adapter).includes(
    "printing.allowJobsArrayWhenCodeMissing must be a boolean"));

  adapter.printing.allowJobsArrayWhenCodeMissing = true;
  assert.equal(validateBackendAdapter(adapter).some((error) =>
    error.includes("allowJobsArrayWhenCodeMissing")), false);
});

test("field mappings canonicalize list and nested form fields", () => {
  const adapter = validBackendAdapter();
  const raw = {
    formKey: 42,
    displayLabel: "Sample form",
    itemCode: "SAMPLE-42",
    stage: 3,
    locationKey: 7,
    elements: [{
      key: "photo",
      kind: "image",
      parentKind: "media",
      kindLabel: "Upload",
      label: "Photo",
      englishLabel: "Photo",
      mandatory: true,
      shown: true,
      limit: 4,
      choices: [{ key: "one", label: "One", englishLabel: "One", quantity: 1 }]
    }]
  };
  const expected = canonicalTemplate(raw, adapter);
  assert.equal(expected.id, 42);
  assert.equal(expected.process_id, 3);
  assert.equal(expected.field_list[0].field, "photo");
  assert.equal(expected.field_list[0].kind, "photo");
  assert.equal(expected.field_list[0].option_list[0].value, "one");
  assert.deepEqual(templateItems({ rows: [raw] }, adapter), [expected]);
});

test("result mapping is explicit adapter data and unmapped options keep neutral stable keys", () => {
  const adapter = validBackendAdapter({
    conversion: {
      result: {
        includeUnmapped: true,
        mappings: [{
          key: "accepted",
          label: "Accepted",
          labelI18n: { en: "Accepted", es: "Aceptado" },
          operatorLabel: "Sample accepted",
          operatorLabelI18n: {
            en: "Sample accepted",
            es: "Ejemplo aceptado"
          },
          uiColor: "#2563EB",
          include: true,
          submitValue: { state: "allow", score: 1 },
          matchValues: ["allow"],
          matchLabelPatterns: []
        }]
      }
    }
  });
  const raw = {
    formKey: 7,
    displayLabel: "Sample",
    itemCode: "SAMPLE",
    stage: 1,
    locationKey: 2,
    elements: [{
      key: "decision",
      kind: "outcome",
      parentKind: "choice",
      kindLabel: "Outcome",
      label: "Decision",
      englishLabel: "Decision",
      mandatory: true,
      shown: true,
      limit: 1,
      choices: [
        { key: "allow", label: "Allow", englishLabel: "Allow", quantity: 1 },
        { key: "review", label: "Review", englishLabel: "Review", quantity: 1 }
      ]
    }]
  };
  const project = ({ resultKey, resultLabel, resultLabelI18n, resultOperatorLabel,
    resultOperatorLabelI18n, resultUiColor, resultValue, includeInResults }) => ({
    resultKey, resultLabel, resultLabelI18n, resultOperatorLabel,
    resultOperatorLabelI18n, resultUiColor, resultValue, includeInResults
  });
  const expected = [
    {
      resultKey: "accepted",
      resultLabel: "Accepted",
      resultLabelI18n: { en: "Accepted", es: "Aceptado" },
      resultOperatorLabel: "Sample accepted",
      resultOperatorLabelI18n: {
        en: "Sample accepted",
        es: "Ejemplo aceptado"
      },
      resultUiColor: "#2563EB",
      resultValue: { state: "allow", score: 1 },
      includeInResults: true
    },
    {
      resultKey: "option-2",
      resultLabel: "Review",
      resultLabelI18n: undefined,
      resultOperatorLabel: undefined,
      resultOperatorLabelI18n: undefined,
      resultUiColor: undefined,
      resultValue: "review",
      includeInResults: true
    }
  ];
  assert.deepEqual(canonicalTemplate(raw, adapter).field_list[0].option_list.map(project),
    expected);
  assert.deepEqual(browserCanonicalTemplate(raw, adapter).field_list[0].option_list.map(project),
    expected);
});

test("result operator-label mapping uses a strict bounded en/es-only schema", () => {
  const adapter = validBackendAdapter({
    conversion: {
      result: {
        includeUnmapped: true,
        mappings: [{
          key: "sample-result",
          operatorLabel: " Sample operator label ",
          operatorLabelI18n: {
            en: "",
            es: "x".repeat(161),
            fr: "Exemple"
          },
          matchValues: ["sample-value"],
          matchLabelPatterns: [],
          operatorHint: "unsupported"
        }]
      }
    }
  });

  const errors = validateBackendAdapter(adapter);
  assert.ok(errors.includes(
    "conversion.result.mappings[0].operatorHint is not supported"));
  assert.ok(errors.includes(
    "conversion.result.mappings[0].operatorLabel must not have surrounding whitespace"));
  assert.ok(errors.includes(
    "conversion.result.mappings[0].operatorLabelI18n.en must be a non-empty string"));
  assert.ok(errors.includes(
    "conversion.result.mappings[0].operatorLabelI18n.es must contain at most 160 characters"));
  assert.ok(errors.includes(
    "conversion.result.mappings[0].operatorLabelI18n.fr is not supported"));
});

test("browser client applies configured request, success, pagination and response mappings", async () => {
  const adapter = validBackendAdapter();
  const seen = [];
  const client = createBackendClient(adapter, {
    fingerprint: "fixture-fp",
    fetchImpl: async (url, options) => {
      seen.push({ url: String(url), options });
      return new Response(JSON.stringify({
        meta: { state: "accepted" },
        payload: { session: { value: "sample-session-token" }, person: { label: "Sample User" } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  const body = client.loginBody({ account: "operator", password: "sample-password", captcha: "1234", client: "challenge" });
  const data = await client.request("login", { method: "POST", body, token: "existing-token" });
  assert.equal(client.token(data), "sample-session-token");
  assert.equal(client.userName(data), "Sample User");
  assert.deepEqual(client.templateListQuery("widget"), { pageIndex: 0, search: "widget" });
  assert.deepEqual(client.templateDetailQuery(42), { formId: 42 });
  assert.equal(seen[0].url, "https://api.test.invalid/v1/auth/session");
  assert.equal(seen[0].options.headers.Authorization, "Token existing-token");
  assert.equal(seen[0].options.headers["X-Test-Fingerprint"], "fixture-fp");
  assert.deepEqual(JSON.parse(seen[0].options.body), body);
});

test("auth-only code-missing compatibility preserves strict business responses", async () => {
  const adapter = validBackendAdapter();
  const clientFor = (body) => createBackendClient(adapter, {
    fetchImpl: async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  const dataTokenClient = clientFor({
    payload: { session: { value: "sample-data-token" } }
  });
  const dataToken = await dataTokenClient.request("login", { method: "POST", body: {} });
  assert.equal(dataTokenClient.token(dataToken), "sample-data-token");

  const rootTokenClient = clientFor({
    payload: { person: { label: "Sample User" } },
    session: { value: "sample-root-token" }
  });
  const rootToken = await rootTokenClient.request("login", { method: "POST", body: {} });
  assert.equal(rootTokenClient.token(rootToken), "sample-root-token");

  const nullEvidenceClient = clientFor({ payload: null, sample: true });
  assert.deepEqual(await nullEvidenceClient.request("captcha"), {
    payload: null,
    sample: true
  });

  await assert.rejects(
    () => clientFor({
      meta: { state: "rejected" },
      payload: { session: { value: "must-not-pass" } }
    }).request("login", { method: "POST", body: {} }),
    /HTTP 200/);

  await assert.rejects(
    () => clientFor({
      meta: { message: "Sample authentication error" },
      payload: { session: { value: "must-not-pass" } }
    }).request("login", { method: "POST", body: {} }),
    /Sample authentication error/);

  await assert.rejects(
    () => clientFor({ payload: { accepted: true } })
      .request("submitEntry", { method: "POST", body: {} }),
    /HTTP 200/);

  const strictAdapter = validBackendAdapter();
  delete strictAdapter.auth.successFieldsWhenCodeMissing;
  delete strictAdapter.auth.dataRootWhenCodeMissing;
  const strictClient = createBackendClient(strictAdapter, {
    fetchImpl: async () => new Response(JSON.stringify({
      payload: { session: { value: "must-not-pass" } }
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  await assert.rejects(
    () => strictClient.request("login", { method: "POST", body: {} }),
    /HTTP 200/);
});

test("browser business code-missing compatibility is field-bound, message-aware and code-first", async () => {
  const adapter = validBackendAdapter({
    response: {
      successFieldsWhenCodeMissing: ["receipt", "payload"],
      dataRootWhenCodeMissing: true,
      rejectMessageWhenCodeMissing: true
    }
  });
  const clientFor = (body, configuredAdapter = adapter, status = 200) => createBackendClient(
    configuredAdapter, {
      fetchImpl: async () => new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
      })
    });

  const nullReceipt = { receipt: null, sample: true };
  assert.deepEqual(await clientFor(nullReceipt)
    .request("submitEntry", { method: "POST", body: {} }), nullReceipt);
  await assert.rejects(
    () => clientFor({ sample: true })
      .request("submitEntry", { method: "POST", body: {} }),
    /HTTP 200/);
  await assert.rejects(
    () => clientFor({ receipt: null }, adapter, 503)
      .request("submitEntry", { method: "POST", body: {} }),
    /HTTP 503/);
  await assert.rejects(
    () => clientFor({
      receipt: null,
      meta: { message: "Sample business rejection" }
    }).request("submitEntry", { method: "POST", body: {} }),
    /Sample business rejection/);

  const whitespaceMessage = {
    receipt: null,
    meta: { message: "   " },
    sample: "whitespace-is-not-a-rejection"
  };
  assert.deepEqual(await clientFor(whitespaceMessage)
    .request("submitEntry", { method: "POST", body: {} }), whitespaceMessage);

  const messageAllowed = structuredClone(adapter);
  messageAllowed.response.rejectMessageWhenCodeMissing = false;
  const declaredMessage = {
    receipt: null,
    meta: { message: "Informational sample message" },
    sample: true
  };
  assert.deepEqual(await clientFor(declaredMessage, messageAllowed)
    .request("submitEntry", { method: "POST", body: {} }), declaredMessage);

  await assert.rejects(
    () => clientFor({
      meta: { state: "rejected" },
      receipt: null
    }, messageAllowed).request("submitEntry", { method: "POST", body: {} }),
    /HTTP 200/);
  assert.deepEqual(await clientFor({
    meta: { state: "accepted", message: "ignored for standard success" },
    payload: { sample: true }
  }).request("submitEntry", { method: "POST", body: {} }), { sample: true });

  const configuredDataOnly = structuredClone(adapter);
  configuredDataOnly.response.dataRootWhenCodeMissing = false;
  assert.deepEqual(await clientFor({
    receipt: null,
    payload: { sample: "configured-data" }
  }, configuredDataOnly).request("submitEntry", { method: "POST", body: {} }),
    { sample: "configured-data" });

  const globalAuth = structuredClone(messageAllowed);
  globalAuth.response.successFieldsWhenCodeMissing = ["session.value"];
  delete globalAuth.auth.successFieldsWhenCodeMissing;
  delete globalAuth.auth.dataRootWhenCodeMissing;
  const authClient = clientFor({
    session: { value: "sample-global-token" },
    meta: { message: "allowed by global response policy" }
  }, globalAuth);
  const authRoot = await authClient.request("login", { method: "POST", body: {} });
  assert.equal(authClient.token(authRoot), "sample-global-token");
});
