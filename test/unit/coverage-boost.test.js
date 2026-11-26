import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import { loadConfig } from "../../src/config.js";
import { auditLocalRepo } from "../../src/index.js";
import { withTempDir } from "../../src/tempdir.js";
import { createFixtureRepo } from "../helpers/make-repo.js";

test("withTempDir always removes directory even when callback throws", async () => {
  let created = "";
  await assert.rejects(
    () =>
      withTempDir(async (dir) => {
        created = dir;
        throw new Error("boom");
      }),
    /boom/
  );
  await assert.rejects(() => fs.stat(created));
});

test("loadConfig errors on missing explicit file and invalid JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "safetree-cfg-"));
  try {
    await assert.rejects(() => loadConfig(dir, path.join(dir, "missing.json")), /Unable to read/);
    const badJson = path.join(dir, "bad.json");
    await fs.writeFile(badJson, "{not json", "utf8");
    await assert.rejects(() => loadConfig(dir, badJson), /Invalid JSON/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("CLI inspect subcommand, --fail-on warn, --max-entries, and oversized symlink", async () => {
  const repo = await createFixtureRepo(
    [
      { path: "oversized", mode: "120000", content: "a".repeat(5000) },
      { path: "dangling", mode: "120000", content: "missing" },
      { path: "a.txt", mode: "100644", content: "1" },
      { path: "b.txt", mode: "100644", content: "2" }
    ],
    { bare: true }
  );

  try {
    const out = [];
    const err = [];
    const code = await runCli(
      ["inspect", repo.repoDir, "--allow-local", "--format", "sarif", "--fail-on", "warn"],
      { stdout: (s) => out.push(s), stderr: (s) => err.push(s), env: repo.env }
    );
    assert.equal(code, 1);
    const sarif = JSON.parse(out.join("\n"));
    assert.equal(sarif.version, "2.1.0");

    // Bad CLI options -> exit 2
    assert.equal(
      await runCli(["inspect"], { stdout: () => {}, stderr: () => {} }),
      2
    );
    assert.equal(
      await runCli([".", "--format", "xml"], { stdout: () => {}, stderr: () => {} }),
      2
    );
    assert.equal(
      await runCli([".", "--max-entries", "0"], { stdout: () => {}, stderr: () => {} }),
      2
    );
    assert.equal(
      await runCli([".", "--fail-on", "bogus"], { stdout: () => {}, stderr: () => {} }),
      2
    );

    // Non-bare audit with oversized symlink
    const nonBare = await createFixtureRepo([
      { path: "oversized", mode: "120000", content: "a".repeat(5000) }
    ]);
    try {
      const res = await auditLocalRepo(nonBare.repoDir, { env: nonBare.env });
      assert.ok(res.findings.some((f) => f.id === "ST003" && f.title.includes("Oversized")));
    } finally {
      await nonBare.cleanup();
    }
  } finally {
    await repo.cleanup();
  }
});
