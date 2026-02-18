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
}
