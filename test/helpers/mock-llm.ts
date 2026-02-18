import type { AssistantMessageEvent, Message } from "@mariozechner/pi-ai";
import type { AssistantMessageEventStreamLike } from "../../src/agent/types.js";

interface MockStreamStep {
	assistant: Extract<Message, { role: "assistant" }>;
	events?: Array<AssistantMessageEvent>;
}

class MockEventStream implements AssistantMessageEventStreamLike {
	readonly #assistant: Extract<Message, { role: "assistant" }>;
	readonly #events: Array<AssistantMessageEvent>;

	public constructor(step: MockStreamStep) {
		this.#assistant = step.assistant;
		this.#events = step.events ?? [];
	}

	public async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
		for (const event of this.#events) {
			yield event;
		}
	}

	public async result(): Promise<Extract<Message, { role: "assistant" }>> {
		return this.#assistant;
	}
}

/**
 * Creates a deterministic mock stream factory from scripted assistant responses.
 */
export function createMockStreamFactory(
	steps: Array<MockStreamStep>,
): (_model?: unknown, _context?: unknown, _options?: unknown) => AssistantMessageEventStreamLike {
	let index = 0;
	return (): AssistantMessageEventStreamLike => {
		const step = steps[index];
		if (step === undefined) {
			throw new Error("Mock stream exhausted.");
		}
		index += 1;
		return new MockEventStream(step);
	};
}
