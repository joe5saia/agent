import type { Context, Next } from "hono";
import type { ServerAppContext } from "../types.js";

interface IdentityInfo {
	login?: string;
	name?: string;
}

function normalizeAddress(rawAddress: string | undefined): string {
	if (rawAddress === undefined || rawAddress === "") {
		return "";
	}
	if (rawAddress.startsWith("::ffff:")) {
		return rawAddress.slice(7);
	}
	return rawAddress;
}

function isLoopbackAddress(rawAddress: string | undefined): boolean {
	const address = normalizeAddress(rawAddress);
	return (
		address === "127.0.0.1" ||
		address === "::1" ||
		address === "localhost" ||
		address.startsWith("127.")
	);
}

function getClientAddress(context: Context): string | undefined {
	const forwarded = context.req.header("x-forwarded-for");
	if (forwarded !== undefined && forwarded.trim() !== "") {
		return forwarded.split(",")[0]?.trim();
	}

	const remoteAddress = (
		context.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
	)?.incoming?.socket?.remoteAddress;
	return remoteAddress;
}

/**
 * Parses Tailscale identity headers and enforces optional user allowlist.
 */
export async function identityMiddleware(
	context: Context<{ Variables: ServerAppContext & { identity: IdentityInfo } }>,
	next: Next,
): Promise<Response | void> {
	const login = context.req.header("Tailscale-User-Login");
	const name = context.req.header("Tailscale-User-Name");
	const identity: IdentityInfo = {
		...(login !== undefined ? { login } : {}),
		...(name !== undefined ? { name } : {}),
	};
	context.set("identity", identity);

	context.var.deps.logger.info("request_identity", {
		path: context.req.path,
		...(login !== undefined ? { tailscaleUserLogin: login } : {}),
		...(name !== undefined ? { tailscaleUserName: name } : {}),
	});

	const allowedUsers = context.var.config.security.allowedUsers;
	if (allowedUsers.length === 0) {
		await next();
		return;
	}

	const remoteAddress = getClientAddress(context);
	if (isLoopbackAddress(remoteAddress)) {
		await next();
		return;
	}

	if (login === undefined || !allowedUsers.includes(login)) {
		return context.json({ error: "Forbidden" }, 403);
	}

	await next();
}
