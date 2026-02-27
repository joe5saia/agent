/**
 * Telegram Bot API envelope.
 */
export interface TelegramResponse<T> {
	description?: string;
	error_code?: number;
	ok: boolean;
	parameters?: {
		retry_after?: number;
	};
	result?: T;
}

/**
 * Telegram user object (partial fields used by runtime).
 */
export interface TelegramUser {
	first_name?: string;
	id: number;
	is_bot?: boolean;
	last_name?: string;
	username?: string;
}

/**
 * Telegram chat object (partial fields used by runtime).
 */
export interface TelegramChat {
	id: number;
	is_forum?: boolean;
	type: string;
}

/**
 * Telegram media descriptor extracted from inbound messages.
 */
export interface TelegramMediaDescriptor {
	file_id?: string;
	file_size?: number;
	file_unique_id?: string;
}

/**
 * Telegram message object (partial fields used by runtime).
 */
export interface TelegramMessage {
	audio?: TelegramMediaDescriptor;
	caption?: string;
	chat: TelegramChat;
	document?: TelegramMediaDescriptor;
	from?: TelegramUser;
	message_id: number;
	message_thread_id?: number;
	photo?: Array<TelegramMediaDescriptor>;
	reply_to_message?: {
		caption?: string;
		from?: TelegramUser;
		message_id: number;
		text?: string;
	};
	text?: string;
	video?: TelegramMediaDescriptor;
}

/**
 * Telegram callback query object (partial fields used by runtime).
 */
export interface TelegramCallbackQuery {
	data?: string;
	from: TelegramUser;
	id: string;
	message?: TelegramMessage;
}

/**
 * Telegram update object (partial fields used by runtime).
 */
export interface TelegramUpdate {
	callback_query?: TelegramCallbackQuery;
	edited_message?: TelegramMessage;
	message?: TelegramMessage;
	update_id: number;
}

/**
 * Telegram getMe response payload.
 */
export interface TelegramGetMeResult {
	id: number;
	username?: string;
}
