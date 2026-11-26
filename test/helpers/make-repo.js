import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Creates an isolated temporary git environment (no global/system gitconfig leakage).
 *
 * @param {string} [prefix]
 * @returns {Promise<{ root: string, env: NodeJS.ProcessEnv, cleanup: () => Promise<void> }>}
 */
export async function createIsolatedEnv(prefix = "safetree-test-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const homeDir = path.join(root, "home");
  const xdgDir = path.join(root, "xdg");
  const globalCfg = path.join(root, "gitconfig");
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(xdgDir, { recursive: true });
  await fs.writeFile(globalCfg, "[user]\n\tname = Test User\n\temail = test@example.com\n", "utf8");

  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: xdgDir,
    GIT_CONFIG_GLOBAL: globalCfg,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0"
  };

  return {
    root,
    env,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

/**
 * Runs git in a test directory with isolated env.
 *
 * @param {string[]} args
 * @param {{ cwd?: string, env: NodeJS.ProcessEnv, input?: string | Buffer }} opts
 * @returns {Promise<string>}
 */
export async function gitInTest(args, opts) {
  if (opts.input !== undefined) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        args,
        { cwd: opts.cwd, env: opts.env, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            err.message += `\n${stderr}`;
            reject(err);
          } else {
            resolve(stdout.trim());
          }
        }
      );
      child.stdin?.end(opts.input);
    });
  }
  const res = await execFileAsync("git", args, {
    cwd: opts.cwd,
    env: opts.env,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return res.stdout.trim();
}

/**
 * Builds a raw Git tree recursively via `git mktree` (bypasses index path
 * restrictions so fixtures can include `.git.`, symlinked `.gitmodules`, and
 * entries behind symlinks).
 *
 * @param {Array<{ path: string, mode: string, type: string, oid: string }>} leaves
 * @param {string} repoDir
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string>}
 */
async function buildRawTree(leaves, repoDir, env) {
  /** @type {Map<string, Array<{ path: string, mode: string, type: string, oid: string }>>} */
  const subdirs = new Map();
  /** @type {string[]} */
  const lines = [];

  for (const leaf of leaves) {
    const slashIdx = leaf.path.indexOf("/");
    if (slashIdx === -1) {
      lines.push(`${leaf.mode} ${leaf.type} ${leaf.oid}\t${leaf.path}`);
    } else {
      const dir = leaf.path.slice(0, slashIdx);
      const rest = leaf.path.slice(slashIdx + 1);
      const arr = subdirs.get(dir) ?? [];
      arr.push({ ...leaf, path: rest });
      subdirs.set(dir, arr);
    }
  }

  for (const [dir, childLeaves] of subdirs.entries()) {
    const subTreeOid = await buildRawTree(childLeaves, repoDir, env);
    lines.push(`040000 tree ${subTreeOid}\t${dir}`);
  }

  return gitInTest(["mktree", "--missing"], {
    cwd: repoDir,
    env,
    input: lines.join("\n") + "\n"
  });
}

/**
 * @typedef {object} FixtureEntry
 * @property {string} path
 * @property {"100644" | "100755" | "120000" | "160000"} [mode]
 * @property {string | Buffer} [content]
 * @property {string} [oid]
 */

/**
 * Builds a Git repository purely via plumbing (`hash-object`, `update-index` or
 * `mktree`, `commit-tree`) so no OS symlink privileges are needed.
 *
 * @param {FixtureEntry[]} entries
 * @param {{
 *   bare?: boolean,
 *   rawTree?: boolean,
 *   checkoutWithSymlinksFalse?: boolean,
 *   tag?: string,
 *   branch?: string
 * }} [options]
 * @returns {Promise<{
 *   repoDir: string,
 *   env: NodeJS.ProcessEnv,
 *   cleanup: () => Promise<void>
 * }>}
 */
export async function createFixtureRepo(entries, options = {}) {
  const iso = await createIsolatedEnv("safetree-repo-");
  const repoDir = path.join(iso.root, options.bare ? "bare.git" : "repo");
  const branch = options.branch ?? "main";

  await fs.mkdir(repoDir, { recursive: true });
  const initArgs = options.bare
    ? ["init", "--bare", `--initial-branch=${branch}`]
    : ["init", `--initial-branch=${branch}`];
  await gitInTest(initArgs, { cwd: repoDir, env: iso.env });

  if (entries.length > 0) {
    /** @type {Array<{ path: string, mode: string, type: string, oid: string }>} */
    const prepared = [];

    for (const entry of entries) {
      const mode = entry.mode ?? "100644";
      const type = mode === "160000" ? "commit" : "blob";
      let oid = entry.oid;
      if (!oid) {
        if (mode === "160000") {
          oid = "1111111111111111111111111111111111111111";
        } else {
          oid = await gitInTest(["hash-object", "-w", "--stdin"], {
            cwd: repoDir,
            env: iso.env,
            input: entry.content ?? ""
          });
        }
      }
      prepared.push({ path: entry.path, mode, type, oid });
    }

    let treeOid;
    if (options.rawTree) {
      treeOid = await buildRawTree(prepared, repoDir, iso.env);
    } else {
      for (const item of prepared) {
        await gitInTest(
          ["update-index", "--add", "--cacheinfo", `${item.mode},${item.oid},${item.path}`],
          { cwd: repoDir, env: iso.env }
        );
      }
      treeOid = await gitInTest(["write-tree"], { cwd: repoDir, env: iso.env });
    }

    const commitOid = await gitInTest(["commit-tree", treeOid, "-m", "fixture commit"], {
      cwd: repoDir,
      env: iso.env
    });
    await gitInTest(["update-ref", `refs/heads/${branch}`, commitOid], {
      cwd: repoDir,
      env: iso.env
    });
    await gitInTest(["symbolic-ref", "HEAD", `refs/heads/${branch}`], {
      cwd: repoDir,
      env: iso.env
    });

    if (options.tag) {
      await gitInTest(["tag", options.tag, commitOid], { cwd: repoDir, env: iso.env });
    }

    if (options.checkoutWithSymlinksFalse) {
      await gitInTest(["config", "core.symlinks", "false"], { cwd: repoDir, env: iso.env });
      await gitInTest(["checkout", "--force", branch], { cwd: repoDir, env: iso.env });
    }
  }

  return {
    repoDir,
    env: iso.env,
    cleanup: iso.cleanup
  };
}
