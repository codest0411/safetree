# Contributing to `safetree`

Thank you for helping improve `safetree`!

## Development Setup

Requirements:
- Node.js >= 22 (non-EOL LTS lines: 22, 24, 26)
- Git >= 2.25.0

```bash
git clone https://github.com/safetree/safetree.git
cd safetree
npm install
```

## Checks

Run all checks before opening a pull request:

```bash
npm run lint
npm run typecheck
npm run build:types
npm test
npm run test:coverage
```

## Guidelines

- Keep **zero runtime dependencies** (Node.js built-ins only).
- Write ESM JavaScript with JSDoc types checked by `tsc --noEmit`.
- Never use `exec`, `eval`, `new Function`, or `shell: true`.
- Pass all repository-derived paths and URLs through `escapeDisplay` before display, and pass `git` targets after `--`.
- Test fixtures must use `git hash-object` + `git update-index --cacheinfo` (never require OS symlink privileges).
