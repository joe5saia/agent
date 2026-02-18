import { appendFile, readFile } from "node:fs/promises";
import type { SessionRecord } from "./types.js";

/**
 * Appends a single JSONL record atomically (one appendFile call).
 */
export async function appendRecord(path: string, record: SessionRecord): Promise<void> {
	await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Reads session records from a JSONL file and ignores a trailing partial line.
 */
export async function readRecords(path: string): Promise<Array<SessionRecord>> {
	let raw = "";
	try {
		raw = await readFile(path, "utf8");
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	if (raw === "") {
		return [];
	}

	const hasTrailingNewline = raw.endsWith("\n");
	const lines = raw.split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}

	const records: Array<SessionRecord> = [];
	for (const [index, line] of lines.entries()) {
		if (line.trim() === "") {
			continue;
		}
		try {
			records.push(JSON.parse(line) as SessionRecord);
		} catch (error: unknown) {
			const isLastLine = index === lines.length - 1;
			if (isLastLine && !hasTrailingNewline) {
				break;
			}
			throw error;
		}
	}

	return records;
}
