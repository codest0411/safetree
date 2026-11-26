import { parseArgs } from "node:util";
import {
  auditLocalRepo,
  escapeDisplay,
  inspectRemoteRepo,
  loadConfig,
  redactHomePath,
  SafetreeError,
  shouldFail
} from "./index.js";
import { formatReport } from "./reporters/index.js";

const VERSION = "0.1.0";

const HELP_TEXT = `safetree v${VERSION}
Read-only Git tree and symlink security/Windows compatibility auditor.

Usage:
  safetree [path] [options]            Audit a local Git repository (default: .)
  safetree inspect <url-or-path>       Safely clone (--no-checkout) and audit a remote repo

Options:
  --rev <ref>           Git revision to inspect (default: HEAD)
  --format <fmt>        Output format: human | json | github | sarif (default: human)
  --fail-on <level>     Exit 1 threshold: error | warn | never (default: error)
  --max-entries <n>     Max tree entries to parse (default: 1000000)
  --config <path>       Path to .safetreerc.json
  --allow-local         Allow local paths / file:// URLs in 'inspect'
  --keep                Keep temporary clone directory after 'inspect' (prints warning)
  --no-color            Disable ANSI colors in human output
  -h, --help            Show this help message
  -v, --version         Show version

Exit codes:
  0  Clean (below --fail-on threshold)
  1  Findings at or above --fail-on threshold
  2  Usage, configuration, or Git runtime error
`;

/**
 * Runs the safetree CLI with the given argv (excluding node and script).
 *
 * @param {string[]} argv
 * @param {{
 *   stdout?: (s: string) => void,
 *   stderr?: (s: string) => void,
 *   isTTY?: boolean,
 *   env?: NodeJS.ProcessEnv
 * }} [io]
 * @returns {Promise<number>}
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(s + "\n"));
  const stderr = io.stderr ?? ((s) => process.stderr.write(s + "\n"));
  const env = io.env ?? process.env;

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        rev: { type: "string" },
        format: { type: "string" },
        "fail-on": { type: "string" },
        "max-entries": { type: "string" },
        config: { type: "string" },
        "allow-local": { type: "boolean", default: false },
        keep: { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false }
      }
    });
  } catch (/** @type {unknown} */ err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`safetree error: ${escapeDisplay(msg)}`);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    stdout(HELP_TEXT);
    return 0;
  }
  if (values.version) {
    stdout(VERSION);
    return 0;
  }

  const formatRaw = values.format ?? "human";
  if (
    formatRaw !== "human" &&
    formatRaw !== "json" &&
    formatRaw !== "github" &&
    formatRaw !== "sarif"
  ) {
    stderr(`safetree error: invalid --format '${escapeDisplay(formatRaw)}'`);
    return 2;
  }

  const rev = values.rev ?? "HEAD";
  const useColor =
    !values["no-color"] &&
    !Object.hasOwn(env, "NO_COLOR") &&
    (io.isTTY ?? Boolean(process.stdout.isTTY));

  try {
    let maxEntriesOpt;
    if (values["max-entries"] !== undefined) {
      const n = Number(values["max-entries"]);
      if (!Number.isInteger(n) || n < 1) {
        throw new SafetreeError("INVALID_OPTION", "--max-entries must be a positive integer.");
      }
      maxEntriesOpt = n;
    }

    const subcommand = positionals[0];
    let result;
    let configFailOn;

    if (subcommand === "inspect") {
      const target = positionals[1];
      if (!target || positionals.length > 2) {
        throw new SafetreeError("INVALID_USAGE", "Usage: safetree inspect <url-or-path>");
      }
      if (values.config) {
        const cfg = await loadConfig(process.cwd(), values.config);
        configFailOn = cfg.failOn;
      }
      result = await inspectRemoteRepo(target, {
        rev,
        maxEntries: maxEntriesOpt,
        configPath: values.config,
        allowLocal: values["allow-local"],
        keep: values.keep,
        onKeep: (dir) => {
          stderr(`Warning: --keep enabled; temporary clone retained at ${redactHomePath(dir)}`);
        },
        env
      });
    } else {
      if (positionals.length > 1) {
        throw new SafetreeError("INVALID_USAGE", "Too many positional arguments. Usage: safetree [path]");
      }
      const repoPath = subcommand ?? ".";
      const cfg = await loadConfig(repoPath, values.config);
      configFailOn = cfg.failOn;
      result = await auditLocalRepo(repoPath, {
        rev,
        maxEntries: maxEntriesOpt,
        configPath: values.config,
        env
      });
    }

    const failOnRaw = values["fail-on"] ?? configFailOn ?? "error";
    if (failOnRaw !== "error" && failOnRaw !== "warn" && failOnRaw !== "never") {
      throw new SafetreeError("INVALID_OPTION", `Invalid --fail-on '${escapeDisplay(failOnRaw)}'`);
    }

    const output = formatReport(result, formatRaw, { color: useColor });
    if (output.length > 0) {
      stdout(output);
    }

    return shouldFail(result, failOnRaw) ? 1 : 0;
  } catch (/** @type {unknown} */ err) {
    if (err instanceof SafetreeError) {
      stderr(`safetree error [${err.code}]: ${escapeDisplay(err.message)}`);
      return err.exitCode;
    }
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`safetree error: ${escapeDisplay(msg)}`);
    return 2;
  }
}
