# Onboarding Setup

Step-by-step onboarding for running this project with Docker Compose, including Claude Code OAuth and Codex token setup.

**Related documents:**

- [deployment-guide.md](deployment-guide.md) - Production deployment details and operations
- [spec-security.md](spec-security.md) - Credential storage and token resolution behavior
- [implementation-plan.md](implementation-plan.md) - Project task and maintenance tracking

---

## 1. Token Model Used by This Project

The runtime resolves credentials with env-first behavior:

- Anthropic (Claude): `ANTHROPIC_OAUTH_TOKEN` -> `ANTHROPIC_API_KEY` -> `~/.agent/auth.json`
- OpenAI models: `OPENAI_API_KEY`
- OAuth-backed providers (including `openai-codex`) can also use `~/.agent/auth.json`

For this onboarding:

- Use `ANTHROPIC_OAUTH_TOKEN` as your Claude Code OAuth token.
- Use `OPENAI_API_KEY` as your Codex/OpenAI token.

## 2. Shared Prerequisites

- Docker Engine 24+ and Docker Compose installed
- Git installed
- Access to this repository
- A Claude OAuth token and a Codex/OpenAI token

## 3. Gather Tokens

Before starting either setup path, gather:

- Claude Code OAuth token for Anthropic and store it as `ANTHROPIC_OAUTH_TOKEN`
- Codex/OpenAI token and store it as `OPENAI_API_KEY`

## 4. Dedicated VM Setup (Docker Installed)

Use this flow when the agent runs in an isolated VM.

### 4.1 Clone and Enter Project

```bash
git clone <repo-url> agent
cd agent
```

### 4.2 Configure Runtime Tokens

```bash
cp deploy/docker/.env.example deploy/docker/.env
```

Edit `deploy/docker/.env`:

```bash
ANTHROPIC_OAUTH_TOKEN=<your-claude-code-oauth-token>
ANTHROPIC_API_KEY=
OPENAI_API_KEY=<your-codex-token>
```

Notes:

- Keep `ANTHROPIC_API_KEY` empty when using OAuth only.
- If both Anthropic variables are set, `ANTHROPIC_OAUTH_TOKEN` is used first.

### 4.3 Configure Persistent Agent State Path

Update the host-side volume path in `docker-compose.yml` from:

```yaml
- /Users/saiaj/.agent:/home/agent/.agent
```

to your VM user path (example):

```yaml
- /home/agent/.agent:/home/agent/.agent
```

### 4.4 Build and Start the Docker Compose Image

```bash
docker compose --env-file deploy/docker/.env up -d --build
```

### 4.5 Verify

```bash
docker compose ps
docker compose logs -f agent
```

Open the UI at `http://<vm-ip>:8080/ui/`.

## 5. Personal Laptop Setup (Docker Installed)

Use this flow when running locally on your laptop.

### 5.1 Clone and Enter Project

```bash
git clone <repo-url> agent
cd agent
```

### 5.2 Configure Runtime Tokens

```bash
cp deploy/docker/.env.example deploy/docker/.env
```

Edit `deploy/docker/.env`:

```bash
ANTHROPIC_OAUTH_TOKEN=<your-claude-code-oauth-token>
ANTHROPIC_API_KEY=
OPENAI_API_KEY=<your-codex-token>
```

### 5.3 Configure Persistent Agent State Path

For macOS with your current compose file, keep:

```yaml
- /Users/<your-username>/.agent:/home/agent/.agent
```

If the file has a different hardcoded username, replace it with your own.

### 5.4 Build and Start the Docker Compose Image

```bash
docker compose --env-file deploy/docker/.env up -d --build
```

### 5.5 Verify

```bash
docker compose ps
docker compose logs -f agent
```

Open the UI at `http://127.0.0.1:8080/ui/`.

## 6. Optional `auth.json` for OAuth Credential Storage

If you prefer storing OAuth credentials in a file instead of environment variables, create
`~/.agent/auth.json` (on the host path mounted into the container):

```json
{
	"anthropic": {
		"type": "oauth"
	},
	"openai-codex": {
		"type": "oauth"
	}
}
```

Use provider credential payload fields from your OAuth flow/tooling. The minimal example above is
only the file shape; the OAuth credential fields are still required for token exchange/refresh.
The runtime can refresh and persist updated OAuth credentials in this file.

## 7. Useful Operations

```bash
docker compose restart agent
docker compose down
docker compose down -v
```

- `down -v` also removes volumes (destructive for local state).
