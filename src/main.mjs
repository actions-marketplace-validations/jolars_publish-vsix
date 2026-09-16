import * as core from "@actions/core";
import { publishVsix, readInputs } from "./publish.mjs";

try {
  for (const token of [
    process.env.PUBLISH_VSIX_MARKETPLACE_TOKEN,
    process.env.PUBLISH_VSIX_OPEN_VSX_TOKEN,
  ]) {
    if (token?.trim()) core.setSecret(token.trim());
  }
  const result = await publishVsix(readInputs(), { warn: core.warning });
  core.setOutput("marketplace", result.marketplace);
  core.setOutput("open-vsx", result.openVsx);
  if (result.errors.length > 0) {
    core.setFailed(
      result.errors
        .map(
          ({ registry, error }) =>
            `${registry}: ${error instanceof Error ? error.message : String(error)}`,
        )
        .join("\n"),
    );
  }
} catch (error) {
  core.setFailed(error instanceof Error ? error.message : String(error));
}
