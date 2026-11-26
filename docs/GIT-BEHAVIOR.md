# Git Behavior Reference

This document records verified facts about how Git handles symbolic links, filesystem-specific path protections, `.gitmodules`, and transport protocols, based on official Git documentation and Git security advisories. It serves as the reference for `safetree`'s rules and `inspect` sandboxing.

## 1. `git fsck` and `fsck.<msg-id>`

Reference: [git-fsck documentation](https://git-scm.com/docs/git-fsck)

`git fsck` verifies the connectivity and validity of objects in the Git object database. By default, `git clone` and `git fetch` do **not** run `fsck` checks on incoming objects unless `transfer.fsckObjects` or `fetch.fsckObjects` is explicitly set to `true`.

Relevant `fsck` message IDs:
- `gitmodulesSymlink` (`ERROR`): `.gitmodules` is a symbolic link (mode `120000`) instead of a regular file.
- `gitmodulesBlob` (`ERROR`): `.gitmodules` is not a blob object.
- `gitmodulesParse` / `gitmodulesLarge` / `gitmodulesMissing` / `gitmodulesPath` / `gitmodulesName` / `gitmodulesUrl` / `gitmodulesUpdate`: validation checks on `.gitmodules` structure, size, paths (e.g., `..` traversal), and URLs (e.g., leading `-`, control characters, or disallowed transports).
- `gitattributesSymlink` (`INFO`), `gitignoreSymlink` (`INFO`), `mailmapSymlink` (`INFO`): special dotfiles stored as symlinks.
- `hasDotgit` (`WARN`): a tree contains an entry named `.git` or a variant that NTFS/HFS+ treats as `.git`.
- `symlinkPointsToGitDir` (`INFO`/`WARN`): a symlink target points into a `.git` directory.

## 2. `core.protectNTFS` and `core.protectHFS`

Reference: [git-config documentation](https://git-scm.com/docs/git-config)

- **`core.protectNTFS`** (default `true` on Windows, `false` elsewhere): Prevents checkout of paths that NTFS would interpret as `.git` or other protected names, including:
  - Case-insensitive variants of `.git` (e.g., `.GIT`, `.Git`)
  - Trailing dots and spaces (e.g., `.git.`, `.git `)
  - NTFS 8.3 short names (e.g., `GIT~1`)
  - NTFS Alternate Data Streams (e.g., `.git::$DATA`, `.git:stream`)
  - Trailing backslashes or Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with or without extensions)
- **`core.protectHFS`** (default `true` on macOS, `false` elsewhere): Prevents checkout of paths that HFS+/APFS would interpret as `.git` after stripping HFS-ignorable Unicode code points (such as zero-width characters `U+200C`–`U+200F`, directional formatting `U+202A`–`U+202E`, `U+206A`–`U+206F`, `U+FEFF`, and related default-ignorable code points) and case folding.

## 3. `core.symlinks` and Windows Text Stubs

Reference: [git-config documentation](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks)

- When `core.symlinks` is `false` (the default on Windows when the user lacks symlink creation privileges or Developer Mode is disabled, or on filesystems like FAT), Git checks out mode `120000` entries as **plain regular files** whose content is the raw symlink target string.
- Tools, compilers, and scripts on Windows then read the target path string as if it were the file's contents (for example, a package manifest, config file, or source file), causing silent breakage or broken builds.

## 4. UNC Paths and Windows Credential Leaks

- On Windows, resolving a UNC path (`\\host\share\...`, `//host/share/...`, or `\\?\UNC\host\share\...`) can cause Windows to initiate an outbound SMB connection and send NTLMv2 credentials to the remote host.
- Git for Windows and ecosystem libraries (e.g., `gix-fs` / `CVE-2026-123532`) have had to guard against probing symlink targets that are UNC paths during checkout/inspection.

## 5. Case-Insensitive Symlink Collisions (CVE-2024-32002)

Reference: [CVE-2024-32002](https://www.cve.org/CVERecord?id=CVE-2024-32002)

- On case-insensitive filesystems (Windows, default macOS APFS), if a tree or submodule contains both a symlink (e.g., `a`) and a directory path beneath a case-variant of that name (e.g., `A/hooks/post-checkout`), checkout ordering or path resolution can redirect writes through the symlink.

## 6. Plumbing Commands & Safe Cloning Options

References: [git-ls-tree](https://git-scm.com/docs/git-ls-tree), [git-cat-file](https://git-scm.com/docs/git-cat-file), [git-clone](https://git-scm.com/docs/git-clone)

- `git ls-tree -r -z --full-tree <rev>`: Lists all tree entries recursively, NUL-terminated (`-z`), with raw unescaped byte paths.
- `git cat-file --batch`: Reads object metadata and raw bytes from stdin object IDs without touching the working tree.
- `git ls-files -s -z`: Lists staged index entries with modes (`120000` for symlinks) NUL-terminated.
- `git clone --no-checkout --no-tags --depth 1 --no-recurse-submodules`: Clones only the tip commit's object database without writing any working-tree files or fetching submodules.
- Hardening flags (all supported in Git >= 2.25.0):
  - `-c core.fsmonitor=false`: Disables filesystem monitor hooks/daemons.
  - `-c core.hooksPath=<empty-dir>`: Prevents execution of any repository or template hooks.
  - `-c protocol.ext.allow=never`: Blocks the `ext::` external-command transport protocol.
  - `GIT_ALLOW_PROTOCOL`: Restricts allowed transport protocols (e.g., `https:ssh`).
  - `GIT_TERMINAL_PROMPT=0`: Prevents interactive credential prompts.
  - `GIT_OPTIONAL_LOCKS=0`: Avoids taking optional index locks during read-only operations.

## 7. Comparison: What Git Already Flags vs. What `safetree` Adds

| Check | `git fsck` / `git clone` (default) | `safetree` |
| --- | --- | --- |
| `.git` / NTFS / HFS+ variants in tree paths | `git fsck` (`hasDotgit`), **not** run by default on `clone` | ST007: checks both tree paths **and** symlink targets |
| `.gitmodules` is a symlink / bad URL or path | `git fsck` (`gitmodulesSymlink`, `gitmodulesUrl`, `gitmodulesPath`), **not** run by default on `clone` | ST008: checks `.gitmodules` symlink, `ext::`/`fd::`/`file://`/leading `-`/control chars, `..`/absolute paths |
| Symlink with absolute target | Not flagged | ST001 (error) |
| Symlink targeting UNC / network share | Not flagged | ST002 (error) |
| Symlink resolving outside repo root / mixed separators | Not flagged | ST003 (error) |
| Dangling symlink (target missing in tree) | Not flagged | ST004 (warn) |
| Windows `core.symlinks=false` impact report | Not available | ST005 (warn/info) with file/dir classification and high-risk extensions |
| Entry behind a symlink in same tree (incl. case variants) | Not flagged | ST006 (error) |
| Case / NFC-NFD collisions involving symlinks or dir prefixes | Not flagged | ST009 (warn) |
| Working-tree text stubs (`core.symlinks=false` fallout) | Not flagged | ST010 (error) |
| Pre-checkout remote inspection without working tree | Requires manual `clone --no-checkout` + custom scripts | `safetree inspect <url>` with strict URL validation & isolated temp dir |
| CI output formats (SARIF, GitHub Actions, JSON) | Plain stderr text only | `human`, `json`, `github`, `sarif` + `.safetreerc.json` |
