# safetree

Read-only Git tree and symlink security and Windows compatibility auditor.

## The Problem

A Git repository's tree can contain entries that are dangerous or silently broken once checked out:
- Symlinks pointing to absolute host paths (`/etc/passwd`), UNC network shares (`\\attacker\share` — risking Windows NTLMv2 credential leaks), or escaping the repo root (`../../outside`).
- Tree entries sitting **behind** a symlink in the same tree (e.g., symlink `a` alongside `a/hooks/post-checkout` or case-variant `A/hooks/post-checkout`).
- Path components that Windows (NTFS) or macOS (HFS+/APFS) treat as `.git` (`.git.`, `GIT~1`, invisible Unicode).
- Suspicious `.gitmodules` URLs (`ext::`, `fd::`, leading `-`).
- **Windows `core.symlinks=false` fallout:** On Windows without Developer Mode or admin privileges, Git checks out every committed symlink (`120000`) as a plain text file containing only the target path string. For example, a symlinked `package.json -> ../shared/package.json` becomes a 22-byte text file containing `../shared/package.json`, silently breaking builds and tools.

`safetree` inspects the committed tree **without checking anything out** (both locally and for remote URLs via `safetree inspect`), and detects symlinks that were already checked out as text stubs.

> **Important:** A clean `safetree` report does **not** mean a repository is safe to run. `safetree` audits Git tree structure, symlinks, and `.gitmodules`—not source code, install scripts, or binaries.

## Quick Start

Requires **Node.js >= 22** and **Git >= 2.25.0**.

```bash
# Audit the current local repository (read-only, offline)
npx safetree

# Audit a specific revision
npx safetree . --rev v1.0.0

# Safely inspect a remote repository without checking out any files
npx safetree inspect https://github.com/org/repo.git
```

## Sample Output

### `safetree` (local repository)

```text
safetree audit: . (rev: HEAD)

[ERROR] ST002 Symlink target is a UNC/network path
  path:     links/share
  evidence: links/share -> \\\\evil\\share\\file
  why:      On Windows, resolving a UNC symlink target can trigger an outbound SMB connection and leak NTLMv2 credentials to a remote server (see docs/GIT-BEHAVIOR.md).
  next:     verify before running: do not check out on Windows; remove or replace the UNC symlink.

[INFO]  ST011 Tree summary
  evidence: entries=42, symlinks=1, executables=2, submodules=0, top-dirs=[src:20, test:12, docs:5]
  why:      Inventory of tree entry types and top-level directory sizes.
  next:     verify before running: review any error/warn findings above before checkout.

Result: 1 error(s), 0 warning(s), 1 info(s)
```

### `safetree inspect <url>` (pre-checkout remote audit)

```bash
npx safetree inspect https://github.com/org/repo.git --format json
```

`inspect` validates the URL strictly, clones with `git clone --no-checkout --no-tags --depth 1 --no-recurse-submodules` into an isolated `0700` temporary directory with hooks, `fsmonitor`, and `ext::` disabled, audits the tree, and **always** deletes the temporary directory afterwards.

- **Network & credentials:** `inspect` uses the network and your configured Git credentials for `https://` or `ssh://`.
- **What it cannot guarantee:** A malicious server can still serve a crafted packfile or a different tree later on a real clone. Never checking out is what protects your working tree during inspection.

## Rules

See [docs/RULES.md](./docs/RULES.md) for full details and examples.

| ID | Severity | Summary |
| --- | --- | --- |
| `ST001` | `error` | Symlink with an absolute target (`/etc/passwd`, `C:\...`) |
| `ST002` | `error` | Symlink target is a UNC/network path (`\\host\share`, `//host/share`) |
| `ST003` | `error` | Symlink target escapes repository root, uses mixed `/` and `\`, or exceeds 4096 bytes |
| `ST004` | `warn` | Dangling symlink (target not found in the same tree) |
| `ST005` | `warn`/`info` | Windows `core.symlinks=false` impact report (higher severity for code/config/manifest paths) |
| `ST006` | `error` | Entry behind a symlink in the same tree (including case-insensitive variants) |
| `ST007` | `error`/`warn` | NTFS/HFS+ protected `.git`/`.gitmodules` variants or Windows reserved device names |
| `ST008` | `warn` | Suspicious `.gitmodules` (symlinked, `ext::`, `fd::`, leading `-`, control chars, `file://`, `..` path) |
| `ST009` | `warn` | Case-insensitive or NFC/NFD collision involving a symlink or directory prefix |
| `ST010` | `error` | Working-tree text stub (mode `120000` in index, regular file on disk) |
| `ST011` | `info` | Tree summary (symlinks, executables, submodules, total entries, largest directories) |

## Configuration (`.safetreerc.json`)

Optional `.safetreerc.json` in the repository root (or passed via `--config <path>`):

```json
{
  "failOn": "error",
  "maxEntries": 1000000,
  "ignore": [
    {
      "rule": "ST004",
      "path": "docs/generated-link",
      "reason": "Points to build output generated in CI"
    }
  ]
}
```

Every `ignore` entry requires a non-empty `reason` and at least one of `rule` or `path`.

## CI Integration (GitHub Actions)

```yaml
name: safetree
on: [pull_request]
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: npx safetree --format github
```

### Pre-push Hook Example

```sh
#!/bin/sh
npx safetree --fail-on error
```

## What Does Git Already Protect?

See [docs/GIT-BEHAVIOR.md](./docs/GIT-BEHAVIOR.md) for verified details. In short:
- `git fsck` checks `hasDotgit`, `symlinkPointsToGitDir`, `gitmodulesSymlink`, `gitmodulesUrl`, and `gitmodulesPath` — **but `git clone` does not run `fsck` by default** (`transfer.fsckObjects` defaults to `false`).
- `core.protectNTFS` (default `true` on Windows) and `core.protectHFS` (default `true` on macOS) block `.git` checkout exploits locally, but do not warn you about cross-platform issues before checkout or report Windows `core.symlinks=false` text stubs.

## Tool Comparison

| Tool | Pre-checkout `inspect` | Windows stub impact (`ST005`/`ST010`) | UNC / escaping symlinks | Entries behind symlinks | NTFS/HFS `.git` | CI formats (SARIF/GH) |
| --- | --- | --- | --- | --- | --- | --- |
| **`safetree`** | Yes (`--no-checkout`) | Yes | Yes | Yes | Paths + symlink targets | `human`, `json`, `github`, `sarif` |
| **`git fsck`** | Local object DB only | No | `.git` targets only | No | Tree paths only | Plain text |
| **`pre-commit-hooks`** (`check-symlinks`, `destroyed-symlinks`) | No (needs checkout) | `destroyed-symlinks` only | No | No | No | Plain text |

## FAQ

**How is this different from `git fsck`?**
`git fsck` validates object integrity and a narrow set of `.git`/`.gitmodules` rules, and is not run by default on `git clone`. `safetree` focuses on symlink safety (UNC, absolute, escaping, entries behind symlinks), Windows `core.symlinks=false` impact and stub detection, pre-checkout `inspect`, and CI reporting.

**How is this different from `pre-commit-hooks`?**
`check-symlinks` and `destroyed-symlinks` require Python and an already-checked-out working tree. `safetree` has zero runtime dependencies, runs offline against any `--rev`, and can `inspect` remote repositories without checking out files.

## Limitations

See [docs/LIMITATIONS.md](./docs/LIMITATIONS.md). Key points: lexical path resolution only; does not inspect inside submodules; `inspect` uses `--depth 1` (tip only); `.gitmodules` uses a simple line-based parser; a clean report does not make a repository safe.

## License

[MIT](./LICENSE)
