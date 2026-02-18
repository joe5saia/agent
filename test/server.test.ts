import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { cleanupTempDirs, createConfig, createServerDeps } from "./helpers/server-fixtures.js";

afterEach(() => {
	cleanupTempDirs();
});

describe("server app", () => {
	it("S16.1: serves health endpoint", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const app = createApp(createConfig(), createServerDeps(events));

		const response = await app.request("/health");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("S16.2 + S11.1: enforces allowed_users for non-loopback requests", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const config = createConfig({
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: ["/tmp"],
				allowedUsers: ["alice@example.com"],
				blockedCommands: [],
				deniedPaths: [],
			},
		});
		const app = createApp(config, createServerDeps(events));

		const forbidden = await app.request("/health", {
			headers: {
				"x-forwarded-for": "100.64.0.5",
			},
		});
		expect(forbidden.status).toBe(403);

		const allowed = await app.request("/health", {
			headers: {
				"Tailscale-User-Login": "alice@example.com",
				"x-forwarded-for": "100.64.0.5",
			},
		});
		expect(allowed.status).toBe(200);
		expect(events.some((entry) => entry.event === "request_identity")).toBe(true);
	});
});
