import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { publishVSIX } from "@vscode/vsce";
import { publish as ovsxPublish } from "ovsx";
import { retry } from "./retry.mjs";

export function readInputs(env = process.env) {
  const path = env.PUBLISH_VSIX_PATH?.trim();
  if (!path) throw new Error("vsix-path is required.");
  const marketplaceToken = env.PUBLISH_VSIX_MARKETPLACE_TOKEN?.trim() || "";
  const openVsxToken = env.PUBLISH_VSIX_OPEN_VSX_TOKEN?.trim() || "";
  if (!marketplaceToken && !openVsxToken) {
    throw new Error("Provide marketplace-token, open-vsx-token, or both.");
  }
  const attempts = env.PUBLISH_VSIX_MAX_ATTEMPTS?.trim() || "4";
  if (!/^(?:[1-9]|10)$/.test(attempts)) {
    throw new Error("max-attempts must be an integer from 1 to 10.");
  }
  const duplicate =
    env.PUBLISH_VSIX_SKIP_DUPLICATE?.trim().toLowerCase() || "true";
  if (!["true", "false"].includes(duplicate)) {
    throw new Error("skip-duplicate must be true or false.");
  }
  return {
    vsixPath: resolve(path),
    marketplaceToken,
    openVsxToken,
    skipDuplicate: duplicate === "true",
    maxAttempts: Number(attempts),
  };
}

export async function publishVsix(
  inputs,
  {
    marketplace = publishVSIX,
    openVsx = ovsxPublish,
    sleep,
    warn = console.warn,
  } = {},
) {
  if (!(await stat(inputs.vsixPath)).isFile()) {
    throw new Error("vsix-path must point to a file.");
  }
  const result = {
    marketplace: "not-requested",
    openVsx: "not-requested",
    errors: [],
  };
  const registries = [
    {
      name: "Marketplace",
      key: "marketplace",
      token: inputs.marketplaceToken,
      publish: () =>
        marketplace(inputs.vsixPath, {
          pat: inputs.marketplaceToken,
          skipDuplicate: inputs.skipDuplicate,
        }),
    },
    {
      name: "Open VSX",
      key: "openVsx",
      token: inputs.openVsxToken,
      publish: async () => {
        const results = await openVsx({
          extensionFile: inputs.vsixPath,
          pat: inputs.openVsxToken,
          skipDuplicate: inputs.skipDuplicate,
          registryUrl: "https://open-vsx.org",
        });
        // The Open VSX API resolves even when an upload failed.
        const rejected = results.find((entry) => entry.status === "rejected");
        if (rejected) throw rejected.reason;
      },
    },
  ];
  for (const registry of registries) {
    if (!registry.token) continue;
    try {
      // Reenter the client so every retry gets a fresh upload stream and duplicate check.
      await retry(registry.publish, {
        maxAttempts: inputs.maxAttempts,
        sleep,
        warn: (message) => warn(`${registry.name}: ${message}`),
      });
      result[registry.key] = "success";
    } catch (error) {
      result[registry.key] = "failure";
      result.errors.push({ registry: registry.name, error });
    }
  }
  return result;
}
