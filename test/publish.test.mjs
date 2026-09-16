import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishVsix, readInputs } from "../src/publish.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "publish-vsix-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vsixPath = join(directory, "extension.vsix");
  await writeFile(
    vsixPath,
    "Test package; registry clients are stubbed in this suite.",
  );
  return {
    vsixPath,
    marketplaceToken: "marketplace-secret",
    openVsxToken: "open-vsx-secret",
    skipDuplicate: true,
    maxAttempts: 4,
  };
}

const noWait = { sleep: async () => {}, warn: () => {} };

test("passes the same package and duplicate policy to both registries", async (t) => {
  const inputs = await fixture(t);
  const calls = [];
  const result = await publishVsix(inputs, {
    ...noWait,
    marketplace: async (...args) => calls.push(["marketplace", ...args]),
    openVsx: async (...args) => {
      calls.push(["open-vsx", ...args]);
      return [{ status: "fulfilled" }];
    },
  });
  assert.equal(result.marketplace, "success");
  assert.equal(result.openVsx, "success");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(calls, [
    [
      "marketplace",
      inputs.vsixPath,
      { pat: "marketplace-secret", skipDuplicate: true },
    ],
    [
      "open-vsx",
      {
        extensionFile: inputs.vsixPath,
        pat: "open-vsx-secret",
        skipDuplicate: true,
        registryUrl: "https://open-vsx.org",
      },
    ],
  ]);
});

test("attempts Open VSX after a permanent Marketplace failure", async (t) => {
  const error = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  const result = await publishVsix(await fixture(t), {
    ...noWait,
    marketplace: async () => {
      throw error;
    },
    openVsx: async () => [{ status: "fulfilled" }],
  });
  assert.equal(result.marketplace, "failure");
  assert.equal(result.openVsx, "success");
  assert.deepEqual(result.errors, [{ registry: "Marketplace", error }]);
});

test("retries rejected Open VSX results instead of reporting success", async (t) => {
  const inputs = { ...(await fixture(t)), marketplaceToken: "" };
  let calls = 0;
  const result = await publishVsix(inputs, {
    ...noWait,
    marketplace: () => assert.fail("Marketplace was not requested"),
    openVsx: async () =>
      ++calls === 1
        ? [
            {
              status: "rejected",
              reason: Object.assign(new Error("Unavailable"), { status: 503 }),
            },
          ]
        : [{ status: "fulfilled" }],
  });
  assert.equal(calls, 2);
  assert.equal(result.marketplace, "not-requested");
  assert.equal(result.openVsx, "success");
});

test("reports a permanent Open VSX rejection", async (t) => {
  const error = Object.assign(new Error("Forbidden"), { status: 403 });
  const result = await publishVsix(await fixture(t), {
    ...noWait,
    marketplace: async () => {},
    openVsx: async () => [{ status: "rejected", reason: error }],
  });
  assert.equal(result.openVsx, "failure");
  assert.deepEqual(result.errors, [{ registry: "Open VSX", error }]);
});

test("does not call either registry for a missing package", async (t) => {
  const inputs = await fixture(t);
  await rm(inputs.vsixPath);
  await assert.rejects(
    publishVsix(inputs, {
      marketplace: () => assert.fail("No upload should start"),
      openVsx: () => assert.fail("No upload should start"),
    }),
    /ENOENT/,
  );
});

test("defaults to safe reruns and four attempts", () => {
  const inputs = readInputs({
    PUBLISH_VSIX_PATH: "extension.vsix",
    PUBLISH_VSIX_MARKETPLACE_TOKEN: "secret",
  });
  assert.equal(inputs.skipDuplicate, true);
  assert.equal(inputs.maxAttempts, 4);
});

test("requires a package and at least one registry token", () => {
  assert.throws(() => readInputs({}), /vsix-path/);
  assert.throws(
    () => readInputs({ PUBLISH_VSIX_PATH: "extension.vsix" }),
    /token/,
  );
});

test("rejects invalid retry and duplicate settings before publishing", () => {
  const env = {
    PUBLISH_VSIX_PATH: "extension.vsix",
    PUBLISH_VSIX_MARKETPLACE_TOKEN: "secret",
  };
  for (const value of ["0", "11", "1.5", "4x"]) {
    assert.throws(
      () => readInputs({ ...env, PUBLISH_VSIX_MAX_ATTEMPTS: value }),
      /max-attempts/,
    );
  }
  assert.throws(
    () => readInputs({ ...env, PUBLISH_VSIX_SKIP_DUPLICATE: "yes" }),
    /skip-duplicate/,
  );
});
