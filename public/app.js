/* global WebSocket, document, fetch, window */

const state = {
	activeRunId: "",
	activeSessionId: "",
	sessions: [],
	streamingNode: null,
	ws: null,
};

const sessionListNode = document.querySelector("#session-list");
const messagesNode = document.querySelector("#messages");
const composerNode = document.querySelector("#composer");
const promptNode = document.querySelector("#prompt");
const cancelButtonNode = document.querySelector("#cancel");
const newSessionNode = document.querySelector("#new-session");

function renderSessions() {
	sessionListNode.innerHTML = "";
	for (const session of state.sessions) {
		const item = document.createElement("li");
		item.className = `session-item ${session.id === state.activeSessionId ? "active" : ""}`;
		const date = new Date(session.lastMessageAt).toLocaleString();
		item.textContent = `${session.name} · ${date}`;
		item.onclick = () => {
			void openSession(session.id);
		};
		sessionListNode.append(item);
	}
}

function appendMessage(role, text) {
	const node = document.createElement("div");
	node.className = `message ${role}`;
	node.textContent = text;
	messagesNode.append(node);
	messagesNode.scrollTop = messagesNode.scrollHeight;
	return node;
}

function ensureSocket() {
	if (state.ws !== null && state.ws.readyState === WebSocket.OPEN) {
		return;
	}

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	state.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
	state.ws.onmessage = (event) => {
		const payload = JSON.parse(event.data);
		if (payload.sessionId !== state.activeSessionId) {
			return;
		}

		switch (payload.type) {
			case "run_start": {
				state.activeRunId = payload.runId;
				cancelButtonNode.hidden = false;
				state.streamingNode = appendMessage("assistant", "");
				break;
			}
			case "stream_delta": {
				if (state.streamingNode !== null) {
					state.streamingNode.textContent += payload.delta;
				}
				break;
			}
			case "tool_start": {
				appendMessage("meta", `Tool: ${payload.name}`);
				break;
			}
			case "tool_result": {
				appendMessage("meta", `Tool result: ${JSON.stringify(payload.content)}`);
				break;
			}
			case "status": {
				appendMessage("meta", payload.message);
				break;
			}
			case "session_renamed": {
				const target = state.sessions.find((entry) => entry.id === payload.sessionId);
				if (target) {
					target.name = payload.name;
					renderSessions();
				}
				break;
			}
			case "message_complete": {
				cancelButtonNode.hidden = true;
				state.activeRunId = "";
				state.streamingNode = null;
				void loadSessions();
				break;
			}
			case "error": {
				cancelButtonNode.hidden = true;
				state.activeRunId = "";
				appendMessage("meta", payload.error);
				break;
			}
		}
	};
}

async function loadSessions() {
	const response = await fetch("/api/sessions");
	state.sessions = await response.json();
	renderSessions();
}

async function openSession(sessionId) {
	state.activeSessionId = sessionId;
	renderSessions();
	messagesNode.innerHTML = "";
	const response = await fetch(`/api/sessions/${sessionId}`);
	const payload = await response.json();
	for (const message of payload.messages) {
		if (message.role === "user") {
			appendMessage("user", message.content.map((entry) => entry.text).join("\n"));
		}
		if (message.role === "assistant") {
			appendMessage(
				"assistant",
				message.content
					.filter((entry) => entry.type === "text")
					.map((entry) => entry.text)
					.join("\n"),
			);
		}
		if (message.role === "toolResult") {
			appendMessage("meta", message.content.map((entry) => entry.text).join("\n"));
		}
	}
}

async function createSession() {
	const response = await fetch("/api/sessions", {
		body: JSON.stringify({}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	const payload = await response.json();
	await loadSessions();
	await openSession(payload.id);
}

composerNode.addEventListener("submit", (event) => {
	event.preventDefault();
	const content = promptNode.value.trim();
	if (content === "" || state.activeSessionId === "") {
		return;
	}
	appendMessage("user", content);
	promptNode.value = "";
	ensureSocket();
	state.ws.send(
		JSON.stringify({ content, sessionId: state.activeSessionId, type: "send_message" }),
	);
});

promptNode.addEventListener("keydown", (event) => {
	if (event.key !== "Enter" || event.isComposing || !event.metaKey) {
		return;
	}

	event.preventDefault();
	composerNode.requestSubmit();
});

cancelButtonNode.addEventListener("click", () => {
	if (state.ws === null || state.activeRunId === "" || state.activeSessionId === "") {
		return;
	}
	state.ws.send(
		JSON.stringify({ runId: state.activeRunId, sessionId: state.activeSessionId, type: "cancel" }),
	);
});

newSessionNode.addEventListener("click", () => {
	void createSession();
});

await loadSessions();
if (state.sessions.length === 0) {
	await createSession();
} else {
	await openSession(state.sessions[0].id);
}
ensureSocket();
