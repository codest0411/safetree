/** @typedef {import("../rules/types.js").AuditResult} AuditResult */

/**
 * Formats an AuditResult as pretty JSON.
 *
 * @param {AuditResult} result
 * @returns {string}
 */
export function formatJson(result) {
  return JSON.stringify(result, null, 2);
}
