import assert from "node:assert/strict";
import { test } from "node:test";
import { retry } from "../src/retry.mjs";

function harness(errors = []) {
  const waits = [];
  const warnings = [];
  let calls = 0;
  return {
    waits,
    warnings,
    get calls() {
      return calls;
    },
    run: () => {
      const error = errors[calls++];
      if (error) throw error;
      return "published";
    },
    options: {
      sleep: async (delay) => waits.push(delay),
      warn: (message) => warnings.push(message),
    },
  };
}

test("returns successful results without waiting", async () => {
  const h = harness();
  assert.equal(await retry(h.run, h.options), "published");
  assert.equal(h.calls, 1);
  assert.deepEqual(h.waits, []);
});

for (const error of [
  new Error("Request timeout: /_apis/gallery"),
  new Error(
    "No response from https://open-vsx.org/api/-/publish for 30000 ms.",
  ),
  Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
  Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
  Object.assign(new Error("temporary DNS failure"), { code: "EAI_AGAIN" }),
  Object.assign(new Error("Request Timeout"), { statusCode: 408 }),
  Object.assign(new Error("Too Many Requests"), { statusCode: 429 }),
  Object.assign(new Error("<html>Service Unavailable</html>"), {
    statusCode: 503,
  }),
  Object.assign(new Error("Service Unavailable"), { status: 503 }),
]) {
  test(`retries transient errors: ${error.message}`, async () => {
    const h = harness([error]);
    assert.equal(await retry(h.run, h.options), "published");
    assert.equal(h.calls, 2);
    assert.deepEqual(h.waits, [15_000]);
  });
}

for (const error of [
  Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
  Object.assign(new Error("Forbidden"), { status: 403 }),
  Object.assign(new Error("Request timeout is an invalid name"), {
    statusCode: 400,
  }),
  Object.assign(new Error("Already exists"), { statusCode: 409 }),
  new Error("Invalid VSIX manifest"),
]) {
  test(`fails immediately for permanent errors: ${error.message}`, async () => {
    const h = harness([error]);
    await assert.rejects(retry(h.run, h.options), (caught) => caught === error);
    assert.equal(h.calls, 1);
    assert.deepEqual(h.waits, []);
  });
}

test("caps attempts and preserves the final error", async () => {
  const errors = Array.from(
    { length: 4 },
    () => new Error("Request timeout: /_apis/gallery"),
  );
  const h = harness(errors);
  await assert.rejects(retry(h.run, h.options), (error) => error === errors[3]);
  assert.equal(h.calls, 4);
  assert.deepEqual(h.waits, [15_000, 30_000, 60_000]);
});

test("allows retries to be disabled", async () => {
  const h = harness([new Error("Request timeout: /_apis/gallery")]);
  await assert.rejects(retry(h.run, { ...h.options, maxAttempts: 1 }));
  assert.equal(h.calls, 1);
  assert.deepEqual(h.waits, []);
});

test("honors Retry-After from the Marketplace client", async () => {
  const error = Object.assign(new Error("Too Many Requests"), {
    statusCode: 429,
    responseHeaders: { "retry-after": "45" },
  });
  const h = harness([error]);
  await retry(h.run, h.options);
  assert.deepEqual(h.waits, [45_000]);
});

test("stops when Retry-After exceeds the bounded wait", async () => {
  const error = Object.assign(new Error("Too Many Requests"), {
    statusCode: 429,
    responseHeaders: { "retry-after": "3600" },
  });
  const h = harness([error]);
  await assert.rejects(retry(h.run, h.options), (caught) => caught === error);
  assert.deepEqual(h.waits, []);
});
