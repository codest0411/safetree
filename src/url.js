import path from "node:path";
import { SafetreeError } from "./git.js";

/**
 * @typedef {object} ValidatedRemote
 * @property {string} target
 * @property {"https" | "ssh" | "local"} protocol
 * @property {string} allowedProtocolsEnv
 */

/**
 * Validates a repository URL or local path for `safetree inspect`.
 *
 * Rejects:
 * - empty strings
 * - leading `-` (option injection)
 * - control characters or whitespace
 * - `ext::`, `fd::`, `git://`, `http://`, or unknown transports
 * - `file://` or local filesystem paths unless `allowLocal` is true
 *
 * Accepts:
 * - `https://...`
 * - `ssh://...`
 * - scp-like `user@host:path` (or `host:path` where host is not a Windows drive or scheme)
 * - local paths / `file://...` when `allowLocal` is true
 *
 * @param {string} rawTarget
 * @param {{ allowLocal?: boolean }} [options]
 * @returns {ValidatedRemote}
 */
export function validateInspectTarget(rawTarget, options = {}) {
  const allowLocal = options.allowLocal ?? false;

  if (!rawTarget || typeof rawTarget !== "string") {
    throw new SafetreeError("INVALID_URL", "Repository URL or path is required.");
  }

  if (rawTarget.startsWith("-")) {
    throw new SafetreeError("INVALID_URL", "Repository URL must not start with '-'.");
  }

  const lower = rawTarget.toLowerCase();
  if (lower.startsWith("ext::") || lower.startsWith("fd::")) {
    throw new SafetreeError("INVALID_URL", "External/fd Git transports (ext::, fd::) are forbidden.");
  }

  for (let i = 0; i < rawTarget.length; i += 1) {
    const code = rawTarget.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) {
      throw new SafetreeError(
        "INVALID_URL",
        "Repository URL must not contain whitespace or control characters."
      );
    }
  }

  // Standard URLs with scheme://
  const schemeIdx = rawTarget.indexOf("://");
  if (schemeIdx !== -1) {
    const scheme = lower.slice(0, schemeIdx);
    if (scheme === "https") {
      let parsed;
      try {
        parsed = new URL(rawTarget);
      } catch {
        throw new SafetreeError("INVALID_URL", "Malformed https:// repository URL.");
      }
      if (!parsed.hostname) {
        throw new SafetreeError("INVALID_URL", "https:// URL must include a hostname.");
      }
      return { target: rawTarget, protocol: "https", allowedProtocolsEnv: "https" };
    }

    if (scheme === "ssh") {
      let parsed;
      try {
        parsed = new URL(rawTarget);
      } catch {
        throw new SafetreeError("INVALID_URL", "Malformed ssh:// repository URL.");
      }
      if (!parsed.hostname) {
        throw new SafetreeError("INVALID_URL", "ssh:// URL must include a hostname.");
      }
      return { target: rawTarget, protocol: "ssh", allowedProtocolsEnv: "ssh" };
    }

    if (scheme === "file") {
      if (!allowLocal) {
        throw new SafetreeError(
          "INVALID_URL",
          "file:// URLs require --allow-local."
        );
      }
      return { target: rawTarget, protocol: "local", allowedProtocolsEnv: "file" };
    }

    throw new SafetreeError(
      "INVALID_URL",
      `Unsupported URL transport '${scheme}://'. Only https:// and ssh:// (or local with --allow-local) are allowed.`
    );
  }

  // Windows drive path (e.g. C:\repo or C:/repo)
  if (/^[A-Za-z]:[\\/]/.test(rawTarget)) {
    if (!allowLocal) {
      throw new SafetreeError(
        "INVALID_URL",
        "Local repository paths require --allow-local."
      );
    }
    return { target: path.resolve(rawTarget), protocol: "local", allowedProtocolsEnv: "file" };
  }

  // Reject other `scheme:...` prefixes (e.g. `javascript:`, `git:`, `http:`)
  const colonIdx = rawTarget.indexOf(":");
  if (colonIdx !== -1 && !rawTarget.startsWith("/") && !rawTarget.startsWith(".")) {
    // scp-like syntax: `[user@]host:path` (host has no `/` and no `::`)
    const beforeColon = rawTarget.slice(0, colonIdx);
    const afterColon = rawTarget.slice(colonIdx + 1);
    if (
      beforeColon.length > 0 &&
      afterColon.length > 0 &&
      !beforeColon.includes("/") &&
      !beforeColon.includes("\\") &&
      !afterColon.startsWith(":")
    ) {
      const atIdx = beforeColon.indexOf("@");
      const host = atIdx === -1 ? beforeColon : beforeColon.slice(atIdx + 1);
      if (host.length > 0 && !host.startsWith("-")) {
        return { target: rawTarget, protocol: "ssh", allowedProtocolsEnv: "ssh" };
      }
    }
    throw new SafetreeError("INVALID_URL", "Unsupported or malformed repository URL.");
  }

  // Plain local path (relative or POSIX absolute)
  if (!allowLocal) {
    throw new SafetreeError(
      "INVALID_URL",
      "Local repository paths require --allow-local."
    );
  }
  return { target: path.resolve(rawTarget), protocol: "local", allowedProtocolsEnv: "file" };
}
