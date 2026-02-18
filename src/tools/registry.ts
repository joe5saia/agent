import type { AgentTool, ToolSchema } from "./types.js";

/**
 * In-memory registry of available tools.
 */
export class ToolRegistry {
	readonly #toolsByName = new Map<string, AgentTool>();

	/**
	 * Registers a tool by name.
	 */
	public register(tool: AgentTool): void {
		if (this.#toolsByName.has(tool.name)) {
			throw new Error(`Tool is already registered: ${tool.name}`);
		}
		this.#toolsByName.set(tool.name, tool);
	}

	/**
	 * Removes a registered tool by name.
	 */
	public unregister(name: string): boolean {
		return this.#toolsByName.delete(name);
	}

	/**
	 * Returns a tool by name.
	 */
	public get(name: string): AgentTool | undefined {
		return this.#toolsByName.get(name);
	}

	/**
	 * Lists all registered tools.
	 */
	public list(): Array<AgentTool> {
		return [...this.#toolsByName.values()];
	}

	/**
	 * Converts tools to LLM-facing schemas.
	 */
	public toToolSchemas(): Array<ToolSchema> {
		return this.list().map((tool) => ({
			description: tool.description,
			name: tool.name,
			parameters: tool.parameters,
		}));
	}

	/**
	 * Replaces all workflow_* tools in one pass, used for startup and reload.
	 */
	public registerWorkflowTools(workflowTools: Array<AgentTool>): void {
		for (const name of this.#toolsByName.keys()) {
			if (name.startsWith("workflow_")) {
				this.#toolsByName.delete(name);
			}
		}
		for (const tool of workflowTools) {
			this.register(tool);
		}
	}
}
