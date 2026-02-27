import type { AgentConfig } from "../../config/index.js";
import type { InboundEnvelope } from "../types.js";

/**
 * Conversation-level activation mode overrides for group chats.
 */
export type ActivationMode = "always" | "mention";

/**
 * Policy decision emitted for each normalized inbound message.
 */
export interface TelegramPolicyDecision {
	allowed: boolean;
	pairingNotice?: string;
	reason:
		| "allowed"
		| "dm_allowlist_reject"
		| "dm_disabled"
		| "group_allowlist_reject"
		| "group_disabled"
		| "mention_required";
}

/**
 * Resolves the effective group policy, including topic-level overrides.
 */
export function resolveGroupPolicy(
	config: AgentConfig["channels"]["telegram"],
	chatId: number,
	threadId?: number,
): "allowlist" | "disabled" | "open" {
	const groupConfig = config.groups[String(chatId)] ?? config.groups["*"];
	if (
		threadId !== undefined &&
		groupConfig?.topics !== undefined &&
		groupConfig.topics[String(threadId)]?.groupPolicy !== undefined
	) {
		return groupConfig.topics[String(threadId)]?.groupPolicy ?? config.groupPolicy;
	}
	return groupConfig?.groupPolicy ?? config.groupPolicy;
}

/**
 * Resolves mention-gating requirement, including topic-level overrides.
 */
export function resolveRequireMention(
	config: AgentConfig["channels"]["telegram"],
	chatId: number,
	threadId?: number,
): boolean {
	const groupConfig = config.groups[String(chatId)] ?? config.groups["*"];
	if (
		threadId !== undefined &&
		groupConfig?.topics !== undefined &&
		groupConfig.topics[String(threadId)]?.requireMention !== undefined
	) {
		return groupConfig.topics[String(threadId)]?.requireMention ?? true;
	}
	if (groupConfig?.requireMention !== undefined) {
		return groupConfig.requireMention;
	}
	return true;
}

/**
 * Evaluates sender/group mention policy for a Telegram inbound message.
 */
export function evaluateTelegramPolicy(
	config: AgentConfig["channels"]["telegram"],
	envelope: InboundEnvelope,
	options: {
		activationMode?: ActivationMode;
		botId?: number;
		botUsername?: string;
	},
): TelegramPolicyDecision {
	const senderId = envelope.user.id;
	const isDm = envelope.conversationKey.startsWith("telegram:dm:");

	if (isDm) {
		if (config.dmPolicy === "disabled") {
			return { allowed: false, reason: "dm_disabled" };
		}
		if (config.dmPolicy === "open") {
			return { allowed: true, reason: "allowed" };
		}
		if (config.allowFrom.includes(senderId)) {
			return { allowed: true, reason: "allowed" };
		}
		if (config.dmPolicy === "pairing") {
			return {
				allowed: false,
				pairingNotice: `Pairing required. Add Telegram user ID ${senderId} to channels.telegram.allow_from.`,
				reason: "dm_allowlist_reject",
			};
		}
		return { allowed: false, reason: "dm_allowlist_reject" };
	}

	const groupPolicy = resolveGroupPolicy(
		config,
		envelope.transport.chatId,
		envelope.transport.messageThreadId,
	);
	if (groupPolicy === "disabled") {
		return { allowed: false, reason: "group_disabled" };
	}

	const allowSet = new Set(
		config.groupAllowFrom.length > 0 ? config.groupAllowFrom : config.allowFrom,
	);
	if (groupPolicy === "allowlist" && !allowSet.has(senderId)) {
		return { allowed: false, reason: "group_allowlist_reject" };
	}

	let requireMention = resolveRequireMention(
		config,
		envelope.transport.chatId,
		envelope.transport.messageThreadId,
	);
	if (options.activationMode === "always") {
		requireMention = false;
	}
	if (options.activationMode === "mention") {
		requireMention = true;
	}
	if (!requireMention) {
		return { allowed: true, reason: "allowed" };
	}

	const lowerText = envelope.content.text.toLowerCase();
	const explicitMention =
		options.botUsername !== undefined && lowerText.includes(`@${options.botUsername}`);
	const implicitMention =
		options.botId !== undefined && envelope.replyTo?.senderId === String(options.botId);
	if (explicitMention || implicitMention) {
		return { allowed: true, reason: "allowed" };
	}

	return { allowed: false, reason: "mention_required" };
}
