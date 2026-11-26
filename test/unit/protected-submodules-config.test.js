import assert from "node:assert/strict";
import test from "node:test";
import { validateConfigObject } from "../../src/config.js";
import { findProtectedNameHits } from "../../src/protected-names.js";
import { auditGitmodulesContent } from "../../src/submodules.js";

test("protected-names detects NTFS and HFS+ .git variants and Windows device names", () => {
  assert.ok(findProtectedNameHits(".git/config").some((h) => h.kind === "dotgit-exact"));
  assert.ok(findProtectedNameHits("sub/.GIT/hooks").some((h) => h.kind === "dotgit-exact"));
  assert.ok(findProtectedNameHits(".git./config").some((h) => h.kind === "ntfs-dotgit"));
  assert.ok(findProtectedNameHits(".git /config").some((h) => h.kind === "ntfs-dotgit"));
  assert.ok(findProtectedNameHits("GIT~1/config").some((h) => h.kind === "ntfs-dotgit"));
  assert.ok(findProtectedNameHits(".git::$DATA").some((h) => h.kind === "ntfs-dotgit"));
  assert.ok(findProtectedNameHits(".g\u200cit/hooks").some((h) => h.kind === "hfs-dotgit"));
  assert.ok(findProtectedNameHits(".g\ufeffit/hooks").some((h) => h.kind === "hfs-dotgit"));
  assert.ok(findProtectedNameHits("docs/NUL.txt").some((h) => h.kind === "windows-device-name"));
  assert.ok(findProtectedNameHits("COM1").some((h) => h.kind === "windows-device-name"));
  assert.equal(findProtectedNameHits("src/index.js").length, 0);
  assert.equal(findProtectedNameHits(".github/workflows/ci.yml").length, 0);
  assert.equal(findProtectedNameHits(".gitmodules").length, 0);
});

test("auditGitmodulesContent detects ext::, fd::, leading -, control chars, file://, and .. paths", () => {
  const content = Buffer.from(`
[submodule "evil1"]
  path = ../outside
  url = ext::sh -c whoami
[submodule "evil2"]
  path = ok
  url = -oProxyCommand=evil
[submodule "evil3"]
  path = /abs/path
  url = fd::17
[submodule "local"]
  path = vendor/lib
  url = file:///tmp/repo
[submodule "ctrl"]
  path = vendor/ctrl
  url = https://example.com/\x07bad
[submodule "good"]
  path = vendor/good
  url = https://github.com/org/good.git
`);
  const hits = auditGitmodulesContent(content);
  assert.ok(hits.some((h) => h.evidence.includes("ext::")));
  assert.ok(hits.some((h) => h.evidence.includes("fd::")));
  assert.ok(hits.some((h) => h.evidence.includes("-oProxyCommand")));
  assert.ok(hits.some((h) => h.evidence.includes("file://") && h.lowConfidence));
  assert.ok(hits.some((h) => h.title.includes("control characters")));
  assert.ok(hits.some((h) => h.evidence.includes("../outside")));
  assert.ok(hits.some((h) => h.evidence.includes("/abs/path")));
  assert.equal(hits.some((h) => h.evidence.includes("good.git")), false);
});

test("validateConfigObject enforces strict schema and rejects prototype pollution", () => {
  const valid = validateConfigObject({
    failOn: "warn",
    maxEntries: 50000,
    ignore: [{ rule: "ST004", path: "docs/link", reason: "Generated at build time" }]
  });
  assert.equal(valid.failOn, "warn");
  assert.equal(valid.maxEntries, 50000);
  assert.equal(valid.ignore.length, 1);

  assert.throws(() => validateConfigObject([]), /JSON object/);
  assert.throws(() => validateConfigObject({ unknownKey: 1 }), /Unknown config key/);
  assert.throws(() => validateConfigObject(JSON.parse('{"__proto__":{}}')), /Forbidden/);
  assert.throws(() => validateConfigObject({ failOn: "bogus" }), /failOn/);
  assert.throws(() => validateConfigObject({ ignore: [{ rule: "ST004", reason: "" }] }), /reason/);
  assert.throws(() => validateConfigObject({ ignore: [{ reason: "missing target" }] }), /rule.*path/);
});
