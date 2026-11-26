# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-26

### Added
- Initial release of `safetree` CLI and programmatic API (`auditLocalRepo`, `inspectRemoteRepo`).
- Rules `ST001`–`ST011`: absolute/UNC/escaping/dangling symlinks, Windows `core.symlinks=false` impact report, entries behind symlinks (including case-insensitive variants), NTFS/HFS+ protected `.git` & device names, `.gitmodules` security checks, case/NFC-NFD collisions, working-tree text stub detection, and tree summary.
- Safe pre-checkout `safetree inspect <url>` with strict URL validation, `--no-checkout`, isolated `0700` temp directory, and guaranteed cleanup.
- Output formats: `human`, `json`, `github`, `sarif`.
- `.safetreerc.json` configuration with strict schema validation.
