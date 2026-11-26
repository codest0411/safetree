import { escapeDisplay } from "./escape.js";

/**
 * @typedef {object} SubmoduleFinding
 * @property {"error" | "warn"} severity
 * @property {string} title
 * @property {string} evidence
 * @property {string} why
 * @property {string} nextStep
 * @property {boolean} lowConfidence
 */

/**
 * Simple, linear-time line-based parser for `.gitmodules` (no INI library).
 * Checks for dangerous URLs (`ext::`, `fd::`, leading `-`, control chars,
 * `file://` or local paths) and dangerous `path` values (`..`, absolute paths).
 *
 * @param {Buffer} content
 * @returns {SubmoduleFinding[]}
 */
export function auditGitmodulesContent(content) {
  /** @type {SubmoduleFinding[]} */
  const findings = [];
  const text = content.toString("utf8");
  const lines = text.split(/\r?\n/);

  let currentSection = "(top-level)";
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = /** @type {string} */ (lines[i]);
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = escapeDisplay(trimmed.slice(1, -1).trim());
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const lineNum = i + 1;
    const escapedValue = escapeDisplay(value);

    if (key === "url") {
      if (hasControlChars(value)) {
        findings.push({
          severity: "warn",
          title: "Submodule URL contains control characters",
          evidence: `.gitmodules:${lineNum} [${currentSection}] url = ${escapedValue}`,
          why: "Control characters in submodule URLs can trigger parser confusion or terminal injection.",
          nextStep: "verify before running: inspect .gitmodules and remove control characters from the submodule URL.",
          lowConfidence: false
        });
      } else if (value.startsWith("-")) {
        findings.push({
          severity: "warn",
          title: "Submodule URL starts with '-'",
          evidence: `.gitmodules:${lineNum} [${currentSection}] url = ${escapedValue}`,
          why: "A leading '-' can be interpreted as a command-line option by older Git or helper invocations.",
          nextStep: "verify before running: inspect .gitmodules and reject or fix the submodule URL.",
          lowConfidence: false
        });
      } else if (/^ext::/i.test(value) || /^fd::/i.test(value)) {
        findings.push({
          severity: "warn",
          title: "Submodule URL uses dangerous ext:: or fd:: transport",
          evidence: `.gitmodules:${lineNum} [${currentSection}] url = ${escapedValue}`,
          why: "The ext:: and fd:: transports can invoke arbitrary external commands or file descriptors when submodules are fetched.",
          nextStep: "verify before running: do not initialize submodules; remove the ext::/fd:: URL from .gitmodules.",
          lowConfidence: false
        });
      } else if (
        /^file:\/\//i.test(value) ||
        value.startsWith("./") ||
        value.startsWith("../") ||
        value.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(value)
      ) {
        findings.push({
          severity: "warn",
          title: "Submodule URL points to file:// or local path (low-confidence)",
          evidence: `.gitmodules:${lineNum} [${currentSection}] url = ${escapedValue}`,
          why: "Local/file:// submodule URLs can reference unintended local repositories or relative paths when cloned.",
          nextStep: "verify before running: confirm whether a relative/local submodule URL is intentional in .gitmodules.",
          lowConfidence: true
        });
      }
    } else if (key === "path") {
      const normalized = value.replaceAll("\\", "/");
      const segments = normalized.split("/");
      if (
        normalized.startsWith("/") ||
        /^[A-Za-z]:/.test(value) ||
        segments.includes("..")
      ) {
        findings.push({
          severity: "warn",
          title: "Submodule path traverses outside repository or is absolute",
          evidence: `.gitmodules:${lineNum} [${currentSection}] path = ${escapedValue}`,
          why: "A submodule path with '..' or an absolute prefix can escape the working tree during submodule checkout.",
          nextStep: "verify before running: inspect .gitmodules and ensure submodule paths are relative and inside the repo.",
          lowConfidence: false
        });
      }
    }
  }

  return findings;
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function hasControlChars(s) {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
