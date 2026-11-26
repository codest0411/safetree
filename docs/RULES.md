# `safetree` Rules Reference

All rules produce findings with: `id`, `severity`, `title`, `path`, `evidence`, `why`, and `nextStep` (prefixed with `verify before running:`).

## ST001 — Symlink with an absolute target (`error`)
- **What it detects:** A committed symlink (`120000`) whose target begins with `/`, `\`, or a Windows drive letter (`C:\...`, `C:/...`).
- **Example:** `links/passwd -> /etc/passwd`
- **Why it matters:** Absolute targets point outside the repository to host filesystem locations and break or leak host files depending on tooling.

## ST002 — Symlink target is a UNC/network path (`error`)
- **What it detects:** A symlink target starting with `\\` or `//` (e.g., `\\server\share\file`, `//server/share`, `\\?\UNC\...`).
- **Example:** `links/share -> \\attacker\share\file`
- **Why it matters:** On Windows, probing or resolving a UNC path can trigger an outbound SMB connection and leak NTLMv2 credentials (see [GIT-BEHAVIOR.md](./GIT-BEHAVIOR.md)).

## ST003 — Symlink target escapes repository root or uses mixed separators (`error`)
- **What it detects:** Lexical traversal (`..`) past the repository root, mixed `/` and `\` separators in the target, or oversized symlink blobs (> 4096 bytes).
- **Example:** `a/link -> ../../outside` or `a/link -> sub\file/x`
- **Why it matters:** Escaping targets can trick tools or vulnerable Git clients into reading/writing outside the worktree; mixed separators behave differently across OSes.

## ST004 — Dangling symlink (`warn`)
- **What it detects:** A relative in-tree symlink whose lexically resolved target does not match any file or directory prefix in the same tree.
- **Example:** `docs/alias -> missing.md`
- **Why it matters:** Often indicates a broken link, a missing file, or a build-time generated target.
- **False positives:** Intentional symlinks to gitignored build artifacts can be allowlisted in `.safetreerc.json` with a `reason`.

## ST005 — Windows `core.symlinks=false` impact report (`warn` / `info`)
- **What it detects:** Summarizes all symlinks in the tree, classifies each as file vs directory (when determinable), and flags `warn` if any symlink path has a high-impact extension or basename (source code, configs, manifests such as `package.json`, `Cargo.toml`, `LICENSE`, `.js`, `.ts`, `.py`, `.json`, `.yaml`, etc.).
- **Why it matters:** On Windows when `core.symlinks=false` (the default without Developer Mode or admin privileges), Git checks out every symlink as a plain text file containing only the target path string.

## ST006 — Entry behind a symlink in the same tree (`error`)
- **What it detects:** Any tree entry whose parent path component (exact or case-insensitive) is itself a symlink in the same tree.
- **Example:** `sym` (mode `120000`) and `sym/hooks/post-checkout` (or `SYM/hooks/post-checkout`) in the same tree.
- **Why it matters:** This is the classic checkout-redirection pattern behind vulnerabilities such as CVE-2024-32002.

## ST007 — Protected or special filesystem names (`error` / `warn`)
- **What it detects:** Path components (in tree paths **and** symlink targets) matching Git's verified `core.protectNTFS` / `core.protectHFS` `.git` and `.gitmodules` variants (case variants, trailing dots/spaces, `GIT~1`, NTFS Alternate Data Streams `::$DATA`, HFS+ ignorable Unicode characters) as `error`, and Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) as `warn`.

## ST008 — Suspicious `.gitmodules` (`warn`)
- **What it detects:** `.gitmodules` stored as a symlink (`120000`), or `.gitmodules` entries with `url` using `ext::`, `fd::`, leading `-`, control characters, `file://`/local paths (marked `lowConfidence: true`), or `path` containing `..` or absolute paths.

## ST009 — Case-insensitive or NFC/NFD collision with symlink or directory (`warn`)
- **What it detects:** Two or more tree paths that collide under ASCII case-folding or Unicode NFC normalization where at least one colliding entry is a symlink (`120000`) or a directory prefix.

## ST010 — Working-tree text stub (`error`)
- **What it detects:** In local working-tree mode, an index entry with mode `120000` (symlink) that is a regular file on disk, displaying its escaped stub content.
- **Why it matters:** Indicates `core.symlinks=false` already turned the symlink into a text stub on disk.

## ST011 — Tree summary (`info`)
- **What it detects:** Reports total entries, symlinks, executables (`100755`), submodules (`160000`), truncation status, and top 5 largest top-level directories.
