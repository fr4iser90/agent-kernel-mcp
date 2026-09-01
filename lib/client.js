window.__ModuleLoader__.load({
	id: "agent-kernel-mcp",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#endregion
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/types/host/idle-followup.js
		/**
		* Per-Session idle followup: opt-in flag, followup prompt, and optional hour budget
		* under `$DSH_HOME`. Independent of autonomy `state.json` so Header can arm
		* without `/autonomy start`.
		* @module agent-kernel-mcp/idle-followup
		*/
		/** Default followup text when the operator leaves the prompt empty. */
		const DEFAULT_FOLLOWUP_PROMPT = "Continue";
		/**
		* Ms until the next Host idle-check opportunity for this Session.
		* Cycles on the full poll interval from `lastPolledAt` (else `armedAt`) so the
		* Header never sticks at overdue after the first window elapses. After a wake,
		* the in-memory anti-spam half-interval still applies before another followup.
		* @param state - durable followup.
		* @param intervalMinutes - Host poll interval (`watchdogIntervalMinutes`).
		* @param nowMs - evaluation clock.
		* @returns remaining ms in `(0, intervalMs]`, or `null` when not armed / interval off.
		*/
		function followupNextCheckRemainingMs(state, intervalMinutes, nowMs) {
			if (!state.enabled || !Number.isSafeInteger(intervalMinutes) || intervalMinutes <= 0) return null;
			const baseIso = state.lastPolledAt.length > 0 ? state.lastPolledAt : state.armedAt;
			if (baseIso.length === 0) return null;
			const base = Date.parse(baseIso);
			if (!Number.isFinite(base)) return null;
			const intervalMs = intervalMinutes * 6e4;
			const mod = Math.max(0, nowMs - base) % intervalMs;
			if (mod === 0) return intervalMs;
			return intervalMs - mod;
		}
		//#endregion
		//#region lib/types/client/controller.js
		/** Browser state for Agent Kernel Session Header. */
		const INITIAL$1 = { bySession: {} };
		const EMPTY = {
			watchdogEnabled: false,
			followupPrompt: DEFAULT_FOLLOWUP_PROMPT,
			followupActiveHours: 0,
			followupArmedAt: "",
			followupLastPolledAt: "",
			followupLastWakeAt: "",
			watchdogIntervalMinutes: 5,
			pluginEnabled: true,
			kernelUrl: "",
			kernelToken: "",
			kernelConnected: false,
			wssConnected: false,
			wssLastError: null,
			error: null,
			busy: false,
			settingsOpen: false
		};
		function hostBase$1() {
			const origin = globalThis.location?.origin;
			return origin !== void 0 && origin !== "null" ? origin : "http://dsh.internal";
		}
		function messageOf$1(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function parseEntry(body, settingsOpen) {
			return {
				watchdogEnabled: body.watchdogEnabled === true,
				followupPrompt: typeof body.followupPrompt === "string" && body.followupPrompt.trim().length > 0 ? body.followupPrompt : DEFAULT_FOLLOWUP_PROMPT,
				followupActiveHours: typeof body.followupActiveHours === "number" && Number.isSafeInteger(body.followupActiveHours) ? Math.max(0, body.followupActiveHours) : 0,
				followupArmedAt: typeof body.followupArmedAt === "string" ? body.followupArmedAt : "",
				followupLastPolledAt: typeof body.followupLastPolledAt === "string" ? body.followupLastPolledAt : "",
				followupLastWakeAt: typeof body.followupLastWakeAt === "string" ? body.followupLastWakeAt : "",
				watchdogIntervalMinutes: typeof body.watchdogIntervalMinutes === "number" && Number.isSafeInteger(body.watchdogIntervalMinutes) ? Math.max(0, body.watchdogIntervalMinutes) : 5,
				pluginEnabled: body.pluginEnabled !== false,
				kernelUrl: typeof body.kernelUrl === "string" ? body.kernelUrl : "",
				kernelToken: typeof body.kernelToken === "string" ? body.kernelToken : "",
				kernelConnected: body.kernelConnected === true,
				wssConnected: body.wssConnected === true,
				wssLastError: typeof body.wssLastError === "string" ? body.wssLastError : null,
				error: null,
				busy: false,
				settingsOpen
			};
		}
		var AgentKernelHeaderController = class {
			fetcher;
			pollMs;
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(INITIAL$1);
			polls = /* @__PURE__ */ new Map();
			disposed = false;
			constructor(fetcher = (input, init) => fetch(input, init), pollMs = 5e3) {
				this.fetcher = fetcher;
				this.pollMs = pollMs;
			}
			watch(sessionId) {
				if (this.disposed) return;
				if (this.polls.has(sessionId)) return;
				this.refresh(sessionId);
				this.polls.set(sessionId, setInterval(() => {
					this.refresh(sessionId);
				}, this.pollMs));
			}
			unwatch(sessionId) {
				const timer = this.polls.get(sessionId);
				if (timer === void 0) return;
				clearInterval(timer);
				this.polls.delete(sessionId);
			}
			setSettingsOpen(sessionId, open) {
				if (this.disposed) return;
				const prev = this.store.getSnapshot().bySession[String(sessionId)] ?? EMPTY;
				this.publish(sessionId, {
					...prev,
					settingsOpen: open
				});
			}
			async refresh(sessionId) {
				if (this.disposed) return;
				const prev = this.store.getSnapshot().bySession[String(sessionId)] ?? EMPTY;
				try {
					const url = new URL("/api/agent-kernel.status", hostBase$1());
					url.searchParams.set("sessionId", sessionId);
					const response = await this.fetcher(url, { method: "GET" });
					if (!response.ok) {
						const detail = await response.text().catch(() => "");
						throw new Error(`Status failed: HTTP ${String(response.status)}${detail === "" ? "" : ` ${detail}`}`);
					}
					const body = await response.json();
					if (this.disposed) return;
					this.publish(sessionId, parseEntry(body, prev.settingsOpen));
				} catch (error) {
					if (this.disposed) return;
					this.publish(sessionId, {
						...prev,
						error: messageOf$1(error),
						busy: false
					});
				}
			}
			async setEnabled(sessionId, enabled) {
				await this.patch(sessionId, { enabled });
			}
			async saveSettings(sessionId, settings) {
				await this.patch(sessionId, settings);
			}
			async claimPair(sessionId, code, kernelUrl) {
				if (this.disposed) return;
				const prev = this.store.getSnapshot().bySession[String(sessionId)] ?? EMPTY;
				this.publish(sessionId, {
					...prev,
					busy: true,
					error: null
				});
				try {
					const response = await this.fetcher(new URL("/api/agent-kernel.pair", hostBase$1()), {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							code,
							kernelUrl
						})
					});
					if (!response.ok) {
						const detail = await response.text().catch(() => "");
						throw new Error(`Pair failed: HTTP ${String(response.status)}${detail === "" ? "" : ` ${detail}`}`);
					}
					if (this.disposed) return;
					await this.refresh(sessionId);
				} catch (error) {
					if (this.disposed) return;
					const current = this.store.getSnapshot().bySession[String(sessionId)] ?? prev;
					this.publish(sessionId, {
						...current,
						busy: false,
						error: messageOf$1(error)
					});
				}
			}
			async dispose() {
				this.disposed = true;
				for (const sessionId of [...this.polls.keys()]) this.unwatch(sessionId);
			}
			async patch(sessionId, patch) {
				if (this.disposed) return;
				const prev = this.store.getSnapshot().bySession[String(sessionId)] ?? EMPTY;
				this.publish(sessionId, {
					...prev,
					busy: true,
					error: null
				});
				try {
					const response = await this.fetcher(new URL("/api/agent-kernel.followup", hostBase$1()), {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							sessionId,
							...patch
						})
					});
					if (!response.ok) {
						const detail = await response.text().catch(() => "");
						throw new Error(`Save failed: HTTP ${String(response.status)}${detail === "" ? "" : ` ${detail}`}`);
					}
					const body = await response.json();
					if (this.disposed) return;
					this.publish(sessionId, parseEntry(body, prev.settingsOpen));
				} catch (error) {
					if (this.disposed) return;
					const current = this.store.getSnapshot().bySession[String(sessionId)] ?? prev;
					this.publish(sessionId, {
						...current,
						busy: false,
						error: messageOf$1(error)
					});
				}
			}
			publish(sessionId, entry) {
				this.store.update((state) => {
					state.bySession = {
						...state.bySession,
						[String(sessionId)]: entry
					};
				});
			}
		};
		//#endregion
		//#region lib/types/client/format.js
		/**
		* Format a non-negative duration as a compact elapsed label.
		* @param ms - elapsed milliseconds (clamped at 0).
		* @returns labels like `45s`, `14m`, `2h 14m`, or `3d 2h`.
		*/
		function formatAutonomyDuration(ms) {
			const totalSec = Math.max(0, Math.floor(ms / 1e3));
			const days = Math.floor(totalSec / 86400);
			const hours = Math.floor(totalSec % 86400 / 3600);
			const minutes = Math.floor(totalSec % 3600 / 60);
			const seconds = totalSec % 60;
			if (days > 0) return hours > 0 ? `${String(days)}d ${String(hours)}h` : `${String(days)}d`;
			if (hours > 0) return minutes > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(hours)}h`;
			if (minutes > 0) return `${String(minutes)}m`;
			return `${String(seconds)}s`;
		}
		/**
		* Remaining Session-followup window label for the Header capsule.
		* @param enabled - whether followup is armed.
		* @param armedAt - ISO arm start.
		* @param activeHours - `0` = forever.
		* @param nowMs - clock.
		* @param foreverLabel - copy when unlimited.
		* @returns remaining label, forever label, or empty when off.
		*/
		function formatFollowupCountdownLabel(enabled, armedAt, activeHours, nowMs, foreverLabel) {
			if (!enabled) return "";
			if (!Number.isSafeInteger(activeHours) || activeHours <= 0) return foreverLabel;
			if (armedAt.length === 0) return "";
			const started = Date.parse(armedAt);
			if (!Number.isFinite(started)) return "";
			return formatAutonomyDuration(Math.max(0, started + activeHours * 36e5 - nowMs));
		}
		/**
		* Compact "next Host idle check" label for the Header capsule.
		* @param remainingMs - ms until estimated next check, or `null` when off.
		* @param soonLabel - fallback when remaining is non-positive (should not occur for a cycling countdown).
		* @returns `↓ 3m`, soon label, or empty when not armed.
		*/
		function formatFollowupNextCheckLabel(remainingMs, soonLabel) {
			if (remainingMs === null) return "";
			if (remainingMs <= 0) return soonLabel;
			return `↓ ${formatAutonomyDuration(remainingMs)}`;
		}
		//#endregion
		//#region \0dsh-css:/home/fr4iser/Documents/Git/deepseek-harness/packages/agent-kernel/mcp/src/client/HeaderAction.module.css.mjs
		const css$1 = "._3XsgEa_capsule{border:1px solid var(--dsw-alias-border-l2);min-height:32px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);background:0 0;border-radius:18px;justify-content:center;align-items:center;gap:8px;padding:4px 12px;font-size:13px;font-weight:400;line-height:20px;display:inline-flex}._3XsgEa_label{cursor:pointer;white-space:nowrap;align-items:center;gap:6px;display:inline-flex}._3XsgEa_label:has(input:disabled){cursor:default}._3XsgEa_checkbox{accent-color:var(--dsw-alias-label-primary);margin:0}._3XsgEa_gear{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;margin:0;padding:2px;display:inline-flex}._3XsgEa_gear:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-hover,transparent)}._3XsgEa_gear:disabled{cursor:default;opacity:.5}._3XsgEa_time{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}._3XsgEa_timeSecondary{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-dimmed);font-size:12px}._3XsgEa_wssOn{white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}._3XsgEa_wssOff{white-space:nowrap;color:var(--dsw-alias-label-dimmed);opacity:.85;font-size:11px}._3XsgEa_footer{flex-wrap:wrap;justify-content:flex-end;gap:8px;display:flex}._3XsgEa_promptField{flex-direction:column;gap:8px;width:100%;margin-bottom:12px;display:flex}._3XsgEa_promptLabel{color:var(--dsw-alias-label-secondary);font-size:13px}._3XsgEa_prompt{border:1px solid var(--dsw-alias-border-l2);width:100%;min-height:100px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);resize:vertical;background:0 0;border-radius:8px;padding:8px 10px;font-size:13px;line-height:20px}._3XsgEa_durationField{border:none;flex-direction:column;gap:8px;margin:0;padding:0;display:flex}._3XsgEa_radioRow{color:var(--dsw-alias-label-primary);cursor:pointer;align-items:center;gap:8px;font-size:13px;display:inline-flex}._3XsgEa_hoursRow{align-items:center;gap:8px;margin-left:24px;display:flex}._3XsgEa_hoursInput{border:1px solid var(--dsw-alias-border-l2);width:88px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);background:0 0;border-radius:6px;padding:4px 8px;font-size:13px}._3XsgEa_error{color:var(--dsw-alias-label-danger,#c44);margin:8px 0 0;font-size:13px}";
		const tagId$1 = "agent-kernel-mcp/HeaderAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "agent-kernel-mcp";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var HeaderAction_module_css_default = {
			"capsule": "_3XsgEa_capsule",
			"checkbox": "_3XsgEa_checkbox",
			"durationField": "_3XsgEa_durationField",
			"error": "_3XsgEa_error",
			"footer": "_3XsgEa_footer",
			"gear": "_3XsgEa_gear",
			"hoursInput": "_3XsgEa_hoursInput",
			"hoursRow": "_3XsgEa_hoursRow",
			"label": "_3XsgEa_label",
			"prompt": "_3XsgEa_prompt",
			"promptField": "_3XsgEa_promptField",
			"promptLabel": "_3XsgEa_promptLabel",
			"radioRow": "_3XsgEa_radioRow",
			"time": "_3XsgEa_time",
			"timeSecondary": "_3XsgEa_timeSecondary",
			"wssOff": "_3XsgEa_wssOff",
			"wssOn": "_3XsgEa_wssOn"
		};
		//#endregion
		//#region lib/types/client/HeaderAction.js
		function AgentKernelHeaderAction({ sessionId, useAgentKernelHeader, watch, unwatch, setEnabled, saveSettings, claimPair, setSettingsOpen, t }) {
			const entry = useAgentKernelHeader((state) => state.bySession[String(sessionId)]);
			const [nowMs, setNowMs] = (0, react.useState)(() => Date.now());
			const [draftPrompt, setDraftPrompt] = (0, react.useState)("");
			const [draftForever, setDraftForever] = (0, react.useState)(true);
			const [draftHours, setDraftHours] = (0, react.useState)("8");
			const [draftUrl, setDraftUrl] = (0, react.useState)("");
			const [draftToken, setDraftToken] = (0, react.useState)("");
			const [draftPairCode, setDraftPairCode] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				watch(sessionId);
				return () => {
					unwatch(sessionId);
				};
			}, [
				sessionId,
				watch,
				unwatch
			]);
			const enabled = entry?.watchdogEnabled === true;
			(0, react.useEffect)(() => {
				if (!enabled) return;
				const timer = setInterval(() => {
					setNowMs(Date.now());
				}, 1e3);
				return () => {
					clearInterval(timer);
				};
			}, [enabled]);
			const busy = entry?.busy === true;
			const settingsOpen = entry?.settingsOpen === true;
			const savedPrompt = entry?.followupPrompt ?? "Continue";
			const savedHours = entry?.followupActiveHours ?? 0;
			const savedUrl = entry?.kernelUrl ?? "";
			const savedToken = entry?.kernelToken ?? "";
			const nextCheck = formatFollowupNextCheckLabel(enabled ? followupNextCheckRemainingMs({
				enabled: true,
				prompt: savedPrompt,
				activeHours: savedHours,
				armedAt: entry?.followupArmedAt ?? "",
				lastPolledAt: entry?.followupLastPolledAt ?? "",
				lastWakeAt: entry?.followupLastWakeAt ?? "",
				updatedAt: ""
			}, entry?.watchdogIntervalMinutes ?? 5, nowMs) : null, t("followup.nextSoon"));
			const followupClock = formatFollowupCountdownLabel(enabled, entry?.followupArmedAt ?? "", savedHours, nowMs, t("followup.forever"));
			(0, react.useEffect)(() => {
				if (!settingsOpen) return;
				setDraftPrompt(savedPrompt);
				setDraftForever(savedHours <= 0);
				setDraftHours(savedHours > 0 ? String(savedHours) : "8");
				setDraftUrl(savedUrl);
				setDraftToken(savedToken);
			}, [
				settingsOpen,
				savedPrompt,
				savedHours,
				savedUrl,
				savedToken
			]);
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("div", {
				className: HeaderAction_module_css_default.capsule,
				title: t("watchdog.title"),
				children: [
					(0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.label,
						children: [(0, react_jsx_runtime.jsx)("input", {
							className: HeaderAction_module_css_default.checkbox,
							type: "checkbox",
							checked: enabled,
							disabled: busy,
							"aria-label": t("watchdog.label"),
							onChange: (event) => {
								setEnabled(sessionId, event.target.checked);
							}
						}), (0, react_jsx_runtime.jsx)("span", { children: t("watchdog.label") })]
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: entry?.wssConnected ? HeaderAction_module_css_default.wssOn : HeaderAction_module_css_default.wssOff,
						title: entry?.wssLastError ?? (entry?.wssConnected ? t("wss.connected") : t("wss.disconnected")),
						children: entry?.wssConnected ? t("wss.connected") : t("wss.disconnected")
					}),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: HeaderAction_module_css_default.gear,
						disabled: busy,
						"aria-label": t("settings.open"),
						onClick: () => {
							setSettingsOpen(sessionId, true);
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutline14, { size: 14 })
					}),
					nextCheck.length > 0 ? (0, react_jsx_runtime.jsx)("span", {
						className: HeaderAction_module_css_default.time,
						"aria-live": "polite",
						children: nextCheck
					}) : null,
					followupClock.length > 0 ? (0, react_jsx_runtime.jsx)("span", {
						className: HeaderAction_module_css_default.timeSecondary,
						"aria-live": "polite",
						children: followupClock
					}) : null
				]
			}), (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: settingsOpen,
				onClose: () => {
					setSettingsOpen(sessionId, false);
				},
				title: t("dialog.title"),
				description: t("dialog.description"),
				closeLabel: t("dialog.close"),
				footer: (0, react_jsx_runtime.jsxs)("div", {
					className: HeaderAction_module_css_default.footer,
					children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						onClick: () => {
							setSettingsOpen(sessionId, false);
						},
						children: t("dialog.close")
					}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: busy,
						onClick: () => {
							(async () => {
								await saveSettings(sessionId, {
									prompt: draftPrompt,
									activeHours: draftForever ? 0 : Math.min(720, Math.max(1, Math.trunc(Number(draftHours)) || 1)),
									kernelUrl: draftUrl,
									kernelToken: draftToken
								});
								setSettingsOpen(sessionId, false);
							})();
						},
						children: t("dialog.save")
					})]
				}),
				children: [
					(0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.promptField,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: HeaderAction_module_css_default.promptLabel,
							children: t("dialog.targetLabel")
						}), (0, react_jsx_runtime.jsx)("input", {
							className: HeaderAction_module_css_default.hoursInput,
							style: { width: "100%" },
							type: "url",
							value: draftUrl,
							disabled: busy,
							placeholder: "https://agent-kernel.example.com",
							"aria-label": t("dialog.targetLabel"),
							onChange: (event) => {
								setDraftUrl(event.target.value);
							}
						})]
					}),
					(0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.promptField,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: HeaderAction_module_css_default.promptLabel,
							children: t("dialog.pairCodeLabel")
						}), (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: "0.5rem",
								width: "100%"
							},
							children: [(0, react_jsx_runtime.jsx)("input", {
								className: HeaderAction_module_css_default.hoursInput,
								style: { flex: 1 },
								type: "text",
								autoComplete: "off",
								spellCheck: false,
								value: draftPairCode,
								disabled: busy,
								placeholder: "WD4K-9F2M",
								"aria-label": t("dialog.pairCodeLabel"),
								onChange: (event) => {
									setDraftPairCode(event.target.value.toUpperCase());
								}
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								disabled: busy || draftPairCode.trim().length === 0 || draftUrl.trim().length === 0,
								onClick: () => {
									(async () => {
										await claimPair(sessionId, draftPairCode.trim(), draftUrl.trim());
										setDraftPairCode("");
									})();
								},
								children: t("dialog.pair")
							})]
						})]
					}),
					(0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.promptField,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: HeaderAction_module_css_default.promptLabel,
							children: t("dialog.tokenLabel")
						}), (0, react_jsx_runtime.jsx)("input", {
							className: HeaderAction_module_css_default.hoursInput,
							style: { width: "100%" },
							type: "password",
							autoComplete: "off",
							value: draftToken,
							disabled: busy,
							"aria-label": t("dialog.tokenLabel"),
							onChange: (event) => {
								setDraftToken(event.target.value);
							}
						})]
					}),
					(0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.promptField,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: HeaderAction_module_css_default.promptLabel,
							children: t("dialog.promptLabel")
						}), (0, react_jsx_runtime.jsx)("textarea", {
							className: HeaderAction_module_css_default.prompt,
							value: draftPrompt,
							rows: 5,
							disabled: busy,
							"aria-label": t("dialog.promptLabel"),
							onChange: (event) => {
								setDraftPrompt(event.target.value);
							}
						})]
					}),
					(0, react_jsx_runtime.jsxs)("fieldset", {
						className: HeaderAction_module_css_default.durationField,
						disabled: busy,
						children: [
							(0, react_jsx_runtime.jsx)("legend", {
								className: HeaderAction_module_css_default.promptLabel,
								children: t("dialog.durationLabel")
							}),
							(0, react_jsx_runtime.jsxs)("label", {
								className: HeaderAction_module_css_default.radioRow,
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "radio",
									name: `ak-followup-duration-${String(sessionId)}`,
									checked: draftForever,
									onChange: () => {
										setDraftForever(true);
									}
								}), (0, react_jsx_runtime.jsx)("span", { children: t("dialog.durationForever") })]
							}),
							(0, react_jsx_runtime.jsxs)("label", {
								className: HeaderAction_module_css_default.radioRow,
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "radio",
									name: `ak-followup-duration-${String(sessionId)}`,
									checked: !draftForever,
									onChange: () => {
										setDraftForever(false);
									}
								}), (0, react_jsx_runtime.jsx)("span", { children: t("dialog.durationHours") })]
							}),
							!draftForever ? (0, react_jsx_runtime.jsxs)("label", {
								className: HeaderAction_module_css_default.hoursRow,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: HeaderAction_module_css_default.promptLabel,
									children: t("dialog.hoursLabel")
								}), (0, react_jsx_runtime.jsx)("input", {
									className: HeaderAction_module_css_default.hoursInput,
									type: "number",
									min: 1,
									max: 720,
									step: 1,
									value: draftHours,
									"aria-label": t("dialog.hoursLabel"),
									onChange: (event) => {
										setDraftHours(event.target.value);
									}
								})]
							}) : null
						]
					}),
					entry?.error !== null && entry?.error !== void 0 && entry.error.length > 0 ? (0, react_jsx_runtime.jsxs)("p", {
						className: HeaderAction_module_css_default.error,
						role: "alert",
						children: [
							t("dialog.error"),
							": ",
							entry.error
						]
					}) : null
				]
			})] });
		}
		//#endregion
		//#region lib/types/client/followup-index.js
		/** Browser poll of Host Session ids with idle followup armed. */
		const INITIAL = {
			enabled: {},
			error: null
		};
		function hostBase() {
			const origin = globalThis.location?.origin;
			/* v8 ignore next -- jsdom provides a non-null origin; null appears only under file:// carriers */
			return origin !== void 0 && origin !== "null" ? origin : "http://dsh.internal";
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Poll `/api/agent-kernel.followup-index` for Workspaces sidebar marks.
		*/
		var FollowupIndexController = class {
			fetcher;
			pollMs;
			/** uSES-safe enabled-id map. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(INITIAL);
			timer;
			disposed = false;
			/**
			* @param fetcher - HTTP carrier.
			* @param pollMs - refresh interval while the sidebar is mounted.
			*/
			constructor(fetcher = (input, init) => fetch(input, init), pollMs = 15e3) {
				this.fetcher = fetcher;
				this.pollMs = pollMs;
			}
			/** Start polling (idempotent) and fetch immediately. */
			start() {
				/* v8 ignore next -- dispose races */
				if (this.disposed) return;
				if (this.timer !== void 0) return;
				this.refresh();
				this.timer = setInterval(() => {
					this.refresh();
				}, this.pollMs);
			}
			/** Stop polling. */
			stop() {
				if (this.timer === void 0) return;
				clearInterval(this.timer);
				this.timer = void 0;
			}
			/**
			* Optimistically mirror a Header toggle so the sidebar mark updates immediately.
			* @param sessionId - Session id.
			* @param enabled - next armed value.
			*/
			setLocal(sessionId, enabled) {
				/* v8 ignore next -- dispose races */
				if (this.disposed) return;
				this.store.update((state) => {
					const next = {};
					for (const [id, on] of Object.entries(state.enabled)) {
						if (id === sessionId || on !== true) continue;
						next[id] = true;
					}
					if (enabled) next[sessionId] = true;
					state.enabled = next;
					state.error = null;
				});
			}
			/** Fetch Host index. */
			async refresh() {
				/* v8 ignore next -- dispose races */
				if (this.disposed) return;
				try {
					const response = await this.fetcher(new URL("/api/agent-kernel.followup-index", hostBase()), { method: "GET" });
					if (!response.ok) {
						/* v8 ignore next -- text() rarely rejects */
						const detail = await response.text().catch(() => "");
						throw new Error(`Followup index failed: HTTP ${String(response.status)}${detail === "" ? "" : ` ${detail}`}`);
					}
					const body = await response.json();
					const list = Array.isArray(body.enabled) ? body.enabled : [];
					const enabled = {};
					for (const id of list) if (typeof id === "string" && id.length > 0) enabled[id] = true;
					/* v8 ignore next -- dispose during fetch */
					if (this.disposed) return;
					this.store.update((state) => {
						state.enabled = enabled;
						state.error = null;
					});
				} catch (error) {
					/* v8 ignore next -- dispose during fetch */
					if (this.disposed) return;
					this.store.update((state) => {
						state.error = messageOf(error);
					});
				}
			}
			/** Abort polls. */
			dispose() {
				this.disposed = true;
				this.stop();
			}
		};
		//#endregion
		//#region \0dsh-css:/home/fr4iser/Documents/Git/deepseek-harness/packages/agent-kernel/mcp/src/client/FollowupRowMark.module.css.mjs
		const css = ".AIpIlW_mark{width:14px;height:14px;color:var(--dsw-alias-label-secondary,#8b8b9a);opacity:.9;flex:none;justify-content:center;align-items:center;display:inline-flex}";
		const tagId = "agent-kernel-mcp/FollowupRowMark.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "agent-kernel-mcp";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var FollowupRowMark_module_css_default = { "mark": "AIpIlW_mark" };
		//#endregion
		//#region lib/types/client/FollowupRowMark.js
		/**
		* Show a refresh glyph left of the relative time when this Session's idle followup is on.
		* @param props - owner `sessionId` + index store + locale.
		*/
		function FollowupRowMark({ sessionId, useFollowupIndex, t }) {
			if (!useFollowupIndex((state) => state.enabled[String(sessionId)] === true)) return null;
			return (0, react_jsx_runtime.jsx)("span", {
				className: FollowupRowMark_module_css_default.mark,
				title: t("followup.rowMarkTitle"),
				"aria-label": t("followup.rowMarkTitle"),
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14, { size: 12 })
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Locale for Agent Kernel Session Header. */
		const NS = "agent-kernel-mcp";
		const zh = {
			"watchdog.label": "Agent Kernel",
			"watchdog.title": "本会话空闲续跑 + Agent Kernel WSS 连接。",
			"wss.connected": "WSS 已连接",
			"wss.disconnected": "WSS 未连接",
			"time.placeholder": "—",
			"followup.forever": "∞",
			"followup.nextSoon": "↓ …",
			"settings.open": "Agent Kernel 设置",
			"dialog.title": "Agent Kernel",
			"dialog.description": "用 Agent Kernel 设置页的配对码，或手动填 Target / Token。空闲消息仅本会话。",
			"dialog.targetLabel": "Target URL",
			"dialog.pairCodeLabel": "配对码",
			"dialog.pair": "配对",
			"dialog.tokenLabel": "Token（已配对可留空）",
			"dialog.promptLabel": "空闲消息",
			"dialog.durationLabel": "有效时长",
			"dialog.durationForever": "一直开着",
			"dialog.durationHours": "限时（小时）",
			"dialog.hoursLabel": "小时",
			"dialog.save": "保存",
			"dialog.close": "关闭",
			"dialog.error": "保存失败",
			"followup.rowMarkTitle": "Agent Kernel 已开启"
		};
		const en = {
			"watchdog.label": "Agent Kernel",
			"watchdog.title": "This Session idle followup + Agent Kernel WSS control channel.",
			"wss.connected": "WSS connected",
			"wss.disconnected": "WSS down",
			"time.placeholder": "—",
			"followup.forever": "∞",
			"followup.nextSoon": "↓ …",
			"settings.open": "Agent Kernel settings",
			"dialog.title": "Agent Kernel",
			"dialog.description": "Pair with a code from Agent Kernel setup, or paste Target / Token. Idle message is per Session.",
			"dialog.targetLabel": "Target URL",
			"dialog.pairCodeLabel": "Pairing code",
			"dialog.pair": "Pair",
			"dialog.tokenLabel": "Token (optional if paired)",
			"dialog.promptLabel": "Idle message",
			"dialog.durationLabel": "How long active",
			"dialog.durationForever": "Forever",
			"dialog.durationHours": "Limited (hours)",
			"dialog.hoursLabel": "Hours",
			"dialog.save": "Save",
			"dialog.close": "Close",
			"dialog.error": "Save failed",
			"followup.rowMarkTitle": "Agent Kernel idle followup on"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Browser plugin: Agent Kernel Session Header + sidebar mark. */
		const inject = ["slots", "locale"];
		function apply(ctx) {
			const controller = new AgentKernelHeaderController();
			const followupIndex = new FollowupIndexController();
			ctx.provide("agentKernelHeader", controller);
			ctx.provide("followupIndex", followupIndex);
			ctx.effect(() => {
				followupIndex.start();
				return () => {
					followupIndex.dispose();
				};
			}, "agent-kernel: followup-index poll");
			ctx.effect(() => async () => {
				await controller.dispose();
				followupIndex.dispose();
			}, "agent-kernel: browser lifecycle");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "agent-kernel: dictionaries");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "agent-kernel-followup",
				locale: NS,
				inject: () => ({
					hooks: { agentKernelHeader: controller.store },
					watch: (sessionId) => {
						controller.watch(sessionId);
					},
					unwatch: (sessionId) => {
						controller.unwatch(sessionId);
					},
					setEnabled: async (sessionId, enabled) => {
						followupIndex.setLocal(String(sessionId), enabled);
						await controller.setEnabled(sessionId, enabled);
						followupIndex.refresh();
					},
					saveSettings: (sessionId, settings) => controller.saveSettings(sessionId, settings),
					claimPair: (sessionId, code, kernelUrl) => controller.claimPair(sessionId, code, kernelUrl),
					setSettingsOpen: (sessionId, open) => {
						controller.setSettingsOpen(sessionId, open);
					}
				})
			}, AgentKernelHeaderAction));
			ctx.slots.inject("sidebar.workspaces.session.trailing", () => ctx.slots.register({
				name: "sidebar.workspaces.session.trailing",
				id: "agent-kernel-followup-mark",
				order: 10,
				locale: NS,
				inject: () => ({ hooks: { followupIndex: followupIndex.store } })
			}, FollowupRowMark));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map