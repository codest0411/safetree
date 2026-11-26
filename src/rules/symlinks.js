import path from "node:path";
import { escapeDisplay } from "../escape.js";
import { analyzeSymlinkTarget } from "../paths.js";

/** @typedef {import("../tree.js").TreeEntry} TreeEntry */
/** @typedef {import("../blobs.js").BlobData} BlobData */
/** @typedef {import("./types.js").Finding} Finding */

const HIGH_RISK_WINDOWS_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env", ".xml",
  ".md", ".txt", ".pem", ".crt", ".key"
]);

const HIGH_RISK_WINDOWS_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "cargo.toml",
  "pyproject.toml",
  "go.mod",
  "makefile",
  "dockerfile",
  "license",
  "license.md",
  "license.txt",
  ".npmrc",
  ".yarnrc",
  ".eslintrc",
  ".prettierrc"
]);

/**
 * Checks if a symlink path looks like source code, config, license, or manifest.
 *
 * @param {string} repoPath
 * @returns {boolean}
 */
export function isHighImpactWindowsPath(repoPath) {
  const base = path.posix.basename(repoPath).toLowerCase();
  if (HIGH_RISK_WINDOWS_BASENAMES.has(base)) return true;
  const ext = path.posix.extname(base);
  return HIGH_RISK_WINDOWS_EXTENSIONS.has(ext);
}

/**
 * Evaluates symlink-related rules ST001–ST006.
 *
 * @param {TreeEntry[]} entries
 * @param {Map<string, BlobData>} blobs
 * @param {Set<string>} exactFiles
 * @param {Set<string>} exactDirs
 * @returns {Finding[]}
 */
export function evaluateSymlinkRules(entries, blobs, exactFiles, exactDirs) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {TreeEntry[]} */
  const symlinks = [];
  /** @type {Map<string, TreeEntry>} */
  const symlinkByLowerPath = new Map();

  for (const entry of entries) {
    if (entry.mode === "120000") {
      symlinks.push(entry);
      const lower = entry.path.toLowerCase();
      if (!symlinkByLowerPath.has(lower)) {
        symlinkByLowerPath.set(lower, entry);
      }
    }
  }

  /** @type {Array<{ displayPath: string, kind: "file" | "directory" | "unknown", highImpact: boolean }>} */
  const windowsImpacts = [];

  for (const sym of symlinks) {
    const blob = blobs.get(sym.oid);
    if (!blob || blob.missing) continue;

    if (blob.oversized) {
      findings.push({
        id: "ST003",
        severity: "error",
        title: "Oversized symlink target (> 4096 bytes)",
        path: sym.displayPath,
        evidence: `${sym.displayPath} -> (${blob.size} bytes, truncated)`,
        why: "Symlink targets exceeding 4096 bytes exceed POSIX PATH_MAX and may indicate malformed or hostile objects.",
        nextStep: "verify before running: inspect the raw symlink blob with `git cat-file -p <oid>`."
      });
      continue;
    }

    const rawTarget = blob.content.toString("utf8");
    const displayTarget = escapeDisplay(blob.content);
    const analysis = analyzeSymlinkTarget(sym.path, rawTarget);

    if (analysis.kind === "unc") {
      findings.push({
        id: "ST002",
        severity: "error",
        title: "Symlink target is a UNC/network path",
        path: sym.displayPath,
        evidence: `${sym.displayPath} -> ${displayTarget}`,
        why: "On Windows, resolving a UNC symlink target can trigger an outbound SMB connection and leak NTLMv2 credentials to a remote server (see docs/GIT-BEHAVIOR.md).",
        nextStep: "verify before running: do not check out on Windows; remove or replace the UNC symlink."
      });
      windowsImpacts.push({
        displayPath: sym.displayPath,
        kind: "unknown",
        highImpact: isHighImpactWindowsPath(sym.path)
      });
      continue;
    }

    if (analysis.kind === "absolute") {
      findings.push({
        id: "ST001",
        severity: "error",
        title: "Symlink has an absolute target",
        path: sym.displayPath,
        evidence: `${sym.displayPath} -> ${displayTarget}`,
        why: "Absolute symlink targets point outside the repository to host filesystem paths and behave unpredictably across machines.",
        nextStep: "verify before running: replace with a relative in-repo symlink or remove it."
      });
      windowsImpacts.push({
        displayPath: sym.displayPath,
        kind: "unknown",
        highImpact: isHighImpactWindowsPath(sym.path)
      });
      continue;
    }

    if (analysis.kind === "escape") {
      findings.push({
        id: "ST003",
        severity: "error",
        title: "Symlink target resolves outside repository root",
        path: sym.displayPath,
        evidence: `${sym.displayPath} -> ${displayTarget}`,
        why: "A symlink that traverses above the repository root can escape the worktree when followed by tools or vulnerable Git clients.",
        nextStep: "verify before running: check the symlink target and keep all targets inside the repository."
      });
      windowsImpacts.push({
        displayPath: sym.displayPath,
        kind: "unknown",
        highImpact: isHighImpactWindowsPath(sym.path)
      });
      continue;
    }

    // In-tree target: flag mixed separators if present
    if (analysis.hasMixedSeparators) {
      findings.push({
        id: "ST003",
        severity: "error",
        title: "Symlink target uses mixed path separators ('/' and '\\')",
        path: sym.displayPath,
        evidence: `${sym.displayPath} -> ${displayTarget}`,
        why: "Mixed '/' and '\\' separators are interpreted differently on POSIX vs Windows and can cause path-resolution confusion.",
        nextStep: "verify before running: normalize the symlink target to POSIX '/' separators."
      });
    }

    const resolved = analysis.resolvedPath ?? "";
    let targetKind = /** @type {"file" | "directory" | "unknown"} */ ("unknown");
    if (resolved === "") {
      targetKind = "directory";
    } else if (exactDirs.has(resolved)) {
      targetKind = "directory";
    } else if (exactFiles.has(resolved)) {
      targetKind = "file";
    } else {
      findings.push({
        id: "ST004",
        severity: "warn",
        title: "Dangling symlink (target not found in tree)",
        path: sym.displayPath,
        evidence: `${sym.displayPath} -> ${displayTarget} (resolved: ${escapeDisplay(resolved)})`,
        why: "The symlink target does not exist in this tree, which breaks tools that read it and may indicate a missing file or external reference.",
        nextStep: "verify before running: confirm whether the target file is missing or generated at build time."
      });
    }

    windowsImpacts.push({
      displayPath: sym.displayPath,
      kind: targetKind,
      highImpact: isHighImpactWindowsPath(sym.path)
    });
  }

  // ST005: Windows core.symlinks=false impact report
  if (windowsImpacts.length > 0) {
    const anyHighImpact = windowsImpacts.some((w) => w.highImpact);
    const cap = 20;
    const sample = windowsImpacts
      .slice(0, cap)
      .map((w) => `${w.displayPath} (${w.kind}${w.highImpact ? ", high-impact" : ""})`)
      .join("; ");
    const extra = windowsImpacts.length > cap ? `; ... and ${windowsImpacts.length - cap} more` : "";
    findings.push({
      id: "ST005",
      severity: anyHighImpact ? "warn" : "info",
      title: `Windows impact: ${windowsImpacts.length} symlink(s) become plain text files when core.symlinks=false`,
      path: null,
      evidence: `${sample}${extra}`,
      why: "On Windows with core.symlinks=false (default without Developer Mode/admin), Git checks out every symlink as a plain text file containing the target path string, silently breaking manifests, configs, and source imports.",
      nextStep: "verify before running: enable Developer Mode + `git config core.symlinks true` before checkout on Windows, or avoid symlinks in cross-platform repos."
    });
  }

  // ST006: Entry behind a symlink in the same tree (including case-insensitive variants)
  if (symlinkByLowerPath.size > 0) {
    for (const entry of entries) {
      const segments = entry.path.split("/");
      let prefixLower = "";
      for (let i = 0; i < segments.length - 1; i += 1) {
        const seg = /** @type {string} */ (segments[i]);
        prefixLower = prefixLower ? `${prefixLower}/${seg.toLowerCase()}` : seg.toLowerCase();
        const parentSym = symlinkByLowerPath.get(prefixLower);
        if (parentSym) {
          const isExactCase = entry.path.startsWith(parentSym.path + "/");
          findings.push({
            id: "ST006",
            severity: "error",
            title: isExactCase
              ? "Tree entry sits behind a symlink in the same tree"
              : "Tree entry sits behind a case-variant symlink in the same tree",
            path: entry.displayPath,
            evidence: `symlink '${parentSym.displayPath}' shadows parent of '${entry.displayPath}'`,
            why: "Having both a symlink and entries beneath that path (or a case-variant of it) in the same tree is a classic checkout-redirection exploit pattern (see CVE-2024-32002).",
            nextStep: "verify before running: do not check out this repository; inspect both the symlink and the shadowed path."
          });
          break;
        }
      }
    }
  }

  return findings;
}
