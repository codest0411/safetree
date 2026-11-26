import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

/** @type {Set<string>} */
const activeTempDirs = new Set();
let hooksRegistered = false;

function cleanupAllSync() {
  for (const dir of activeTempDirs) {
    try {
      fsSync.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup during exit/signal
    }
  }
  activeTempDirs.clear();
}

function ensureExitHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  const onSignal = (/** @type {NodeJS.Signals} */ sig) => {
    cleanupAllSync();
    process.exit(sig === "SIGINT" ? 130 : 143);
  };

  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("exit", () => cleanupAllSync());
}

/**
 * Creates a unique temporary directory with 0700 permissions.
 *
 * @param {string} [prefix]
 * @returns {Promise<string>}
 */
export async function createSecureTempDir(prefix = "safetree-") {
  ensureExitHooks();
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, prefix));
  try {
    await fs.chmod(dir, 0o700);
  } catch {
    // chmod may be a no-op on some Windows filesystems
  }
  activeTempDirs.add(dir);
  return dir;
}

/**
 * Removes a temporary directory created by `createSecureTempDir`.
 *
 * @param {string} dir
 * @returns {Promise<void>}
 */
export async function removeTempDir(dir) {
  activeTempDirs.delete(dir);
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Runs `fn` with an isolated temporary directory and always cleans it up
 * unless `options.keep` is true.
 *
 * @template T
 * @param {(dir: string) => Promise<T>} fn
 * @param {{ prefix?: string, keep?: boolean, onKeep?: (dir: string) => void }} [options]
 * @returns {Promise<T>}
 */
export async function withTempDir(fn, options = {}) {
  const dir = await createSecureTempDir(options.prefix ?? "safetree-");
  try {
    return await fn(dir);
  } finally {
    if (options.keep) {
      activeTempDirs.delete(dir);
      options.onKeep?.(dir);
    } else {
      await removeTempDir(dir);
    }
  }
}
