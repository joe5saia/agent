# Specification: Overview

This document covers the project goals, methodology, and high-level architecture for the AI agent.

**Related documents:**

- [Technology Stack](spec-technology-stack.md) — runtime, dependencies, tooling
- [Agent Loop & Tools](spec-agent-loop.md) — core loop and tool system
- [Sessions](spec-sessions.md) — session management and persistence
- [Automation](spec-automation.md) — cron jobs and workflows
- [Web Interface](spec-web-interface.md) — HTTP API and WebSocket protocol
- [Security](spec-security.md) — security model and storage
- [System Prompt & Observability](spec-system-prompt.md) — prompt assembly, logging, error handling
- [Configuration](spec-configuration.md) — config validation and session naming
- [Project Structure](spec-project-structure.md) — source layout, milestones, deployment

---

## 1. Goals

Build a minimal agent that runs on a dedicated virtual machine within a Tailscale network. The agent has two interaction modes:

1. **Interactive** — a small web app exposes a chat interface with threads. Each thread is a separate conversation with its own context.
2. **Scheduled** — the agent is triggerable by cron for recurring automated tasks.

Design principles:

- **Simplicity** — built in the simplest way possible without sacrificing security.
- **General purpose** — the agent is tool-agnostic. We primarily provide CLI tools that interact with services.
- **Repeatable workflows** — the harness handles structured workflows defined in files.

---

## 2. Project Methodology

This project uses TDD and spec-based development. Specs are detailed markdown files containing testing criteria and scenarios that the build must be validated against.

We follow the **RPI methodology** (Research, Plan, Implement):

1. **Research** — study existing projects, document findings in [research_findings.md](research_findings.md).
2. **Plan** — expand specs with implementation details, define test scenarios.
3. **Implement** — build against the specs, validate with tests.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Our Code (owned)                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │  Agent Loop   │  │  Tool System  │  │  Sessions    │  │
│  │  (custom)     │  │  (TypeBox)    │  │  (JSONL)     │  │
│  └──────┬───────┘  └───────────────┘  └──────────────┘  │
│         │                                                │
│  ┌──────┴───────┐  ┌───────────────┐  ┌──────────────┐  │
│  │  Cron Service │  │  Web Server   │  │  Workflows   │  │
│  │  (croner)     │  │  (HTTP + WS)  │  │  (YAML)      │  │
│  └──────────────┘  └───────────────┘  └──────────────┘  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                  Dependency (not owned)                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  @mariozechner/pi-ai                              │   │
│  │  stream() / complete() / getModel()               │   │
│  │  → Anthropic, OpenAI, Google, Mistral, etc.       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Boundary: Owned vs. Dependency

**`@mariozechner/pi-ai`** (dependency) — handles the LLM provider abstraction layer. Provides a unified streaming API across 20+ providers with TypeBox-based tool schemas. We use this because wrapping provider SDKs is hundreds of lines of plumbing with no architectural value.

**Everything else** (owned) — the agent loop, tool system, session management, cron service, web server, workflow engine, and security layer. We own these because they are the identity of the agent and need to integrate tightly with each other.

### 3.2 Key Architectural Decisions

| Decision           | Choice                             | Rationale                                                                                       |
| ------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| LLM provider layer | `@mariozechner/pi-ai`              | Unified API across 20+ providers, TypeBox integration, battle-tested by pi-mono and OpenClaw    |
| Agent loop         | Custom (inspired by pi-agent-core) | ~50 lines of core logic; owning it lets us integrate workflows, cron, and permissions naturally |
| Tool schemas       | TypeBox (`@sinclair/typebox`)      | Single definition produces both JSON Schema (for LLM) and TypeScript types (for code)           |
| Session storage    | JSONL files (append-only)          | Simple, human-readable, no database required; proven by all three inspiration projects          |
| Cron scheduling    | croner                             | Zero dependencies, overrun protection, timezone support, async-native                           |
| Network security   | Tailscale                          | Network-level auth, no public internet exposure, identity headers                               |
| Web framework      | Hono + `@hono/node-server`         | Lightweight, Web Standards API, built-in WS + static file support, minimal surface area         |
