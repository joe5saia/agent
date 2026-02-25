/**
 * Canonical HTTP and WebSocket route prefixes for the web runtime.
 */
export const serverPaths = {
	health: "/agent_health",
	ui: "/agent",
	ws: "/agent_ws",
} as const;

/**
 * Prefixes API route namespaces under /agent_api.
 */
export function agentApiPath(path: string): string {
	const normalized = path.startsWith("/") ? path : `/${path}`;
	return `/agent_api${normalized}`;
}
