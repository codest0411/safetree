import { escapeDisplay } from "./escape.js";
import { classifyGitFailure, execGit, SafetreeError } from "./git.js";

/**
 * @typedef {object} TreeEntry
 * @property {string} mode
 * @property {string} type
 * @property {string} oid
 * @property {Buffer} pathBuf
 * @property {string} path
 * @property {string} displayPath
 */

/**
 * Parses NUL-separated `git ls-tree -r -z --full-tree` output into TreeEntry records.
 * Never throws on malformed or non-UTF-8 bytes; skips invalid records safely.
 *
 * @param {Buffer} buffer
 * @param {number} [maxEntries]
 * @returns {{ entries: TreeEntry[], truncated: boolean }}
 */
export function parseLsTreeBuffer(buffer, maxEntries = 1_000_000) {
  /** @type {TreeEntry[]} */
  const entries = [];
  let truncated = false;
  let offset = 0;

  while (offset < buffer.length) {
    const nulIdx = buffer.indexOf(0x00, offset);
    const recordEnd = nulIdx === -1 ? buffer.length : nulIdx;
    if (recordEnd > offset) {
      const tabIdx = buffer.indexOf(0x09, offset);
      if (tabIdx !== -1 && tabIdx < recordEnd) {
        const meta = buffer.subarray(offset, tabIdx).toString("ascii");
        const parts = meta.split(" ");
        if (parts.length >= 3) {
          const mode = /** @type {string} */ (parts[0]);
          const type = /** @type {string} */ (parts[1]);
          const oid = /** @type {string} */ (parts[2]);
          const pathBuf = Buffer.from(buffer.subarray(tabIdx + 1, recordEnd));
          if (entries.length >= maxEntries) {
            truncated = true;
            break;
          }
          entries.push({
            mode,
            type,
            oid,
            pathBuf,
            path: pathBuf.toString("utf8"),
            displayPath: escapeDisplay(pathBuf)
          });
        }
      }
    }
    if (nulIdx === -1) break;
    offset = nulIdx + 1;
  }

  return { entries, truncated };
}

/**
 * Lists all tree entries for a given revision using `git ls-tree -r -z --full-tree`.
 *
 * @param {string} repoPath
 * @param {string} rev
 * @param {{ maxEntries?: number, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {Promise<{ entries: TreeEntry[], truncated: boolean }>}
 */
export async function listTree(repoPath, rev, options = {}) {
  const maxEntries = options.maxEntries ?? 1_000_000;
  // Allow ~256 bytes per entry up to 256MB
  const maxBuffer = Math.min(256 * 1024 * 1024, Math.max(16 * 1024 * 1024, maxEntries * 256));

  const res = await execGit(
    ["-C", repoPath, "ls-tree", "-r", "-z", "--full-tree", rev, "--"],
    {
      env: options.env,
      timeoutMs: options.timeoutMs ?? 60_000,
      maxBuffer
    }
  );

  if (res.exitCode !== 0) {
    const stderr = res.stderr.toString("utf8").trim();
    throw classifyGitFailure(stderr, `git ls-tree failed: ${stderr}`);
  }

  return parseLsTreeBuffer(res.stdout, maxEntries);
}

/**
 * Validates that `maxEntries` is a positive safe integer.
 *
 * @param {number} maxEntries
 */
export function assertValidMaxEntries(maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000_000) {
    throw new SafetreeError("INVALID_OPTION", "maxEntries must be an integer between 1 and 10000000.");
  }
}
