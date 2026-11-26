import fs from "node:fs/promises";
import path from "node:path";
import { SafetreeError } from "./git.js";
import { assertValidMaxEntries } from "./tree.js";

/** @typedef {import("./rules/index.js").IgnoreRule} IgnoreRule */

/**
 * @typedef {object} SafetreeConfig
 * @property {"error" | "warn" | "never"} [failOn]
 * @property {number} [maxEntries]
 * @property {IgnoreRule[]} ignore
 */

const ALLOWED_TOP_KEYS = new Set(["failOn", "maxEntries", "ignore"]);
const ALLOWED_IGNORE_KEYS = new Set(["rule", "path", "reason"]);
const ALLOWED_FAIL_ON = new Set(["error", "warn", "never"]);

/**
 * Validates parsed config object strictly and safely (prototype-pollution safe).
 *
 * @param {unknown} raw
 * @returns {SafetreeConfig}
 */
export function validateConfigObject(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SafetreeError("INVALID_CONFIG", "Config must be a JSON object.");
  }

  const obj = /** @type {Record<string, unknown>} */ (raw);
  for (const key of Object.keys(obj)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new SafetreeError("INVALID_CONFIG", `Forbidden config key '${key}'.`);
    }
    if (!ALLOWED_TOP_KEYS.has(key)) {
      throw new SafetreeError("INVALID_CONFIG", `Unknown config key '${key}'.`);
    }
  }

  /** @type {SafetreeConfig} */
  const config = { ignore: [] };

  if (Object.hasOwn(obj, "failOn")) {
    if (typeof obj.failOn !== "string" || !ALLOWED_FAIL_ON.has(obj.failOn)) {
      throw new SafetreeError("INVALID_CONFIG", "Config 'failOn' must be 'error', 'warn', or 'never'.");
    }
    config.failOn = /** @type {"error" | "warn" | "never"} */ (obj.failOn);
  }

  if (Object.hasOwn(obj, "maxEntries")) {
    if (typeof obj.maxEntries !== "number") {
      throw new SafetreeError("INVALID_CONFIG", "Config 'maxEntries' must be an integer.");
    }
    assertValidMaxEntries(obj.maxEntries);
    config.maxEntries = obj.maxEntries;
  }

  if (Object.hasOwn(obj, "ignore")) {
    if (!Array.isArray(obj.ignore)) {
      throw new SafetreeError("INVALID_CONFIG", "Config 'ignore' must be an array.");
    }
    for (let i = 0; i < obj.ignore.length; i += 1) {
      const item = obj.ignore[i];
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new SafetreeError("INVALID_CONFIG", `Config 'ignore[${i}]' must be an object.`);
      }
      const entry = /** @type {Record<string, unknown>} */ (item);
      for (const k of Object.keys(entry)) {
        if (!ALLOWED_IGNORE_KEYS.has(k)) {
          throw new SafetreeError("INVALID_CONFIG", `Unknown key '${k}' in ignore[${i}].`);
        }
      }
      if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
        throw new SafetreeError("INVALID_CONFIG", `Config 'ignore[${i}].reason' must be a non-empty string.`);
      }
      const hasRule = Object.hasOwn(entry, "rule") && entry.rule !== undefined;
      const hasPath = Object.hasOwn(entry, "path") && entry.path !== undefined;
      if (!hasRule && !hasPath) {
        throw new SafetreeError("INVALID_CONFIG", `Config 'ignore[${i}]' must specify 'rule' and/or 'path'.`);
      }
      if (hasRule && (typeof entry.rule !== "string" || !/^ST\d{3}$/.test(entry.rule))) {
        throw new SafetreeError("INVALID_CONFIG", `Config 'ignore[${i}].rule' must match ST001..ST011.`);
      }
      if (hasPath && (typeof entry.path !== "string" || entry.path.length === 0)) {
        throw new SafetreeError("INVALID_CONFIG", `Config 'ignore[${i}].path' must be a non-empty string.`);
      }
      config.ignore.push({
        rule: hasRule ? /** @type {string} */ (entry.rule) : undefined,
        path: hasPath ? /** @type {string} */ (entry.path) : undefined,
        reason: entry.reason
      });
    }
  }

  return config;
}

/**
 * Loads `.safetreerc.json` from `explicitPath` or `repoPath/.safetreerc.json` if present.
 *
 * @param {string} repoPath
 * @param {string} [explicitPath]
 * @returns {Promise<SafetreeConfig>}
 */
export async function loadConfig(repoPath, explicitPath) {
  const targetPath = explicitPath ? path.resolve(explicitPath) : path.join(repoPath, ".safetreerc.json");

  let rawText;
  try {
    rawText = await fs.readFile(targetPath, "utf8");
  } catch (/** @type {unknown} */ err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    if (code === "ENOENT" && !explicitPath) {
      return { ignore: [] };
    }
    throw new SafetreeError("INVALID_CONFIG", `Unable to read config file: ${targetPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new SafetreeError("INVALID_CONFIG", `Invalid JSON in config file: ${targetPath}`);
  }

  return validateConfigObject(parsed);
}
