/** @typedef {import("../rules/types.js").AuditResult} AuditResult */

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json";

/**
 * Formats an AuditResult as SARIF v2.1.0 JSON.
 *
 * @param {AuditResult} result
 * @returns {string}
 */
export function formatSarif(result) {
  /** @type {Map<string, { id: string, name: string, shortDescription: { text: string }, fullDescription: { text: string } }>} */
  const rulesMap = new Map();
  const sarifResults = [];

  for (const f of result.findings) {
    if (!rulesMap.has(f.id)) {
      rulesMap.set(f.id, {
        id: f.id,
        name: f.id,
        shortDescription: { text: f.title },
        fullDescription: { text: f.why }
      });
    }

    const level = f.severity === "error" ? "error" : f.severity === "warn" ? "warning" : "note";
    /** @type {Record<string, unknown>} */
    const item = {
      ruleId: f.id,
      level,
      message: {
        text: `${f.title}. Evidence: ${f.evidence}. ${f.why} (${f.nextStep})`
      }
    };

    if (f.path) {
      item.locations = [
        {
          physicalLocation: {
            artifactLocation: {
              uri: f.path
            }
          }
        }
      ];
    }

    sarifResults.push(item);
  }

  const sarif = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "safetree",
            informationUri: "https://github.com/safetree/safetree",
            rules: [...rulesMap.values()]
          }
        },
        results: sarifResults
      }
    ]
  };

  return JSON.stringify(sarif, null, 2);
}
