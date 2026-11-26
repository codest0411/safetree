# Security Policy

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, report them privately via **GitHub Security Advisories** ("Security" tab -> "Advisories" -> "Report a vulnerability" in the repository).

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (or a minimal fixture repository / input)
- Any suggested remediation if known

We aim to acknowledge reports within 72 hours and provide a fix or mitigation plan as quickly as possible.

## Threat Model Summary

`safetree` treats all inspected Git repositories and remote URLs as **untrusted input**:
- Never checks out working-tree files during `safetree inspect` (`git clone --no-checkout`)
- Disables hooks, `fsmonitor`, and `ext::` transport on every `git` invocation
- Executes `git` via `spawn` with argument arrays (`shell: false`), timeouts, and output caps
- Escapes control characters, ANSI sequences, and invalid UTF-8 in all output formats
