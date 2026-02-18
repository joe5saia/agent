export interface RetryConfig {
	baseDelayMs: number;
	maxDelayMs: number;
	maxRetries: number;
	retryableStatuses: Array<number>;
}

export interface RetryStatusEvent {
	attempt: number;
	delayMs: number;
	message: string;
	status?: number;
}

interface RetryErrorLike {
	response?: { headers?: Headers; status?: number };
	status?: number;
}

function getStatusCode(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}
	const candidate = error as RetryErrorLike;
	if (typeof candidate.status === "number") {
		return candidate.status;
	}
	if (typeof candidate.response?.status === "number") {
		return candidate.response.status;
	}
	return undefined;
}

function parseRetryAfterMs(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}
	const candidate = error as RetryErrorLike;
	const header = candidate.response?.headers?.get("retry-after");
	if (header === null || header === undefined || header.trim() === "") {
		return undefined;
	}

	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds > 0) {
		return Math.floor(seconds * 1000);
	}

	const timestamp = Date.parse(header);
	if (Number.isFinite(timestamp)) {
		return Math.max(0, timestamp - Date.now());
	}

	return undefined;
}

function delayWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			signal.throwIfAborted();
		}

		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(signal?.reason ?? new Error("Aborted"));
		};

		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function getBackoffDelay(config: RetryConfig, attempt: number): number {
	const exponential = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
	const jitterFactor = 0.5 + Math.random();
	return Math.floor(exponential * jitterFactor);
}

/**
 * Runs an operation with retry/backoff for retryable provider failures.
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	config: RetryConfig,
	signal?: AbortSignal,
	onStatus?: (event: RetryStatusEvent) => void,
): Promise<T> {
	let attempt = 0;

	while (true) {
		signal?.throwIfAborted();
		attempt += 1;
		try {
			return await operation();
		} catch (error: unknown) {
			const status = getStatusCode(error);
			const retryable = status !== undefined && config.retryableStatuses.includes(status);
			if (!retryable || attempt > config.maxRetries) {
				throw error;
			}

			const retryAfterMs = status === 429 ? parseRetryAfterMs(error) : undefined;
			const delayMs = Math.min(retryAfterMs ?? getBackoffDelay(config, attempt), config.maxDelayMs);
			onStatus?.({
				attempt,
				delayMs,
				message: `Request failed${status === undefined ? "" : ` (${status})`}. Retrying in ${Math.ceil(delayMs / 1000)}s...`,
				status,
			});
			await delayWithAbort(delayMs, signal);
		}
	}
}
