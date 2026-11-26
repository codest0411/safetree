import { SafetreeError } from "../git.js";
import { formatGitHub } from "./github.js";
import { formatHuman } from "./human.js";
import { formatJson } from "./json.js";
import { formatSarif } from "./sarif.js";

/** @typedef {import("../rules/types.js").AuditResult} AuditResult */

/**
 * Formats an AuditResult using the requested output format.
 *
 * @param {AuditResult} result
 * @param {"human" | "json" | "github" | "sarif"} format
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function formatReport(result, format, options = {}) {
  switch (format) {
    case "human":
      return formatHuman(result, options);
    case "json":
      return formatJson(result);
    case "github":
      return formatGitHub(result);
    case "sarif":
      return formatSarif(result);
    default:
      throw new SafetreeError("INVALID_OPTION", `Unsupported format '${format}'.`);
  }
}
