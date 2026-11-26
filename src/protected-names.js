import { splitPathSegments } from "./paths.js";

/**
 * Checks path components against Git's verified `core.protectNTFS` and
 * `core.protectHFS` protected name rules (see docs/GIT-BEHAVIOR.md).
 */

const WINDOWS_RESERVED_DEVICES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

/**
 * Code points ignored by HFS+ / APFS when comparing filenames (matching Git's
 * `is_hfs_dotgit` / `utf8.c` ignorable code points).
 *
 * @param {number} cp
 * @returns {boolean}
 */
function isHfsIgnorableCodePoint(cp) {
  if (cp === 0x00ad || cp === 0x034f || cp === 0x115f || cp === 0x1160) return true;
  if (cp === 0x17b4 || cp === 0x17b5 || cp === 0x200b || cp === 0x3164) return true;
  if (cp === 0xfeff || cp === 0xffa0 || cp === 0xe0001) return true;
  if (cp >= 0x180b && cp <= 0x180e) return true;
  if (cp >= 0x200c && cp <= 0x200f) return true;
  if (cp >= 0x202a && cp <= 0x202e) return true;
  if (cp >= 0x2060 && cp <= 0x2064) return true;
  if (cp >= 0x206a && cp <= 0x206f) return true;
  if (cp >= 0xe0020 && cp <= 0xe007f) return true;
  return false;
}

/**
 * Strips HFS-ignorable Unicode code points from a segment.
 *
 * @param {string} segment
 * @returns {{ stripped: string, hadIgnorable: boolean }}
 */
export function stripHfsIgnorable(segment) {
  let stripped = "";
  let hadIgnorable = false;
  for (const ch of segment) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isHfsIgnorableCodePoint(cp)) {
      hadIgnorable = true;
    } else {
      stripped += ch;
    }
  }
  return { stripped, hadIgnorable };
}

/**
 * Strips trailing dots/spaces and NTFS Alternate Data Stream suffixes (`:...`).
 *
 * @param {string} segment
 * @returns {string}
 */
function normalizeNtfsSegment(segment) {
  const colonIdx = segment.indexOf(":");
  const base = colonIdx === -1 ? segment : segment.slice(0, colonIdx);
  let end = base.length;
  while (end > 0 && (base[end - 1] === "." || base[end - 1] === " ")) {
    end -= 1;
  }
  return base.slice(0, end).toLowerCase();
}

/**
 * @typedef {object} ProtectedNameHit
 * @property {string} segment
 * @property {"error" | "warn"} severity
 * @property {string} kind
 * @property {string} detail
 */

/**
 * Inspects a single path segment for NTFS/HFS+ protected `.git` variants or
 * Windows reserved device names.
 *
 * @param {string} segment
 * @returns {ProtectedNameHit | null}
 */
export function checkProtectedSegment(segment) {
  if (!segment || segment === "." || segment === "..") return null;

  const lower = segment.toLowerCase();
  const ntfsNorm = normalizeNtfsSegment(segment);

  // Exact or case-variant .git, trailing dots/spaces, ADS, or 8.3 short name git~1
  if (lower === ".git") {
    return {
      segment,
      severity: "error",
      kind: "dotgit-exact",
      detail: "Component is '.git' (or case variant), which aliases Git metadata."
    };
  }

  if (ntfsNorm === ".git" || ntfsNorm === "git~1") {
    return {
      segment,
      severity: "error",
      kind: "ntfs-dotgit",
      detail: `NTFS normalizes '${segment}' to '.git' (trailing dots/spaces, ADS, or 8.3 short name).`
    };
  }

  // NTFS .gitmodules variants (excluding exact '.gitmodules' which is a normal repo file)
  if (lower !== ".gitmodules" && (ntfsNorm === ".gitmodules" || ntfsNorm === "gitmod~1")) {
    return {
      segment,
      severity: "error",
      kind: "ntfs-dotgitmodules",
      detail: `NTFS normalizes '${segment}' to '.gitmodules'.`
    };
  }

  // HFS+ / APFS ignorable Unicode characters hiding .git or .gitmodules
  const { stripped, hadIgnorable } = stripHfsIgnorable(segment);
  if (hadIgnorable) {
    const strippedLower = stripped.toLowerCase();
    if (strippedLower === ".git" || normalizeNtfsSegment(stripped) === ".git") {
      return {
        segment,
        severity: "error",
        kind: "hfs-dotgit",
        detail: "HFS+/APFS strips ignorable Unicode characters, resolving this component to '.git'."
      };
    }
    if (strippedLower === ".gitmodules") {
      return {
        segment,
        severity: "error",
        kind: "hfs-dotgitmodules",
        detail: "HFS+/APFS strips ignorable Unicode characters, resolving this component to '.gitmodules'."
      };
    }
  }

  // Windows reserved device names (e.g. CON, NUL, COM1.txt, aux )
  const dotIdx = ntfsNorm.indexOf(".");
  const deviceStem = dotIdx === -1 ? ntfsNorm : ntfsNorm.slice(0, dotIdx);
  if (WINDOWS_RESERVED_DEVICES.has(deviceStem)) {
    return {
      segment,
      severity: "warn",
      kind: "windows-device-name",
      detail: `'${deviceStem.toUpperCase()}' is a Windows reserved device name that cannot be checked out normally on Windows.`
    };
  }

  return null;
}

/**
 * Checks all segments of a path (tree entry or symlink target) for protected names.
 *
 * @param {string} pathStr
 * @returns {ProtectedNameHit[]}
 */
export function findProtectedNameHits(pathStr) {
  /** @type {ProtectedNameHit[]} */
  const hits = [];
  for (const seg of splitPathSegments(pathStr)) {
    const hit = checkProtectedSegment(seg);
    if (hit) hits.push(hit);
  }
  return hits;
}
