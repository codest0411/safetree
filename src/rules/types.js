/**
 * @typedef {"error" | "warn" | "info"} Severity
 */

/**
 * @typedef {object} Finding
 * @property {string} id
 * @property {Severity} severity
 * @property {string} title
 * @property {string | null} path
 * @property {string} evidence
 * @property {string} why
 * @property {string} nextStep
 * @property {boolean} [lowConfidence]
 */

/**
 * @typedef {object} AuditSummary
 * @property {number} totalEntries
 * @property {number} symlinks
 * @property {number} executables
 * @property {number} submodules
 * @property {boolean} truncated
 * @property {Array<{ directory: string, count: number }>} largestDirectories
 */

/**
 * @typedef {object} AuditResult
 * @property {string} target
 * @property {string} rev
 * @property {Finding[]} findings
 * @property {AuditSummary} summary
 * @property {{ errors: number, warnings: number, infos: number }} counts
 */

export const MAX_FINDINGS = 5000;
