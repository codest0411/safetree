import fs from "node:fs/promises";
import path from "node:path";
import { escapeDisplay } from "./escape.js";
import { ensureGitAvailable, execGit, SafetreeError } from "./git.js";
import { withTempDir } from "./tempdir.js";
import { validateInspectTarget } from "./url.js";

/**
 * Performs a safe pre-checkout `git clone --no-checkout` into an isolated
 * 0700 temporary directory and runs the provided audit callback on the clone.
 *
 * Always deletes the temporary directory (unless `options.keep` is true).
 *
 * @template T
 * @param {string} rawTarget
 * @param {(cloneDir: string, displayTarget: string) => Promise<T>} onCloned
 * @param {{
 *   allowLocal?: boolean,
 *   keep?: boolean,
 *   onKeep?: (dir: string) => void,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number
 * }} [options]
 * @returns {Promise<T>}
 */
export async function withInspectedClone(rawTarget, onCloned, options = {}) {
  const validated = validateInspectTarget(rawTarget, { allowLocal: options.allowLocal });
  await ensureGitAvailable(options.env);

  const displayTarget = escapeDisplay(rawTarget);

  return withTempDir(
    async (rootTmp) => {
      const emptyTemplateDir = path.join(rootTmp, "empty-template");
      const emptyHooksDir = path.join(rootTmp, "empty-hooks");
      const cloneDir = path.join(rootTmp, "repo");

      await fs.mkdir(emptyTemplateDir, { mode: 0o700 });
      await fs.mkdir(emptyHooksDir, { mode: 0o700 });

      const cloneArgs = [
        "clone",
        "--no-checkout",
        "--no-tags",
        "--depth",
        "1",
        "--no-recurse-submodules",
        `--template=${emptyTemplateDir}`,
        "--config",
        `core.hooksPath=${emptyHooksDir}`,
        "--",
        validated.target,
        cloneDir
      ];

      const cloneEnv = {
        ...options.env,
        GIT_ALLOW_PROTOCOL: validated.allowedProtocolsEnv
      };

      const res = await execGit(cloneArgs, {
        env: cloneEnv,
        emptyHooksDir,
        timeoutMs: options.timeoutMs ?? 120_000
      });

      if (res.exitCode !== 0) {
        const stderr = escapeDisplay(res.stderr.toString("utf8").trim());
        throw new SafetreeError("CLONE_FAILED", `git clone --no-checkout failed: ${stderr}`);
      }

      return onCloned(cloneDir, displayTarget);
    },
    {
      prefix: "safetree-inspect-",
      keep: options.keep,
      onKeep: options.onKeep
    }
  );
}
