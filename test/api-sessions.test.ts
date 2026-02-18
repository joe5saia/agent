import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { cleanupTempDirs, createConfig, createServerDeps } from "./helpers/server-fixtures.js";

afterEach(() => {
	cleanupTempDirs();
});

describe("sessions api", () => {
	it("S10.1 + S10.2: supports create/list/get/delete", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const deps = createServerDeps(events);
		const app = createApp(createConfig(), deps);

		const createResponse = await app.request("/api/sessions", {
			body: JSON.stringify({ name: "Test Session" }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});
		expect(createResponse.status).toBe(200);
		const created = (await createResponse.json()) as { id: string; name: string };
		expect(created.name).toBe("Test Session");

		const listResponse = await app.request("/api/sessions");
		expect(listResponse.status).toBe(200);
		const sessions = (await listResponse.json()) as Array<{ id: string }>;
		expect(sessions.some((session) => session.id === created.id)).toBe(true);

		const getResponse = await app.request(`/api/sessions/${created.id}`);
		expect(getResponse.status).toBe(200);

		const deleteResponse = await app.request(`/api/sessions/${created.id}`, { method: "DELETE" });
		expect(deleteResponse.status).toBe(204);
	});

	it("S16.4: validates body and session id", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const app = createApp(createConfig(), createServerDeps(events));

		const invalidBody = await app.request("/api/sessions", {
			body: JSON.stringify({ name: "" }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});
		expect(invalidBody.status).toBe(400);

		const invalidId = await app.request("/api/sessions/not-valid");
		expect(invalidId.status).toBe(400);
	});
});
