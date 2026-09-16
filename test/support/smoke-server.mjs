import { appendFile, writeFile } from "node:fs/promises";
import { marketplaceHandler, packageFixture, serve } from "./registry.mjs";

const fixture = await packageFixture();
const server = await serve(marketplaceHandler());
await appendFile(
  process.env.GITHUB_ENV,
  `VSCE_MARKETPLACE_URL=${server.url}\nPUBLISH_VSIX_SMOKE_PATH=${fixture.path}\n`,
);
await writeFile(process.env.PUBLISH_VSIX_SMOKE_READY, "ready\n");

process.on("SIGTERM", async () => {
  await server.close();
  await fixture.cleanup();
  process.exit(0);
});
