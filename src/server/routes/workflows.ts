import { Hono } from "hono";
import type { ServerAppContext } from "../types.js";

/**
 * Workflow discovery and execution REST routes.
 */
export function createWorkflowsRoutes(): Hono<{ Variables: ServerAppContext }> {
	const app = new Hono<{ Variables: ServerAppContext }>();

	app.get("/", (context) => {
		const workflowEngine = context.var.deps.workflowEngine;
		if (workflowEngine === undefined) {
			return context.json([], 200);
		}

		return context.json(
			workflowEngine.list().map((workflow) => ({
				description: workflow.description,
				name: workflow.name,
				parameters: workflow.parameterDefinitions,
			})),
		);
	});

	app.post("/:name/run", async (context) => {
		const workflowEngine = context.var.deps.workflowEngine;
		if (workflowEngine === undefined) {
			return context.json({ error: "Workflow engine unavailable" }, 503);
		}

		const name = context.req.param("name");
		if (workflowEngine.get(name) === undefined) {
			return context.json({ error: "Workflow not found" }, 404);
		}

		const body = (await context.req.json().catch(() => ({}))) as { parameters?: unknown };
		const parameters =
			typeof body.parameters === "object" && body.parameters !== null
				? (body.parameters as Record<string, unknown>)
				: {};

		try {
			const result = await workflowEngine.runWorkflow(name, parameters);
			return context.json(result);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (/Invalid workflow parameters:/i.test(message)) {
				return context.json({ error: message }, 400);
			}
			return context.json({ error: message }, 500);
		}
	});

	return app;
}
