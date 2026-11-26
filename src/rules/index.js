import { evaluateSymlinkRules } from "./symlinks.js";
import { evaluateTreeHygieneRules } from "./tree-hygiene.js";
import { MAX_FINDINGS } from "./types.js";

/** @typedef {import("../tree.js").TreeEntry} TreeEntry */
/** @typedef {import("../blobs.js").BlobData} BlobData */
/** @typedef {import("../stubs.js").WorkingStub} WorkingStub */
/** @typedef {import("./types.js").Finding} Finding */
/** @typedef {import("./types.js").AuditResult} AuditResult */

/**
 * @typedef {object} IgnoreRule
 * @property {string} [rule]
 * @property {string} [path]
 * @property {string} reason
 */

/**
 * Builds fast lookup sets of exact files and directory prefixes in the tree.
 *
 * @param {TreeEntry[]} entries
 * @returns {{ exactFiles: Set<string>, exactDirs: Set<string> }}
 */
export function buildTreeIndex(entries) {
  /** @type {Set<string>} */
  const exactFiles = new Set();
  /** @type {Set<string>} */
  const exactDirs = new Set();

  for (const entry of entries) {
    exactFiles.add(entry.path);
    let idx = entry.path.indexOf("/");
    while (idx !== -1) {
      exactDirs.add(entry.path.slice(0, idx));
      idx = entry.path.indexOf("/", idx + 1);
    }
  }

  return { exactFiles, exactDirs };
}

/**
 * Evaluates all safetree rules against a parsed tree, blobs, and optional stubs.
 *
 * @param {{
 *   target: string,
 *   rev: string,
 *   entries: TreeEntry[],
 *   blobs: Map<string, BlobData>,
 *   stubs?: WorkingStub[],
 *   truncated?: boolean,
 *   ignore?: IgnoreRule[]
 * }} ctx
 * @returns {AuditResult}
 */
export function evaluateAllRules(ctx) {
  const { exactFiles, exactDirs } = buildTreeIndex(ctx.entries);
  const symlinkFindings = evaluateSymlinkRules(ctx.entries, ctx.blobs, exactFiles, exactDirs);
  const { findings: hygieneFindings, summary } = evaluateTreeHygieneRules(
    ctx.entries,
    ctx.blobs,
    exactDirs,
    ctx.stubs ?? [],
    ctx.truncated ?? false
  );

  const combined = [...symlinkFindings, ...hygieneFindings];
  const ignoreList = ctx.ignore ?? [];

  /** @type {Finding[]} */
  const filtered = [];
  for (const f of combined) {
    if (isIgnored(f, ignoreList)) continue;
    filtered.push(f);
    if (filtered.length >= MAX_FINDINGS) break;
  }

  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const f of filtered) {
    if (f.severity === "error") errors += 1;
    else if (f.severity === "warn") warnings += 1;
    else infos += 1;
  }

  return {
    target: ctx.target,
    rev: ctx.rev,
    findings: filtered,
    summary,
    counts: { errors, warnings, infos }
  };
}

/**
 * @param {Finding} finding
 * @param {IgnoreRule[]} ignoreList
 * @returns {boolean}
 */
function isIgnored(finding, ignoreList) {
  for (const item of ignoreList) {
    const ruleMatch = item.rule ? item.rule === finding.id : true;
    const pathMatch = item.path ? item.path === finding.path : true;
    if (ruleMatch && pathMatch && (item.rule || item.path)) {
      return true;
    }
  }
  return false;
}
