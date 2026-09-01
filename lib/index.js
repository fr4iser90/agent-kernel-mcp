import { boundContextSummary, createUserMessage } from "@deepseek-ai/dsh-llm";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
//#region lib/types/host/idle-followup.js
/**
* Per-Session idle followup: opt-in flag, followup prompt, and optional hour budget
* under `$DSH_HOME`. Independent of autonomy `state.json` so Header can arm
* without `/autonomy start`.
* @module agent-kernel-mcp/idle-followup
*/
/** Default followup text when the operator leaves the prompt empty. */
const DEFAULT_FOLLOWUP_PROMPT = "Continue";
/** Max UTF-8 code units accepted for a custom followup prompt. */
const MAX_FOLLOWUP_PROMPT_CHARS = 8e3;
/**
* Resolve the directory that holds `session-followup/<sessionId>.json`.
* Prefers `$DSH_HOME`, else `~/.dsh`.
* @returns absolute followup root directory.
*/
function resolveSessionFollowupRoot() {
	const home = process.env.DSH_HOME?.trim();
	const base = home !== void 0 && home.length > 0 ? home : path.join(os.homedir(), ".dsh");
	return path.join(base, "session-followup");
}
/**
* Reject session ids that are unsafe as a single path segment.
* @param sessionId - Session id string.
* @returns the same id when valid.
*/
function assertFollowupSessionId(sessionId) {
	if (!/^[A-Za-z0-9._-]{1,200}$/u.test(sessionId)) throw new Error("sessionId is not a safe followup filename");
	return sessionId;
}
/**
* Absolute path for one Session's followup file.
* @param followupRoot - directory from {@link resolveSessionFollowupRoot}.
* @param sessionId - Session id.
*/
function resolveFollowupPath(followupRoot, sessionId) {
	return path.join(followupRoot, `${assertFollowupSessionId(sessionId)}.json`);
}
/**
* Normalize prompt text; empty → default Continue.
* @param raw - operator input.
* @returns trimmed prompt or {@link DEFAULT_FOLLOWUP_PROMPT}.
*/
function normalizeFollowupPrompt(raw) {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return DEFAULT_FOLLOWUP_PROMPT;
	if (trimmed.length > 8e3) throw new Error(`followup prompt exceeds ${String(MAX_FOLLOWUP_PROMPT_CHARS)} characters`);
	return trimmed;
}
/**
* Validate active-hours budget (`0` = forever).
* @param raw - operator input.
* @returns sanitized hour count.
*/
function normalizeFollowupActiveHours(raw) {
	if (!Number.isSafeInteger(raw) || raw < 0 || raw > 720) throw new Error(`followup activeHours must be an integer from 0 to ${String(720)}`);
	return raw;
}
/**
* Default in-memory followup when no file exists.
* @returns disabled Continue record with empty timestamps.
*/
function emptyFollowupState() {
	return {
		enabled: false,
		prompt: DEFAULT_FOLLOWUP_PROMPT,
		activeHours: 0,
		armedAt: "",
		lastPolledAt: "",
		lastWakeAt: "",
		updatedAt: ""
	};
}
/**
* Parse a JSON followup record; invalid shapes throw.
* @param raw - file UTF-8 contents.
* @returns durable followup state.
*/
function parseFollowupState(raw) {
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("followup state must be a JSON object");
	const record = parsed;
	const enabled = record["enabled"] === true;
	const prompt = normalizeFollowupPrompt(typeof record["prompt"] === "string" ? record["prompt"] : DEFAULT_FOLLOWUP_PROMPT);
	const hoursRaw = record["activeHours"];
	return {
		enabled,
		prompt,
		activeHours: hoursRaw === void 0 ? 0 : typeof hoursRaw === "number" ? normalizeFollowupActiveHours(hoursRaw) : (() => {
			throw new Error("followup state activeHours must be a number");
		})(),
		armedAt: typeof record["armedAt"] === "string" ? record["armedAt"] : "",
		lastPolledAt: typeof record["lastPolledAt"] === "string" ? record["lastPolledAt"] : "",
		lastWakeAt: typeof record["lastWakeAt"] === "string" ? record["lastWakeAt"] : "",
		updatedAt: typeof record["updatedAt"] === "string" ? record["updatedAt"] : ""
	};
}
/**
* Read followup state for a Session; missing file → empty defaults.
* @param followupRoot - storage directory.
* @param sessionId - Session id.
*/
async function readSessionFollowup(followupRoot, sessionId) {
	const file = resolveFollowupPath(followupRoot, sessionId);
	let raw;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return emptyFollowupState();
		throw error;
	}
	return parseFollowupState(raw);
}
/**
* Persist followup state for a Session.
* @param followupRoot - storage directory.
* @param sessionId - Session id.
* @param state - next record.
*/
async function writeSessionFollowup(followupRoot, sessionId, state) {
	const file = resolveFollowupPath(followupRoot, sessionId);
	await mkdir(followupRoot, { recursive: true });
	await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
/**
* Session ids whose durable followup file is currently enabled (and budget-active).
* Corrupt or unsafe filenames are skipped so one bad file cannot break the index.
* @param followupRoot - directory from {@link resolveSessionFollowupRoot}.
* @param nowMs - evaluation clock for hour-budget expiry.
*/
async function listEnabledFollowupSessionIds(followupRoot, nowMs = Date.now()) {
	let names;
	try {
		names = await readdir(followupRoot);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
	const enabled = [];
	const iso = new Date(nowMs).toISOString();
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const sessionId = name.slice(0, -5);
		try {
			assertFollowupSessionId(sessionId);
		} catch {
			continue;
		}
		let state;
		try {
			state = parseFollowupState(await readFile(resolveFollowupPath(followupRoot, sessionId), "utf8"));
		} catch {
			continue;
		}
		const { state: live, expired } = expireFollowupIfNeeded(state, nowMs, iso);
		if (expired || !live.enabled) continue;
		enabled.push(sessionId);
	}
	return enabled;
}
/**
* Remaining ms in a limited arm window; `Infinity` when forever; `0` when expired/off.
* @param state - durable followup.
* @param nowMs - evaluation clock.
*/
function followupRemainingMs(state, nowMs) {
	if (!state.enabled) return 0;
	if (state.activeHours <= 0) return Number.POSITIVE_INFINITY;
	if (state.armedAt.length === 0) return 0;
	const started = Date.parse(state.armedAt);
	if (!Number.isFinite(started)) return 0;
	const budgetMs = state.activeHours * 36e5;
	return Math.max(0, started + budgetMs - nowMs);
}
/**
* Whether the arm window is still open.
* @param state - durable followup.
* @param nowMs - evaluation clock.
*/
function isFollowupBudgetActive(state, nowMs) {
	const remaining = followupRemainingMs(state, nowMs);
	return remaining === Number.POSITIVE_INFINITY || remaining > 0;
}
/**
* Disable a timed-out followup; no-op when still active or already off.
* @param state - durable followup.
* @param nowMs - evaluation clock.
* @param nowIso - write timestamp when expiring.
* @returns next state and whether an expiry write is needed.
*/
function expireFollowupIfNeeded(state, nowMs, nowIso) {
	if (!state.enabled || isFollowupBudgetActive(state, nowMs)) return {
		state,
		expired: false
	};
	return {
		state: {
			...state,
			enabled: false,
			armedAt: "",
			lastPolledAt: "",
			lastWakeAt: "",
			updatedAt: nowIso
		},
		expired: true
	};
}
/**
* Whether the Host timer should post an idle followup.
* @param state - durable followup (caller should expire first).
* @param agentStatus - live agent status (`idle` only).
* @param nowMs - evaluation clock.
*/
function shouldWakeFollowup(state, agentStatus, nowMs) {
	return state.enabled && agentStatus === "idle" && isFollowupBudgetActive(state, nowMs);
}
/**
* Merge a partial update into the durable followup record.
* @param previous - current state.
* @param patch - fields to change.
* @param nowIso - write timestamp (also used as `armedAt` when arming).
* @returns next state.
*/
function patchSessionFollowup(previous, patch, nowIso) {
	if (patch.enabled === void 0 && patch.prompt === void 0 && patch.activeHours === void 0) throw new Error("followup patch requires enabled, prompt, and/or activeHours");
	const enabled = patch.enabled ?? previous.enabled;
	const activeHours = patch.activeHours !== void 0 ? normalizeFollowupActiveHours(patch.activeHours) : previous.activeHours;
	const prompt = patch.prompt !== void 0 ? normalizeFollowupPrompt(patch.prompt) : previous.prompt;
	let armedAt = previous.armedAt;
	let lastPolledAt = previous.lastPolledAt;
	let lastWakeAt = previous.lastWakeAt;
	if (!enabled) {
		armedAt = "";
		lastPolledAt = "";
		lastWakeAt = "";
	} else if (!previous.enabled || patch.activeHours !== void 0 || previous.armedAt.length === 0) {
		armedAt = nowIso;
		lastPolledAt = "";
		lastWakeAt = "";
	}
	return {
		enabled,
		prompt,
		activeHours,
		armedAt,
		lastPolledAt,
		lastWakeAt,
		updatedAt: nowIso
	};
}
/**
* Mark that the Host timer just evaluated this Session for an idle followup.
* @param state - current armed state.
* @param nowIso - poll timestamp.
*/
function recordFollowupPoll(state, nowIso) {
	return {
		...state,
		lastPolledAt: nowIso,
		updatedAt: nowIso
	};
}
/**
* Mark that this Session just received an idle followup followup.
* @param state - current armed state.
* @param nowIso - wake timestamp.
*/
function recordFollowupWake(state, nowIso) {
	return {
		...state,
		lastPolledAt: nowIso,
		lastWakeAt: nowIso,
		updatedAt: nowIso
	};
}
//#endregion
//#region lib/types/host/loopback-hostname.js
/**
* Browser-safe, zero-dependency loopback classification shared by the `/api`
* Host fence and the package's `ctx.connection` state. The predicate stays
* package-internal; client plugins consume the derived state through Cordis.
*/
/**
* Whether a normalized URL hostname names the local loopback authority.
* @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
* @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
*/
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
//#endregion
//#region lib/types/host/api-request-trust.js
/**
* Browser-trust fence for every /api request. Defends the two confused-deputy
* paths a browser opens against a local HTTP API — DNS rebinding (Host names
* the attacker's domain while the socket reaches this server) and cross-site
* requests fired from a malicious page. The Host fence binds every request,
* browser-looking or not: over plain HTTP a browser attaches neither Origin
* nor Fetch-Metadata to reads (images and navigations — those
* headers go only to trustworthy destinations), so an unmarked request may
* still be a rebound browser read and Host is the one header rebinding cannot
* forge. Non-browser and remote clients pass the same fence via loopback,
* deployment-derived LAN IP literals, or a declared `trustedHosts` authority.
* Network reachability and authentication stay out of scope: binding policy
* belongs to the webserver config, and this fence is not an auth layer.
*/
function header(headers, name) {
	if (headers instanceof Headers) return headers.get(name) ?? void 0;
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority (hostname lowercased, default port stripped, IPv6 bracketed), or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/**
* Canonical form of a parsed authority: `hostname` when no port was written,
* else `hostname:port`. The port is judged from URL parses under both special
* schemes (their default ports differ, so `:80` and `:443` still count as
* explicit), never from the raw string, where WHATWG trimming would misread
* shapes like `host:port ` as port-less.
*/
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/**
* Whether the request authority matches a `trustedHosts` entry. An entry with
* an explicit port matches that exact authority; a port-less entry matches the
* hostname on any port (the shape the CLI derives for IP-literal LAN serving,
* where the bound port may be OS-assigned). Both sides compare through WHATWG
* normalization, so case and a redundant `:80` never decide trust.
*/
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one /api request may reach the RPC bridge.
* @param request - Node HTTP or Fetch request facts (headers).
* @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
* @returns true when the Host is ours (loopback or trusted) and any attached browser markers are same-origin.
*/
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region lib/types/host/connect.js
/**
* Global agent-kernel connection for DSH Header + MCP stdio.
* `$DSH_HOME/agent-kernel/connect.json`
*/
function resolveAgentKernelConnectPath() {
	const home = process.env.DSH_HOME?.trim();
	const base = home !== void 0 && home.length > 0 ? home : path.join(os.homedir(), ".dsh");
	return path.join(base, "agent-kernel", "connect.json");
}
function emptyAgentKernelConnect() {
	return {
		url: "",
		token: "",
		updatedAt: ""
	};
}
function parseAgentKernelConnect(raw) {
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("agent-kernel connect must be a JSON object");
	const record = parsed;
	return {
		url: typeof record["url"] === "string" ? record["url"].trim().replace(/\/$/, "") : "",
		token: typeof record["token"] === "string" ? record["token"].trim() : "",
		updatedAt: typeof record["updatedAt"] === "string" ? record["updatedAt"] : ""
	};
}
async function readAgentKernelConnect() {
	try {
		return parseAgentKernelConnect(await readFile(resolveAgentKernelConnectPath(), "utf8"));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return emptyAgentKernelConnect();
		throw error;
	}
}
async function writeAgentKernelConnect(next, nowIso) {
	const previous = await readAgentKernelConnect();
	const url = next.url !== void 0 ? next.url.trim().replace(/\/$/, "") : previous.url;
	const token = next.token !== void 0 ? next.token.trim() : previous.token;
	if (url.length > 0) try {
		new URL(url);
	} catch {
		throw new Error("agent-kernel url must be an absolute http(s) URL");
	}
	const state = {
		url,
		token,
		updatedAt: nowIso
	};
	const file = resolveAgentKernelConnectPath();
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	return state;
}
//#endregion
//#region lib/types/host/http.js
async function readJsonBody(req, maxBytes) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buf.byteLength;
		if (size > maxBytes) throw new Error(`request body exceeds ${String(maxBytes)} bytes`);
		chunks.push(buf);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	if (raw.trim().length === 0) return {};
	return JSON.parse(raw);
}
function resolveSession(sessions, sessionIdRaw) {
	if (sessionIdRaw === null || sessionIdRaw === "") return {
		ok: false,
		status: 400,
		message: "missing sessionId"
	};
	if (sessions.get(SessionId(sessionIdRaw)) === void 0) return {
		ok: false,
		status: 404,
		message: "session not found"
	};
	return {
		ok: true,
		sessionId: sessionIdRaw
	};
}
function writeJson(res, status, body) {
	const text = `${JSON.stringify(body)}\n`;
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Length": Buffer.byteLength(text)
	}).end(text);
}
function statusPayload(limits, followup, connect) {
	return {
		watchdogEnabled: followup.enabled,
		followupPrompt: followup.prompt,
		followupActiveHours: followup.activeHours,
		followupArmedAt: followup.armedAt,
		followupLastPolledAt: followup.lastPolledAt,
		followupLastWakeAt: followup.lastWakeAt,
		watchdogIntervalMinutes: limits.watchdogIntervalMinutes,
		pluginEnabled: limits.pluginEnabled,
		kernelUrl: connect.url,
		kernelToken: connect.token,
		kernelConnected: connect.token.length > 0 && connect.url.length > 0
	};
}
async function loadLiveFollowup(followupRoot, sessionId) {
	let followup;
	try {
		followup = await readSessionFollowup(followupRoot, sessionId);
	} catch {
		return emptyFollowupState();
	}
	const nowMs = Date.now();
	const { state, expired } = expireFollowupIfNeeded(followup, nowMs, new Date(nowMs).toISOString());
	if (expired) try {
		await writeSessionFollowup(followupRoot, sessionId, state);
	} catch {}
	return state;
}
async function handleAgentKernelStatus(req, res, sessions, limits) {
	if (!isTrustedApiRequest(req, limits.trustedHosts)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	if (req.method !== "GET") {
		res.writeHead(405, { Allow: "GET" }).end("method not allowed");
		return;
	}
	const resolved = resolveSession(sessions, new URL(req.url ?? "/", "http://dsh.internal").searchParams.get("sessionId"));
	if (!resolved.ok) {
		res.writeHead(resolved.status).end(resolved.message);
		return;
	}
	writeJson(res, 200, statusPayload(limits, await loadLiveFollowup(limits.followupRoot, resolved.sessionId), await readAgentKernelConnect()));
}
async function handleAgentKernelFollowup(req, res, sessions, limits) {
	if (!isTrustedApiRequest(req, limits.trustedHosts)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	if (req.method !== "POST") {
		res.writeHead(405, { Allow: "POST" }).end("method not allowed");
		return;
	}
	let body;
	try {
		body = await readJsonBody(req, 64 * 1024);
	} catch (error) {
		res.writeHead(400).end(error instanceof Error ? error.message : String(error));
		return;
	}
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		res.writeHead(400).end("body must be a JSON object");
		return;
	}
	const record = body;
	const sessionIdRaw = typeof record["sessionId"] === "string" ? record["sessionId"] : null;
	const hasEnabled = typeof record["enabled"] === "boolean";
	const hasPrompt = typeof record["prompt"] === "string";
	const hasHours = typeof record["activeHours"] === "number";
	const hasKernelUrl = typeof record["kernelUrl"] === "string";
	const hasKernelToken = typeof record["kernelToken"] === "string";
	if (!hasEnabled && !hasPrompt && !hasHours && !hasKernelUrl && !hasKernelToken) {
		res.writeHead(400).end("enabled, prompt, activeHours, kernelUrl, and/or kernelToken required");
		return;
	}
	const resolved = resolveSession(sessions, sessionIdRaw);
	if (!resolved.ok) {
		res.writeHead(resolved.status).end(resolved.message);
		return;
	}
	const nowIso = (/* @__PURE__ */ new Date()).toISOString();
	let connect = await readAgentKernelConnect();
	if (hasKernelUrl || hasKernelToken) try {
		connect = await writeAgentKernelConnect({
			...hasKernelUrl ? { url: record["kernelUrl"] } : {},
			...hasKernelToken ? { token: record["kernelToken"] } : {}
		}, nowIso);
	} catch (error) {
		res.writeHead(400).end(error instanceof Error ? error.message : String(error));
		return;
	}
	let next;
	try {
		const previous = await readSessionFollowup(limits.followupRoot, resolved.sessionId);
		if (hasEnabled || hasPrompt || hasHours) {
			const patch = {};
			if (hasEnabled) patch.enabled = record["enabled"];
			if (hasPrompt) patch.prompt = record["prompt"];
			if (hasHours) patch.activeHours = record["activeHours"];
			next = patchSessionFollowup(previous, patch, nowIso);
			await writeSessionFollowup(limits.followupRoot, resolved.sessionId, next);
		} else next = previous;
	} catch (error) {
		res.writeHead(400).end(error instanceof Error ? error.message : String(error));
		return;
	}
	writeJson(res, 200, statusPayload(limits, next, connect));
}
/**
* Claim a pairing code from Agent Kernel (proxied so the browser never talks
* cross-origin to the kernel). Writes `$DSH_HOME/agent-kernel/connect.json`.
*/
async function handleAgentKernelPair(req, res, limits) {
	if (!isTrustedApiRequest(req, limits.trustedHosts)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	if (req.method !== "POST") {
		res.writeHead(405, { Allow: "POST" }).end("method not allowed");
		return;
	}
	let body;
	try {
		body = await readJsonBody(req, 16 * 1024);
	} catch (error) {
		res.writeHead(400).end(error instanceof Error ? error.message : String(error));
		return;
	}
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		res.writeHead(400).end("body must be a JSON object");
		return;
	}
	const record = body;
	const code = typeof record["code"] === "string" ? record["code"].trim() : "";
	if (code.length === 0) {
		res.writeHead(400).end("code required");
		return;
	}
	const previous = await readAgentKernelConnect();
	const kernelUrlRaw = typeof record["kernelUrl"] === "string" ? record["kernelUrl"].trim() : previous.url;
	if (kernelUrlRaw.length === 0) {
		res.writeHead(400).end("kernelUrl required (set Target URL once)");
		return;
	}
	let kernelUrl;
	try {
		kernelUrl = new URL(kernelUrlRaw.replace(/\/$/, "")).origin;
	} catch {
		res.writeHead(400).end("kernelUrl must be an absolute http(s) URL");
		return;
	}
	let claimRes;
	try {
		claimRes = await fetch(`${kernelUrl}/api/pair/claim`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json"
			},
			body: JSON.stringify({ code })
		});
	} catch (error) {
		res.writeHead(502).end(error instanceof Error ? error.message : String(error));
		return;
	}
	const claimJson = await claimRes.json().catch(() => ({}));
	if (!claimRes.ok) {
		res.writeHead(claimRes.status >= 400 && claimRes.status < 600 ? claimRes.status : 502).end(typeof claimJson.error === "string" ? claimJson.error : `pair claim HTTP ${String(claimRes.status)}`);
		return;
	}
	if (typeof claimJson.url !== "string" || typeof claimJson.token !== "string") {
		res.writeHead(502).end("pair claim response missing url/token");
		return;
	}
	const nowIso = (/* @__PURE__ */ new Date()).toISOString();
	let connect;
	try {
		connect = await writeAgentKernelConnect({
			url: claimJson.url,
			token: claimJson.token
		}, nowIso);
	} catch (error) {
		res.writeHead(400).end(error instanceof Error ? error.message : String(error));
		return;
	}
	writeJson(res, 200, {
		ok: true,
		kernelUrl: connect.url,
		kernelConnected: true,
		updatedAt: connect.updatedAt
	});
}
async function handleAgentKernelFollowupIndex(req, res, limits) {
	if (!isTrustedApiRequest(req, limits.trustedHosts)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	if (req.method !== "GET") {
		res.writeHead(405, { Allow: "GET" }).end("method not allowed");
		return;
	}
	try {
		writeJson(res, 200, { enabled: await listEnabledFollowupSessionIds(limits.followupRoot) });
	} catch (error) {
		res.writeHead(500).end(error instanceof Error ? error.message : String(error));
	}
}
//#endregion
//#region lib/types/host/index.js
const name = "agent-kernel-mcp";
const inject = ["webServer", "sessions"];
function resolveConfig(config) {
	const watchdogIntervalMinutes = config.watchdogIntervalMinutes ?? 5;
	if (!Number.isSafeInteger(watchdogIntervalMinutes) || watchdogIntervalMinutes < 0) throw new TypeError("watchdogIntervalMinutes must be a non-negative safe integer");
	return {
		enabled: config.enabled !== false,
		watchdogIntervalMinutes,
		trustedHosts: config.trustedHosts ?? []
	};
}
function wakeIdleFollowup(agent, prompt) {
	const text = prompt.trim().length > 0 ? prompt.trim() : DEFAULT_FOLLOWUP_PROMPT;
	agent.followup(createUserMessage({
		content: [{
			type: "text",
			text
		}],
		source: {
			kind: "plugin",
			plugin: name,
			form: "notice",
			summary: boundContextSummary("Agent Kernel idle followup")
		}
	}));
}
function apply(ctx, config = {}) {
	const current = () => resolveConfig(config);
	const limitsOf = () => ({
		trustedHosts: current().trustedHosts,
		pluginEnabled: current().enabled,
		followupRoot: resolveSessionFollowupRoot(),
		watchdogIntervalMinutes: current().watchdogIntervalMinutes
	});
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/agent-kernel.status",
		handler: (req, res) => handleAgentKernelStatus(req, res, ctx.sessions, limitsOf())
	}), "agent-kernel: status");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/agent-kernel.followup",
		handler: (req, res) => handleAgentKernelFollowup(req, res, ctx.sessions, limitsOf())
	}), "agent-kernel: followup");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/agent-kernel.pair",
		handler: (req, res) => handleAgentKernelPair(req, res, limitsOf())
	}), "agent-kernel: pair");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/agent-kernel.followup-index",
		handler: (req, res) => handleAgentKernelFollowupIndex(req, res, limitsOf())
	}), "agent-kernel: followup-index");
	const lastWakeAt = /* @__PURE__ */ new Map();
	const intervalMinutes = current().watchdogIntervalMinutes;
	if (intervalMinutes > 0) {
		const intervalMs = intervalMinutes * 6e4;
		const tick = () => {
			(async () => {
				const resolved = current();
				if (!resolved.enabled || resolved.watchdogIntervalMinutes <= 0) return;
				const agents = ctx.get("agents")?.list() ?? [];
				const nowMs = Date.now();
				const iso = new Date(nowMs).toISOString();
				const followupRoot = resolveSessionFollowupRoot();
				for (const agent of agents) {
					let followup;
					try {
						followup = await readSessionFollowup(followupRoot, String(agent.id));
					} catch {
						continue;
					}
					const expired = expireFollowupIfNeeded(followup, nowMs, iso);
					if (expired.expired) {
						try {
							await writeSessionFollowup(followupRoot, String(agent.id), expired.state);
						} catch {}
						continue;
					}
					if (!expired.state.enabled || !isFollowupBudgetActive(expired.state, nowMs)) continue;
					const agentKey = String(agent.id);
					const polled = recordFollowupPoll(expired.state, iso);
					try {
						await writeSessionFollowup(followupRoot, agentKey, polled);
					} catch {}
					if (!shouldWakeFollowup(polled, agent.status, nowMs)) continue;
					if (nowMs - (lastWakeAt.get(agentKey) ?? 0) < intervalMs / 2) continue;
					lastWakeAt.set(agentKey, nowMs);
					const woken = recordFollowupWake(polled, iso);
					try {
						await writeSessionFollowup(followupRoot, agentKey, woken);
					} catch {}
					wakeIdleFollowup(agent, woken.prompt);
				}
			})();
		};
		const timer = setInterval(tick, intervalMs);
		ctx.effect(() => () => {
			clearInterval(timer);
			lastWakeAt.clear();
		}, "agent-kernel: idle timer");
	}
}
//#endregion
export { apply, inject, name };
