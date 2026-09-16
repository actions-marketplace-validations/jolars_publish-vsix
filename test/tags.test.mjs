import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("floating release tags advance without moving backward for maintenance releases", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "publish-vsix-tags-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = join(directory, "remote.git");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("remote", "add", "origin", remote);
  const script = fileURLToPath(
    new URL("../scripts/update-tags.sh", import.meta.url),
  ).replaceAll("\\", "/");
  const release = (tag) => {
    git("commit", "--allow-empty", "-m", `Release ${tag}`);
    git("tag", tag);
    execFileSync("bash", [script], {
      cwd: directory,
      env: { ...process.env, GITHUB_REF_NAME: tag },
      stdio: "pipe",
    });
    return git("rev-parse", "HEAD");
  };
  const first = release("v1.0.0");
  assert.equal(git("rev-parse", "v1^{commit}"), first);
  const latest = release("v1.1.0");
  const maintenance = release("v1.0.1");
  assert.equal(git("rev-parse", "v1^{commit}"), latest);
  assert.equal(git("rev-parse", "v1.1^{commit}"), latest);
  assert.equal(git("rev-parse", "v1.0^{commit}"), maintenance);
  release("v2.0.0-rc.1");
  assert.equal(git("tag", "--list", "v2"), "");
  assert.equal(git("--git-dir", remote, "rev-parse", "v1^{commit}"), latest);
});
