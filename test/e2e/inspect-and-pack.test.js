import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runCli } from "../../src/cli.js";
import { inspectRemoteRepo } from "../../src/index.js";
import { createFixtureRepo } from "../helpers/make-repo.js";

const execFileAsync = promisify(execFile);

test("inspect: audits local bare hostile repo without checkout and cleans up temp dir", async () => {
  const hostile = await createFixtureRepo(
    [
      { path: "README.md", mode: "100644", content: "hello\n" },
      { path: "unc-link", mode: "120000", content: "\\\\evil\\share\\pwn" },
      { path: "sym", mode: "120000", content: "README.md" },
      { path: "sym/post-checkout", mode: "100755", content: "#!/bin/sh\ntouch PWNED\n" },
      {
        path: ".gitmodules",
        mode: "100644",
        content: '[submodule "x"]\n\tpath = sub\n\turl = ext::sh -c touch\\ PWNED\n'
      }
    ],
    { bare: true, rawTree: true }
  );

  let keptRoot = "";
  try {
    // 1. Run with --keep to prove ZERO working-tree files are checked out
    const result = await inspectRemoteRepo(hostile.repoDir, {
      allowLocal: true,
      keep: true,
      onKeep: (dir) => {
        keptRoot = dir;
      },
      env: hostile.env
    });

    assert.ok(result.findings.some((f) => f.id === "ST002"));
    assert.ok(result.findings.some((f) => f.id === "ST006"));
    assert.ok(result.findings.some((f) => f.id === "ST008"));

    const cloneDir = path.join(keptRoot, "repo");
    const entries = await fs.readdir(cloneDir);
    assert.deepEqual(entries, [".git"], "No working tree files may be checked out");
  } finally {
    if (keptRoot) {
      await fs.rm(keptRoot, { recursive: true, force: true });
    }
    await hostile.cleanup();
  }
});

test("inspect: rejects option injection and ext:: URLs without creating marker files", async () => {
  const markerDir = await fs.mkdtemp(path.join(os.tmpdir(), "safetree-marker-"));
  const markerFile = path.join(markerDir, "pwned.txt");
  try {
    const errOut = [];
    const code1 = await runCli(["inspect", `--upload-pack=touch ${markerFile}`], {
      stdout: () => {},
      stderr: (s) => errOut.push(s)
    });
    assert.equal(code1, 2);

    const code2 = await runCli(["inspect", `ext::sh -c touch\\ ${markerFile}`], {
      stdout: () => {},
      stderr: (s) => errOut.push(s)
    });
    assert.equal(code2, 2);

    await assert.rejects(() => fs.stat(markerFile));
  } finally {
    await fs.rm(markerDir, { recursive: true, force: true });
  }
});

test("e2e: packed tarball smoke test on healthy and broken fixture repos", async () => {
  const pkgRoot = path.resolve(import.meta.dirname, "..", "..");
  const packDir = await fs.mkdtemp(path.join(os.tmpdir(), "safetree-pack-"));
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "safetree-npmcache-"));
  const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "safetree-install-"));
  const healthy = await createFixtureRepo([
    { path: "index.js", mode: "100644", content: "console.log('ok');\n" }
  ]);
  const broken = await createFixtureRepo([
    { path: "bad-link", mode: "120000", content: "/etc/passwd" }
  ]);

  try {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const { stdout: packOut } = await execFileAsync(
      npmCmd,
      ["pack", "--pack-destination", packDir, "--cache", cacheDir],
      { cwd: pkgRoot, shell: process.platform === "win32", windowsHide: true }
    );
    const tgzName = packOut.trim().split(/\r?\n/).pop()?.trim();
    assert.ok(tgzName && tgzName.endsWith(".tgz"), `Unexpected pack output: ${packOut}`);
    const tgzPath = path.join(packDir, tgzName);

    // Extract tarball using tar (built-in on Windows 10+, macOS, Linux)
    await execFileAsync("tar", ["-xzf", tgzPath, "-C", installDir], { windowsHide: true });
    const cliBin = path.join(installDir, "package", "bin", "safetree.js");

    // Healthy -> exit 0
    const healthyRes = await execFileAsync(process.execPath, [cliBin, healthy.repoDir, "--no-color"], {
      env: healthy.env,
      windowsHide: true
    });
    assert.ok(healthyRes.stdout.includes("0 error(s)"));

    // Broken -> exit 1
    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [cliBin, broken.repoDir, "--no-color"], {
          env: broken.env,
          windowsHide: true
        }),
      (/** @type {{ code?: number }} */ e) => e.code === 1
    );
  } finally {
    await fs.rm(packDir, { recursive: true, force: true });
    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.rm(installDir, { recursive: true, force: true });
    await healthy.cleanup();
    await broken.cleanup();
  }
});
