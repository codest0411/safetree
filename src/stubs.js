import fs from "node:fs/promises";
import path from "node:path";
import { escapeDisplay } from "./escape.js";
import { execGit } from "./git.js";

/**
 * @typedef {object} WorkingStub
 * @property {string} path
 * @property {string} displayPath
 * @property {string} content
 */

/**
 * Parses NUL-terminated `git ls-files -s -z` output and returns staged entries
 * with mode `120000` (symlinks).
 *
 * Format: `<mode> <oid> <stage>\t<path>\0`
 *
 * @param {Buffer} stdout
 * @returns {string[]}
 */
export function parseLsFilesSymlinkPaths(stdout) {
  /** @type {string[]} */
  const paths = [];
  let offset = 0;
  while (offset < stdout.length) {
    const nulIdx = stdout.indexOf(0x00, offset);
    const end = nulIdx === -1 ? stdout.length : nulIdx;
    if (end > offset) {
      const tabIdx = stdout.indexOf(0x09, offset);
      if (tabIdx !== -1 && tabIdx < end) {
        const meta = stdout.subarray(offset, tabIdx).toString("ascii");
        if (meta.startsWith("120000 ")) {
          paths.push(stdout.subarray(tabIdx + 1, end).toString("utf8"));
        }
      }
    }
    if (nulIdx === -1) break;
    offset = nulIdx + 1;
  }
  return paths;
}

/**
 * Checks the working tree for index symlinks (mode 120000) that are regular
 * files on disk (e.g. text stubs created by `core.symlinks=false`).
 *
 * @param {string} repoPath
 * @param {{ env?: NodeJS.ProcessEnv, maxStubs?: number }} [options]
 * @returns {Promise<WorkingStub[]>}
 */
export async function detectWorkingTreeStubs(repoPath, options = {}) {
  const maxStubs = options.maxStubs ?? 500;
  const res = await execGit(["-C", repoPath, "ls-files", "-s", "-z"], {
    env: options.env,
    timeoutMs: 30_000
  });

  if (res.exitCode !== 0) {
    return [];
  }

  const symlinkPaths = parseLsFilesSymlinkPaths(res.stdout);
  /** @type {WorkingStub[]} */
  const stubs = [];

  const resolvedRoot = await fs.realpath(repoPath);

  for (const relPath of symlinkPaths) {
    if (stubs.length >= maxStubs) break;

    const fullPath = path.resolve(resolvedRoot, relPath);
    // Ensure we never lstat outside repo root
    if (fullPath !== resolvedRoot && !fullPath.startsWith(resolvedRoot + path.sep)) {
      continue;
    }

    try {
      const st = await fs.lstat(fullPath);
      if (st.isFile()) {
        const fh = await fs.open(fullPath, "r");
        try {
          const buf = Buffer.alloc(Math.min(4096, st.size));
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          stubs.push({
            path: relPath,
            displayPath: escapeDisplay(relPath),
            content: escapeDisplay(buf.subarray(0, bytesRead))
          });
        } finally {
          await fh.close();
        }
      }
    } catch {
      // File may not exist in working tree (e.g. sparse checkout or deleted)
    }
  }

  return stubs;
}
