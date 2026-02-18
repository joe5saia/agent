import { readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

export interface RotationConfig {
	maxDays: number;
	maxSizeMb: number;
}

function dateStamp(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function extractDateFromName(filename: string): Date | undefined {
	const match = filename.match(/\.(\d{4}-\d{2}-\d{2})\.log$/);
	if (match === null) {
		return undefined;
	}
	const parsed = new Date(`${match[1]}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) {
		return undefined;
	}
	return parsed;
}

/**
 * Rotates log files by date/size and removes old archives.
 */
export function rotateIfNeeded(
	logPath: string,
	config: RotationConfig,
	now: Date = new Date(),
): void {
	let stats: ReturnType<typeof statSync> | undefined;
	try {
		stats = statSync(logPath);
	} catch {
		stats = undefined;
	}
	if (stats === undefined || !stats.isFile()) {
		return;
	}

	const directory = dirname(logPath);
	const extension = extname(logPath) || ".log";
	const stem = basename(logPath, extension);
	const archivePath = join(directory, `${stem}.${dateStamp(now)}${extension}`);
	const maxSizeBytes = config.maxSizeMb * 1024 * 1024;
	const modifiedDate = dateStamp(stats.mtime);
	const shouldRotate = modifiedDate !== dateStamp(now) || stats.size > maxSizeBytes;
	if (shouldRotate) {
		try {
			renameSync(logPath, archivePath);
		} catch {
			// Best effort rotation; writing continues to current file on failure.
		}
	}

	const maxAgeMs = config.maxDays * 24 * 60 * 60 * 1000;
	for (const filename of readdirSync(directory)) {
		if (!filename.startsWith(`${stem}.`) || !filename.endsWith(extension)) {
			continue;
		}
		const stamp = extractDateFromName(filename);
		if (stamp === undefined) {
			continue;
		}
		if (now.getTime() - stamp.getTime() > maxAgeMs) {
			try {
				unlinkSync(join(directory, filename));
			} catch {
				// Ignore retention cleanup errors.
			}
		}
	}
}
