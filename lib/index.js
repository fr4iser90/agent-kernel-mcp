import { boundContextSummary, createUserMessage } from "@deepseek-ai/dsh-llm";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path, { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import WebSocket from "ws";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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
* Mark that this Session just received an idle followup.
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
* Global agent-kernel connection for DSH Header, MCP stdio, and standalone runner.
* Prefer `$AGENT_KERNEL_HOME/connect.json`, then `$DSH_HOME/agent-kernel/connect.json`,
* then `~/.dsh/agent-kernel/connect.json`, then `~/.agent-kernel/connect.json`.
*/
function candidatePaths() {
	const out = [];
	const ak = process.env.AGENT_KERNEL_HOME?.trim();
	if (ak) out.push(path.join(ak, "connect.json"));
	const dsh = process.env.DSH_HOME?.trim();
	if (dsh) out.push(path.join(dsh, "agent-kernel", "connect.json"));
	out.push(path.join(os.homedir(), ".dsh", "agent-kernel", "connect.json"));
	out.push(path.join(os.homedir(), ".agent-kernel", "connect.json"));
	return [...new Set(out)];
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
	let lastErr;
	for (const file of candidatePaths()) try {
		const parsed = parseAgentKernelConnect(await readFile(file, "utf8"));
		if (parsed.url || parsed.token) return parsed;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
		lastErr = error;
	}
	if (lastErr) throw lastErr;
	return emptyAgentKernelConnect();
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
	const body = `${JSON.stringify(state, null, 2)}\n`;
	const written = /* @__PURE__ */ new Set();
	for (const file of candidatePaths()) {
		if (written.has(file)) continue;
		written.add(file);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, body, "utf8");
	}
	return state;
}
//#endregion
//#region lib/types/host/local-rpc.js
/**
* Local DSH Host HTTP RPC (loopback). Used by the outbound job worker so the
* kernel never dials this machine — we execute session.* against ourselves.
*/
function resolveLocalHost() {
	const endpoint = (process.env.DSH_HOST_URL?.trim() || process.env.AGENT_KERNEL_DSH_LOCAL_URL?.trim() || "http://127.0.0.1:3080").replace(/\/$/, "");
	let trustedHost = process.env.TRUSTED_HOST?.trim() || "";
	if (!trustedHost) try {
		trustedHost = new URL(endpoint).host;
	} catch {
		trustedHost = "127.0.0.1:3080";
	}
	return {
		endpoint,
		trustedHost
	};
}
async function localRpc(method, payload) {
	const cfg = resolveLocalHost();
	const body = JSON.stringify({
		type: "client-request",
		rpcId: randomUUID(),
		method,
		payload
	});
	const res = await fetch(`${cfg.endpoint}/api/${method}`, {
		method: "POST",
		headers: {
			Host: cfg.trustedHost,
			Accept: "application/json",
			"Content-Type": "application/json"
		},
		body
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`local DSH RPC HTTP ${String(res.status)} ${method}: ${text}`);
	const json = JSON.parse(text);
	if (!json.result || json.result.ok !== true) throw new Error(`local DSH RPC failed ${method}: ${JSON.stringify(json.result)}`);
	return json.result.value;
}
async function localCreateSession(cwd, agentPreset = "standard") {
	const value = await localRpc("session.create", {
		cwd,
		agentPreset
	});
	const sessionId = value.sessionId ?? value.id;
	if (!sessionId) throw new Error(`session.create missing sessionId: ${JSON.stringify(value)}`);
	return sessionId;
}
async function localPrompt(sessionId, text) {
	await localRpc("session.prompt", {
		sessionId,
		mode: "queue",
		content: [{
			type: "text",
			text
		}]
	});
}
async function localListSessions() {
	return localRpc("session.list", {});
}
async function localHistoryAll(sessionId, maxPages = 20) {
	const collected = [];
	let beforeSeq;
	let pages = 0;
	for (let i = 0; i < maxPages; i++) {
		const page = await localRpc("session.history", {
			sessionId,
			maxMessages: 100,
			...beforeSeq !== void 0 ? { beforeSeq } : {}
		});
		pages += 1;
		collected.push(...page.events);
		if (!page.hasMore || page.events.length === 0) break;
		const oldest = page.events.reduce((min, e) => Math.min(min, e.event.seq), Number.POSITIVE_INFINITY);
		if (!Number.isFinite(oldest)) break;
		beforeSeq = oldest;
	}
	collected.sort((a, b) => a.event.seq - b.event.seq);
	return {
		events: collected,
		pages
	};
}
//#endregion
//#region lib/types/host/detect-workdirs.js
/**
* Device-side workdir discovery for catalog "Detect".
* Sources: DSH session cwds, CLI session cwds, job payload roots / AGENT_KERNEL_DETECT_ROOTS (git children).
*/
function basenameOf(p) {
	const parts = p.split(/[/\\]/).filter(Boolean);
	return parts[parts.length - 1] || p;
}
function pushUnique(out, seen, candidate) {
	const key = candidate.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	if (!key || seen.has(key)) return;
	seen.add(key);
	out.push(candidate);
}
async function readOriginRemote(workdir) {
	try {
		return (await readFile(path.join(workdir, ".git", "config"), "utf8")).match(/\[remote\s+"origin"\][^\[]*?url\s*=\s*(\S+)/s)?.[1]?.trim() || null;
	} catch {
		return null;
	}
}
async function enrich(candidate) {
	return {
		...candidate,
		gitRemote: await readOriginRemote(candidate.path)
	};
}
async function fromDshSessions() {
	const listed = await localListSessions();
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of listed.items) {
		const cwd = typeof item.cwd === "string" ? item.cwd.trim() : "";
		if (!cwd) continue;
		const titleRaw = item.projections?.values?.["title"];
		pushUnique(out, seen, await enrich({
			path: cwd,
			name: (typeof titleRaw === "string" ? titleRaw.trim() : "") || basenameOf(cwd),
			source: "dsh-session"
		}));
	}
	return out;
}
async function fromCliSessions() {
	const roots = [
		process.env.DSH_HOME?.trim() ? path.join(process.env.DSH_HOME.trim(), "agent-kernel", "cli-sessions") : "",
		process.env.AGENT_KERNEL_HOME?.trim() ? path.join(process.env.AGENT_KERNEL_HOME.trim(), "cli-sessions") : "",
		path.join(os.homedir(), ".agent-kernel", "cli-sessions"),
		path.join(os.homedir(), ".dsh", "agent-kernel", "cli-sessions")
	].filter(Boolean);
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const root of roots) {
		let names;
		try {
			names = await readdir(root);
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			try {
				const parsed = JSON.parse(await readFile(path.join(root, name), "utf8"));
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
				const rec = parsed;
				const cwd = typeof rec.cwd === "string" ? rec.cwd.trim() : "";
				if (!cwd) continue;
				const executorId = typeof rec.executorId === "string" ? rec.executorId : "cli";
				pushUnique(out, seen, await enrich({
					path: cwd,
					name: basenameOf(cwd),
					source: `cli:${executorId}`
				}));
			} catch {
				continue;
			}
		}
	}
	return out;
}
function rootsFromPayloadAndEnv(payloadRoots) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const push = (raw) => {
		const t = raw.trim();
		if (!t || seen.has(t)) return;
		seen.add(t);
		out.push(t);
	};
	if (payloadRoots) {
		for (const r of payloadRoots) if (typeof r === "string") push(r);
	}
	const envRaw = process.env.AGENT_KERNEL_DETECT_ROOTS?.trim();
	if (envRaw) for (const part of envRaw.split(/[:;]/)) push(part);
	return out;
}
async function fromDetectRoots(roots) {
	if (roots.length === 0) return [];
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const root of roots) {
		let entries;
		try {
			entries = await readdir(root);
		} catch (error) {
			throw new Error(`detect root unreadable: ${root} (${error instanceof Error ? error.message : String(error)})`);
		}
		for (const name of entries) {
			if (name.startsWith(".")) continue;
			const full = path.join(root, name);
			try {
				if (!(await stat(full)).isDirectory()) continue;
				await stat(path.join(full, ".git"));
			} catch {
				continue;
			}
			pushUnique(out, seen, await enrich({
				path: full,
				name,
				source: "detect-roots"
			}));
		}
	}
	return out;
}
async function listWorkdirCandidates(opts) {
	const seen = /* @__PURE__ */ new Set();
	const candidates = [];
	const errors = [];
	const roots = rootsFromPayloadAndEnv(opts?.roots);
	try {
		for (const c of await fromDshSessions()) pushUnique(candidates, seen, c);
	} catch (error) {
		errors.push(`dsh-sessions: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		for (const c of await fromCliSessions()) pushUnique(candidates, seen, c);
	} catch (error) {
		errors.push(`cli-sessions: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		for (const c of await fromDetectRoots(roots)) pushUnique(candidates, seen, c);
	} catch (error) {
		throw error;
	}
	if (candidates.length === 0) {
		const hint = roots.length ? `No git children under detect roots (${roots.join(", ")}) and no session cwds.` : "Open a DSH/Claude/Aider/OpenCode session on a repo, or set detectRoots in Setup / AGENT_KERNEL_DETECT_ROOTS";
		const detail = errors.length ? ` Attempts: ${errors.join("; ")}` : "";
		throw new Error(`No workdir candidates.${detail} ${hint}`);
	}
	candidates.sort((a, b) => a.name.localeCompare(b.name));
	return { candidates };
}
//#endregion
//#region lib/types/host/cli-sessions.js
/**
* Durable session records for CLI executors (claude-code / aider / opencode).
* DSH sessions stay in the Host; these only exist for non-DSH job routing.
*/
function homeRoot() {
	const dsh = process.env.DSH_HOME?.trim();
	if (dsh) return path.join(dsh, "agent-kernel", "cli-sessions");
	const ak = process.env.AGENT_KERNEL_HOME?.trim();
	if (ak) return path.join(ak, "cli-sessions");
	return path.join(os.homedir(), ".agent-kernel", "cli-sessions");
}
function sessionPath(id) {
	if (!/^[A-Za-z0-9._-]{1,200}$/u.test(id)) throw new Error("cli session id is not a safe filename");
	return path.join(homeRoot(), `${id}.json`);
}
async function writeCliSession(session) {
	await mkdir(homeRoot(), { recursive: true });
	await writeFile(sessionPath(session.id), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}
async function readCliSession(id) {
	const raw = await readFile(sessionPath(id), "utf8");
	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`corrupt cli session: ${id}`);
	const rec = parsed;
	const executorId = rec.executorId;
	if (executorId !== "claude-code" && executorId !== "aider" && executorId !== "opencode") throw new Error(`cli session ${id} has unsupported executorId`);
	return {
		id: String(rec.id ?? id),
		executorId,
		cwd: String(rec.cwd ?? ""),
		createdAt: String(rec.createdAt ?? ""),
		updatedAt: String(rec.updatedAt ?? ""),
		externalSessionId: typeof rec.externalSessionId === "string" ? rec.externalSessionId : null,
		messages: Array.isArray(rec.messages) ? rec.messages : []
	};
}
function appendCliMessage(session, role, text) {
	const at = (/* @__PURE__ */ new Date()).toISOString();
	return {
		...session,
		updatedAt: at,
		messages: [...session.messages, {
			role,
			text,
			at
		}]
	};
}
//#endregion
//#region lib/types/host/cli-runners.js
/**
* Spawn Claude Code / Aider / OpenCode for kernel start/session_continue jobs.
* Fail loudly when the binary is missing — no silent fallback to DSH.
*/
const CLI_TIMEOUT_MS = 30 * 6e4;
function isCliExecutorId(id) {
	return id === "claude-code" || id === "aider" || id === "opencode";
}
function binFor(executorId) {
	if (executorId === "claude-code") return process.env.AGENT_KERNEL_CLAUDE_BIN?.trim() || "claude";
	if (executorId === "aider") return process.env.AGENT_KERNEL_AIDER_BIN?.trim() || "aider";
	return process.env.AGENT_KERNEL_OPENCODE_BIN?.trim() || "opencode";
}
function runCommand(command, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: process.env,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(/* @__PURE__ */ new Error(`${command} timed out after ${CLI_TIMEOUT_MS}ms`));
		}, CLI_TIMEOUT_MS);
		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			if (err.code === "ENOENT") {
				reject(/* @__PURE__ */ new Error(`${command} not found on PATH — install the CLI or set AGENT_KERNEL_${command.toUpperCase()}_BIN`));
				return;
			}
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				code: code ?? 1,
				stdout,
				stderr
			});
		});
	});
}
function composePrompt(objective, rolePromptText) {
	return `${objective}${rolePromptText && rolePromptText.trim() ? `\n\n---\n# Role / Lawpack (injected)\n\n${rolePromptText.trim()}\n---\n` : ""}`;
}
function parseClaudeJson(stdout) {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{")) return {
		text: trimmed,
		sessionId: null
	};
	try {
		const parsed = JSON.parse(trimmed);
		return {
			text: typeof parsed.result === "string" && parsed.result || typeof parsed.content === "string" && parsed.content || trimmed,
			sessionId: typeof parsed.session_id === "string" && parsed.session_id || typeof parsed.sessionId === "string" && parsed.sessionId || null
		};
	} catch {
		return {
			text: trimmed,
			sessionId: null
		};
	}
}
async function invokeClaude(cwd, prompt, externalSessionId) {
	const bin = binFor("claude-code");
	const args = [
		"--print",
		"--output-format",
		"json",
		"--dangerously-skip-permissions"
	];
	if (externalSessionId) args.push("--resume", externalSessionId);
	args.push(prompt);
	const { code, stdout, stderr } = await runCommand(bin, args, cwd);
	if (code !== 0) throw new Error(`claude exited ${code}: ${stderr.trim() || stdout.trim() || "no output"}`);
	const parsed = parseClaudeJson(stdout);
	if (!parsed.text.trim()) throw new Error("claude produced empty output");
	return {
		text: parsed.text.trim(),
		externalSessionId: parsed.sessionId ?? externalSessionId
	};
}
async function invokeAider(cwd, prompt) {
	const { code, stdout, stderr } = await runCommand(binFor("aider"), [
		"--message",
		prompt,
		"--yes-always",
		"--no-stream",
		"--no-pretty",
		"--no-show-release-notes"
	], cwd);
	if (code !== 0) throw new Error(`aider exited ${code}: ${stderr.trim() || stdout.trim() || "no output"}`);
	const text = stdout.trim() || stderr.trim();
	if (!text) throw new Error("aider produced empty output");
	return text;
}
async function invokeOpenCode(cwd, prompt, externalSessionId) {
	const bin = binFor("opencode");
	const args = ["run", "--auto"];
	if (externalSessionId) args.push("--session", externalSessionId);
	args.push(prompt);
	const { code, stdout, stderr } = await runCommand(bin, args, cwd);
	if (code !== 0) throw new Error(`opencode exited ${code}: ${stderr.trim() || stdout.trim() || "no output"}`);
	const text = stdout.trim();
	if (!text) throw new Error("opencode produced empty output");
	return {
		text,
		externalSessionId
	};
}
async function invoke(executorId, cwd, prompt, externalSessionId) {
	if (executorId === "claude-code") return invokeClaude(cwd, prompt, externalSessionId);
	if (executorId === "aider") return {
		text: await invokeAider(cwd, prompt),
		externalSessionId: null
	};
	return invokeOpenCode(cwd, prompt, externalSessionId);
}
async function cliStart(opts) {
	const prompt = composePrompt(opts.objective, opts.rolePromptText);
	const id = randomUUID();
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const out = await invoke(opts.executorId, opts.cwd, prompt, null);
	let session = {
		id,
		executorId: opts.executorId,
		cwd: opts.cwd,
		createdAt: now,
		updatedAt: now,
		externalSessionId: out.externalSessionId,
		messages: []
	};
	session = appendCliMessage(session, "user", prompt);
	session = appendCliMessage(session, "assistant", out.text);
	await writeCliSession(session);
	return { executorSessionId: id };
}
async function cliContinueSession(opts) {
	const session = await readCliSession(opts.executorSessionId);
	if (!session.cwd) throw new Error(`cli session ${session.id} missing cwd`);
	const out = await invoke(session.executorId, session.cwd, opts.prompt, session.externalSessionId);
	let next = appendCliMessage(session, "user", opts.prompt);
	next = appendCliMessage(next, "assistant", out.text);
	next = {
		...next,
		externalSessionId: out.externalSessionId ?? next.externalSessionId
	};
	await writeCliSession(next);
	return { executorSessionId: session.id };
}
async function cliFetchTranscript(executorSessionId) {
	const session = await readCliSession(executorSessionId);
	const messages = session.messages.map((m, i) => ({
		seq: i + 1,
		time: Date.parse(m.at) || 0,
		role: m.role,
		type: m.role === "user" ? "user/message" : "assistant/message",
		text: m.text
	}));
	return { transcript: {
		session: {
			sessionId: session.id,
			running: false,
			blank: messages.length === 0,
			cwd: session.cwd,
			title: `${session.executorId}:${session.id.slice(0, 8)}`,
			updatedAt: session.updatedAt,
			agentPreset: null,
			externalSessionId: session.externalSessionId
		},
		messages,
		fileOps: [],
		rawEvents: [],
		meta: {
			executorId: session.executorId,
			messageCount: messages.length
		}
	} };
}
//#endregion
//#region lib/types/host/jobs.js
/**
* Outbound control channel: execute kernel jobs on local DSH Host RPC
* or CLI executors (claude-code / aider / opencode).
* Transport is WSS (see ws-client.ts) — not HTTP claim polling.
*/
function isRecord(v) {
	return typeof v === "object" && v !== null;
}
function executorIdFromPayload(payload) {
	const brief = isRecord(payload.brief) ? payload.brief : null;
	if (brief && typeof brief.executorId === "string" && brief.executorId.trim()) return brief.executorId.trim();
	if (typeof payload.executorId === "string" && payload.executorId.trim()) return payload.executorId.trim();
	return "dsh";
}
function textFromBlocks(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n").trim();
}
function mapHistory(events) {
	const messages = [];
	const fileOps = [];
	for (const entry of events) {
		const { event, view } = entry;
		const t = event.type;
		if (t === "user/message" || t === "assistant/message") {
			const data = isRecord(event.data) ? event.data : {};
			const text = textFromBlocks((isRecord(data.message) ? data.message : data).content);
			if (text) messages.push({
				seq: event.seq,
				time: event.time,
				role: t.startsWith("user") ? "user" : "assistant",
				type: t,
				text,
				toolView: view
			});
		} else messages.push({
			seq: event.seq,
			time: event.time,
			role: "event",
			type: t,
			text: t,
			toolView: view
		});
	}
	return {
		messages,
		fileOps
	};
}
async function runStartDsh(payload) {
	const brief = isRecord(payload.brief) ? payload.brief : null;
	if (!brief) throw new Error("start job missing brief");
	const cwd = String(brief.executorCwd ?? brief.workdir ?? "").trim();
	if (!cwd) throw new Error("start job brief missing workdir/executorCwd");
	const sessionId = await localCreateSession(cwd);
	const roleBlock = typeof brief.rolePromptText === "string" && brief.rolePromptText.trim() ? `\n\n---\n# Role / Lawpack (injected)\n\n${brief.rolePromptText}\n---\n` : "";
	await localPrompt(sessionId, `${typeof payload.prompt === "string" && payload.prompt.trim() || typeof brief.initialObjective === "string" && brief.initialObjective.trim() || `Obey Lawpack / AGENTS.md. RUN_ID=${String(brief.runId ?? "")}. Continue autonomous work.`}${roleBlock}`);
	return { executorSessionId: sessionId };
}
async function runStartCli(executorId, payload) {
	const brief = isRecord(payload.brief) ? payload.brief : null;
	if (!brief) throw new Error("start job missing brief");
	const cwd = String(brief.executorCwd ?? brief.workdir ?? "").trim();
	if (!cwd) throw new Error("start job brief missing workdir/executorCwd");
	return cliStart({
		executorId,
		cwd,
		objective: typeof payload.prompt === "string" && payload.prompt.trim() || typeof brief.initialObjective === "string" && brief.initialObjective.trim() || `Obey Lawpack / AGENTS.md. RUN_ID=${String(brief.runId ?? "")}. Continue autonomous work.`,
		rolePromptText: typeof brief.rolePromptText === "string" ? brief.rolePromptText : null
	});
}
async function runStart(payload) {
	const executorId = executorIdFromPayload(payload);
	if (isCliExecutorId(executorId)) return runStartCli(executorId, payload);
	if (executorId !== "dsh") throw new Error(`executorId=${executorId} is not implemented on this device — use dsh, claude-code, aider, or opencode`);
	return runStartDsh(payload);
}
async function runSessionContinueDsh(payload) {
	const sessionId = String(payload.executorSessionId ?? "").trim();
	if (!sessionId) throw new Error("session_continue job missing executorSessionId");
	const brief = isRecord(payload.brief) ? payload.brief : {};
	await localPrompt(sessionId, typeof payload.prompt === "string" && payload.prompt.trim() || `Continue. RUN_ID=${String(brief.runId ?? "")}. Obey pinned Lawpack / AGENTS.md.`);
	return { executorSessionId: sessionId };
}
async function runSessionContinue(payload) {
	const sessionId = String(payload.executorSessionId ?? "").trim();
	if (!sessionId) throw new Error("session_continue job missing executorSessionId");
	const executorId = executorIdFromPayload(payload);
	const brief = isRecord(payload.brief) ? payload.brief : {};
	const text = typeof payload.prompt === "string" && payload.prompt.trim() || `Continue. RUN_ID=${String(brief.runId ?? "")}. Obey pinned Lawpack / AGENTS.md.`;
	if (isCliExecutorId(executorId)) return cliContinueSession({
		executorSessionId: sessionId,
		prompt: text
	});
	try {
		await readCliSession(sessionId);
		return cliContinueSession({
			executorSessionId: sessionId,
			prompt: text
		});
	} catch (error) {
		if (error.code !== "ENOENT" && !String(error).includes("ENOENT")) {
			if (String(error).includes("cli session") || String(error).includes("unsupported executorId")) throw error;
		}
	}
	return runSessionContinueDsh(payload);
}
async function runFetchTranscript(payload) {
	const sessionId = String(payload.executorSessionId ?? "").trim();
	if (!sessionId) throw new Error("fetch_transcript missing executorSessionId");
	try {
		await readCliSession(sessionId);
		return await cliFetchTranscript(sessionId);
	} catch (error) {
		if (!(error.code === "ENOENT" || String(error).includes("ENOENT"))) throw error;
	}
	const [{ events, pages }, listed] = await Promise.all([localHistoryAll(sessionId), localListSessions()]);
	const summary = listed.items.find((i) => i.sessionId === sessionId);
	if (!summary) throw new Error(`executor session not found (cli or DSH): ${sessionId}`);
	const { messages, fileOps } = mapHistory(events);
	return { transcript: {
		session: {
			sessionId: summary.sessionId,
			running: summary.running,
			blank: summary.blank,
			cwd: summary.cwd ?? null,
			title: typeof summary.projections?.values?.title === "string" ? summary.projections.values.title : null,
			updatedAt: summary.updatedAt,
			agentPreset: summary.agentPreset ?? null
		},
		messages,
		fileOps,
		rawEvents: events,
		meta: {
			historyPages: pages,
			eventCount: events.length
		}
	} };
}
async function requireAgentPreset(presetId) {
	if (!(await localRpc("agentPreset.list", {})).presets.some((p) => p.id === presetId)) throw new Error(`DSH agent preset "${presetId}" not found — create it with tool deny (shell/edit) and only agent-kernel MCP tools`);
}
async function waitSessionIdle(sessionId, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const summary = (await localListSessions()).items.find((i) => i.sessionId === sessionId);
		if (!summary) throw new Error(`operator session disappeared: ${sessionId}`);
		if (!summary.running) return;
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`operator session still running after ${timeoutMs}ms`);
}
function lastAssistantText(events) {
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i].event;
		if (ev.type !== "assistant/message") continue;
		const data = isRecord(ev.data) ? ev.data : {};
		const text = textFromBlocks((isRecord(data.message) ? data.message : data).content);
		if (text) return text;
	}
	return "";
}
async function runOperatorTurn(payload) {
	const message = typeof payload.message === "string" ? payload.message.trim() : "";
	if (!message) throw new Error("operator_turn missing message");
	const agentPreset = typeof payload.agentPreset === "string" && payload.agentPreset.trim() ? payload.agentPreset.trim() : "operator";
	const systemPrompt = typeof payload.systemPrompt === "string" && payload.systemPrompt.trim() ? payload.systemPrompt.trim() : "You are the agent-kernel operator. Use only agent-kernel MCP tools.";
	await requireAgentPreset(agentPreset);
	const cwd = join(tmpdir(), "agent-kernel-operator");
	mkdirSync(cwd, { recursive: true });
	const sessionId = await localCreateSession(cwd, agentPreset);
	await localPrompt(sessionId, `${systemPrompt}\n\n---\nOperator request:\n\n${message}`);
	await waitSessionIdle(sessionId, 17e4);
	const { events } = await localHistoryAll(sessionId);
	const reply = lastAssistantText(events);
	if (!reply) throw new Error("operator_turn finished with no assistant reply");
	return {
		reply,
		executorSessionId: sessionId,
		toolResults: []
	};
}
/** Run one kernel job via local Host RPC or CLI adapter. */
async function executeKernelJob(job) {
	if (job.kind === "start") return runStart(job.payload);
	if (job.kind === "session_continue") return runSessionContinue(job.payload);
	if (job.kind === "fetch_transcript") return runFetchTranscript(job.payload);
	if (job.kind === "operator_turn") return runOperatorTurn(job.payload);
	if (job.kind === "list_workdir_candidates") {
		const rootsRaw = job.payload.roots;
		if (Array.isArray(rootsRaw)) return listWorkdirCandidates({ roots: rootsRaw.filter((r) => typeof r === "string") });
		return listWorkdirCandidates();
	}
	throw new Error(`unknown job kind: ${String(job.kind)}`);
}
//#endregion
//#region lib/types/host/ws-protocol.js
/**
* Wire protocol copy for DSH ↔ kernel control channel (WSS).
* Keep in sync with agent-kernel `domain/executor/ws-protocol.ts`.
*/
/** Derive `wss://…/api/executor/ws?token=` from HTTPS kernel URL + pair token. */
function executorWsUrl(kernelBaseUrl, token) {
	const base = kernelBaseUrl.trim();
	if (!base) throw new Error("AGENT_KERNEL_URL / connect.json url is required for WSS");
	if (!token.trim()) throw new Error("AGENT_KERNEL_TOKEN / connect.json token is required for WSS");
	const u = new URL(base);
	if (u.protocol === "https:") u.protocol = "wss:";
	else if (u.protocol === "http:") u.protocol = "ws:";
	else throw new Error(`unsupported kernel URL protocol: ${u.protocol}`);
	u.pathname = "/api/executor/ws";
	u.search = "";
	u.hash = "";
	u.searchParams.set("token", token.trim());
	return u.toString();
}
//#endregion
//#region lib/types/host/ws-client.js
/**
* Outbound WSS control channel to agent-kernel.
* Pairing writes connect.json; this opens wss://…/api/executor/ws?token=…
*/
let status = {
	connected: false,
	lastError: null,
	lastHelloAt: null
};
function getExecutorWsStatus() {
	return { ...status };
}
/** Force reconnect (e.g. after pair writes a new token). */
let forceReconnect = null;
function reconnectExecutorWs() {
	forceReconnect?.();
}
function sendJson(ws, msg) {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
async function handleJob(ws, job) {
	sendJson(ws, {
		type: "job.started",
		jobId: job.jobId
	});
	try {
		const result = await executeKernelJob({
			id: job.jobId,
			runId: job.runId,
			kind: job.kind,
			payload: job.payload,
			createdAt: job.createdAt
		});
		sendJson(ws, {
			type: "job.completed",
			jobId: job.jobId,
			ok: true,
			result
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		sendJson(ws, {
			type: "job.completed",
			jobId: job.jobId,
			ok: false,
			error: message
		});
	}
}
/**
* Maintain a single reconnecting WSS to the paired kernel.
* Returns a dispose function.
*/
function startExecutorWsClient(opts) {
	const deviceLabel = opts?.deviceLabel ?? "dsh-host";
	let stopped = false;
	let ws = null;
	let heartbeatTimer;
	let reconnectTimer;
	let backoffMs = 1e3;
	const inFlight = /* @__PURE__ */ new Set();
	const clearTimers = () => {
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		heartbeatTimer = void 0;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = void 0;
	};
	const scheduleReconnect = () => {
		if (stopped) return;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		const wait = backoffMs;
		backoffMs = Math.min(backoffMs * 2, 3e4);
		reconnectTimer = setTimeout(() => {
			connect();
		}, wait);
	};
	const connect = async () => {
		if (stopped) return;
		if (opts?.enabled && !opts.enabled()) {
			status = {
				connected: false,
				lastError: null,
				lastHelloAt: status.lastHelloAt
			};
			scheduleReconnect();
			return;
		}
		let connectFile;
		try {
			connectFile = await readAgentKernelConnect();
		} catch (error) {
			status = {
				connected: false,
				lastError: error instanceof Error ? error.message : String(error),
				lastHelloAt: null
			};
			scheduleReconnect();
			return;
		}
		if (!connectFile.url || !connectFile.token) {
			status = {
				connected: false,
				lastError: "not paired (missing connect.json)",
				lastHelloAt: null
			};
			scheduleReconnect();
			return;
		}
		let url;
		try {
			url = executorWsUrl(connectFile.url, connectFile.token);
		} catch (error) {
			status = {
				connected: false,
				lastError: error instanceof Error ? error.message : String(error),
				lastHelloAt: null
			};
			scheduleReconnect();
			return;
		}
		try {
			ws?.close();
		} catch {}
		const socket = new WebSocket(url);
		ws = socket;
		socket.on("open", () => {
			backoffMs = 1e3;
			status = {
				connected: true,
				lastError: null,
				lastHelloAt: status.lastHelloAt
			};
			sendJson(socket, {
				type: "hello",
				deviceLabel
			});
			clearTimers();
			heartbeatTimer = setInterval(() => {
				sendJson(socket, {
					type: "heartbeat",
					deviceLabel
				});
			}, 25e3);
		});
		socket.on("message", (data) => {
			let msg;
			try {
				msg = JSON.parse(String(data));
			} catch {
				return;
			}
			if (msg.type === "hello") {
				status = {
					connected: true,
					lastError: null,
					lastHelloAt: (/* @__PURE__ */ new Date()).toISOString()
				};
				return;
			}
			if (msg.type === "error") {
				status = {
					connected: status.connected,
					lastError: String(msg.message ?? "server error"),
					lastHelloAt: status.lastHelloAt
				};
				return;
			}
			if (msg.type === "job.created") {
				const job = msg;
				if (!job.jobId || inFlight.has(job.jobId)) return;
				inFlight.add(job.jobId);
				handleJob(socket, job).finally(() => {
					inFlight.delete(job.jobId);
				});
			}
		});
		socket.on("close", () => {
			status = {
				connected: false,
				lastError: status.lastError,
				lastHelloAt: status.lastHelloAt
			};
			clearTimers();
			if (!stopped) scheduleReconnect();
		});
		socket.on("error", (err) => {
			status = {
				connected: false,
				lastError: err instanceof Error ? err.message : "WebSocket error",
				lastHelloAt: status.lastHelloAt
			};
		});
	};
	connect();
	forceReconnect = () => {
		if (stopped) return;
		backoffMs = 1e3;
		try {
			ws?.close();
		} catch {}
	};
	return () => {
		stopped = true;
		forceReconnect = null;
		clearTimers();
		try {
			ws?.close();
		} catch {}
		ws = null;
		status = {
			connected: false,
			lastError: null,
			lastHelloAt: status.lastHelloAt
		};
	};
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
	const wss = getExecutorWsStatus();
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
		kernelConnected: connect.token.length > 0 && connect.url.length > 0 && wss.connected,
		wssConnected: wss.connected,
		wssLastError: wss.lastError
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
		reconnectExecutorWs();
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
	reconnectExecutorWs();
	const wss = getExecutorWsStatus();
	writeJson(res, 200, {
		ok: true,
		kernelUrl: connect.url,
		kernelConnected: connect.url.length > 0 && connect.token.length > 0,
		wssConnected: wss.connected,
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
	{
		const stop = startExecutorWsClient({
			deviceLabel: "dsh-host",
			enabled: () => current().enabled
		});
		ctx.effect(() => () => {
			stop();
		}, "agent-kernel: executor wss");
	}
}
//#endregion
export { apply, inject, name };
