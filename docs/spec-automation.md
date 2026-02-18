# Specification: Automation

Cron-based scheduled triggers and structured workflow execution.

**Related documents:**

- [Agent Loop & Tools](spec-agent-loop.md) — loop execution and tool permissions
- [Sessions](spec-sessions.md) — session creation for cron/workflow runs
- [Web Interface](spec-web-interface.md) — REST API for cron/workflow management
- [Security](spec-security.md) — tool policy enforcement
- [Configuration](spec-configuration.md) — config validation for job/workflow schemas

---

## 8. Cron & Scheduled Triggers

The agent supports scheduled tasks via cron expressions, powered by the croner library.

### 8.1 Job Definition

```yaml
# ~/.agent/cron/jobs.yaml
jobs:
  - id: daily-report
    schedule: "0 9 * * 1-5" # 9 AM weekdays
    timezone: "America/New_York"
    prompt: "Generate the daily status report and post it to Slack"
    enabled: true
    policy:
      allowed_tools: ["read_file", "list_directory", "bash", "workflow_daily_report"]
      max_iterations: 10

  - id: healthcheck
    schedule: "*/15 * * * *" # Every 15 minutes
    prompt: "Run the healthcheck workflow"
    enabled: true
    policy:
      allowed_tools: ["workflow_healthcheck", "read_file", "bash"]
      max_iterations: 5
```

**Per-job tool policy:**

Cron jobs run unattended — no user is present to approve actions. Each job specifies a `policy` that restricts what the agent can do:

- `allowed_tools` — whitelist of tools the agent may use during this job. Tools not listed are unavailable. If omitted, only `read`-category tools are available.
- `max_iterations` — per-job override of the agent loop's `maxIterations` (default: 10, lower than interactive default of 20).
- `admin`-category tools are **never** available in cron, even if listed in `allowed_tools`.

### 8.2 Run History

Each job tracks its recent execution history for the web UI:

```typescript
interface CronJobStatus {
	id: string;
	schedule: string;
	enabled: boolean;
	lastRunAt?: string; // ISO 8601
	lastStatus?: "success" | "error";
	lastErrorSnippet?: string; // First 200 chars of error message
	consecutiveFailures: number;
	nextRunAt?: string; // ISO 8601 — next scheduled execution
}
```

Run history is stored in `metadata.json` alongside the session for each cron run. The job status summary is kept in memory and returned by `GET /api/cron`.

### 8.3 Cron Service

```typescript
import { Cron } from "croner";

function startCronService(jobs: CronJobConfig[]): void {
	for (const job of jobs) {
		if (!job.enabled) continue;

		new Cron(
			job.schedule,
			{
				timezone: job.timezone,
				name: job.id,
				protect: true, // Overrun protection
				catch: (err) => logJobError(job.id, err),
				context: job,
			},
			async (_self, ctx) => {
				await runAgentSession({
					sessionId: generateSessionId(),
					source: "cron",
					cronJobId: ctx.id,
					prompt: ctx.prompt,
				});
			},
		);
	}
}
```

### 8.4 Design Decisions

- **Isolated sessions** — each cron run creates a new session. This prevents context contamination between runs.
- **Overrun protection** — croner's `protect: true` prevents a slow run from stacking on top of itself.
- **Error isolation** — cron errors are caught and logged, never crash the service.
- **Named jobs** — jobs are accessible via `scheduledJobs` for pause/resume from the web UI.

### 8.5 Test Scenarios

- **S8.1**: Cron job with valid expression schedules and fires at the correct time.
- **S8.2**: Disabled job (`enabled: false`) is not scheduled.
- **S8.3**: Cron job creates an isolated session with `source: "cron"` metadata.
- **S8.4**: Overrun protection prevents concurrent execution of the same job.
- **S8.5**: Job error is caught and logged; the job continues to fire on the next schedule.
- **S8.6**: Job with timezone fires at the correct local time.
- **S8.7**: Jobs can be paused and resumed from the web UI.
- **S8.8**: Reloading job config (adding/removing/editing jobs) takes effect without restart.
- **S8.9**: Cron job with `policy.allowed_tools` restricts the agent to only those tools.
- **S8.10**: Cron job without a `policy` defaults to `read`-category tools only.
- **S8.11**: `admin`-category tools are blocked in cron even if listed in `allowed_tools`.
- **S8.12**: `consecutiveFailures` increments on failure and resets on success.
- **S8.13**: `GET /api/cron` returns job status including `lastRunAt`, `lastStatus`, and `consecutiveFailures`.

---

## 9. Structured Workflows

Workflows are repeatable, multi-step processes defined in files. The agent executes them in a **structured sequence** — the step order, conditions, and parameters are deterministic, but individual steps that use LLM prompts produce non-deterministic output (the LLM may choose different tools or phrasing across runs).

### 9.1 Workflow Definition

```yaml
# ~/.agent/workflows/deploy.yaml
name: deploy
description: "Deploy the application to the specified environment"
parameters:
  environment:
    type: string
    enum: [dev, staging, prod]
    description: "Target environment"
  skip_tests:
    type: boolean
    default: false
    description: "Skip test suite"

steps:
  - name: run_tests
    prompt: "Run the test suite and report results"
    condition: "!parameters.skip_tests"

  - name: build
    prompt: "Build the application for {{parameters.environment}}"

  - name: deploy
    prompt: "Deploy the built application to {{parameters.environment}}"

  - name: verify
    prompt: "Run smoke tests against {{parameters.environment}} and report status"
```

### 9.2 Condition Evaluator

Step conditions are evaluated using a **safe expression evaluator** — not `eval()`. The evaluator supports a minimal grammar:

**Supported expressions:**

- Boolean literals: `true`, `false`
- Parameter references: `parameters.skip_tests`, `parameters.environment`
- Negation: `!parameters.skip_tests`
- Equality: `parameters.environment == "prod"`, `parameters.count != 0`
- Boolean operators: `&&`, `||`
- Parentheses for grouping: `(parameters.a && parameters.b) || parameters.c`

**Not supported (by design):**

- Function calls, property access beyond one level, arithmetic, string concatenation
- Any expression that would require a general-purpose evaluator

The evaluator is implemented as a simple recursive descent parser (~50 lines). If an expression fails to parse, the step is skipped with a warning log.

### 9.3 Templating

Step prompts and CLI tool commands use `{{parameters.name}}` template syntax. The templating engine:

- Replaces `{{parameters.<key>}}` with the corresponding parameter value.
- Validates that all referenced parameters exist before execution begins.
- Escapes are not needed — values are interpolated as strings, not shell-expanded.
- Unknown template variables cause a validation error at workflow load time.

### 9.4 Step Failure Criteria

A workflow step is considered **failed** if:

1. The agent loop exits with an error (provider failure after retries, internal error).
2. The agent loop hits `maxIterations` without completing.
3. A tool call returns `isError: true` and the LLM's final response contains the word "failed" or "error" (heuristic — configurable per step).
4. The step has an explicit `expect` field that is not satisfied (future extension).

Steps can configure failure behavior:

```yaml
steps:
  - name: run_tests
    prompt: "Run the test suite and report results"
    on_failure: halt # halt (default) | continue | skip_remaining
```

- `halt` — stop the workflow and mark it as failed (default).
- `continue` — log the failure and proceed to the next step.
- `skip_remaining` — skip all remaining steps and mark the workflow as failed.

### 9.5 Workflow Execution

1. User or cron triggers a workflow by name with parameters.
2. Parameters are validated against the workflow's TypeBox schema — invalid parameters fail before execution.
3. The agent creates a new session for the workflow run.
4. Each step is executed as a separate agent turn within that session.
5. Step conditions are evaluated using the safe expression evaluator (§9.2) — false conditions skip the step.
6. Step prompts are expanded using template variables from parameters (§9.3).
7. Progress is tracked: each step is marked as `pending`, `running`, `completed`, `skipped`, or `failed`.
8. On failure, the `on_failure` policy determines behavior (§9.4).

### 9.6 Workflow as a Tool

Workflows are exposed to the agent as tools, so the LLM can trigger them:

```typescript
const deployWorkflow: AgentTool = {
	name: "workflow_deploy",
	description: "Deploy the application to the specified environment",
	parameters: Type.Object({
		environment: Type.Enum({ dev: "dev", staging: "staging", prod: "prod" }),
		skip_tests: Type.Optional(Type.Boolean()),
	}),
	execute: async (args) => {
		return await runWorkflow("deploy", args);
	},
};
```

### 9.7 Test Scenarios

- **S9.1**: Workflow file loads and parses correctly from YAML.
- **S9.2**: Workflow with all steps succeeding completes with all steps marked `completed`.
- **S9.3**: Workflow with a failing step and `on_failure: halt` stops and marks the step as `failed`.
- **S9.4**: Step with a false condition is skipped and marked `skipped`.
- **S9.5**: Template variables in step prompts are expanded from parameters.
- **S9.6**: Workflow execution creates a dedicated session for the run.
- **S9.7**: Workflow is callable as a tool by the agent.
- **S9.8**: Invalid workflow parameters fail TypeBox validation before execution begins.
- **S9.9**: Condition evaluator handles negation (`!parameters.skip_tests`) correctly.
- **S9.10**: Condition evaluator rejects unsupported expressions (function calls, deep property access) with a warning.
- **S9.11**: Template variable referencing a non-existent parameter fails validation at load time.
- **S9.12**: Step with `on_failure: continue` logs the failure and proceeds to the next step.
- **S9.13**: Condition evaluator does not use `eval()` — verified by code inspection / AST analysis.
