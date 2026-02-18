import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Hono } from "hono";
import { isValidSessionId } from "../../sessions/index.js";
import type { ServerAppContext } from "../types.js";

const createSessionSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	systemPrompt: Type.Optional(Type.String()),
});

function validationErrorDetails(input: unknown): Array<string> {
	return [...Value.Errors(createSessionSchema, input)].map(
		(entry) => `${entry.path === "" ? "/" : entry.path}: ${entry.message}`,
	);
}

/**
 * Session CRUD REST routes.
 */
export function createSessionsRoutes(): Hono<{ Variables: ServerAppContext }> {
	const app = new Hono<{ Variables: ServerAppContext }>();

	app.get("/", async (context) => {
		const sessions = await context.var.deps.sessionManager.list();
		return context.json(sessions);
	});

	app.post("/", async (context) => {
		const rawBody = await context.req.json().catch(() => undefined);
		if (!Value.Check(createSessionSchema, rawBody)) {
			return context.json(
				{
					details: validationErrorDetails(rawBody),
					error: "Invalid request body",
				},
				400,
			);
		}

		const createOptions = {
			...(rawBody?.name !== undefined ? { name: rawBody.name } : {}),
			...(rawBody?.systemPrompt !== undefined
				? { systemPromptOverride: rawBody.systemPrompt }
				: {}),
		};
		const session = await context.var.deps.sessionManager.create(createOptions);
		return context.json({ id: session.id, name: session.name });
	});

	app.get("/:id", async (context) => {
		const sessionId = context.req.param("id");
		if (!isValidSessionId(sessionId)) {
			return context.json({ error: "Invalid session ID" }, 400);
		}

		try {
			const metadata = await context.var.deps.sessionManager.get(sessionId);
			const messages = await context.var.deps.sessionManager.buildContext(sessionId);
			return context.json({ messages, metadata });
		} catch {
			return context.json({ error: "Session not found" }, 404);
		}
	});

	app.delete("/:id", async (context) => {
		const sessionId = context.req.param("id");
		if (!isValidSessionId(sessionId)) {
			return context.json({ error: "Invalid session ID" }, 400);
		}

		try {
			await context.var.deps.sessionManager.get(sessionId);
			await context.var.deps.sessionManager.delete(sessionId);
			return context.body(null, 204);
		} catch {
			return context.json({ error: "Session not found" }, 404);
		}
	});

	return app;
}
