import { spawn } from "node:child_process";
import { createSecureTempDir, removeTempDir } from "./tempdir.js";

/** Minimum supported Git version (supports core.fsmonitor, core.hooksPath, protocol.ext.allow). */
export const MIN_GIT_VERSION = /** @type {const} */ ([2, 25, 0]);

/**
 * Structured error for CLI exit code 2 (usage / runtime / git errors).
 */
export class SafetreeError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [exitCode]
   */
  constructor(code, message, exitCode = 2) {
    super(message);
    this.name = "SafetreeError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/**
 * Parses `git --version` output into [major, minor, patch].
 *
 * @param {string} output
 * @returns {[number, number, number] | null}
 */
export function parseGitVersion(output) {
  const match = /\b(\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) return null;
  const major = Number.parseInt(/** @type {string} */ (match[1]), 10);
  const minor = Number.parseInt(/** @type {string} */ (match[2]), 10);
  const patch = match[3] ? Number.parseInt(match[3], 10) : 0;
  return [major, minor, patch];
}

/**
 * Returns true if `version` >= `minVersion`.
 *
 * @param {readonly [number, number, number]} version
 * @param {readonly [number, number, number]} minVersion
 * @returns {boolean}
 */
export function isGitVersionSupported(version, minVersion = MIN_GIT_VERSION) {
  for (let i = 0; i < 3; i += 1) {
    const a = version[i] ?? 0;
    const b = minVersion[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

/**
 * Builds a hardened environment for child git processes.
 *
 * @param {NodeJS.ProcessEnv} [extraEnv]
 * @returns {NodeJS.ProcessEnv}
 */
export function buildGitEnv(extraEnv = {}) {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
    ...extraEnv
  };
}

/**
 * Kills a child process (and its process tree on Windows when possible).
 *
 * @param {import("node:child_process").ChildProcess} child
 */
function killProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true
      });
      killer.unref();
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    try {
      child.kill("SIGKILL");
    } catch {
      // Ignore already exited
    }
  }
}

/**
 * Executes `git` with argument arrays (`shell: false`), timeout, and maxBuffer.
 *
 * @param {string[]} args
 * @param {{
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   maxBuffer?: number,
 *   input?: string | Buffer,
 *   hardenConfig?: boolean,
 *   emptyHooksDir?: string
 * }} [options]
 * @returns {Promise<{ stdout: Buffer, stderr: Buffer, exitCode: number }>}
 */
export async function execGit(args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  const hardenConfig = options.hardenConfig ?? true;

  let tempHooksDir = "";
  let hooksDir = options.emptyHooksDir ?? "";
  if (hardenConfig && !hooksDir) {
    tempHooksDir = await createSecureTempDir("safetree-hooks-");
    hooksDir = tempHooksDir;
  }

  const fullArgs = hardenConfig
    ? [
        "-c",
        "core.fsmonitor=false",
        "-c",
        `core.hooksPath=${hooksDir}`,
        "-c",
        "protocol.ext.allow=never",
        ...args
      ]
    : args;

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("git", fullArgs, {
        cwd: options.cwd,
        env: buildGitEnv(options.env),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });

      /** @type {Buffer[]} */
      const stdoutChunks = [];
      /** @type {Buffer[]} */
      const stderrChunks = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killProcessTree(child);
        reject(new SafetreeError("GIT_TIMEOUT", `git command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (/** @type {Buffer} */ chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxBuffer) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          killProcessTree(child);
          reject(new SafetreeError("LIMIT_EXCEEDED", `git stdout exceeded ${maxBuffer} bytes`));
          return;
        }
        stdoutChunks.push(chunk);
      });

      child.stderr.on("data", (/** @type {Buffer} */ chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= 1024 * 1024) {
          stderrChunks.push(chunk);
        }
      });

      child.on("error", (/** @type {NodeJS.ErrnoException} */ err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err.code === "ENOENT") {
          reject(new SafetreeError("GIT_MISSING", "git executable not found on PATH"));
        } else {
          reject(new SafetreeError("GIT_ERROR", `Failed to start git: ${err.message}`));
        }
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
          exitCode: code ?? 1
        });
      });

      if (options.input !== undefined) {
        child.stdin.end(options.input);
      } else {
        child.stdin.end();
      }
    });
  } finally {
    if (tempHooksDir) {
      await removeTempDir(tempHooksDir);
    }
  }
}

/**
 * Verifies that `git` is installed and meets `MIN_GIT_VERSION`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<[number, number, number]>}
 */
export async function ensureGitAvailable(env) {
  const res = await execGit(["--version"], { env, hardenConfig: false, timeoutMs: 10_000 });
  const text = res.stdout.toString("utf8").trim();
  const version = parseGitVersion(text);
  if (!version) {
    throw new SafetreeError("GIT_ERROR", `Unable to parse git version from: ${text}`);
  }
  if (!isGitVersionSupported(version, MIN_GIT_VERSION)) {
    throw new SafetreeError(
      "GIT_TOO_OLD",
      `Git ${version.join(".")} is older than minimum required ${MIN_GIT_VERSION.join(".")}`
    );
  }
  return version;
}

/**
 * Classifies common fatal git stderr messages into SafetreeError.
 *
 * @param {string} stderrText
 * @param {string} fallbackMessage
 * @returns {SafetreeError}
 */
export function classifyGitFailure(stderrText, fallbackMessage) {
  if (/detected dubious ownership/i.test(stderrText)) {
    return new SafetreeError(
      "OWNERSHIP_REFUSAL",
      "Git refused to read the repository due to dubious ownership. Inspect ownership manually; safetree never modifies safe.directory."
    );
  }
  if (/not a git repository/i.test(stderrText)) {
    return new SafetreeError("NOT_A_GIT_REPO", "Target path is not a Git repository.");
  }
  return new SafetreeError("GIT_ERROR", fallbackMessage);
}

/**
 * Checks whether the repository has any commits / whether `rev` resolves.
 *
 * @param {string} repoPath
 * @param {string} rev
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ hasCommits: boolean, resolvedOid: string | null }>}
 */
export async function resolveRevision(repoPath, rev, env) {
  if (!rev || rev.startsWith("-") || /[\0\r\n]/.test(rev)) {
    throw new SafetreeError("INVALID_REV", "Invalid revision specified.");
  }

  const res = await execGit(["-C", repoPath, "rev-parse", "--verify", "--end-of-options", `${rev}^{tree}`], {
    env,
    timeoutMs: 15_000
  });

  if (res.exitCode === 0) {
    return { hasCommits: true, resolvedOid: res.stdout.toString("utf8").trim() };
  }

  const stderr = res.stderr.toString("utf8");
  if (/detected dubious ownership|not a git repository/i.test(stderr)) {
    throw classifyGitFailure(stderr, stderr.trim());
  }

  // Check if repo has no commits at all (unborn HEAD)
  if (rev === "HEAD") {
    const headCheck = await execGit(["-C", repoPath, "symbolic-ref", "--quiet", "HEAD"], {
      env,
      timeoutMs: 10_000
    });
    if (headCheck.exitCode === 0) {
      return { hasCommits: false, resolvedOid: null };
    }
  }

  throw new SafetreeError("INVALID_REV", `Revision '${rev}' could not be resolved: ${stderr.trim()}`);
}
