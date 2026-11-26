import { escapeDisplay } from "../escape.js";
import { findProtectedNameHits } from "../protected-names.js";
import { auditGitmodulesContent } from "../submodules.js";

/** @typedef {import("../tree.js").TreeEntry} TreeEntry */
/** @typedef {import("../blobs.js").BlobData} BlobData */
/** @typedef {import("../stubs.js").WorkingStub} WorkingStub */
/** @typedef {import("./types.js").Finding} Finding */
/** @typedef {import("./types.js").AuditSummary} AuditSummary */

/**
 * Evaluates ST007 (protected names in paths and symlink targets),
 * ST008 (.gitmodules), ST009 (case/NFC-NFD collisions), ST010 (working stubs),
 * and ST011 (summary).
 *
 * @param {TreeEntry[]} entries
 * @param {Map<string, BlobData>} blobs
 * @param {Set<string>} exactDirs
 * @param {WorkingStub[]} stubs
 * @param {boolean} truncated
 * @returns {{ findings: Finding[], summary: AuditSummary }}
 */
export function evaluateTreeHygieneRules(entries, blobs, exactDirs, stubs, truncated) {
  /** @type {Finding[]} */
  const findings = [];

  let symlinkCount = 0;
  let executableCount = 0;
  let submoduleCount = 0;
  /** @type {Map<string, number>} */
  const dirCounts = new Map();

  // Case-insensitive and NFC-normalized collision tracking
  /** @type {Map<string, TreeEntry[]>} */
  const byCaseFold = new Map();
  /** @type {Map<string, TreeEntry[]>} */
  const byNfc = new Map();

  for (const entry of entries) {
    if (entry.mode === "120000") symlinkCount += 1;
    else if (entry.mode === "100755") executableCount += 1;
    else if (entry.mode === "160000") submoduleCount += 1;

    const slashIdx = entry.path.indexOf("/");
    const topDir = slashIdx === -1 ? "(root)" : entry.path.slice(0, slashIdx);
    dirCounts.set(topDir, (dirCounts.get(topDir) ?? 0) + 1);

    // ST007: protected names in tree paths
    for (const hit of findProtectedNameHits(entry.path)) {
      findings.push({
        id: "ST007",
        severity: hit.severity,
        title: `Protected/special filesystem name in path (${hit.kind})`,
        path: entry.displayPath,
        evidence: `${entry.displayPath} (segment: ${escapeDisplay(hit.segment)})`,
        why: hit.detail,
        nextStep: "verify before running: rename or remove the offending path component before checkout."
      });
    }

    // ST007: protected names in symlink targets
    if (entry.mode === "120000") {
      const blob = blobs.get(entry.oid);
      if (blob && !blob.missing) {
        const targetStr = blob.content.toString("utf8");
        for (const hit of findProtectedNameHits(targetStr)) {
          findings.push({
            id: "ST007",
            severity: hit.severity,
            title: `Protected/special filesystem name in symlink target (${hit.kind})`,
            path: entry.displayPath,
            evidence: `${symTargetEvidence(entry.displayPath, blob.content)} (segment: ${escapeDisplay(hit.segment)})`,
            why: hit.detail,
            nextStep: "verify before running: inspect the symlink target; symlinks targeting .git variants can redirect writes into Git metadata."
          });
        }
      }
    }

    // ST008: .gitmodules checks
    if (entry.path === ".gitmodules") {
      if (entry.mode === "120000") {
        findings.push({
          id: "ST008",
          severity: "warn",
          title: ".gitmodules is a symbolic link",
          path: entry.displayPath,
          evidence: ".gitmodules has mode 120000 (symlink)",
          why: "A symlinked .gitmodules file is rejected by `git fsck` (gitmodulesSymlink) and can trick tools into reading unintended submodule configs.",
          nextStep: "verify before running: replace .gitmodules with a regular file or remove it."
        });
      } else if (entry.type === "blob") {
        const blob = blobs.get(entry.oid);
        if (blob && !blob.missing) {
          if (blob.oversized) {
            findings.push({
              id: "ST008",
              severity: "warn",
              title: ".gitmodules exceeds size limit",
              path: entry.displayPath,
              evidence: `.gitmodules is ${blob.size} bytes`,
              why: "Oversized .gitmodules files may be malformed or used to exhaust parser memory.",
              nextStep: "verify before running: inspect .gitmodules manually before initializing submodules."
            });
          } else {
            for (const sub of auditGitmodulesContent(blob.content)) {
              findings.push({
                id: "ST008",
                severity: sub.severity,
                title: sub.title,
                path: entry.displayPath,
                evidence: sub.evidence,
                why: sub.why,
                nextStep: sub.nextStep,
                lowConfidence: sub.lowConfidence
              });
            }
          }
        }
      }
    }

    // Collect collision buckets for ST009
    const caseKey = entry.path.toLowerCase();
    const caseBucket = byCaseFold.get(caseKey);
    if (caseBucket) {
      caseBucket.push(entry);
    } else {
      byCaseFold.set(caseKey, [entry]);
    }

    const nfcKey = entry.path.normalize("NFC");
    if (nfcKey !== entry.path || byNfc.has(nfcKey)) {
      const nfcBucket = byNfc.get(nfcKey);
      if (nfcBucket) {
        nfcBucket.push(entry);
      } else {
        byNfc.set(nfcKey, [entry]);
      }
    } else {
      byNfc.set(nfcKey, [entry]);
    }
  }

  // ST009: Case-insensitive collisions where at least one path is a symlink or dir prefix
  const reportedCollisionPairs = new Set();
  for (const bucket of byCaseFold.values()) {
    if (bucket.length < 2) continue;
    const hasSymlinkOrDir = bucket.some(
      (e) => e.mode === "120000" || exactDirs.has(e.path)
    );
    if (!hasSymlinkOrDir) continue;
    const pairKey = bucket.map((e) => e.path).sort().join("\0");
    if (reportedCollisionPairs.has(pairKey)) continue;
    reportedCollisionPairs.add(pairKey);

    const first = /** @type {TreeEntry} */ (bucket[0]);
    findings.push({
      id: "ST009",
      severity: "warn",
      title: "Case-insensitive path collision involving a symlink or directory",
      path: first.displayPath,
      evidence: bucket.map((e) => `${e.displayPath} (${e.mode})`).join(" vs "),
      why: "On case-insensitive filesystems (Windows NTFS, default macOS APFS), colliding paths overwrite or redirect each other during checkout.",
      nextStep: "verify before running: disambiguate the colliding paths before checking out on Windows or macOS."
    });
  }

  // ST009: NFC/NFD Unicode normalization collisions
  for (const bucket of byNfc.values()) {
    if (bucket.length < 2) continue;
    const hasSymlinkOrDir = bucket.some(
      (e) => e.mode === "120000" || exactDirs.has(e.path)
    );
    if (!hasSymlinkOrDir) continue;
    const pairKey = bucket.map((e) => e.path).sort().join("\0");
    if (reportedCollisionPairs.has(pairKey)) continue;
    reportedCollisionPairs.add(pairKey);

    const first = /** @type {TreeEntry} */ (bucket[0]);
    findings.push({
      id: "ST009",
      severity: "warn",
      title: "Unicode normalization (NFC/NFD) path collision involving a symlink or directory",
      path: first.displayPath,
      evidence: bucket.map((e) => `${e.displayPath} (${e.mode})`).join(" vs "),
      why: "macOS HFS+/APFS normalizes Unicode paths, which can cause canonically equivalent names to collide during checkout.",
      nextStep: "verify before running: normalize filenames to NFC and remove duplicate entries."
    });
  }

  // ST010: Working-tree text stubs
  for (const stub of stubs) {
    findings.push({
      id: "ST010",
      severity: "error",
      title: "Working-tree symlink was checked out as a plain text stub",
      path: stub.displayPath,
      evidence: `${stub.displayPath} is mode 120000 in index, regular file on disk containing: ${stub.content}`,
      why: "Git checked out this symlink as a plain text file (typically because core.symlinks=false on Windows). Tools reading it will see the path string instead of the target file.",
      nextStep: "verify before running: enable Developer Mode and `git config core.symlinks true`, then re-checkout or restore the file."
    });
  }

  const largestDirectories = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([directory, count]) => ({ directory: escapeDisplay(directory), count }));

  /** @type {AuditSummary} */
  const summary = {
    totalEntries: entries.length,
    symlinks: symlinkCount,
    executables: executableCount,
    submodules: submoduleCount,
    truncated,
    largestDirectories
  };

  // ST011: Always emit info summary
  const dirSummary =
    largestDirectories.length > 0
      ? largestDirectories.map((d) => `${d.directory}:${d.count}`).join(", ")
      : "none";
  findings.push({
    id: "ST011",
    severity: "info",
    title: "Tree summary",
    path: null,
    evidence: `entries=${entries.length}${truncated ? " (truncated)" : ""}, symlinks=${symlinkCount}, executables=${executableCount}, submodules=${submoduleCount}, top-dirs=[${dirSummary}]`,
    why: "Inventory of tree entry types and top-level directory sizes.",
    nextStep: "verify before running: review any error/warn findings above before checkout."
  });

  return { findings, summary };
}

/**
 * @param {string} displayPath
 * @param {Buffer} targetBuf
 * @returns {string}
 */
function symTargetEvidence(displayPath, targetBuf) {
  return `${displayPath} -> ${escapeDisplay(targetBuf)}`;
}
