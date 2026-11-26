import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import { classifyGitFailure, isGitVersionSupported, parseGitVersion } from "../../src/git.js";
import { formatReport } from "../../src/reporters/index.js";
import { createFixtureRepo, createIsolatedEnv } from "../helpers/make-repo.js";

test("reporters: human, json, github, sarif format outputs cleanly and escape hostile chars", () => {
  const sampleResult = {
    target: ".",
    rev: "HEAD",
    findings: [
      {
        id: "ST001",
        severity: /** @type {const} */ ("error"),
        title: "Symlink has an absolute target",
        path: "dir/bad\\n%name",
        evidence: "dir/bad\\n%name -> /etc/passwd",
        why: "Points outside repo.",
        nextStep: "verify before running: remove it."
      }
    ],
    summary: {
      totalEntries: 1,
      symlinks: 1,
      executables: 0,
      submodules: 0,
      truncated: false,
      largestDirectories: [{ directory: "dir", count: 1 }]
    },
    counts: { errors: 1, warnings: 0, infos: 0 }
  };

  const human = formatReport(sampleResult, "human", { color: false });
  assert.ok(human.includes("[ERROR] ST001"));
  assert.equal(human.includes("\x1b["), false);

  const json = JSON.parse(formatReport(sampleResult, "json"));
  assert.equal(json.counts.errors, 1);

  const gh = formatReport(sampleResult, "github");
  assert.ok(gh.startsWith("::error file="));
  assert.ok(gh.includes("%25"));

  const sarif = JSON.parse(formatReport(sampleResult, "sarif"));
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results[0].ruleId, "ST001");
});

test("CLI exit codes: 0, 1, 2, --help, --version, empty repo, .safetreerc.json", async () => {
  const out = [];
  const err = [];
  assert.equal(await runCli(["--help"], { stdout: (s) => out.push(s), stderr: (s) => err.push(s) }), 0);
  assert.ok(out.join("\n").includes("Usage:"));

  out.length = 0;
  assert.equal(await runCli(["--version"], { stdout: (s) => out.push(s), stderr: (s) => err.push(s) }), 0);
  assert.equal(out[0], "0.1.0");

  // Not a git repo -> exit 2
  const nonRepo = await fs.mkdtemp(path.join(os.tmpdir(), "safetree-nonrepo-"));
  try {
    const code = await runCli([nonRepo], { stdout: () => {}, stderr: (s) => err.push(s) });
    assert.equal(code, 2);
  } finally {
    await fs.rm(nonRepo, { recursive: true, force: true });
  }

  // Empty repo (0 commits) -> exit 0
  const emptyRepo = await createFixtureRepo([]);
  try {
    const code = await runCli([emptyRepo.repoDir, "--format", "json"], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: emptyRepo.env
    });
    assert.equal(code, 0);
  } finally {
    await emptyRepo.cleanup();
  }

  // Broken repo with --fail-on error / warn / never and .safetreerc.json ignore
  const broken = await createFixtureRepo([
    { path: "bad", mode: "120000", content: "/etc/passwd" }
  ]);
  try {
    assert.equal(
      await runCli([broken.repoDir, "--no-color"], {
        stdout: () => {},
        stderr: () => {},
        env: broken.env
      }),
      1
    );
    assert.equal(
      await runCli([broken.repoDir, "--fail-on", "never"], {
        stdout: () => {},
        stderr: () => {},
        env: broken.env
      }),
      0
    );

    const cfgPath = path.join(broken.repoDir, ".safetreerc.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        failOn: "error",
        ignore: [{ rule: "ST001", path: "bad", reason: "Intentional test" }]
      }),
      "utf8"
    );
    assert.equal(
      await runCli([broken.repoDir, "--config", cfgPath], {
        stdout: () => {},
        stderr: () => {},
        env: broken.env
      }),
      0
    );
  } finally {
    await broken.cleanup();
  }
});

test("git missing, git too old, and ownership refusal handling", async () => {
  // Missing git via empty PATH
  const iso = await createIsolatedEnv("safetree-nogit-");
  try {
    const err = [];
    const code = await runCli(["."], {
      stdout: () => {},
      stderr: (s) => err.push(s),
      env: { ...iso.env, PATH: iso.root }
    });
    assert.equal(code, 2);
    assert.ok(err.join("\n").includes("GIT_MISSING") || err.join("\n").includes("not found"));
  } finally {
    await iso.cleanup();
  }

  // Too-old git version check
  assert.equal(isGitVersionSupported(/** @type {[number, number, number]} */ (parseGitVersion("git version 2.10.0"))), false);
  assert.equal(isGitVersionSupported(/** @type {[number, number, number]} */ (parseGitVersion("git version 2.25.0"))), true);

  // Ownership refusal classification
  const ownershipErr = classifyGitFailure(
    "fatal: detected dubious ownership in repository at '/some/path'",
    "fallback"
  );
  assert.equal(ownershipErr.code, "OWNERSHIP_REFUSAL");
  assert.ok(ownershipErr.message.includes("safe.directory"));
});
