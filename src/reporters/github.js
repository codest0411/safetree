import { escapeGitHub } from "../escape.js";

/** @typedef {import("../rules/types.js").AuditResult} AuditResult */

/**
 * Formats an AuditResult as GitHub Actions workflow commands.
 *
 * @param {AuditResult} result
 * @returns {string}
 */
export function formatGitHub(result) {
  const lines = [];
  for (const f of result.findings) {
    const cmd =
      f.severity === "error" ? "error" : f.severity === "warn" ? "warning" : "notice";
    const title = escapeGitHub(`${f.id}: ${f.title}`, true);
    const fileProp = f.path ? `file=${escapeGitHub(f.path, true)},` : "";
    const msg = escapeGitHub(`${f.evidence} — ${f.why} (${f.nextStep})`, false);
    lines.push(`::${cmd} ${fileProp}title=${title}::${msg}`);
  }
  return lines.join("\n");
}
