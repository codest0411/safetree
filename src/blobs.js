import { execGit, SafetreeError } from "./git.js";

/**
 * @typedef {object} BlobData
 * @property {string} oid
 * @property {string} type
 * @property {number} size
 * @property {Buffer} content
 * @property {boolean} oversized
 * @property {boolean} missing
 */

/**
 * Parses `git cat-file --batch` stdout buffer into a Map<oid, BlobData>.
 * Caps stored content at `maxBlobBytes` and marks `oversized` when exceeded.
 *
 * @param {Buffer} stdout
 * @param {number} [maxBlobBytes]
 * @returns {Map<string, BlobData>}
 */
export function parseCatFileBatchOutput(stdout, maxBlobBytes = 4096) {
  /** @type {Map<string, BlobData>} */
  const result = new Map();
  let offset = 0;

  while (offset < stdout.length) {
    const nlIdx = stdout.indexOf(0x0a, offset);
    if (nlIdx === -1) break;
    const header = stdout.subarray(offset, nlIdx).toString("utf8").replace(/\r$/, "");
    offset = nlIdx + 1;

    if (!header) continue;
    const parts = header.split(" ");
    const oid = parts[0] ?? "";
    const second = parts[1] ?? "";

    if (second === "missing" || parts.length < 3) {
      if (oid) {
        result.set(oid, {
          oid,
          type: "missing",
          size: 0,
          content: Buffer.alloc(0),
          oversized: false,
          missing: true
        });
      }
      continue;
    }

    const size = Number.parseInt(/** @type {string} */ (parts[2]), 10);
    if (!Number.isFinite(size) || size < 0) {
      break;
    }

    const available = stdout.length - offset;
    const actualCopyEnd = offset + Math.min(size, available);
    const keepBytes = Math.min(maxBlobBytes, actualCopyEnd - offset);
    const content = Buffer.from(stdout.subarray(offset, offset + keepBytes));
    const oversized = size > maxBlobBytes;

    result.set(oid, {
      oid,
      type: second,
      size,
      content,
      oversized,
      missing: false
    });

    offset = offset + size;
    // Skip trailing LF after blob payload
    if (offset < stdout.length && stdout[offset] === 0x0a) {
      offset += 1;
    }
  }

  return result;
}

/**
 * Reads blobs for the given OIDs via `git cat-file --batch`, capping each blob
 * at `maxBlobBytes` (truncating oversized blobs in memory).
 *
 * @param {string} repoPath
 * @param {string[]} oids
 * @param {{ maxBlobBytes?: number, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {Promise<Map<string, BlobData>>}
 */
export async function readBlobs(repoPath, oids, options = {}) {
  if (oids.length === 0) return new Map();

  const uniqueOids = [...new Set(oids)].filter((oid) => /^[0-9a-fA-F]{40,64}$/.test(oid));
  if (uniqueOids.length === 0) return new Map();

  const maxBlobBytes = options.maxBlobBytes ?? 4096;
  const input = uniqueOids.join("\n") + "\n";

  const res = await execGit(["-C", repoPath, "cat-file", "--batch"], {
    env: options.env,
    input,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxBuffer: 64 * 1024 * 1024
  });

  if (res.exitCode !== 0) {
    throw new SafetreeError(
      "GIT_ERROR",
      `git cat-file --batch failed: ${res.stderr.toString("utf8").trim()}`
    );
  }

  return parseCatFileBatchOutput(res.stdout, maxBlobBytes);
}
