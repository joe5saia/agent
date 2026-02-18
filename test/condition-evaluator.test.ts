import { describe, expect, it } from "vitest";
import { evaluateCondition } from "../src/workflows/index.js";

describe("condition evaluator", () => {
	it("S9.9: supports negation and boolean expressions", () => {
		expect(evaluateCondition("!parameters.skip_tests", { skip_tests: false })).toBe(true);
		expect(
			evaluateCondition('parameters.environment == "prod" && !parameters.skip_tests', {
				environment: "prod",
				skip_tests: false,
			}),
		).toBe(true);
	});

	it("S9.10 + S9.13: rejects unsupported expressions without eval", () => {
		expect(() => evaluateCondition("parameters.a.b", { a: { b: true } })).toThrowError();
		expect(() => evaluateCondition("doThing()", {})).toThrowError();
	});
});
