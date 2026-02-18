import { describe, expect, it } from "vitest";
import { withRetry } from "../src/agent/retry.js";

describe("withRetry", () => {
	it("S15.1: retries retryable status then succeeds", async () => {
		let attempts = 0;
		const result = await withRetry(
			async () => {
				attempts += 1;
				if (attempts < 2) {
					const error = new Error("rate limited") as Error & { status: number };
					error.status = 429;
					throw error;
				}
				return "ok";
			},
			{
				baseDelayMs: 1,
				maxDelayMs: 10,
				maxRetries: 2,
				retryableStatuses: [429, 500],
			},
		);
		expect(result).toBe("ok");
		expect(attempts).toBe(2);
	});

	it("S15.3: fails immediately for non-retryable errors", async () => {
		let attempts = 0;
		await expect(
			withRetry(
				async () => {
					attempts += 1;
					const error = new Error("bad request") as Error & { status: number };
					error.status = 400;
					throw error;
				},
				{
					baseDelayMs: 1,
					maxDelayMs: 10,
					maxRetries: 2,
					retryableStatuses: [429, 500],
				},
			),
		).rejects.toThrowError("bad request");
		expect(attempts).toBe(1);
	});
});
