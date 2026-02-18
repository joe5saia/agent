import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/sessions/index.js";
import { cleanupTempDirs, createTempSessionsDir } from "./helpers/server-fixtures.js";

afterEach(() => {
	cleanupTempDirs();
});

describe("session naming", () => {
	it("S18.2 + S18.4: generates fallback title on failure", async () => {
		const manager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		const session = await manager.create();

		const title = await manager.generateTitle(session.id, {
			assistantText: "assistant",
			generate: async () => {
				throw new Error("provider failed");
			},
			userText:
				"This is a very long message that should be turned into a fallback title without cutting words awkwardly",
		});

		expect(title.endsWith("...")).toBe(true);
		const metadata = await manager.get(session.id);
		expect(metadata.name).toBe(title);
	});

	it("S18.5: preserves user-provided names", async () => {
		const manager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		const session = await manager.create({ name: "Custom Name" });
		const title = await manager.generateTitle(session.id, {
			assistantText: "assistant",
			generate: async () => "Generated",
			userText: "hello",
		});

		expect(title).toBe("Custom Name");
		expect((await manager.get(session.id)).name).toBe("Custom Name");
	});
});
