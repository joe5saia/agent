import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { TelegramUpdate } from "./types.js";

/**
 * Inbound webhook handling result.
 */
export type TelegramWebhookResult =
	| "accepted"
	| "conversation_queue_full"
	| "global_queue_full"
	| "ignored";

export interface TelegramWebhookServerOptions {
	host: string;
	logger?: {
		warn(event: string, fields?: Record<string, unknown>): void;
	};
	onUpdate: (update: TelegramUpdate) => Promise<TelegramWebhookResult>;
	path: string;
	port: number;
	secret: string;
}

function normalizePath(path: string): string {
	return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Constant-time secret verification for Telegram webhook headers.
 */
export function verifyTelegramWebhookSecret(
	expectedSecret: string,
	receivedHeader: string | undefined,
): boolean {
	if (receivedHeader === undefined) {
		return false;
	}
	const expected = Buffer.from(expectedSecret, "utf8");
	const actual = Buffer.from(receivedHeader, "utf8");
	if (expected.length !== actual.length) {
		// Maintain constant-time characteristics for non-matching lengths.
		return timingSafeEqual(expected, expected) && false;
	}
	return timingSafeEqual(expected, actual);
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Array<Buffer> = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

function writeJson(
	res: ServerResponse,
	statusCode: number,
	payload: Record<string, unknown>,
): void {
	const body = JSON.stringify(payload);
	res.statusCode = statusCode;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(body);
}

/**
 * Lightweight webhook HTTP server for Telegram updates.
 */
export class TelegramWebhookServer {
	readonly #host: string;
	readonly #logger:
		| {
				warn(event: string, fields?: Record<string, unknown>): void;
		  }
		| undefined;
	readonly #onUpdate: (update: TelegramUpdate) => Promise<TelegramWebhookResult>;
	readonly #path: string;
	readonly #port: number;
	readonly #secret: string;
	#server: Server | undefined;

	public constructor(options: TelegramWebhookServerOptions) {
		this.#host = options.host;
		this.#logger = options.logger;
		this.#onUpdate = options.onUpdate;
		this.#path = normalizePath(options.path);
		this.#port = options.port;
		this.#secret = options.secret;
	}

	public async start(signal?: AbortSignal): Promise<void> {
		if (this.#server !== undefined) {
			return;
		}
		const server = createServer((req, res) => {
			void this.#handleRequest(req, res);
		});

		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.#port, this.#host, () => {
				server.off("error", reject);
				resolve();
			});
		});

		if (signal !== undefined) {
			signal.addEventListener(
				"abort",
				() => {
					void this.stop();
				},
				{ once: true },
			);
		}

		this.#server = server;
	}

	public async stop(): Promise<void> {
		if (this.#server === undefined) {
			return;
		}
		const server = this.#server;
		this.#server = undefined;
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	}

	/**
	 * Returns the active TCP port when the webhook server is running.
	 */
	public getPort(): number | undefined {
		const address = this.#server?.address();
		if (address === null || typeof address === "string" || address === undefined) {
			return undefined;
		}
		return address.port;
	}

	async #handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (req.method !== "POST") {
			writeJson(res, 405, { ok: false });
			return;
		}

		const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
		if (requestPath !== this.#path) {
			writeJson(res, 404, { ok: false });
			return;
		}

		const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
		const secretValue = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
		if (!verifyTelegramWebhookSecret(this.#secret, secretValue)) {
			this.#logger?.warn("telegram_webhook_secret_rejected");
			writeJson(res, 401, { ok: false });
			return;
		}

		let parsed: unknown;
		try {
			const body = await readBody(req);
			parsed = JSON.parse(body) as unknown;
		} catch {
			writeJson(res, 400, { ok: false });
			return;
		}
		if (typeof parsed !== "object" || parsed === null) {
			writeJson(res, 400, { ok: false });
			return;
		}

		const update = parsed as TelegramUpdate;
		const result = await this.#onUpdate(update);
		if (result === "global_queue_full") {
			writeJson(res, 503, { ok: false, retry: true });
			return;
		}
		writeJson(res, 200, { ok: true });
	}
}
