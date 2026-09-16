import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVSIX } from "@vscode/vsce";

export async function packageFixture() {
  const directory = await mkdtemp(join(tmpdir(), "publish-vsix-integration-"));
  const source = join(directory, "extension");
  await mkdir(source);
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "fixture",
      publisher: "publish-vsix-test",
      version: "1.0.0",
      engines: { vscode: "^1.91.0" },
      repository: { type: "git", url: "https://example.invalid/fixture.git" },
      license: "MIT",
      main: "extension.js",
      activationEvents: [],
    }),
  );
  await writeFile(
    join(source, "README.md"),
    "# Fixture\n\nUsed only with a local registry server.\n",
  );
  await writeFile(
    join(source, "extension.js"),
    "exports.activate = () => {};\n",
  );
  const path = join(directory, "fixture-linux-x64.vsix");
  await createVSIX({
    cwd: source,
    packagePath: path,
    target: "linux-x64",
    dependencies: false,
    skipLicense: true,
  });
  return {
    path,
    directory,
    bytes: await readFile(path),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function serve(handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const entry = {
      method: request.method,
      path: new URL(request.url, "http://localhost").pathname,
      body: Buffer.concat(chunks),
    };
    requests.push(entry);
    response.setHeader("Content-Type", "application/json");
    handler(entry, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

export function marketplaceHandler({ dropUploadResponse = false } = {}) {
  // A version on another platform must not suppress this package's upload.
  const versions = [{ version: "1.0.0", targetPlatform: "win32-x64" }];
  return (request, response) => {
    if (request.method === "OPTIONS") {
      response.end(
        JSON.stringify({
          value: [
            {
              id: "e11ea35a-16fe-4b80-ab11-c4cab88a0966",
              area: "gallery",
              resourceName: "extensions",
              routeTemplate:
                "_apis/gallery/publishers/{publisherName}/extensions/{extensionName}",
              minVersion: "1.0",
              maxVersion: "7.2",
              releasedVersion: "7.2",
              resourceVersion: 2,
            },
          ],
        }),
      );
    } else if (request.method === "GET") {
      response.end(JSON.stringify({ versions }));
    } else if (request.method === "PUT") {
      versions.push({ version: "1.0.0", targetPlatform: "linux-x64" });
      if (dropUploadResponse) response.destroy();
      else response.end(JSON.stringify({ versions }));
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  };
}
