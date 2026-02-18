# Documentation

Project documentation for all contributors and agents. Files in this directory should be clear, well-structured, and kept up to date.

## Index

<!-- Add entries here as documents are created. Keep sorted alphabetically. -->

| Document                                               | Description                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| [implementation-plan.md](implementation-plan.md)       | Ordered build plan with tasks, deliverables, and acceptance criteria   |
| [spec-agent-loop.md](spec-agent-loop.md)               | Agent loop core and tool system (§5–§6)                                |
| [spec-automation.md](spec-automation.md)               | Cron scheduled triggers and structured workflows (§8–§9)               |
| [spec-configuration.md](spec-configuration.md)         | Configuration validation and session naming UX (§17–§18)               |
| [spec-overview.md](spec-overview.md)                   | Goals, methodology, and architecture overview (§1–§3)                  |
| [spec-project-structure.md](spec-project-structure.md) | Source layout, milestones, deployment, inspirations (§19–§22)          |
| [spec-security.md](spec-security.md)                   | Security model and storage/persistence (§11–§12)                       |
| [spec-sessions.md](spec-sessions.md)                   | Session & thread management, JSONL format, compaction (§7)             |
| [spec-system-prompt.md](spec-system-prompt.md)         | System prompt assembly, logging, and error handling (§13–§15)          |
| [spec-technology-stack.md](spec-technology-stack.md)   | Runtime, dependencies, linting, formatting, testing (§4)               |
| [spec-web-interface.md](spec-web-interface.md)         | Web interface, REST API, WebSocket protocol, Hono framework (§10, §16) |

## Style Guidelines

### Document Structure

1. **Title** — `# Specification: <Topic>` as the first line.
2. **Summary** — A one- or two-sentence description of what the document covers, immediately below the title.
3. **Related documents** — A bold `**Related documents:**` block listing links to other docs in this directory. Use the format `- [Display Name](filename.md) — short description`. Only link to documents that are directly relevant.
4. **Horizontal rule** — A `---` separator between the front matter and the first content section.
5. **Sections** — Use `##` for top-level sections (numbered, e.g., `## 5. Agent Loop`) and `###` for subsections (e.g., `### 5.1 Core Loop`).
6. **Test scenarios** — Each section that defines behavior ends with a `### X.Y Test Scenarios` subsection. Scenarios are prefixed with a unique ID (e.g., `**S5.1**:`).

### Formatting Conventions

- **Bold** for key terms on first use and for emphasis in lists.
- **Code fences** with language tags (`typescript`, `yaml`, `bash`, `json`, `jsonl`) for all code blocks.
- **Tables** for comparisons, option lists, and structured data. Use consistent column alignment.
- **Em dashes** (`—`) for parenthetical asides, not hyphens or en dashes.
- **Section references** use `§` notation (e.g., `§6.3`) when referring to sections within the same document. Use markdown links with anchors (e.g., `[§6.3](spec-agent-loop.md#63-cli-tool-registration)`) when referencing other documents.

### File Conventions

- **Filenames** — `spec-<topic>.md`, lowercase with hyphens.
- **Target length** — Each file should be under 500 lines. Never exceed 1000 lines; split into separate documents if needed.
- **Cross-linking** — Documents must link to related docs in the front matter and use inline links for specific cross-references. Prefer deep-linked anchors over generic file links.
- **Self-contained sections** — Each document should be readable on its own. Repeat minimal context rather than requiring the reader to jump between files for basic understanding.

### Writing Style

- **Concise and direct** — Use short sentences. State what the system does, not what it might do.
- **Present tense** — "The agent creates a session" not "The agent will create a session."
- **Active voice** — "The blocklist rejects dangerous commands" not "Dangerous commands are rejected by the blocklist."
- **Preserve specifics** — Always include exact file paths, function names, config keys, and error messages. Never paraphrase technical identifiers.

## Process for Updating Documentation

1. **Adding a new document** — Create the file in this directory, then add an entry to the index table above. Keep the table sorted alphabetically by document name.
2. **Updating an existing document** — Edit the file directly. If the scope or title changes, update the corresponding index entry.
3. **Removing a document** — Delete the file and remove its index entry.
4. **Index maintenance** — The index must stay in sync with the directory contents. Every pull request that adds, renames, or removes a doc file must include the matching index update.
