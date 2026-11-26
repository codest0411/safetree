/**
 * Classifies a symlink target and resolves it lexically relative to the
 * symlink's directory inside the repository.
 *
 * Uses linear-time string operations only (no backtracking regexes).
 */

/**
 * @typedef {object} TargetAnalysis
 * @property {"unc" | "absolute" | "escape" | "in-tree"} kind
 * @property {string | null} resolvedPath
 * @property {boolean} hasBackslash
 * @property {boolean} hasMixedSeparators
 * @property {string | null} reason
 */

/**
 * Checks if a target string is a Windows UNC / network path.
 * Covers `\\host\share`, `//host/share`, `\\?\UNC\...`, `\\.\...`.
 *
 * @param {string} target
 * @returns {boolean}
 */
export function isUncPath(target) {
  if (target.startsWith("\\\\") || target.startsWith("//")) {
    return true;
  }
  return false;
}

/**
 * Checks if a target string is an absolute path (POSIX `/...` or Windows drive `C:\...` / `C:/...` or `C:`).
 * Note: UNC paths (`//...` or `\\...`) should be checked with `isUncPath` first.
 *
 * @param {string} target
 * @returns {boolean}
 */
export function isAbsoluteTarget(target) {
  if (target.startsWith("/") || target.startsWith("\\")) {
    return true;
  }
  if (target.length >= 2 && target[1] === ":") {
    const ch = target.charCodeAt(0);
    const isAsciiAlpha = (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
    if (isAsciiAlpha) return true;
  }
  return false;
}

/**
 * Splits a relative path on `/` and `\` without regex backtracking.
 *
 * @param {string} p
 * @returns {string[]}
 */
export function splitPathSegments(p) {
  /** @type {string[]} */
  const parts = [];
  let start = 0;
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === "/" || c === "\\") {
      if (i > start) {
        parts.push(p.slice(start, i));
      }
      start = i + 1;
    }
  }
  if (start < p.length) {
    parts.push(p.slice(start));
  }
  return parts;
}

/**
 * Lexically resolves `target` from `symlinkRepoPath` (e.g. `"a/b/link"`).
 *
 * @param {string} symlinkRepoPath
 * @param {string} target
 * @returns {TargetAnalysis}
 */
export function analyzeSymlinkTarget(symlinkRepoPath, target) {
  const hasSlash = target.includes("/");
  const hasBackslash = target.includes("\\");
  const hasMixedSeparators = hasSlash && hasBackslash;

  if (isUncPath(target)) {
    return {
      kind: "unc",
      resolvedPath: null,
      hasBackslash,
      hasMixedSeparators,
      reason: "UNC/network share path"
    };
  }

  if (isAbsoluteTarget(target)) {
    return {
      kind: "absolute",
      resolvedPath: null,
      hasBackslash,
      hasMixedSeparators,
      reason: "Absolute path"
    };
  }

  const baseSegments = splitPathSegments(symlinkRepoPath);
  // Remove the symlink filename itself to get its parent directory
  baseSegments.pop();

  const targetSegments = splitPathSegments(target);
  const stack = [...baseSegments];

  for (const seg of targetSegments) {
    if (seg === "." || seg === "") {
      continue;
    }
    if (seg === "..") {
      if (stack.length === 0) {
        return {
          kind: "escape",
          resolvedPath: null,
          hasBackslash,
          hasMixedSeparators,
          reason: "Target traverses above repository root"
        };
      }
      stack.pop();
    } else {
      stack.push(seg);
    }
  }

  return {
    kind: "in-tree",
    resolvedPath: stack.join("/"),
    hasBackslash,
    hasMixedSeparators,
    reason: null
  };
}
