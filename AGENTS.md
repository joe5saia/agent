# Agent Guidelines

## Running CI Checks

```bash
# Run all checks (lint, format, type check) in parallel — this is the CI gate
npm run check

# Run tests
npm test
```

Individual commands:

| Command               | What it does                            |
| --------------------- | --------------------------------------- |
| `npm run tsc`         | Type check via `tsgo` (not `tsc`)       |
| `npm run lint`        | Lint via `oxlint` with type-aware rules |
| `npm run lint:fix`    | Lint with auto-fix                      |
| `npm run lint:format` | Check formatting via `oxfmt`            |
| `npm run format`      | Auto-format via `oxfmt`                 |
| `npm test`            | Run tests via `vitest`                  |

## Manual Agent Invocation (Testing)

Use this to run the built CLI agent directly:

```bash
# Rebuild dist after source changes
npm run build

# Run one prompt through the CLI agent
echo "hello" | node dist/index.js
```

Notes:

- The CLI reads config from `~/.agent/config.yaml` (or `AGENT_CONFIG_PATH`).
- Auth resolution order is `ANTHROPIC_OAUTH_TOKEN` -> `ANTHROPIC_API_KEY` -> `~/.agent/auth.json`.

## Non-Standard Tooling

- **Type checker is `tsgo`**, not `tsc`. The `@typescript/native-preview` package provides a Go-native TypeScript compiler. All `tsc` invocations are replaced with `tsgo`.
- **Linter is `oxlint`**, not ESLint. Config lives in `oxlint.config.ts`. The lint script sets `NODE_OPTIONS='--experimental-strip-types'` so Node can load the TS config file.
- **Formatter is `oxfmt`**, not Prettier. Config lives in `.oxfmtrc.jsonc`.
- **Style conventions**: tabs, double quotes, semicolons always, trailing commas, 100 char print width, LF line endings.

## Documentation

### `docs/`

Tracked project documentation for all contributors and agents. The `docs/README.md` contains an index table that **must** be kept in sync — any PR that adds, renames, or removes a doc must update the index.

### `scratch_docs/`

Temporary working files (plans, research notes, drafts). Everything except `scratch_docs/README.md` is git-ignored. Anything worth keeping should be promoted to `docs/`.

## Starting Work

Work is tracked in implementation plans in the file [`docs/implementation-plan.md`](docs/implementation-plan.md). When you start work read the plan and update it as you go. Make sure you track work in the plan as you complete so that we can keep track of the status of the work.

## Documenting Bugs

When you find a bug that you cannot fix right away, please document it in [docs/known-bugs.md](docs/known-bugs.md). Include a description of the bug, steps to reproduce, and any relevant information that may help in fixing the bug.
