import test from "node:test";
import assert from "node:assert/strict";

import { handleRequest, AppPairingTicketStore } from "../api/request-handler.mjs";
const worker = { fetch: handleRequest };

const PANEL_ORIGIN = "https://panel.test.invalid";
const APPLICATION_ID = "com.autoformkit.app";
const ACCESS_KEY = "sample-panel-read-key-2026";
const ISSUER_KEY = "sample-pairing-issuer-secret-32-characters";
const CLIENT_DIGEST = "a".repeat(64);

const clone = (value) => value === undefined ? undefined : structuredClone(value);

class FakeStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
    this.lock = Promise.resolve();
    this.beforeGet = null;
  }

  async transaction(callback) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolve) => { release = resolve; });
    await previous;
    const draft = new Map(Array.from(this.values, ([key, value]) => [key, clone(value)]));
    const transaction = {
      get: async (key) => {
        if (this.beforeGet) {
          const callback = this.beforeGet;
          this.beforeGet = null;
          await callback();
        }
        return clone(draft.get(key));
      },
      put: async (key, value) => { draft.set(key, clone(value)); }
    };
    try {
      const result = await callback(transaction);
      this.values = draft;
      return result;
    } finally {
      release();
    }
  }

  async setAlarm(value) {
    this.alarmAt = value;
  }

  async deleteAll() {
    this.values.clear();
  }
}

class FakeTicketNamespace {
  constructor() {
    this.instances = new Map();
  }

  idFromName(name) {
    return name;
  }

  get(id) {
    if (!this.instances.has(id)) {
      const storage = new FakeStorage();
      const instance = new AppPairingTicketStore({ storage });
      this.instances.set(id, { storage, instance });
    }
    return {
      fetch: (request) => this.instances.get(id).instance.fetch(request)
    };
  }

  serializedState() {
    const output = [];
    for (const [id, { storage }] of this.instances) {
      output.push([id, Array.from(storage.values.entries())]);
    }
    return JSON.stringify(output);
  }
}

function environment(overrides = {}) {
  return {
    PUBLIC_URL: PANEL_ORIGIN,
    APP_PAIR_APPLICATION_IDS: APPLICATION_ID,
    APP_PAIR_TTL_SECONDS: "300",
    APP_PAIR_ISSUER_KEY: ISSUER_KEY,
    CATALOG_READ_KEY: ACCESS_KEY,
    APP_PAIR_TICKETS: new FakeTicketNamespace(),
    ...overrides
  };
}

function issueRequest(body = {
  version: 1,
  applicationId: APPLICATION_ID,
  clientDigest: CLIENT_DIGEST
}, authorization = `Bearer ${ISSUER_KEY}`) {
  return new Request(`${PANEL_ORIGIN}/api/app-pair/v1/issue`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function redeemRequest(ticket, options = {}) {
  return new Request(`${options.origin || PANEL_ORIGIN}/api/app-pair/v1/redeem`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "CF-Connecting-IP": options.ip || "192.0.2.10"
    },
    body: JSON.stringify(options.body || { version: 1, ticket })
  });
}

function assertNoStore(response) {
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
}

test("authenticated issuer returns only a short opaque ticket and exact audience", async () => {
  const env = environment();
  const response = await worker.fetch(issueRequest(), env);
  assert.equal(response.status, 200);
  assertNoStore(response);
  const issued = await response.json();
  assert.deepEqual(Object.keys(issued).sort(), [
    "applicationId", "expires", "panelOrigin", "ticket", "version"
  ]);
  assert.equal(issued.version, 1);
  assert.equal(issued.panelOrigin, PANEL_ORIGIN);
  assert.equal(issued.applicationId, APPLICATION_ID);
  assert.match(issued.ticket, /^[A-Za-z0-9_-]{43}$/u);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(issued.expires >= now + 295);
  assert.ok(issued.expires <= now + 300);

  const stored = env.APP_PAIR_TICKETS.serializedState();
  assert.equal(stored.includes(issued.ticket), false);
  assert.equal(stored.includes(ACCESS_KEY), false);
  assert.equal(stored.includes(ISSUER_KEY), false);
  assert.match(stored, /"accessKeyHash":"[0-9a-f]{64}"/u);
  assert.match(stored, new RegExp(CLIENT_DIGEST, "u"));
});

test("issuer uses a distinct constant-time checked secret and strict request shape", async () => {
  for (const authorization of [
    "",
    `Bearer ${ACCESS_KEY}`,
    `bearer ${ISSUER_KEY}`,
    `Bearer ${ISSUER_KEY.slice(0, -1)}x`
  ]) {
    const response = await worker.fetch(issueRequest(undefined, authorization), environment());
    assert.equal(response.status, 401);
    assertNoStore(response);
    assert.deepEqual(await response.json(), { error: "pairing unavailable" });
  }

  const malformedBodies = [
    { version: 1, applicationId: APPLICATION_ID, clientDigest: CLIENT_DIGEST, extra: true },
    { version: 2, applicationId: APPLICATION_ID, clientDigest: CLIENT_DIGEST },
    { version: 1, applicationId: "com.example.unlisted", clientDigest: CLIENT_DIGEST },
    { version: 1, applicationId: APPLICATION_ID, clientDigest: "A".repeat(64) }
  ];
  for (const body of malformedBodies) {
    const response = await worker.fetch(issueRequest(body), environment());
    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.deepEqual(await response.json(), { error: "pairing unavailable" });
  }
});

test("redeem atomically consumes a ticket before returning the exact App v1 response", async () => {
  const env = environment();
  const issued = await (await worker.fetch(issueRequest(), env)).json();
  const responses = await Promise.all(Array.from(
    { length: 64 }, () => worker.fetch(redeemRequest(issued.ticket), env)));
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status === 400).length, 63);
  for (const response of responses) assertNoStore(response);
  const success = responses.find((response) => response.status === 200);
  const failure = responses.find((response) => response.status === 400);
  assert.deepEqual(await success.json(), { version: 1, accessKey: ACCESS_KEY });
  assert.deepEqual(await failure.json(), { error: "pairing unavailable" });

  const replay = await worker.fetch(redeemRequest(issued.ticket), env);
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), { error: "pairing unavailable" });
});

test("redeem rejects key rotation, malformed input, and the wrong HTTPS origin generically", async () => {
  const env = environment();
  const issued = await (await worker.fetch(issueRequest(), env)).json();
  const rotated = { ...env, CATALOG_READ_KEY: "sample-rotated-panel-read-key" };
  const rotationResponse = await worker.fetch(redeemRequest(issued.ticket), rotated);
  assert.equal(rotationResponse.status, 400);
  const rotationText = await rotationResponse.text();
  assert.deepEqual(JSON.parse(rotationText), { error: "pairing unavailable" });
  assert.equal(rotationText.includes(ACCESS_KEY), false);
  assert.equal(rotationText.includes(rotated.CATALOG_READ_KEY), false);

  const malformed = await worker.fetch(redeemRequest(issued.ticket, {
    body: { version: 1, ticket: issued.ticket, applicationId: APPLICATION_ID }
  }), env);
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "pairing unavailable" });

  const wrongOrigin = await worker.fetch(redeemRequest(issued.ticket, {
    origin: "https://alias.test.invalid"
  }), env);
  assert.equal(wrongOrigin.status, 503);
  assert.deepEqual(await wrongOrigin.json(), { error: "pairing unavailable" });
});

test("pairing fails closed when any deployment prerequisite is missing or invalid", async () => {
  const invalidEnvironments = [
    { APP_PAIR_TICKETS: undefined },
    { APP_PAIR_ISSUER_KEY: undefined },
    { APP_PAIR_ISSUER_KEY: "too-short" },
    {
      APP_PAIR_ISSUER_KEY: "sample-shared-secret-that-must-be-rejected",
      CATALOG_READ_KEY: "sample-shared-secret-that-must-be-rejected"
    },
    { CATALOG_READ_KEY: undefined },
    { CATALOG_READ_KEY: "not allowed whitespace" },
    { APP_PAIR_APPLICATION_IDS: undefined },
    { APP_PAIR_APPLICATION_IDS: "invalid" },
    { APP_PAIR_TTL_SECONDS: "601" },
    { PUBLIC_URL: "http://panel.test.invalid" },
    { PUBLIC_URL: `${PANEL_ORIGIN}/business-path` }
  ];
  for (const override of invalidEnvironments) {
    const response = await worker.fetch(issueRequest(), environment(override));
    assert.equal(response.status, 503);
    assertNoStore(response);
    assert.deepEqual(await response.json(), { error: "pairing unavailable" });
  }
});

test("unexpected pairing exceptions never reach the Worker's detailed global error response", async () => {
  const privateMarker = "private-pairing-binding-error-must-not-escape";
  const env = environment();
  Object.defineProperty(env, "APP_PAIR_ISSUER_KEY", {
    enumerable: true,
    get() {
      throw new Error(privateMarker);
    }
  });
  const response = await worker.fetch(issueRequest(), env);
  assert.equal(response.status, 503);
  assertNoStore(response);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: "pairing unavailable" });
  assert.equal(text.includes(privateMarker), false);
});

test("Durable Object rejects expiry at the boundary and enforces a transactional rate limit", async () => {
  const storage = new FakeStorage();
  let clockMs = 1_299_000;
  const store = new AppPairingTicketStore({ storage }, {}, () => clockMs);
  const internal = (path, body) => store.fetch(new Request(`https://app-pair.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
  const issue = {
    version: 1,
    protocol: "app-pair/v1",
    panelOrigin: PANEL_ORIGIN,
    endpoint: "/api/app-pair/v1/redeem",
    applicationId: APPLICATION_ID,
    clientDigest: CLIENT_DIGEST,
    accessKeyHash: "b".repeat(64),
    issuedAt: 1000,
    expires: 1300
  };
  assert.equal((await internal("/v1/issue", issue)).status, 200);
  // Simulate a request accepted just before expiry but delayed in the Object/storage queue until
  // the boundary. The Object must use its own clock after the transactional read, not caller time.
  storage.beforeGet = () => { clockMs = 1_300_000; };
  assert.equal((await internal("/v1/redeem", {
    version: 1,
    protocol: "app-pair/v1",
    panelOrigin: PANEL_ORIGIN,
    endpoint: "/api/app-pair/v1/redeem",
    allowedApplicationIds: [APPLICATION_ID],
    accessKeyHash: issue.accessKeyHash
  })).status, 409);

  const rateStorage = new FakeStorage();
  const rateStore = new AppPairingTicketStore(
    { storage: rateStorage }, {}, () => clockMs);
  const rate = () => rateStore.fetch(new Request("https://app-pair.internal/v1/rate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, limit: 2, windowSeconds: 60 })
  }));
  clockMs = 2_000_000;
  const concurrent = await Promise.all([rate(), rate(), rate()]);
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 200, 429]);
  clockMs = 2_060_000;
  assert.equal((await rate()).status, 200);

  const wrongMethod = await store.fetch(new Request("https://app-pair.internal/v1/redeem"));
  assert.equal(wrongMethod.status, 404);
  assertNoStore(wrongMethod);
  assert.ok(storage.values.size > 0);
  await store.alarm();
  assert.equal(storage.values.size, 0);
});
