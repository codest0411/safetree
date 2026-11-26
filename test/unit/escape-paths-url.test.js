import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { escapeDisplay, escapeGitHub, redactHomePath } from "../../src/escape.js";
import { analyzeSymlinkTarget, isAbsoluteTarget, isUncPath } from "../../src/paths.js";
import { validateInspectTarget } from "../../src/url.js";

test("escapeDisplay neutralizes control chars, ANSI, newlines, bidi, and invalid UTF-8", () => {
  const buf = Buffer.from([
    0x61, // a
    0x1b, 0x5b, 0x33, 0x31, 0x6d, // ESC[31m
    0x0a, // \n
    0x0d, // \r
    0x09, // \t
    0xff, 0xfe, // invalid UTF-8
    0xe2, 0x80, 0xae, // U+202E bidi override
    0x62 // b
  ]);
  const out = escapeDisplay(buf);
  assert.equal(out.includes("\n"), false);
  assert.equal(out.includes("\r"), false);
  assert.equal(out.includes("\x1b"), false);
  assert.ok(out.includes("\\x1b[31m"));
  assert.ok(out.includes("\\n\\r\\t"));
  assert.ok(out.includes("\\xff\\xfe"));
  assert.ok(out.includes("\\u{202e}"));
});

test("escapeGitHub escapes %, CR, LF, and property delimiters", () => {
  assert.equal(escapeGitHub("50%\r\na:b,c", false), "50%25%0D%0Aa:b,c");
  assert.equal(escapeGitHub("a:b,c", true), "a%3Ab%2Cc");
});

test("redactHomePath replaces home directory with ~", () => {
  const home = os.homedir();
  const sample = path.join(home, "projects", "foo");
  assert.ok(redactHomePath(sample).startsWith("~"));
  assert.equal(redactHomePath(home), "~");
});

test("paths: UNC, absolute, escape, and in-tree resolution", () => {
  assert.equal(isUncPath("\\\\evil\\share\\a"), true);
  assert.equal(isUncPath("//evil/share/a"), true);
  assert.equal(isUncPath("\\\\?\\UNC\\evil\\share"), true);
  assert.equal(isUncPath("relative/path"), false);

  assert.equal(isAbsoluteTarget("/etc/passwd"), true);
  assert.equal(isAbsoluteTarget("C:\\Windows\\System32"), true);
  assert.equal(isAbsoluteTarget("D:/data"), true);
  assert.equal(isAbsoluteTarget("sub/file"), false);

  assert.equal(analyzeSymlinkTarget("a/b/link", "../../c").kind, "in-tree");
  assert.equal(analyzeSymlinkTarget("a/b/link", "../../c").resolvedPath, "c");
  assert.equal(analyzeSymlinkTarget("a/b/link", "../../../outside").kind, "escape");
  assert.equal(analyzeSymlinkTarget("a/b/link", "sub\\file/x").hasMixedSeparators, true);
  assert.equal(analyzeSymlinkTarget("link", "/etc/passwd").kind, "absolute");
  assert.equal(analyzeSymlinkTarget("link", "//host/share").kind, "unc");
});

test("url validation rejects dangerous inputs and enforces --allow-local", () => {
  assert.throws(() => validateInspectTarget(""), /required/);
  assert.throws(() => validateInspectTarget("--upload-pack=evil"), /must not start with '-'/);
  assert.throws(() => validateInspectTarget("https://example.com/a b"), /whitespace/);
  assert.throws(() => validateInspectTarget("https://example.com/\x1b"), /control/);
  assert.throws(() => validateInspectTarget("ext::sh -c touch"), /forbidden/i);
  assert.throws(() => validateInspectTarget("fd::123"), /forbidden/i);
  assert.throws(() => validateInspectTarget("http://example.com/repo.git"), /Unsupported/);
  assert.throws(() => validateInspectTarget("git://example.com/repo.git"), /Unsupported/);
  assert.throws(() => validateInspectTarget("file:///tmp/repo"), /--allow-local/);
  assert.throws(() => validateInspectTarget("./local-repo"), /--allow-local/);
  assert.throws(() => validateInspectTarget("C:\\repos\\foo"), /--allow-local/);

  assert.equal(validateInspectTarget("https://github.com/org/repo.git").protocol, "https");
  assert.equal(validateInspectTarget("ssh://git@github.com/org/repo.git").protocol, "ssh");
  assert.equal(validateInspectTarget("git@github.com:org/repo.git").protocol, "ssh");
  assert.equal(
    validateInspectTarget("file:///tmp/repo", { allowLocal: true }).protocol,
    "local"
  );
  assert.equal(
    validateInspectTarget("./local-repo", { allowLocal: true }).protocol,
    "local"
  );
});
