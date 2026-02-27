import type { SessionManager } from "../sessions/index.js";
import { ConversationMappingStore } from "./mapping-store.js";

export interface ResolveConversationInput {
	channel: "telegram";
	chatId: number;
	conversationKey: string;
	threadId?: number;
}

export interface ResolveConversationOutput {
	created: boolean;
	sessionId: string;
}

interface ConversationRouterOptions {
	mappingStore: ConversationMappingStore;
	sessionManager: SessionManager;
}

/**
 * Resolves channel conversation keys into existing or newly created session IDs.
 */
export class ConversationRouter {
	readonly #mappingStore: ConversationMappingStore;
	readonly #sessionManager: SessionManager;

	public constructor(options: ConversationRouterOptions) {
		this.#mappingStore = options.mappingStore;
		this.#sessionManager = options.sessionManager;
	}

	public async resolve(input: ResolveConversationInput): Promise<ResolveConversationOutput> {
		const existing = this.#mappingStore.get(input.conversationKey);
		if (existing !== undefined) {
			try {
				await this.#sessionManager.get(existing.sessionId);
				return { created: false, sessionId: existing.sessionId };
			} catch {
				// Session was removed. Re-create and update mapping.
			}
		}

		const session = await this.#sessionManager.create({
			source: "interactive",
		});
		await this.#mappingStore.upsert({
			channel: input.channel,
			chatId: input.chatId,
			conversationKey: input.conversationKey,
			sessionId: session.id,
			...(input.threadId === undefined ? {} : { threadId: input.threadId }),
		});
		return { created: true, sessionId: session.id };
	}
}
