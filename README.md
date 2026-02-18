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
```

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

See [spec.md](spec.md) for the full specification.

## License

[MIT](LICENSE)
