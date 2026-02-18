import { describe, expect, it } from "vitest";

describe("agent entry point", () => {
	it("should be importable", async () => {
		// Verifies that the module parses and loads without errors.
		const mod = await import("../src/index.js");
		expect(mod).toBeDefined();
	});
});
