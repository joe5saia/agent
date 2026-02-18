/**
 * Tool policy for unattended cron runs.
 */
export interface CronJobPolicy {
	allowedTools?: Array<string>;
	maxIterations?: number;
}

/**
 * Cron job configuration.
 */
export interface CronJobConfig {
	enabled: boolean;
	id: string;
	policy?: CronJobPolicy;
	prompt: string;
	schedule: string;
	timezone?: string;
}

/**
 * In-memory cron status snapshot for REST responses.
 */
export interface CronJobStatus {
	consecutiveFailures: number;
	enabled: boolean;
	id: string;
	lastErrorSnippet?: string;
	lastRunAt?: string;
	lastStatus?: "error" | "success";
	nextRunAt?: string;
	schedule: string;
}
