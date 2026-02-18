import type { TSchema } from "@sinclair/typebox";

export type WorkflowStepStatus = "completed" | "failed" | "pending" | "running" | "skipped";

export type WorkflowStepFailurePolicy = "continue" | "halt" | "skip_remaining";

export interface WorkflowParameterDefinition {
	default?: boolean | number | string;
	description?: string;
	enum?: Array<string>;
	type: "boolean" | "number" | "string";
}

export interface WorkflowStep {
	condition?: string;
	name: string;
	onFailure?: WorkflowStepFailurePolicy;
	prompt: string;
}

export interface WorkflowDefinition {
	description: string;
	name: string;
	parameterDefinitions: Record<string, WorkflowParameterDefinition>;
	parameterSchema: TSchema;
	steps: Array<WorkflowStep>;
}

export interface WorkflowStepResult {
	error?: string;
	name: string;
	output?: string;
	status: WorkflowStepStatus;
}

export interface WorkflowRunResult {
	error?: string;
	sessionId: string;
	steps: Array<WorkflowStepResult>;
	success: boolean;
	workflow: string;
}
