import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { parseCatFileBatchOutput } from "../../src/blobs.js";
import { analyzeSymlinkTarget } from "../../src/paths.js";
import { parseLsTreeBuffer } from "../../src/tree.js";

test("parseLsTreeBuffer handles hostile names, invalid UTF-8, and maxEntries truncation", () => {
  const rec1 = Buffer.concat([
    Buffer.from("120000 blob " + "a".repeat(40) + "\t"),
    Buffer.from("dir/\x1b[31m\n\t\"\\-bad"),
    Buffer.from([0xff, 0x00])
  ]);
  const rec2 = Buffer.from("100644 blob " + "b".repeat(40) + "\tnormal.txt\0");
  const combined = Buffer.concat([rec1, rec2]);

  const full = parseLsTreeBuffer(combined, 100);
  assert.equal(full.truncated, false);
  assert.equal(full.entries.length, 2);
  assert.equal(full.entries[0]?.displayPath.includes("\n"), false);
  assert.equal(full.entries[0]?.displayPath.includes("\x1b"), false);
  assert.ok(full.entries[0]?.displayPath.includes("\\xff"));

  const capped = parseLsTreeBuffer(combined, 1);
  assert.equal(capped.truncated, true);
  assert.equal(capped.entries.length, 1);
});

test("parseCatFileBatchOutput handles missing, oversized, and truncated streams", () => {
  const oid1 = "1".repeat(40);
  const oid2 = "2".repeat(40);
  const oid3 = "3".repeat(40);
  const bigPayload = Buffer.alloc(5000, 0x41);

  const stream = Buffer.concat([
    Buffer.from(`${oid1} missing\n`),
    Buffer.from(`${oid2} blob 5000\n`),
    bigPayload,
    Buffer.from("\n"),
    Buffer.from(`${oid3} blob 100\ntruncated`)
  ]);

  const parsed = parseCatFileBatchOutput(stream, 4096);
  assert.equal(parsed.get(oid1)?.missing, true);
  assert.equal(parsed.get(oid2)?.oversized, true);
  assert.equal(parsed.get(oid2)?.content.length, 4096);
  assert.equal(parsed.get(oid3)?.missing, false);
  assert.equal(parsed.get(oid3)?.content.toString("utf8"), "truncated");
});

test("fuzz: parseLsTreeBuffer and analyzeSymlinkTarget never throw on random bytes", () => {
  const start = Date.now();
  for (let i = 0; i < 300; i += 1) {
    const rand = crypto.randomBytes(256);
    const res = parseLsTreeBuffer(rand, 1000);
    assert.ok(Array.isArray(res.entries));

    const randPath = rand.subarray(0, 64).toString("utf8");
    const randTarget = rand.subarray(64, 192).toString("utf8");
    const analysis = analyzeSymlinkTarget(randPath, randTarget);
    assert.ok(["unc", "absolute", "escape", "in-tree"].includes(analysis.kind));
  }
  assert.ok(Date.now() - start < 5000);
});

test("scale: parseLsTreeBuffer handles 1,000,000 synthetic entries within time and memory bounds", () => {
  const oid = "a".repeat(40);
  const line = Buffer.from(`100644 blob ${oid}\tdir/file_000000.txt\0`);
  const count = 1_000_000;
  const bigBuf = Buffer.allocUnsafe(line.length * count);
  for (let i = 0; i < count; i += 1) {
    line.copy(bigBuf, i * line.length);
  }

  const start = Date.now();
  const res = parseLsTreeBuffer(bigBuf, count);
  const elapsed = Date.now() - start;
  assert.equal(res.entries.length, count);
  assert.equal(res.truncated, false);
  assert.ok(elapsed < 30_000, `Expected < 30s, took ${elapsed}ms`);
});
