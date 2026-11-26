import os from "node:os";
import path from "node:path";

/**
 * Escapes control characters, ANSI escape sequences, newlines, bidi overrides,
 * and invalid UTF-8 bytes so repository-controlled names cannot forge terminal
 * output or inject escape sequences.
 *
 * @param {string | Buffer} input
 * @returns {string}
 */
export function escapeDisplay(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  let out = "";
  let i = 0;

  while (i < buf.length) {
    const b0 = /** @type {number} */ (buf[i]);

    // ASCII fast path
    if (b0 < 0x80) {
      if (b0 === 0x09) {
        out += "\\t";
      } else if (b0 === 0x0a) {
        out += "\\n";
      } else if (b0 === 0x0d) {
        out += "\\r";
      } else if (b0 < 0x20 || b0 === 0x7f) {
        out += `\\x${b0.toString(16).padStart(2, "0")}`;
      } else if (b0 === 0x5c) {
        out += "\\\\";
      } else {
        out += String.fromCharCode(b0);
      }
      i += 1;
      continue;
    }

    // Decode multi-byte UTF-8 sequence strictly; emit \xNN on invalid bytes
    const decoded = decodeUtf8Char(buf, i);
    if (decoded === null) {
      out += `\\x${b0.toString(16).padStart(2, "0")}`;
      i += 1;
      continue;
    }

    const { codePoint, length } = decoded;
    // Escape C1 controls (U+0080..U+009F) and bidi / invisible formatting chars
    if (
      (codePoint >= 0x80 && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0x200e ||
      codePoint === 0x200f
    ) {
      out += `\\u{${codePoint.toString(16)}}`;
    } else {
      out += String.fromCodePoint(codePoint);
    }
    i += length;
  }

  return out;
}

/**
 * Decodes a single valid UTF-8 code point at `offset`, or returns null if invalid.
 *
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {{ codePoint: number, length: number } | null}
 */
function decodeUtf8Char(buf, offset) {
  const b0 = /** @type {number} */ (buf[offset]);
  if (b0 >= 0xc2 && b0 <= 0xdf) {
    if (offset + 1 >= buf.length) return null;
    const b1 = /** @type {number} */ (buf[offset + 1]);
    if ((b1 & 0xc0) !== 0x80) return null;
    return { codePoint: ((b0 & 0x1f) << 6) | (b1 & 0x3f), length: 2 };
  }
  if (b0 >= 0xe0 && b0 <= 0xef) {
    if (offset + 2 >= buf.length) return null;
    const b1 = /** @type {number} */ (buf[offset + 1]);
    const b2 = /** @type {number} */ (buf[offset + 2]);
    if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return null;
    if (b0 === 0xe0 && b1 < 0xa0) return null;
    if (b0 === 0xed && b1 >= 0xa0) return null; // surrogate
    return {
      codePoint: ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f),
      length: 3
    };
  }
  if (b0 >= 0xf0 && b0 <= 0xf4) {
    if (offset + 3 >= buf.length) return null;
    const b1 = /** @type {number} */ (buf[offset + 1]);
    const b2 = /** @type {number} */ (buf[offset + 2]);
    const b3 = /** @type {number} */ (buf[offset + 3]);
    if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return null;
    if (b0 === 0xf0 && b1 < 0x90) return null;
    if (b0 === 0xf4 && b1 > 0x8f) return null;
    return {
      codePoint: ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f),
      length: 4
    };
  }
  return null;
}

/**
 * Escapes a string for GitHub Actions workflow commands (`::error ...::message`).
 *
 * @param {string} value
 * @param {boolean} [isProperty]
 * @returns {string}
 */
export function escapeGitHub(value, isProperty = false) {
  let out = value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  if (isProperty) {
    out = out.replaceAll(":", "%3A").replaceAll(",", "%2C");
  }
  return out;
}

/**
 * Redacts the user's home directory from an error/display path if present.
 *
 * @param {string} targetPath
 * @returns {string}
 */
export function redactHomePath(targetPath) {
  const home = os.homedir();
  if (!home) return escapeDisplay(targetPath);
  const resolved = path.resolve(targetPath);
  const resolvedHome = path.resolve(home);
  if (resolved === resolvedHome) return "~";
  if (resolved.startsWith(resolvedHome + path.sep)) {
    return escapeDisplay("~" + resolved.slice(resolvedHome.length));
  }
  return escapeDisplay(targetPath);
}
