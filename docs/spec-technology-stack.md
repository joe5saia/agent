# Specification: Technology Stack

Runtime, dependencies, linting, formatting, type checking, testing, and git hooks.

**Related documents:**

- [Overview](spec-overview.md) — goals, methodology, architecture
- [Configuration](spec-configuration.md) — config validation schemas
- [Project Structure](spec-project-structure.md) — source directory layout

---

## 4. Technology Stack

### 4.1 Runtime & Language

- **Runtime:** Node.js ≥ 20 (or Bun)
- **Language:** TypeScript (strict mode)

### 4.2 Dependencies

| Package               | Purpose                                      | Version Strategy                  |
| --------------------- | -------------------------------------------- | --------------------------------- |
| `@mariozechner/pi-ai` | LLM provider abstraction                     | Pin to specific version (pre-1.0) |
| `@sinclair/typebox`   | Tool schema definitions + runtime validation | Stable (re-exported by pi-ai)     |
| `croner`              | Cron job scheduling                          | Latest stable (v10.x)             |
| `hono`                | HTTP framework (REST API + WebSocket)        | Latest stable (v4.x)              |
| `@hono/node-server`   | Node.js adapter for Hono                     | Latest stable                     |
| `yaml`                | YAML config parsing                          | Latest stable (v2.x)              |

### 4.3 Dev Dependencies

| Package                      | Purpose                                | Version Strategy     |
| ---------------------------- | -------------------------------------- | -------------------- |
| `oxlint`                     | Linter (Oxc project)                   | Latest stable        |
| `@nkzw/oxlint-config`        | Strict, opinionated Oxlint preset      | Latest stable        |
| `oxlint-tsgolint`            | Type-aware linting powered by tsgo     | Latest stable        |
| `oxfmt`                      | Formatter (Oxc project)                | Latest stable        |
| `@typescript/native-preview` | Type checker (tsgo — TypeScript in Go) | Latest pre-release   |
| `vitest`                     | Test framework + runner                | Latest stable (v3.x) |
| `husky`                      | Git hooks (pre-commit enforcement)     | Latest stable (v9.x) |
| `npm-run-all2`               | Parallel npm script runner             | Latest stable        |

### 4.4 Linting: Oxlint

We use **Oxlint** for linting. Oxlint is a high-performance linter from the [Oxc](https://oxc.rs/) compiler stack, 50–100x faster than ESLint with 675+ built-in rules spanning ESLint core, TypeScript, Unicorn, import-x, and more.

**Why Oxlint over Biome:**

| Aspect                  | Oxlint + Oxfmt                          | Biome                                   |
| ----------------------- | --------------------------------------- | --------------------------------------- |
| Type-aware linting      | Full, via tsgo (TypeScript 7)           | Own inference engine (~75-85% coverage) |
| ESLint plugin compat    | JS plugin shim via NAPI-RS              | None                                    |
| Multi-file analysis     | First-class (project-wide module graph) | No                                      |
| AI-friendly diagnostics | Structured spans + contextual data      | Standard diagnostics                    |
| Rule count              | 675+ built-in rules                     | ~300 rules                              |
| Speed                   | 50-100x faster than ESLint              | 15-25x faster than ESLint               |
| Config format           | TypeScript (`oxlint.config.ts`)         | JSON (`biome.json`)                     |

We use the **`@nkzw/oxlint-config`** preset (by Christoph Nakazawa, used by OpenClaw) as our base configuration. Its philosophy aligns with our spec:

- **Error, Never Warn** — warnings are noise. Either it's an issue, or it isn't.
- **Strict, Consistent Code Style** — enforces modern language features and best practices.
- **Prevent Bugs** — problematic patterns like `instanceof` are disallowed; debug-only code (`console.log`, `test.only`) is blocked.
- **Fast** — slow rules are avoided. TypeScript's `noUnusedLocals` is preferred over `no-unused-vars`.
- **Don't get in the way** — subjective rules are disabled. Autofixable rules are preferred.

**Oxlint configuration (`oxlint.config.ts`):**

```typescript
import nkzw from "@nkzw/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
	extends: [nkzw],
	ignorePatterns: ["dist", "coverage"],
	rules: {
		"@typescript-eslint/no-explicit-any": "error",
	},
});
```

**Key rule enforcement — via `@nkzw/oxlint-config` + our overrides:**

| Rule                                 | Severity           | Rationale                                                                                                                |
| ------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `@typescript-eslint/no-explicit-any` | error              | Forces use of the type system. No lazy `any` escapes. `@nkzw/oxlint-config` leaves this off by default; we re-enable it. |
| `no-console`                         | error (via preset) | Prevents accidental logging in production.                                                                               |
| `no-instanceof`                      | error (via preset) | Forces more robust type-checking patterns.                                                                               |
| `no-only-tests`                      | error (via preset) | Prevents accidental CI failures from `test.only`.                                                                        |
| `unicorn/*`                          | error (via preset) | Enforces modern JS best practices (e.g., `node:` protocol, `for...of`).                                                  |
| `import-x/*`                         | error (via preset) | Enforces import hygiene and detects cycles via multi-file analysis.                                                      |

**Type-aware linting** is enabled via `oxlint-tsgolint`, which integrates the native Go port of TypeScript (tsgo) for full type system access. This enables rules like `no-floating-promises` that require type information:

```bash
oxlint --type-aware
```

### 4.4.1 Formatting: Oxfmt

We use **Oxfmt** for code formatting. Oxfmt is a Prettier-compatible formatter from the Oxc project, approximately 30x faster than Prettier and 2x faster than Biome. It includes built-in import sorting, Tailwind CSS class sorting, and `package.json` field sorting — no plugins required.

**Oxfmt configuration (`.oxfmtrc.jsonc`):**

```jsonc
{
	"$schema": "./node_modules/oxfmt/configuration_schema.json",
	"printWidth": 100,
	"useTabs": true,
	"tabWidth": 2,
	"semi": true,
	"singleQuote": false,
	"trailingComma": "all",
	"bracketSpacing": true,
	"arrowParens": "always",
	"endOfLine": "lf",
	"experimentalSortImports": {
		"newlinesBetween": false,
	},
	"ignorePatterns": ["dist/", "coverage/"],
}
```

**Key formatting choices:**

| Option                    | Value   | Rationale                                                                 |
| ------------------------- | ------- | ------------------------------------------------------------------------- |
| `printWidth`              | 100     | Slightly tighter than the Oxfmt default (100), matches our previous spec. |
| `useTabs`                 | true    | Consistent with our indent style preference.                              |
| `semi`                    | true    | Always use semicolons for clarity.                                        |
| `singleQuote`             | false   | Double quotes — matches our previous convention.                          |
| `trailingComma`           | "all"   | Cleaner diffs.                                                            |
| `experimentalSortImports` | enabled | Auto-sorts imports without needing a separate tool or plugin.             |

### 4.5 TypeScript Configuration

We use **tsgo** (`@typescript/native-preview`) — the native Go rewrite of the TypeScript compiler — for ~10x faster type checking. tsgo is feature-complete and stable, with full editor support via the `"typescript.experimental.useTsgo": true` VS Code setting.

**Migration from `tsc`:**

1. Install: `npm install @typescript/native-preview`
2. Replace every `tsc` invocation with `tsgo`
3. Add `"typescript.experimental.useTsgo": true` to VS Code settings

tsgo uses the same `tsconfig.json` format. Strict mode with all safety checks enabled:

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "Node16",
		"moduleResolution": "Node16",
		"lib": ["ES2022"],
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"forceConsistentCasingInFileNames": true,
		"declaration": true,
		"declarationMap": true,
		"sourceMap": true,
		"resolveJsonModule": true,
		"noUncheckedIndexedAccess": true,
		"noFallthroughCasesInSwitch": true,
		"exactOptionalPropertyTypes": true,
		"outDir": "./dist",
		"rootDir": "./src",
		"types": ["node"]
	},
	"include": ["src/**/*"],
	"exclude": ["node_modules", "dist"]
}
```

**Key strictness settings beyond `strict: true`:**

| Option                       | Effect                                                                   |
| ---------------------------- | ------------------------------------------------------------------------ |
| `noUncheckedIndexedAccess`   | Array/object index access returns `T \| undefined`, forcing null checks. |
| `noFallthroughCasesInSwitch` | Prevents accidental switch case fallthrough.                             |
| `exactOptionalPropertyTypes` | Distinguishes between `undefined` and "missing" in optional properties.  |

### 4.6 Testing: Vitest

We use **Vitest** as the test framework, matching pi-mono's choice.

**Why Vitest:**

- Native TypeScript and ESM support (no compilation step for tests).
- Fast execution with watch mode.
- Compatible API with Jest (familiar `describe`/`it`/`expect`).
- Built-in async support with configurable timeouts.
- `skipIf` for conditional test execution (useful for integration tests requiring API keys).

**Configuration (`vitest.config.ts`):**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		include: ["test/**/*.test.ts"],
	},
});
```

**Test structure:**

```
test/
├── agent-loop.test.ts       # Core loop tests (S5.1-S5.6)
├── tools*.test.ts           # Tool system tests (S6.1-S6.22)
├── sessions.test.ts         # Session management tests (S7.1-S7.7)
├── cron.test.ts             # Cron service tests (S8.1-S8.8)
├── workflows.test.ts        # Workflow engine tests (S9.1-S9.8)
├── api.test.ts              # REST API tests (S10.1-S10.7)
├── security.test.ts         # Security tests (S11.1-S11.6)
└── helpers/
    └── mock-llm.ts          # Mock LLM provider for unit tests
```

**Test patterns:**

- Unit tests use mock LLM responses (no API keys required).
- Integration tests use `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` for graceful skipping.
- Retry flaky API tests with `{ retry: 3 }`.

### 4.7 Git Hooks: Husky

Pre-commit hook enforces all checks before code enters the repository:

```bash
#!/bin/sh
# .husky/pre-commit

STAGED_FILES=$(git diff --cached --name-only)

echo "Running formatting, linting, and type checking..."
npx npm-run-all --parallel lint lint:format tsc

if [ $? -ne 0 ]; then
  echo "❌ Checks failed. Please fix the errors before committing."
  exit 1
fi

for file in $STAGED_FILES; do
  if [ -f "$file" ]; then
    git add "$file"
  fi
done

echo "✅ All pre-commit checks passed!"
```

### 4.8 NPM Scripts

```json
{
	"scripts": {
		"check": "npm-run-all --parallel tsc lint lint:format",
		"lint": "oxlint --type-aware",
		"lint:fix": "oxlint --type-aware --fix",
		"lint:format": "oxfmt --check",
		"format": "oxfmt",
		"tsc": "tsgo --noEmit",
		"test": "vitest --run",
		"test:watch": "vitest",
		"build": "tsgo",
		"prepare": "husky"
	}
}
```

The `check` command runs linting, format checking, and type checking **in parallel** via `npm-run-all2` — all three tools complete in under a second. This is the same pattern recommended by Christoph Nakazawa's [fastest frontend tooling](https://cpojer.net/posts/fastest-frontend-tooling) guide.
