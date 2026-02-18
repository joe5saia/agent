/**
 * Agent entry point.
 *
 * Starts the server, loads configuration, and initializes the cron service.
 * This module imports only top-level modules — no deep imports.
 */

function main(): void {
	const port = Number(process.env["PORT"] ?? 3000);
	// eslint-disable-next-line no-console -- startup banner is intentional
	process.stdout.write(`agent starting on port ${port}\n`);
}

main();
