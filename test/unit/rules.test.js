import assert from "node:assert/strict";
import test from "node:test";
import { auditLocalRepo } from "../../src/index.js";
import { createFixtureRepo } from "../helpers/make-repo.js";

test("rules ST001–ST011 positive detection on synthetic fixture repo", async () => {
  const fixture = await createFixtureRepo([
    { path: "README.md", mode: "100644", content: "hello\n" },
    { path: "scripts/run.sh", mode: "100755", content: "#!/bin/sh\n" },
    { path: "submod", mode: "160000" },
    // ST001: absolute target
    { path: "links/abs.txt", mode: "120000", content: "/etc/passwd" },
    // ST002: UNC target
    { path: "links/unc.txt", mode: "120000", content: "\\\\evil-server\\share\\secret" },
    // ST003: escaping root + mixed separators
    { path: "links/escape.txt", mode: "120000", content: "../../outside" },
    { path: "links/mixed.txt", mode: "120000", content: "..\\README.md" },
    // ST004: dangling
    { path: "links/dangling.txt", mode: "120000", content: "missing.txt" },
    // ST005: high-impact Windows symlink (.json)
    { path: "package.json", mode: "120000", content: "README.md" },
    // ST006: entry behind symlink (exact and case-variant)
    { path: "symdir", mode: "120000", content: "links" },
    { path: "symdir/inside.txt", mode: "100644", content: "x" },
    { path: "SYMDIR/case.txt", mode: "100644", content: "y" },
    // ST007: NTFS/HFS protected name in path and symlink target
    { path: "evil/.git./config", mode: "100644", content: "x" },
    { path: "links/to-git", mode: "120000", content: "../.g\u200cit/hooks" },
    // ST008: .gitmodules with ext::
    {
      path: ".gitmodules",
      mode: "100644",
      content: '[submodule "x"]\n\tpath = submod\n\turl = ext::sh -c id\n'
    },
    // ST009: case-insensitive collision involving symlink
    { path: "collide", mode: "120000", content: "README.md" },
    { path: "Collide", mode: "100644", content: "other" }
  ], { rawTree: true });

  try {
    const result = await auditLocalRepo(fixture.repoDir, { env: fixture.env });
    const ids = new Set(result.findings.map((f) => f.id));
    for (const expected of [
      "ST001",
      "ST002",
      "ST003",
      "ST004",
      "ST005",
      "ST006",
      "ST007",
      "ST008",
      "ST009",
      "ST011"
    ]) {
      assert.ok(ids.has(expected), `Expected finding ${expected}, got ${[...ids].join(",")}`);
    }
    assert.equal(result.summary.executables, 1);
    assert.equal(result.summary.submodules, 1);
    assert.ok(result.summary.symlinks >= 7);
    assert.ok(result.findings.some((f) => f.id === "ST005" && f.severity === "warn"));
  } finally {
    await fixture.cleanup();
  }
});

test("ST010 detects working-tree text stubs when checked out with core.symlinks=false", async () => {
  const fixture = await createFixtureRepo(
    [
      { path: "real.txt", mode: "100644", content: "actual content\n" },
      { path: "stub.txt", mode: "120000", content: "real.txt" }
    ],
    { checkoutWithSymlinksFalse: true }
  );

  try {
    const result = await auditLocalRepo(fixture.repoDir, { env: fixture.env });
    const st010 = result.findings.filter((f) => f.id === "ST010");
    assert.equal(st010.length, 1);
    assert.equal(st010[0]?.severity, "error");
    assert.ok(st010[0]?.evidence.includes("real.txt"));
  } finally {
    await fixture.cleanup();
  }
});

test("ST008 detects symlinked .gitmodules and ST009 detects NFC/NFD collisions", async () => {
  const nfc = "caf\u00e9";
  const nfd = "cafe\u0301";
  const fixture = await createFixtureRepo([
    { path: ".gitmodules", mode: "120000", content: "README.md" },
    { path: "README.md", mode: "100644", content: "ok" },
    { path: nfc, mode: "120000", content: "README.md" },
    { path: nfd, mode: "100644", content: "other" }
  ], { rawTree: true });

  try {
    const result = await auditLocalRepo(fixture.repoDir, { env: fixture.env });
    assert.ok(result.findings.some((f) => f.id === "ST008" && f.title.includes("symbolic link")));
    assert.ok(result.findings.some((f) => f.id === "ST009" && f.title.includes("NFC/NFD")));
  } finally {
    await fixture.cleanup();
  }
});

test("clean repository with valid relative symlink produces 0 errors", async () => {
  const fixture = await createFixtureRepo(
    [
      { path: "docs/guide.md", mode: "100644", content: "# Guide\n" },
      { path: "docs/alias", mode: "120000", content: "guide.md" }
    ],
    { tag: "v1.0.0" }
  );

  try {
    const result = await auditLocalRepo(fixture.repoDir, { rev: "v1.0.0", env: fixture.env });
    assert.equal(result.counts.errors, 0);
    assert.equal(result.counts.warnings, 0);
    assert.ok(result.findings.some((f) => f.id === "ST005" && f.severity === "info"));
    assert.ok(result.findings.some((f) => f.id === "ST011"));
  } finally {
    await fixture.cleanup();
  }
});
