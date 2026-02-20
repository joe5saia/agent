# Agent

A minimal, general-purpose AI agent that runs on a dedicated VM within a Tailscale network.

## Features

- **Interactive mode** — web chat interface with threaded conversations
- **Scheduled mode** — cron-triggered automated tasks
- **Tool system** — extensible CLI tool registration with TypeBox schemas
- **Structured workflows** — repeatable workflows defined in YAML

## Prerequisites

- Node.js ≥ 20
- A Tailscale network (for deployment)

## Getting Started

```bash
# Install dependencies
npm install

# Run all checks (lint, format, type check) in parallel
npm run check

# Run tests
npm test

# Build
npm run build

# Start server runtime
node dist/index.js

# One-shot CLI prompt mode
echo "hello" | node dist/index.js --prompt
```

## Docker (Alpine)

```bash
# Build and run
docker compose up -d --build

# Open UI
open http://127.0.0.1:8080/ui/
```

The container persists runtime state in a named volume at `/home/agent/.agent`.
Set API credentials in `deploy/docker/.env` (copy from `deploy/docker/.env.example`).

## Development

| Command               | Description                                     |
| --------------------- | ----------------------------------------------- |
| `npm run check`       | Run linting, format checking, and type checking |
| `npm run lint`        | Run oxlint with type-aware rules                |
| `npm run lint:fix`    | Run oxlint with auto-fix                        |
| `npm run lint:format` | Check formatting with oxfmt                     |
| `npm run format`      | Format code with oxfmt                          |
| `npm run tsc`         | Type check with tsgo                            |
| `npm test`            | Run tests with vitest                           |
| `npm run test:watch`  | Run tests in watch mode                         |
| `npm run build`       | Build with tsgo                                 |

## Architecture

- Runtime entrypoint: `src/index.ts`
- Web UI: `http://127.0.0.1:8080/ui/` (default)
- Full specs: `docs/spec-*.md`

## Deployment

See [docs/deployment-guide.md](docs/deployment-guide.md) for VM setup, systemd, Tailscale
exposure, and operations guidance.

## License

[MIT](LICENSE)
