# Existing Tools & Competitors

This document surveys existing tools that inspect Git symlinks, tree entries, or repository safety, and explains where `safetree` differs.

## Surveyed Tools

1. **Git built-in `git fsck`** — [git-scm.com/docs/git-fsck](https://git-scm.com/docs/git-fsck)
   - **What it does:** Verifies object connectivity and checks a specific set of security-related `fsck` message IDs (`hasDotgit`, `gitmodulesSymlink`, `gitmodulesUrl`, `gitmodulesPath`, `symlinkPointsToGitDir`).
   - **What it does NOT do:** Does not run by default on `git clone`; does not flag arbitrary absolute, UNC, or escaping symlinks; does not detect entries behind symlinks in the same tree; does not detect case/Unicode collisions; does not report Windows `core.symlinks=false` impact or working-tree text stubs; does not emit SARIF/GitHub Actions annotations.

2. **`pre-commit-hooks` (`check-symlinks` and `destroyed-symlinks`)** — [github.com/pre-commit/pre-commit-hooks](https://github.com/pre-commit/pre-commit-hooks)
   - **What it does:** `check-symlinks` checks staged/committed symlinks in a checked-out working tree for broken targets; `destroyed-symlinks` detects regular files whose content looks like a path that used to be a symlink (typically caused by Windows `core.symlinks=false`).
   - **What it does NOT do:** Requires Python and `pre-commit`, operates on an already-checked-out working tree (cannot inspect a remote repo pre-checkout), does not check UNC/escaping symlinks, entries behind symlinks, NTFS/HFS+ `.git` variants, `.gitmodules`, or case/Unicode collisions.

3. **Cargo (`cargo package` / `cargo publish` symlink handling)** — [doc.rust-lang.org/cargo](https://doc.rust-lang.org/cargo/)
   - **What it does:** Warns or fails when packaging Rust crates if symlinks cannot be resolved or cause filesystem loops on Windows.
   - **What it does NOT do:** Rust-packaging specific; not a general Git tree or pre-checkout security auditor.

4. **General SCA / SAST Scanners (e.g., Semgrep, GitGuardian, Socket.dev)**
   - **What they do:** Scan source code, secrets, or package dependencies.
   - **What they do NOT do:** Do not perform dedicated Git tree-mode (`120000`) lexical symlink traversal, Windows stub impact reporting, or pre-checkout `--no-checkout` Git tree auditing.

## Differentiation

`safetree` fills a specific gap between `git fsck` and `pre-commit-hooks`: it is a zero-dependency Node.js CLI and library that audits a Git tree **without checking it out** (both locally via `--rev` and remotely via `safetree inspect <url>`), combines cross-platform symlink security checks (absolute, UNC, root-escaping, entries-behind-symlinks, NTFS/HFS+ `.git` variants, case/Unicode collisions, `.gitmodules`) with practical Windows `core.symlinks=false` impact and working-tree stub detection, and outputs CI-ready `json`, `github`, and `sarif` reports. It complements `git fsck` rather than replacing it.
