# Limitations

`safetree` is a static, read-only Git tree and symlink auditor. Understanding what it does **not** do is essential:

1. **Lexical path resolution only:** `safetree` resolves `..` and `.` segments lexically against the committed tree listing. It does not follow symlinks across multiple hops or resolve OS-level mount points.
2. **Cannot see inside submodules:** Submodule entries (`160000`) are only commit OID pointers; `safetree` never fetches or clones submodules.
3. **Shallow `inspect` sees only the tip:** `safetree inspect <url>` uses `git clone --depth 1 --no-checkout` and therefore audits only the tip commit of the default branch (or `--rev` if present in the shallow clone), not full commit history.
4. **Line-based `.gitmodules` parsing:** ST008 uses a simple linear-time line parser rather than a full Git config parser. Multi-line continuations or `include.path` directives are not evaluated, and `file://`/local URLs are flagged as low-confidence heuristics.
5. **Non-UTF-8 paths:** Raw bytes from `git ls-tree -z` are preserved in `pathBuf` and escaped for display (`\xNN`), while lexical matching decodes paths as UTF-8.
6. **Clean report != safe repository:** A repository with 0 `safetree` findings can still contain malicious source code, dangerous `package.json` install scripts, or hostile CI workflows. Always review code before running it.
