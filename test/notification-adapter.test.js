import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  migrateNotificationAdapter,
  notificationResponseSucceeded,
  renderNotificationBody,
  renderNotificationMessage,
  renderRoundDeliveryMessage,
  roundDeliveryResponseSucceeded,
  shouldSendRoundProblem,
  validateNotificationAdapter
} from "../src/notification-adapter.js";
import worker, {
  clientCatalog,
  panelCatalog,
  validateNotificationRequest,
  validateNotificationWorkflowCapabilities
} from "../src/worker.js";
import { validBackendAdapter } from "./backend-adapter-fixture.js";

function validRoundDelivery(name) {
  return {
    url: `https://${name}.notifications.example.invalid/hook`,
    method: "POST",
    bodyTemplate: { kind: "{{type}}", text: "{{message}}" },
    messageTemplate: name === "summary"
      ? "Example round {{profileLabel}}: {{submittedCount}}\n{{missingItems}}"
      : "Example problem {{profileLabel}}\n{{errors}}\n{{unconfirmedIdentifiers}}",
    successStatuses: [200],
    response: { textContains: `\"${name}-accepted\":true` },
    timeoutMs: 8000
  };
}

function validV3Adapter() {
  return {
    version: 3,
    deliveries: {
      summary: validRoundDelivery("summary"),
      problem: validRoundDelivery("problem")
    }
  };
}

function validRoundData(overrides = {}) {
  return {
    success: true,
    profileLabel: "Example profile",
    operatorLabel: "Example operator",
    completedAt: "2026-07-22T12:34:56Z",
    submittedCount: 3,
    missingItems: [{ label: "Example item", affectedCount: 2 }],
    newMissingItems: ["Example new item"],
    recoveredItems: ["Example recovered item"],
    errors: [],
    unconfirmedIdentifiers: [],
    networkAffectedIdentifiers: [],
    ...overrides
  };
}

test("submission notification capabilities fail closed at publish time", () => {
  const profile = {
    workflow: {
      notifications: { submissionSummary: true }
    }
  };
  assert.deepEqual(validateNotificationWorkflowCapabilities([profile], null), [
    "a profile enables workflow.notifications.submissionSummary but notificationAdapter is not configured"
  ]);

  const summaryV2 = {
    version: 2,
    url: "https://notifications.example.invalid/hook",
    method: "POST",
    bodyTemplate: { text: "{{message}}" },
    eventTemplates: { "submission.summary": "Example {{submittedCount}}" },
    successStatuses: [200]
  };
  assert.deepEqual(validateNotificationWorkflowCapabilities([profile], summaryV2), []);

  const runtimeOnlyV2 = structuredClone(summaryV2);
  runtimeOnlyV2.eventTemplates = { "runtime.failure": "Example {{stage}}" };
  assert.deepEqual(validateNotificationWorkflowCapabilities([profile], runtimeOnlyV2), [
    "a profile enables workflow.notifications.submissionSummary but notificationAdapter does not provide submission.summary"
  ]);

  assert.deepEqual(validateNotificationWorkflowCapabilities([profile], validV3Adapter()), [
    "profiles[0].workflow.notifications.profileLabel is required by notificationAdapter version 3"
  ]);
  profile.workflow.notifications.profileLabel = "  Example line  ";
  assert.deepEqual(validateNotificationWorkflowCapabilities([profile], validV3Adapter()), []);
  assert.deepEqual(validateNotificationWorkflowCapabilities([], null), []);
});

test("tracked notification adapter example is generic and structurally valid", () => {
  const example = JSON.parse(readFileSync(new URL("../notification-adapter.example.json", import.meta.url), "utf8"));
  assert.deepEqual(validateNotificationAdapter(example), []);
  assert.match(example.url, /\.example\.invalid\//);
});

test("v1 provider settings migrate to safe structured summaries without diagnostics", () => {
  const legacy = {
    version: 1,
    url: "https://notify.test.invalid/hook",
    method: "POST",
    bodyTemplate: { text: "{{message}}" },
    eventTemplates: { "runtime.failure": "Must not migrate {{stage}}" },
    successStatuses: [200]
  };
  const migrated = migrateNotificationAdapter(legacy);
  assert.equal(migrated.version, 2);
  assert.deepEqual(Object.keys(migrated.eventTemplates), ["submission.summary"]);
  assert.equal("runtime.failure" in migrated.eventTemplates, false);
  assert.deepEqual(validateNotificationAdapter(migrated), []);

  const visible = panelCatalog({ settings: { notificationAdapter: legacy }, profiles: [] });
  assert.equal(visible.settings.notificationAdapter.version, 2);
  assert.equal(legacy.version, 1);
});

test("runtime diagnostics require the independent diagnostics policy", async () => {
  const previousFetch = globalThis.fetch;
  const backendAdapter = validBackendAdapter();
  const notificationAdapter = {
    version: 2,
    url: "https://notify.test.invalid/hook",
    method: "POST",
    bodyTemplate: { text: "{{message}}" },
    eventTemplates: { "runtime.failure": "Failure {{stage}}/{{errorCode}}" },
    successStatuses: [200]
  };
  const files = {
    "form-profiles.json": JSON.stringify({
      version: 3,
      settings: { backendAdapter, diagnosticsPolicy: { enabled: false } },
      profiles: []
    }),
    "panel-settings.json": JSON.stringify({ schemaVersion: 1, settings: { notificationAdapter } })
  };
  let providerCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("https://api.github.com/")) {
      if (target === "https://api.github.com/repos/sample/catalog") {
        return Response.json({ default_branch: "main" });
      }
      if (target.endsWith("/git/ref/heads/main")) {
        return Response.json({ object: { sha: "snapshot-sha" } });
      }
      const path = (target.split("/contents/")[1] || "").split("?")[0];
      const content = files[path];
      if (content === undefined) return new Response("not found", { status: 404 });
      return Response.json({ content: btoa(content), sha: `${path}-sha` });
    }
    providerCalls++;
    return Response.json({}, { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://panel.test.invalid/api/notify", {
      method: "POST",
      headers: { Authorization: "Bearer sample-read-key", "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 2,
        type: "runtime.failure",
        data: {
          stage: "network", errorCode: "io_exception", subphase: "submit_unit",
          fingerprint: "abcd1234", appVersion: "1.0.7", gitHead: "deadbeef",
          androidSdk: 35, networkTransport: "wifi", networkValidated: true,
          networkCaptive: false, networkInternet: true, networkMetered: false,
          networkVpn: false
        }
      })
    }), {
      GITHUB_REPO: "sample/catalog",
      GITHUB_TOKEN: "sample-token",
      CATALOG_READ_KEY: "sample-read-key"
    });
    assert.equal(response.status, 403);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("notification adapter requires message substitution and rejects header storage", () => {
  const adapter = {
    version: 2,
    url: "https://notify.test.invalid/hook",
    method: "POST",
    headers: { "X-Custom": "not-allowed" },
    bodyTemplate: { text: "fixed" },
    eventTemplates: { "submission.summary": "Submitted {{submittedCount}}" },
    successStatuses: [200]
  };
  assert.deepEqual(validateNotificationAdapter(adapter), [
    "notificationAdapter.headers is not supported",
    "notificationAdapter.bodyTemplate must contain {{message}}"
  ]);
});

test("notification body substitution works recursively without changing non-string values", () => {
  assert.deepEqual(renderNotificationBody({
    text: "Notice: {{message}}",
    nested: ["{{message}}", 3, true]
  }, { message: "sample", type: "summary" }), {
    text: "Notice: sample",
    nested: ["sample", 3, true]
  });
});

test("optional provider response policy checks a configured JSON code path", () => {
  const adapter = {
    version: 2,
    url: "https://notify.test.invalid/hook",
    method: "POST",
    bodyTemplate: { text: "{{message}}" },
    eventTemplates: { "runtime.failure": "Failure {{stage}}/{{errorCode}}" },
    successStatuses: [200, 202],
    response: { codePath: "meta.code", successValues: [0, "accepted"] }
  };
  assert.deepEqual(validateNotificationAdapter(adapter), []);
  assert.equal(notificationResponseSucceeded(adapter, 202, { meta: { code: 0 } }), true);
  assert.equal(notificationResponseSucceeded(adapter, 202, { meta: { code: "accepted" } }), true);
  assert.equal(notificationResponseSucceeded(adapter, 202, { meta: { code: 1 } }), false);
  assert.equal(notificationResponseSucceeded(adapter, 500, { meta: { code: 0 } }), false);
});

test("client catalog and request validation keep the Worker proxy boundary narrow", () => {
  const source = {
    settings: {
      brand: "Sample",
      backendAdapter: { version: 1 },
      notificationAdapter: { url: "private" },
      futureWorkerSecret: "must-not-leak"
    },
    profiles: []
  };
  assert.deepEqual(clientCatalog(source), {
    settings: { brand: "Sample", backendAdapter: { version: 1 } },
    profiles: []
  });
  assert.equal("notificationAdapter" in source.settings, true);
  const data = {
    success: true,
    submittedCount: 3,
    errorCount: 0,
    unconfirmedPrintCount: 0,
    missingMaterialTypeCount: 1,
    newMissingMaterialTypeCount: 1,
    recoveredMaterialTypeCount: 0,
    networkAffectedCount: 0
  };
  assert.deepEqual(validateNotificationRequest({
    version: 2, type: "submission.summary", data
  }), []);
  assert.deepEqual(validateNotificationRequest({
    version: 2, type: "submission.summary", data, message: "raw record data"
  }), ["message is not supported"]);
});

test("Worker proxies a neutral notification without exposing provider config to App config", async () => {
  const previousFetch = globalThis.fetch;
  const backendAdapter = validBackendAdapter();
  const notificationAdapter = {
    version: 2,
    url: "https://notify.test.invalid/hook",
    method: "POST",
    bodyTemplate: { text: "{{message}}", kind: "{{type}}" },
    eventTemplates: {
      "submission.summary": "Submitted {{submittedCount}}; errors {{errorCount}}",
      "runtime.failure": "Failure {{stage}}/{{errorCode}}"
    },
    successStatuses: [202],
    response: { codePath: "meta.code", successValues: ["accepted"] }
  };
  const files = {
    "form-profiles.json": JSON.stringify({
      version: 3,
      settings: { backendAdapter, diagnosticsPolicy: { enabled: true } },
      profiles: []
    }),
    "panel-settings.json": JSON.stringify({ schemaVersion: 1, settings: { notificationAdapter } })
  };
  let providerRequest;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith("https://api.github.com/")) {
      if (target === "https://api.github.com/repos/sample/catalog") {
        return Response.json({ default_branch: "main" });
      }
      if (target.endsWith("/git/ref/heads/main")) {
        return Response.json({ object: { sha: "snapshot-sha" } });
      }
      const path = (target.split("/contents/")[1] || "").split("?")[0];
      const content = files[path];
      if (content === undefined) return new Response("not found", { status: 404 });
      return Response.json({ content: btoa(content), sha: `${path}-sha` });
    }
    if (target === notificationAdapter.url) {
      providerRequest = options;
      return Response.json({ meta: { code: "accepted" } }, { status: 202 });
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
  const env = {
    GITHUB_REPO: "sample/catalog",
    GITHUB_TOKEN: "sample-token",
    CATALOG_READ_KEY: "sample-read-key"
  };

  try {
    const configResponse = await worker.fetch(new Request("https://panel.test.invalid/api/config", {
      headers: { Authorization: "Bearer sample-read-key" }
    }), env);
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(config.catalogVersion, 3);
    assert.deepEqual(config.notification, {
      version: 2,
      enabled: true,
      endpoint: "/api/notify",
      eventTypes: ["submission.summary", "runtime.failure"],
      diagnosticsEnabled: true
    });
    assert.equal("notificationAdapter" in config, false);

    const denied = await worker.fetch(new Request("https://panel.test.invalid/api/notify", {
      method: "POST",
      body: JSON.stringify({
        version: 2,
        type: "submission.summary",
        data: {
          success: true,
          submittedCount: 3,
          errorCount: 1,
          unconfirmedPrintCount: 0,
          missingMaterialTypeCount: 0,
          newMissingMaterialTypeCount: 0,
          recoveredMaterialTypeCount: 0,
          networkAffectedCount: 0
        }
      })
    }), env);
    assert.equal(denied.status, 401);

    const response = await worker.fetch(new Request("https://panel.test.invalid/api/notify", {
      method: "POST",
      headers: { Authorization: "Bearer sample-read-key", "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 2,
        type: "submission.summary",
        data: {
          success: true,
          submittedCount: 3,
          errorCount: 1,
          unconfirmedPrintCount: 0,
          missingMaterialTypeCount: 0,
          newMissingMaterialTypeCount: 0,
          recoveredMaterialTypeCount: 0,
          networkAffectedCount: 0
        }
      })
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(providerRequest.body), {
      text: "Submitted 3; errors 1",
      kind: "submission.summary"
    });
    assert.deepEqual(providerRequest.headers, {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8"
    });

    files["panel-settings.json"] = JSON.stringify({
      schemaVersion: 1,
      settings: { notificationAdapter, notificationsEnabled: false }
    });
    providerRequest = undefined;
    const disabledConfigResponse = await worker.fetch(new Request(
      "https://panel.test.invalid/api/config", {
        headers: { Authorization: "Bearer sample-read-key" }
      }), env);
    assert.equal(disabledConfigResponse.status, 200);
    const disabledConfig = await disabledConfigResponse.json();
    assert.equal(disabledConfig.notification.enabled, false);
    assert.deepEqual(disabledConfig.notification.eventTypes, []);
    assert.equal(disabledConfig.notification.diagnosticsEnabled, false);

    const disabledNotifyResponse = await worker.fetch(new Request(
      "https://panel.test.invalid/api/notify", {
        method: "POST",
        headers: { Authorization: "Bearer sample-read-key", "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 2,
          type: "submission.summary",
          data: {
            success: true,
            submittedCount: 1,
            errorCount: 0,
            unconfirmedPrintCount: 0,
            missingMaterialTypeCount: 0,
            newMissingMaterialTypeCount: 0,
            recoveredMaterialTypeCount: 0,
            networkAffectedCount: 0
          }
        })
      }), env);
    assert.equal(disabledNotifyResponse.status, 403);
    assert.equal(providerRequest, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("event message templates are Panel-owned and reject unknown placeholders", () => {
  const adapter = {
    version: 2,
    url: "https://notify.test.invalid/hook",
    method: "POST",
    bodyTemplate: { text: "{{message}}" },
    eventTemplates: { "submission.summary": "Submitted {{recordIdentifier}}" },
    successStatuses: [200]
  };
  assert.deepEqual(validateNotificationAdapter(adapter), [
    "notificationAdapter.eventTemplates.submission.summary uses unsupported placeholder {{recordIdentifier}}"
  ]);
  adapter.eventTemplates["submission.summary"] = "Submitted {{submittedCount}}";
  assert.equal(renderNotificationMessage(adapter, "submission.summary", { submittedCount: 2 }),
    "Submitted 2");
});

test("event message templates reject malformed placeholder names", () => {
  const adapter = {
    version: 2,
    url: "https://notify.test.invalid/hook",
    method: "POST",
    bodyTemplate: { text: "{{message}}" },
    eventTemplates: { "submission.summary": "{{record_identifier}} / {{bad-key}}" },
    successStatuses: [200]
  };
  assert.deepEqual(validateNotificationAdapter(adapter), [
    "notificationAdapter.eventTemplates.submission.summary uses invalid placeholder {{record_identifier}}",
    "notificationAdapter.eventTemplates.submission.summary uses invalid placeholder {{bad-key}}"
  ]);
});

test("v3 round adapter is explicit, private and closed to unknown fields", () => {
  const adapter = validV3Adapter();
  assert.deepEqual(validateNotificationAdapter(adapter), []);

  adapter.deliveries.summary.headers = { Authorization: "must-not-be-stored" };
  adapter.deliveries.problem.response.codePath = "code";
  adapter.futureProviderSetting = true;
  assert.deepEqual(validateNotificationAdapter(adapter), [
    "notificationAdapter.futureProviderSetting is not supported",
    "notificationAdapter.deliveries.summary.headers is not supported",
    "notificationAdapter.deliveries.problem.response.codePath is not supported"
  ]);
});

test("v3 provider timeout is explicit and capped at the App proxy budget", () => {
  const adapter = validV3Adapter();
  adapter.deliveries.summary.timeoutMs = 8001;
  adapter.deliveries.problem.timeoutMs = 999;
  assert.deepEqual(validateNotificationAdapter(adapter), [
    "notificationAdapter.deliveries.summary.timeoutMs must be an integer from 1000 to 8000",
    "notificationAdapter.deliveries.problem.timeoutMs must be an integer from 1000 to 8000"
  ]);
});

test("v3 round request enforces exact fields, lengths and array limits", () => {
  assert.deepEqual(validateNotificationRequest({
    version: 3, type: "submission.round", data: validRoundData()
  }), []);

  const unknown = validRoundData({ providerUrl: "https://must-not-cross.example.invalid" });
  assert.deepEqual(validateNotificationRequest({
    version: 3, type: "submission.round", data: unknown
  }), ["data.providerUrl is not supported"]);

  const tooMany = validRoundData({ errors: Array.from({ length: 101 }, () => "Example") });
  assert.deepEqual(validateNotificationRequest({
    version: 3, type: "submission.round", data: tooMany
  }), ["data.errors must not contain more than 100 items"]);

  const tooLong = validRoundData({ errors: ["x".repeat(513)] });
  assert.deepEqual(validateNotificationRequest({
    version: 3, type: "submission.round", data: tooLong
  }), ["data.errors[0] must be a non-empty string not exceeding 512 characters"]);
});

test("v3 delivery rendering and raw response marker matching are exact", () => {
  const adapter = validV3Adapter();
  const data = validRoundData({
    success: false,
    errors: ["Example failure"],
    unconfirmedIdentifiers: ["EXAMPLE-UNIT-001"]
  });
  assert.equal(renderRoundDeliveryMessage(adapter, "summary", data),
    "Example round Example profile: 3\nExample item × 2");
  assert.equal(shouldSendRoundProblem(data), true);
  assert.equal(shouldSendRoundProblem(validRoundData()), false);

  const delivery = adapter.deliveries.summary;
  assert.equal(roundDeliveryResponseSucceeded(
    delivery, 200, '{"summary-accepted":true}'), true);
  assert.equal(roundDeliveryResponseSucceeded(
    delivery, 200, '{"summary-accepted": true}'), false);
  assert.equal(roundDeliveryResponseSucceeded(
    delivery, 200, '{"SUMMARY-ACCEPTED":true}'), false);
  assert.equal(roundDeliveryResponseSucceeded(
    delivery, 202, '{"summary-accepted":true}'), false);
});

test("v3 formatter schema is closed, field-typed and delivery-specific", () => {
  const adapter = validV3Adapter();
  adapter.deliveries.summary.formatters = {
    completedAt: { type: "isoLocalSeconds" },
    unconfirmedIdentifiers: { type: "length" },
    newMissingItems: { type: "list", empty: "none", separator: ", ", prefixEach: "- " },
    missingItems: {
      type: "groupedCountList",
      empty: "none",
      groupSeparator: "\n\n",
      itemSeparator: "\n",
      groupTemplate: "count={{count}}\n{{items}}",
      itemTemplate: "{{index}}. {{label}}"
    }
  };
  adapter.deliveries.problem.formatters = {
    unconfirmedIdentifiers: { type: "list", empty: "none", separator: "\n", prefixEach: "- " }
  };
  assert.deepEqual(validateNotificationAdapter(adapter), []);

  const unknownField = JSON.parse(JSON.stringify(adapter));
  unknownField.deliveries.summary.formatters.providerUrl = { type: "length" };
  assert.ok(validateNotificationAdapter(unknownField).includes(
    "notificationAdapter.deliveries.summary.formatters.providerUrl is not a supported submission.round field"));

  const wrongFieldType = JSON.parse(JSON.stringify(adapter));
  wrongFieldType.deliveries.summary.formatters.completedAt = {
    type: "list", empty: "", separator: "", prefixEach: "", futureOption: true
  };
  const wrongTypeErrors = validateNotificationAdapter(wrongFieldType);
  assert.ok(wrongTypeErrors.includes(
    "notificationAdapter.deliveries.summary.formatters.completedAt.futureOption is not supported"));
  assert.ok(wrongTypeErrors.includes(
    "notificationAdapter.deliveries.summary.formatters.completedAt.type list is not supported for completedAt"));

  const incomplete = JSON.parse(JSON.stringify(adapter));
  delete incomplete.deliveries.summary.formatters.newMissingItems.prefixEach;
  assert.ok(validateNotificationAdapter(incomplete).includes(
    "notificationAdapter.deliveries.summary.formatters.newMissingItems.prefixEach must be a string not exceeding 64 characters"));
});

test("v3 formatters render stable lists, offset-local seconds and count-descending groups", () => {
  const adapter = validV3Adapter();
  adapter.deliveries.summary.messageTemplate = [
    "time={{completedAt}}; unconfirmed={{unconfirmedIdentifiers}}; new={{newMissingItems}}; ",
    "{{#if missingItems}}missing={{missingItems}}{{/if}}",
    "{{#if recoveredItems}}; recovered={{recoveredItems}}{{/if}}",
    "{{#if success}}; succeeded{{/if}}"
  ].join("");
  adapter.deliveries.summary.formatters = {
    completedAt: { type: "isoLocalSeconds" },
    unconfirmedIdentifiers: { type: "length" },
    newMissingItems: { type: "list", empty: "(none)", separator: " | ", prefixEach: "+ " },
    recoveredItems: { type: "list", empty: "SHOULD_NOT_CONTROL_IF", separator: ",", prefixEach: "" },
    missingItems: {
      type: "groupedCountList",
      empty: "(none)",
      groupSeparator: "\n\n",
      itemSeparator: " | ",
      groupTemplate: "{{count}}:{{items}}",
      itemTemplate: "{{index}}.{{label}}"
    }
  };
  adapter.deliveries.problem.messageTemplate = "{{unconfirmedIdentifiers}}";
  adapter.deliveries.problem.formatters = {
    unconfirmedIdentifiers: { type: "list", empty: "(none)", separator: "\n", prefixEach: "- " }
  };
  assert.deepEqual(validateNotificationAdapter(adapter), []);

  const data = validRoundData({
    success: false,
    completedAt: "2026-07-22T12:34:56.987+05:30",
    missingItems: [
      { label: "Two A", affectedCount: 2 },
      { label: "Three A", affectedCount: 3 },
      { label: "Two B", affectedCount: 2 },
      { label: "Three B", affectedCount: 3 }
    ],
    newMissingItems: ["First", "Second"],
    recoveredItems: [],
    unconfirmedIdentifiers: ["EXAMPLE-001", "EXAMPLE-002"]
  });
  assert.equal(renderRoundDeliveryMessage(adapter, "summary", data),
    "time=2026-07-22 12:34:56; unconfirmed=2; new=+ First | + Second; "
      + "missing=3:1.Three A | 2.Three B\n\n2:1.Two A | 2.Two B");
  assert.equal(renderRoundDeliveryMessage(adapter, "problem", data),
    "- EXAMPLE-001\n- EXAMPLE-002");
});

test("v3 conditional blocks and formatter subtemplates fail closed", () => {
  const unknownConditional = validV3Adapter();
  unknownConditional.deliveries.summary.messageTemplate = "{{#if providerUrl}}bad{{/if}}";
  assert.ok(validateNotificationAdapter(unknownConditional).includes(
    "notificationAdapter.deliveries.summary.messageTemplate uses unsupported conditional field providerUrl"));

  const unclosed = validV3Adapter();
  unclosed.deliveries.summary.messageTemplate = "{{#if errors}}{{errors}}";
  assert.ok(validateNotificationAdapter(unclosed).includes(
    "notificationAdapter.deliveries.summary.messageTemplate contains an unclosed {{#if field}} block"));

  const tooDeep = validV3Adapter();
  tooDeep.deliveries.summary.messageTemplate = `${"{{#if errors}}".repeat(5)}x${"{{/if}}".repeat(5)}`;
  assert.ok(validateNotificationAdapter(tooDeep).includes(
    "notificationAdapter.deliveries.summary.messageTemplate conditional blocks must not exceed 4 levels"));

  const unsafeSubtemplate = validV3Adapter();
  unsafeSubtemplate.deliveries.summary.formatters = {
    missingItems: {
      type: "groupedCountList",
      empty: "",
      groupSeparator: "\n",
      itemSeparator: ", ",
      groupTemplate: "{{count}}: {{items}} {{profileLabel}}",
      itemTemplate: "{{#if label}}{{label}}{{/if}}"
    }
  };
  const unsafeErrors = validateNotificationAdapter(unsafeSubtemplate);
  assert.ok(unsafeErrors.includes(
    "notificationAdapter.deliveries.summary.formatters.missingItems.groupTemplate uses unsupported placeholder {{profileLabel}}"));
  assert.ok(unsafeErrors.filter((error) => error.includes("does not support conditional blocks")).length >= 1);
});

test("v3 timestamps are calendar-valid and rendered without Worker timezone conversion", () => {
  for (const completedAt of [
    "2026-02-30T12:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T12:00:00+14:01"
  ]) {
    assert.deepEqual(validateNotificationRequest({
      version: 3, type: "submission.round", data: validRoundData({ completedAt })
    }), ["data.completedAt must be an ISO-8601 date-time with an explicit offset"]);
  }

  const adapter = validV3Adapter();
  adapter.deliveries.summary.messageTemplate = "{{completedAt}}";
  adapter.deliveries.summary.formatters = { completedAt: { type: "isoLocalSeconds" } };
  assert.equal(renderRoundDeliveryMessage(adapter, "summary", validRoundData({
    completedAt: "2024-02-29T23:45:06-07:00"
  })), "2024-02-29 23:45:06");
});

test("v3 rendered messages have a hard upper bound", () => {
  const adapter = validV3Adapter();
  adapter.deliveries.summary.messageTemplate = "{{errors}}".repeat(64);
  assert.deepEqual(validateNotificationAdapter(adapter), []);
  assert.throws(() => renderRoundDeliveryMessage(adapter, "summary", validRoundData({
    errors: Array.from({ length: 100 }, () => "x".repeat(512))
  })), /rendered length limit/);
});

test("v3 Worker sends summary and conditional problem independently without leaking provider config", async () => {
  const previousFetch = globalThis.fetch;
  const backendAdapter = validBackendAdapter();
  const notificationAdapter = validV3Adapter();
  const files = {
    "form-profiles.json": JSON.stringify({
      version: 3,
      settings: { backendAdapter },
      profiles: []
    }),
    "panel-settings.json": JSON.stringify({
      schemaVersion: 1,
      settings: { notificationAdapter }
    })
  };
  const providerCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith("https://api.github.com/")) {
      if (target === "https://api.github.com/repos/sample/catalog") {
        return Response.json({ default_branch: "main" });
      }
      if (target.endsWith("/git/ref/heads/main")) {
        return Response.json({ object: { sha: "snapshot-sha" } });
      }
      const path = (target.split("/contents/")[1] || "").split("?")[0];
      const content = files[path];
      if (content === undefined) return new Response("not found", { status: 404 });
      return Response.json({ content: btoa(content), sha: `${path}-sha` });
    }
    providerCalls.push({ target, options });
    if (target === notificationAdapter.deliveries.summary.url) {
      return new Response('{"summary-accepted":false}', { status: 200 });
    }
    if (target === notificationAdapter.deliveries.problem.url) {
      return new Response('{"problem-accepted":true}', { status: 200 });
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
  const env = {
    GITHUB_REPO: "sample/catalog",
    GITHUB_TOKEN: "sample-token",
    CATALOG_READ_KEY: "sample-read-key"
  };
  try {
    const configResponse = await worker.fetch(new Request("https://panel.example.invalid/api/config", {
      headers: { Authorization: "Bearer sample-read-key" }
    }), env);
    const configText = await configResponse.text();
    const config = JSON.parse(configText);
    assert.deepEqual(config.notification, {
      version: 3,
      enabled: true,
      endpoint: "/api/notify",
      eventTypes: ["submission.round"],
      diagnosticsEnabled: false
    });
    assert.equal(configText.includes("summary.notifications.example.invalid"), false);
    assert.equal(configText.includes("messageTemplate"), false);
    assert.equal(configText.includes("summary-accepted"), false);
    assert.equal(configText.includes("timeoutMs"), false);

    const response = await worker.fetch(new Request("https://panel.example.invalid/api/notify", {
      method: "POST",
      headers: { Authorization: "Bearer sample-read-key", "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 3,
        type: "submission.round",
        data: validRoundData({
          success: false,
          errors: ["Example failure"],
          unconfirmedIdentifiers: ["EXAMPLE-UNIT-001"]
        })
      })
    }), env);
    assert.equal(response.status, 502);
    assert.equal(providerCalls.length, 2);
    assert.deepEqual(new Set(providerCalls.map((call) => call.target)), new Set([
      notificationAdapter.deliveries.summary.url,
      notificationAdapter.deliveries.problem.url
    ]));
    assert.ok(providerCalls.every((call) => call.options.signal instanceof AbortSignal));

    providerCalls.length = 0;
    const cleanResponse = await worker.fetch(new Request("https://panel.example.invalid/api/notify", {
      method: "POST",
      headers: { Authorization: "Bearer sample-read-key", "Content-Type": "application/json" },
      body: JSON.stringify({ version: 3, type: "submission.round", data: validRoundData() })
    }), env);
    assert.equal(cleanResponse.status, 502);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].target, notificationAdapter.deliveries.summary.url);

    const oversizedAdapter = JSON.parse(JSON.stringify(notificationAdapter));
    oversizedAdapter.deliveries.summary.messageTemplate = "{{newMissingItems}}".repeat(64);
    files["panel-settings.json"] = JSON.stringify({
      schemaVersion: 1,
      settings: { notificationAdapter: oversizedAdapter }
    });
    providerCalls.length = 0;
    const oversizedResponse = await worker.fetch(new Request("https://panel.example.invalid/api/notify", {
      method: "POST",
      headers: { Authorization: "Bearer sample-read-key", "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 3,
        type: "submission.round",
        data: validRoundData({
          newMissingItems: Array.from({ length: 100 }, () => "x".repeat(160))
        })
      })
    }), env);
    assert.equal(oversizedResponse.status, 502);
    assert.deepEqual(await oversizedResponse.json(), {
      error: "notification provider rejected one or more deliveries",
      failed: ["summary"]
    });
    assert.equal(providerCalls.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
