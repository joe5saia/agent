import { Value } from "@sinclair/typebox/value";
import { agentLoop } from "../agent/index.js";
import type { AgentLoopConfig } from "../agent/index.js";
import type { Logger } from "../logging/index.js";
import {
	toSessionAppendInput,
	type SessionManager,
	type SessionMetadata,
} from "../sessions/index.js";
import type { AgentTool, ToolRegistry } from "../tools/index.js";
import { evaluateCondition } from "./condition.js";
import { expandTemplate } from "./template.js";
import type { WorkflowDefinition, WorkflowRunResult, WorkflowStepResult } from "./types.js";

function assistantOutput(
	message: Extract<Parameters<typeof agentLoop>[0][number], { role: "assistant" }>,
): string {
	return message.content
		.filter((entry) => entry.type === "text")
		.map((entry) => entry.text)
		.join("\n")
		.trim();
}

function didStepFail(
	stepMessages: Array<Parameters<typeof agentLoop>[0][number]>,
	maxIterationsReached: boolean,
): boolean {
	if (maxIterationsReached) {
		return true;
	}

	const hasToolError = stepMessages.some(
		(message) => message.role === "toolResult" && message.isError,
	);
	if (!hasToolError) {
		return false;
	}

	const finalAssistant = [...stepMessages]
		.reverse()
		.find((message): message is Extract<(typeof stepMessages)[number], { role: "assistant" }> => {
			return message.role === "assistant";
		});
	if (finalAssistant === undefined) {
		return true;
	}
	return /\b(failed?|error)\b/i.test(assistantOutput(finalAssistant));
}

export interface WorkflowEngineDependencies {
	apiKeyResolver?: AgentLoopConfig["apiKeyResolver"];
	defaultMaxIterations: number;
	logger?: Logger;
	model: Parameters<typeof agentLoop>[3];
	runAgentLoop?: typeof agentLoop;
	sessionManager: SessionManager;
	systemPromptBuilder?: (session: SessionMetadata) => string;
	toolRegistry: ToolRegistry;
}

/**
 * Executes loaded workflow definitions and exposes them as callable tools.
 */
export class WorkflowEngine {
	readonly #definitions = new Map<string, WorkflowDefinition>();
	readonly #deps: WorkflowEngineDependencies;

	public constructor(deps: WorkflowEngineDependencies) {
		this.#deps = deps;
	}

	/**
	 * Replaces active workflow definitions.
	 */
	public setDefinitions(definitions: Array<WorkflowDefinition>): void {
		this.#definitions.clear();
		for (const definition of definitions) {
			this.#definitions.set(definition.name, definition);
		}
	}

	/**
	 * Lists loaded workflow definitions.
	 */
	public list(): Array<WorkflowDefinition> {
		return [...this.#definitions.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
	}

	/**
	 * Returns a workflow definition by name.
	 */
	public get(name: string): WorkflowDefinition | undefined {
		return this.#definitions.get(name);
	}

	/**
	 * Runs a workflow by name with validated parameters.
	 */
	public async runWorkflow(
		name: string,
		parameters: Record<string, unknown>,
	): Promise<WorkflowRunResult> {
		const definition = this.#definitions.get(name);
		if (definition === undefined) {
			throw new Error(`Workflow not found: ${name}`);
		}
		if (!Value.Check(definition.parameterSchema, parameters)) {
			const detail = [...Value.Errors(definition.parameterSchema, parameters)]
				.map((entry) => `${entry.path || "/"}: ${entry.message}`)
				.join("; ");
			throw new Error(`Invalid workflow parameters: ${detail}`);
		}

		const session = await this.#deps.sessionManager.create({ name: `[workflow] ${name}` });
		const runAgentLoop = this.#deps.runAgentLoop ?? agentLoop;
		const steps: Array<WorkflowStepResult> = definition.steps.map((step) => ({
			name: step.name,
			status: "pending",
		}));
		let halted = false;
		let skipRemaining = false;
		let failureReason: string | undefined;

		for (const [index, step] of definition.steps.entries()) {
			if (skipRemaining) {
				steps[index] = { name: step.name, status: "skipped" };
				continue;
			}

			if (halted) {
				steps[index] = { name: step.name, status: "pending" };
				continue;
			}

			if (step.condition !== undefined) {
				try {
					const shouldRun = evaluateCondition(step.condition, parameters);
					if (!shouldRun) {
						steps[index] = { name: step.name, status: "skipped" };
						continue;
					}
				} catch (error: unknown) {
					this.#deps.logger?.warn("workflow_condition_invalid", {
						condition: step.condition,
						error: error instanceof Error ? error.message : String(error),
						step: step.name,
						workflow: name,
					});
					steps[index] = { name: step.name, status: "skipped" };
					continue;
				}
			}

			steps[index] = { name: step.name, status: "running" };
			let renderedPrompt = "";
			try {
				renderedPrompt = expandTemplate(step.prompt, parameters);
			} catch (error: unknown) {
				steps[index] = {
					error: error instanceof Error ? error.message : String(error),
					name: step.name,
					status: "failed",
				};
				halted = true;
				failureReason = steps[index].error;
				continue;
			}

			await this.#deps.sessionManager.appendMessage(session.id, {
				content: [{ text: renderedPrompt, type: "text" }],
				role: "user",
			});

			try {
				const contextMessages = await this.#deps.sessionManager.buildContextForRun(session.id);
				const beforeLength = contextMessages.length;
				const systemPrompt =
					this.#deps.systemPromptBuilder === undefined
						? "You are executing a structured workflow."
						: this.#deps.systemPromptBuilder(await this.#deps.sessionManager.get(session.id));

				const finalMessages = await runAgentLoop(
					contextMessages,
					this.#deps.toolRegistry,
					systemPrompt,
					this.#deps.model,
					{
						...(this.#deps.apiKeyResolver === undefined
							? {}
							: { apiKeyResolver: this.#deps.apiKeyResolver }),
						maxIterations: this.#deps.defaultMaxIterations,
						onTurnComplete: (event) => {
							void this.#deps.sessionManager.recordTurnMetrics(session.id, event).catch(() => {
								return;
							});
						},
						sessionId: session.id,
					},
				);

				const stepMessages = finalMessages.slice(beforeLength);
				for (const message of stepMessages) {
					const appendInput = toSessionAppendInput(message);
					if (appendInput !== undefined) {
						await this.#deps.sessionManager.appendMessage(session.id, appendInput);
					}
				}

				const maxIterationsReached =
					stepMessages.at(-1)?.role === "assistant" &&
					assistantOutput(
						stepMessages.at(-1) as Extract<(typeof stepMessages)[number], { role: "assistant" }>,
					).includes("Stopped: maximum iteration limit reached.");
				const failed = didStepFail(stepMessages, maxIterationsReached);
				if (failed) {
					const failedAssistant = [...stepMessages]
						.reverse()
						.find(
							(message): message is Extract<(typeof stepMessages)[number], { role: "assistant" }> =>
								message.role === "assistant",
						);
					const output = failedAssistant === undefined ? "" : assistantOutput(failedAssistant);
					steps[index] = {
						error: output || "Step failed",
						name: step.name,
						output,
						status: "failed",
					};
					failureReason = output || "Step failed";
					if (step.onFailure === "continue") {
						continue;
					}
					if (step.onFailure === "skip_remaining") {
						skipRemaining = true;
						continue;
					}
					halted = true;
					continue;
				}

				const finalAssistant = [...stepMessages]
					.reverse()
					.find(
						(message): message is Extract<(typeof stepMessages)[number], { role: "assistant" }> =>
							message.role === "assistant",
					);
				steps[index] = {
					name: step.name,
					output: finalAssistant === undefined ? "" : assistantOutput(finalAssistant),
					status: "completed",
				};
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				steps[index] = {
					error: message,
					name: step.name,
					status: "failed",
				};
				failureReason = message;
				if (step.onFailure === "continue") {
					continue;
				}
				if (step.onFailure === "skip_remaining") {
					skipRemaining = true;
					continue;
				}
				halted = true;
			}
		}

		const success = !steps.some((step) => step.status === "failed");
		return {
			...(failureReason === undefined ? {} : { error: failureReason }),
			sessionId: session.id,
			steps,
			success,
			workflow: definition.name,
		};
	}

	/**
	 * Converts a loaded workflow to an agent-callable tool.
	 */
	public workflowToTool(workflow: WorkflowDefinition): AgentTool {
		return {
			category: "write",
			description: workflow.description || `Run the ${workflow.name} workflow.`,
			execute: async (args: Record<string, unknown>) => {
				const result = await this.runWorkflow(workflow.name, args);
				return JSON.stringify(result);
			},
			name: `workflow_${workflow.name}`,
			parameters: workflow.parameterSchema,
		};
	}

	/**
	 * Returns all workflow-backed tools.
	 */
	public toTools(): Array<AgentTool> {
		return this.list().map((workflow) => this.workflowToTool(workflow));
	}
}

/**
 * Backward-compatible helper that runs a named workflow.
 */
export async function runWorkflow(
	name: string,
	parameters: Record<string, unknown>,
	deps: { engine: WorkflowEngine },
): Promise<WorkflowRunResult> {
	return await deps.engine.runWorkflow(name, parameters);
}
