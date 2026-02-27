import { describe, expect, it } from "vitest";
import { evaluateTelegramPolicy } from "../src/channels/telegram/policy.js";
import type { InboundEnvelope } from "../src/channels/types.js";
import { createConfig } from "./helpers/server-fixtures.js";

function buildEnvelope(overrides?: Partial<InboundEnvelope>): InboundEnvelope {
	const base: InboundEnvelope = {
		accountId: "default",
		channel: "telegram",
		content: { text: "hello" },
		conversationKey: "telegram:group:-100",
		messageId: "1",
		meta: { receivedAt: new Date().toISOString() },
		transport: { chatId: -100 },
		user: { id: "123" },
	};
	return { ...base, ...overrides };
}

describe("telegram policy", () => {
	it("S24.4: blocks DM sender when policy is disabled", () => {
		const config = createConfig({
			channels: {
				telegram: {
					dmPolicy: "disabled",
				},
			},
		}).channels.telegram;
		const decision = evaluateTelegramPolicy(
			config,
			buildEnvelope({
				conversationKey: "telegram:dm:123",
				transport: { chatId: 123 },
			}),
			{},
		);
		expect(decision.allowed).toBe(false);
		expect(decision.reason).toBe("dm_disabled");
	});

	it("S24.5: pairing mode rejects unknown DM sender with pairing notice", () => {
		const config = createConfig({
			channels: {
				telegram: {
					allowFrom: [],
					dmPolicy: "pairing",
				},
			},
		}).channels.telegram;
		const decision = evaluateTelegramPolicy(
			config,
			buildEnvelope({
				conversationKey: "telegram:dm:123",
				transport: { chatId: 123 },
				user: { id: "123" },
			}),
			{},
		);
		expect(decision.allowed).toBe(false);
		expect(decision.pairingNotice).toContain("123");
	});

	it("S24.6 + S24.7: mention gating blocks plain messages but allows reply-to-bot", () => {
		const config = createConfig({
			channels: {
				telegram: {
					groupAllowFrom: ["123"],
					groupPolicy: "allowlist",
					groups: {
						"*": {
							requireMention: true,
						},
					},
				},
			},
		}).channels.telegram;

		const blocked = evaluateTelegramPolicy(config, buildEnvelope(), {
			botId: 99,
			botUsername: "agentbot",
		});
		expect(blocked.allowed).toBe(false);
		expect(blocked.reason).toBe("mention_required");

		const replyAllowed = evaluateTelegramPolicy(
			config,
			buildEnvelope({
				replyTo: { messageId: "77", senderId: "99" },
			}),
			{ botId: 99, botUsername: "agentbot" },
		);
		expect(replyAllowed.allowed).toBe(true);
	});

	it("supports activation override to always", () => {
		const config = createConfig({
			channels: {
				telegram: {
					groupAllowFrom: ["123"],
					groupPolicy: "allowlist",
					groups: {
						"*": {
							requireMention: true,
						},
					},
				},
			},
		}).channels.telegram;
		const decision = evaluateTelegramPolicy(config, buildEnvelope(), {
			activationMode: "always",
			botUsername: "agentbot",
		});
		expect(decision.allowed).toBe(true);
	});
});
