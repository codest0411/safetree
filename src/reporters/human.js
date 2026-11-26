/** @typedef {import("../rules/types.js").AuditResult} AuditResult */
/** @typedef {import("../rules/types.js").Severity} Severity */

/**
 * Formats an AuditResult for human-readable terminal output.
 *
 * @param {AuditResult} result
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function formatHuman(result, options = {}) {
  const useColor = options.color ?? false;
  const lines = [];

  const bold = (/** @type {string} */ s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);
  const red = (/** @type {string} */ s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
  const yellow = (/** @type {string} */ s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
  const cyan = (/** @type {string} */ s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s);
  const dim = (/** @type {string} */ s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

  /**
   * @param {Severity} sev
   * @returns {string}
   */
  const badge = (sev) => {
    if (sev === "error") return red("[ERROR]");
    if (sev === "warn") return yellow("[WARN] ");
    return cyan("[INFO] ");
  };

  lines.push(bold(`safetree audit: ${result.target} (rev: ${result.rev})`));
  lines.push("");

  for (const f of result.findings) {
    lines.push(`${badge(f.severity)} ${bold(f.id)} ${f.title}`);
    if (f.path) {
      lines.push(`  path:     ${f.path}`);
    }
    lines.push(`  evidence: ${f.evidence}`);
    lines.push(`  why:      ${f.why}`);
    lines.push(`  next:     ${dim(f.nextStep)}`);
    lines.push("");
  }

  lines.push(
    bold(
      `Result: ${result.counts.errors} error(s), ${result.counts.warnings} warning(s), ${result.counts.infos} info(s)`
    )
  );
  return lines.join("\n");
}
