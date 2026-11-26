# Security Review & Threat Model Checklist

This document records the security architecture and self-review for `safetree`.

## Threat Model

All inspected repositories (local or remote), `.gitmodules` contents, symlink target blobs, file names, and remote URLs are **untrusted input**.

## Checklist

- [x] **No working-tree checkout during `inspect`**: `safetree inspect` runs `git clone --no-checkout --no-tags --depth 1 --no-recurse-submodules`, verified by e2e tests asserting only `.git` exists in the clone directory.
- [x] **No repo-controlled code execution**: Every `git` invocation passes `-c core.fsmonitor=false`, `-c core.hooksPath=<empty-0700-dir>`, `-c protocol.ext.allow=never`, `GIT_TERMINAL_PROMPT=0`, and `GIT_OPTIONAL_LOCKS=0`.
- [x] **No `exec`, `eval`, `new Function`, or `shell: true`**: Verified across `src/` (enforced by ESLint `no-eval`, `no-implied-eval`, `no-new-func`, and code review).
- [x] **Strict URL validation (`src/url.js`)**: Rejects leading `-`, whitespace/control chars, `ext::`, `fd::`, `http://`, `git://`, and unknown schemes. Restricts `GIT_ALLOW_PROTOCOL` to `https` or `ssh` (`file` only with `--allow-local`). Target is always passed after `--`.
- [x] **Process timeouts and tree killing (`src/git.js`)**: Every `git` process has a timeout and kills the process tree (`taskkill /T /F` on Windows, `SIGKILL` on POSIX).
- [x] **Resource limits**: `maxEntries` (default `1,000,000`), symlink blob cap (`4096` bytes), `.gitmodules` blob cap (`1 MiB`), `MAX_FINDINGS` (`5000`), `maxBuffer` on stdout/stderr, linear-time path and `.gitmodules` parsing.
- [x] **Isolated temp directories (`src/tempdir.js`)**: `fs.mkdtemp` + `0700` permissions, always cleaned up in `finally` and on `SIGINT`/`SIGTERM`/`exit` (unless `--keep` is explicitly passed).
- [x] **Output hygiene (`src/escape.js`)**: Escapes control characters (`0x00`–`0x1F`, `0x7F`, `0x80`–`0x9F`), ANSI sequences, newlines, bidi overrides, and invalid UTF-8 (`\xNN`), plus GitHub Actions workflow delimiters (`%`, `\r`, `\n`, `:`, `,`). Reports repo-relative paths only.
- [x] **Config safety (`src/config.js`)**: Strict schema allowlist; rejects `__proto__`, `constructor`, `prototype`, and unknown keys.
- [x] **Supply chain**: Zero runtime dependencies, lockfile committed, `npm audit` clean, `"files"` allowlist in `package.json`, GitHub Actions pinned to commit SHAs with least-privilege `permissions:`.
