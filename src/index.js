import path from "node:path";
import { readBlobs } from "./blobs.js";
import { loadConfig } from "./config.js";
import { escapeDisplay } from "./escape.js";
import { ensureGitAvailable, resolveRevision } from "./git.js";
import { withInspectedClone } from "./inspect.js";
import { evaluateAllRules } from "./rules/index.js";
import { detectWorkingTreeStubs } from "./stubs.js";
import { assertValidMaxEntries, listTree } from "./tree.js";

/** @typedef {import("./rules/types.js").AuditResult} AuditResult */
/** @typedef {import("./rules/index.js").IgnoreRule} IgnoreRule */

export { SafetreeError } from "./git.js";
export { escapeDisplay, escapeGitHub, redactHomePath } from "./escape.js";
export { validateInspectTarget } from "./url.js";
export { loadConfig, validateConfigObject } from "./config.js";

/**
 * @typedef {object} AuditOptions
 * @property {string} [rev]
 * @property {number} [maxEntries]
 * @property {string} [configPath]
 * @property {IgnoreRule[]} [ignore]
 * @property {boolean} [checkStubs]
 * @property {NodeJS.ProcessEnv} [env]
 */

/**
 * Audits a local Git repository without checking anything out.
 *
 * @param {string} repoPath
 * @param {AuditOptions} [options]
 * @returns {Promise<AuditResult>}
 */
export async function auditLocalRepo(repoPath, options = {}) {
  const resolvedPath = path.resolve(repoPath);
  const rev = options.rev ?? "HEAD";
  const env = options.env;

  await ensureGitAvailable(env);

  const config = options.ignore
    ? { ignore: options.ignore, maxEntries: undefined }
    : await loadConfig(resolvedPath, options.configPath);

  const maxEntries = options.maxEntries ?? config.maxEntries ?? 1_000_000;
  assertValidMaxEntries(maxEntries);

  const { hasCommits } = await resolveRevision(resolvedPath, rev, env);
  if (!hasCommits) {
    return evaluateAllRules({
      target: ".",
      rev,
      entries: [],
      blobs: new Map(),
      stubs: [],
      truncated: false,
      ignore: config.ignore
    });
  }

  const { entries, truncated } = await listTree(resolvedPath, rev, { maxEntries, env });

  /** @type {string[]} */
  const symlinkOids = [];
  /** @type {string[]} */
  const gitmodulesOids = [];

  for (const entry of entries) {
    if (entry.mode === "120000") {
      symlinkOids.push(entry.oid);
    } else if (entry.path === ".gitmodules" && entry.type === "blob") {
      gitmodulesOids.push(entry.oid);
    }
  }

  const symlinkBlobs = await readBlobs(resolvedPath, symlinkOids, { maxBlobBytes: 4096, env });
  const gitmodulesBlobs = await readBlobs(resolvedPath, gitmodulesOids, {
    maxBlobBytes: 1024 * 1024,
    env
  });

  const blobs = new Map([...symlinkBlobs, ...gitmodulesBlobs]);

  const checkStubs = options.checkStubs ?? rev === "HEAD";
  const stubs = checkStubs ? await detectWorkingTreeStubs(resolvedPath, { env }) : [];

  return evaluateAllRules({
    target: ".",
    rev,
    entries,
    blobs,
    stubs,
    truncated,
    ignore: config.ignore
  });
}

/**
 * Safely clones a remote (or local with `allowLocal`) repository with
 * `--no-checkout` into an isolated temp directory, audits it, and cleans up.
 *
 * @param {string} urlOrPath
 * @param {AuditOptions & { allowLocal?: boolean, keep?: boolean, onKeep?: (dir: string) => void }} [options]
 * @returns {Promise<AuditResult>}
 */
export async function inspectRemoteRepo(urlOrPath, options = {}) {
  const maxEntries = options.maxEntries ?? 1_000_000;
  assertValidMaxEntries(maxEntries);

  return withInspectedClone(
    urlOrPath,
    async (cloneDir, displayTarget) => {
      const result = await auditLocalRepo(cloneDir, {
        ...options,
        checkStubs: false
      });
      return {
        ...result,
        target: escapeDisplay(displayTarget)
      };
    },
    {
      allowLocal: options.allowLocal,
      keep: options.keep,
      onKeep: options.onKeep,
      env: options.env
    }
  );
}

/**
 * Determines whether the audit result should cause a non-zero exit code.
 *
 * @param {AuditResult} result
 * @param {"error" | "warn" | "never"} failOn
 * @returns {boolean}
 */
export function shouldFail(result, failOn) {
  if (failOn === "never") return false;
  if (failOn === "warn") return result.counts.errors > 0 || result.counts.warnings > 0;
  return result.counts.errors > 0;
}
