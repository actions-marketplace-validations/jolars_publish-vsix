import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { publish as ovsxPublish } from "ovsx";
import { publishVsix } from "../src/publish.mjs";
import {
  marketplaceHandler,
  packageFixture,
  serve,
} from "./support/registry.mjs";

const exec = promisify(execFile);
const entrypoint = fileURLToPath(new URL("../src/main.mjs", import.meta.url));

test("Marketplace uploads the requested platform and safely reruns", async (t) => {
  const fixture = await packageFixture();
  t.after(fixture.cleanup);
  const server = await serve(marketplaceHandler());
  t.after(server.close);
  const output = join(fixture.directory, "output");
  await writeFile(output, "");
  const env = {
    ...process.env,
    VSCE_MARKETPLACE_URL: server.url,
    PUBLISH_VSIX_PATH: fixture.path,
    PUBLISH_VSIX_MARKETPLACE_TOKEN: "test-marketplace-token",
    PUBLISH_VSIX_OPEN_VSX_TOKEN: "",
    PUBLISH_VSIX_MAX_ATTEMPTS: "1",
    PUBLISH_VSIX_SKIP_DUPLICATE: "true",
    GITHUB_OUTPUT: output,
  };
  await exec(process.execPath, [entrypoint], { env });
  await exec(process.execPath, [entrypoint], { env });
  const uploads = server.requests.filter((request) => request.method === "PUT");
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].body, fixture.bytes);
  assert.match(await readFile(output, "utf8"), /success/);

  await assert.rejects(
    exec(process.execPath, [entrypoint], {
      env: { ...env, PUBLISH_VSIX_SKIP_DUPLICATE: "false" },
    }),
    (error) => error.code === 1 && /already exists/.test(error.stdout),
  );
});

test("a lost Marketplace upload response is recovered by duplicate detection", async (t) => {
  const fixture = await packageFixture();
  t.after(fixture.cleanup);
  const server = await serve(marketplaceHandler({ dropUploadResponse: true }));
  t.after(server.close);
  await exec(process.execPath, [entrypoint], {
    env: {
      ...process.env,
      VSCE_MARKETPLACE_URL: server.url,
      PUBLISH_VSIX_PATH: fixture.path,
      PUBLISH_VSIX_MARKETPLACE_TOKEN: "test-marketplace-token",
      PUBLISH_VSIX_OPEN_VSX_TOKEN: "",
      PUBLISH_VSIX_SKIP_DUPLICATE: "true",
      PUBLISH_VSIX_MAX_ATTEMPTS: "2",
    },
    timeout: 30_000,
  });
  assert.equal(
    server.requests.filter((request) => request.method === "PUT").length,
    1,
  );
  assert.equal(
    server.requests.filter((request) => request.method === "OPTIONS").length,
    2,
  );
});

test("Open VSX retries real 503 responses and accepts duplicates", async (t) => {
  const fixture = await packageFixture();
  t.after(fixture.cleanup);
  let uploads = 0;
  const server = await serve((request, response) => {
    if (request.path === "/api/version") {
      response.end("{}");
    } else if (++uploads === 1) {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: "Service Unavailable" }));
    } else if (uploads === 2) {
      response.end(
        JSON.stringify({
          namespace: "publish-vsix-test",
          name: "fixture",
          version: "1.0.0",
          targetPlatform: "linux-x64",
        }),
      );
    } else {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          error:
            "publish-vsix-test.fixture v1.0.0@linux-x64 is already published.",
        }),
      );
    }
  });
  t.after(server.close);
  const inputs = {
    vsixPath: fixture.path,
    marketplaceToken: "",
    openVsxToken: "test-open-vsx-token",
    skipDuplicate: true,
    maxAttempts: 4,
  };
  const waits = [];
  const dependencies = {
    openVsx: (options) => ovsxPublish({ ...options, registryUrl: server.url }),
    sleep: async (delay) => waits.push(delay),
    warn: () => {},
  };
  assert.equal((await publishVsix(inputs, dependencies)).openVsx, "success");
  assert.equal((await publishVsix(inputs, dependencies)).openVsx, "success");
  assert.equal(uploads, 3);
  assert.deepEqual(waits, [15_000]);
  for (const request of server.requests.filter(
    (request) => request.method === "POST",
  )) {
    assert.deepEqual(request.body, fixture.bytes);
  }
});
