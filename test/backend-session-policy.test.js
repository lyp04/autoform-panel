import test from "node:test";
import assert from "node:assert/strict";

import { listTemplates, verifyToken } from "../api/backend.js";
import { validBackendAdapter } from "./backend-adapter-fixture.js";

test("worker accepts only explicitly configured non-success session proof codes", async () => {
  const previousFetch = globalThis.fetch;
  const seenFingerprints = [];
  globalThis.fetch = async (_url, options) => {
    seenFingerprints.push(options.headers["X-Test-Fingerprint"]);
    return new Response(JSON.stringify({
      meta: { state: "SESSION_PROOF", message: "verification performed from a different client" }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const token = "sample-token-with-enough-length";
  try {
    await assert.rejects(
      verifyToken({}, token, "sample-fp", validBackendAdapter()),
      /backend token is not valid/);

    const result = await verifyToken({}, token, "sample-fp", validBackendAdapter({
      auth: { sessionProofCodes: ["SESSION_PROOF"] }
    }));
    assert.equal(result.sessionProof, true);
    assert.deepEqual(seenFingerprints, ["sample-fp", "sample-fp"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("worker applies global code-missing policy to business and auth responses", async () => {
  const previousFetch = globalThis.fetch;
  let responseBody;
  globalThis.fetch = async () => new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

  const rawTemplate = {
    formKey: 101,
    displayLabel: "Sample form",
    itemCode: "SAMPLE-SKU",
    stage: 1,
    locationKey: 202,
    elements: []
  };
  const compatible = validBackendAdapter({
    response: {
      successFieldsWhenCodeMissing: ["receipt", "rows"],
      dataRootWhenCodeMissing: true,
      rejectMessageWhenCodeMissing: true
    }
  });
  try {
    responseBody = { receipt: null, rows: [rawTemplate] };
    assert.deepEqual(await listTemplates({}, {
      token: "sample-token",
      fingerprint: "sample-fingerprint"
    }, compatible), [{ id: 101, name: "Sample form", sku: "SAMPLE-SKU", step: 1 }]);

    responseBody = { rows: [rawTemplate], meta: { message: "Sample rejection" } };
    await assert.rejects(
      listTemplates({}, { token: "sample-token", fingerprint: "" }, compatible),
      /Sample rejection/);

    responseBody = {
      meta: { state: "rejected" },
      rows: [rawTemplate]
    };
    await assert.rejects(
      listTemplates({}, { token: "sample-token", fingerprint: "" }, compatible),
      /listTemplates failed/);

    const messageAllowed = structuredClone(compatible);
    messageAllowed.response.rejectMessageWhenCodeMissing = false;
    responseBody = {
      receipt: null,
      rows: [rawTemplate],
      meta: { message: "Informational sample message" }
    };
    assert.equal((await listTemplates({}, {
      token: "sample-token",
      fingerprint: ""
    }, messageAllowed)).length, 1);

    responseBody = { rows: [rawTemplate] };
    await assert.rejects(
      listTemplates({}, { token: "sample-token", fingerprint: "" },
        validBackendAdapter()),
      /listTemplates failed/);

    const globalAuth = validBackendAdapter({
      response: {
        successFieldsWhenCodeMissing: ["proof"],
        dataRootWhenCodeMissing: true,
        rejectMessageWhenCodeMissing: false
      }
    });
    delete globalAuth.auth.successFieldsWhenCodeMissing;
    delete globalAuth.auth.dataRootWhenCodeMissing;
    responseBody = {
      proof: null,
      person: { label: "Sample global user" },
      meta: { message: "Allowed by global policy" }
    };
    assert.equal((await verifyToken({}, "sample-token-with-enough-length", "",
      globalAuth)).userName, "Sample global user");

    responseBody = {
      payload: { person: { label: "Sample fallback user" } }
    };
    assert.equal((await verifyToken({}, "sample-token-with-enough-length", "",
      validBackendAdapter())).userName, "Sample fallback user");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
