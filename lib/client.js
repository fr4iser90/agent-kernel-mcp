window.__ModuleLoader__.load({
	id: "agent-kernel-mcp",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#endregion
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/host/nudge.ts
		/**
		* Per-Session idle nudge: opt-in flag, followup prompt, and optional hour budget
		* under `$DSH_HOME`. Independent of autonomy `state.json` so Header can arm
		* without `/autonomy start`.
		* @module @deepseek-ai/dsh-tool-autonomy/nudge
		*/
		/** Default followup text when the operator leaves the prompt empty. */
		const DEFAULT_NUDGE_PROMPT = "Continue";
		/**
		* Ms until the next Host idle-check opportunity for this Session.
		* Cycles on the full poll interval from `lastPolledAt` (else `armedAt`) so the
		* Header never sticks at overdue after the first window elapses. After a wake,
		* the in-memory anti-spam half-interval still applies before another followup.
		* @param state - durable nudge.
		* @param intervalMinutes - Host poll interval (`watchdogIntervalMinutes`).
		* @param nowMs - evaluation clock.
		* @returns remaining ms in `(0, intervalMs]`, or `null` when not armed / interval off.
		*/
		function nudgeNextCheckRemainingMs(state, intervalMinutes, nowMs) {
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
		//#region src/client/controller.ts
		/** Browser state for Agent Kernel Session Header. */
		const INITIAL$1 = { bySession: {} };
		const EMPTY = {
			watchdogEnabled: false,
			nudgePrompt: DEFAULT_NUDGE_PROMPT,
			nudgeActiveHours: 0,
			nudgeArmedAt: "",
			nudgeLastPolledAt: "",
			nudgeLastWakeAt: "",
			watchdogIntervalMinutes: 5,
			pluginEnabled: true,
			kernelUrl: "",
			kernelToken: "",
			kernelConnected: false,
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
				nudgePrompt: typeof body.nudgePrompt === "string" && body.nudgePrompt.trim().length > 0 ? body.nudgePrompt : DEFAULT_NUDGE_PROMPT,
				nudgeActiveHours: typeof body.nudgeActiveHours === "number" && Number.isSafeInteger(body.nudgeActiveHours) ? Math.max(0, body.nudgeActiveHours) : 0,
				nudgeArmedAt: typeof body.nudgeArmedAt === "string" ? body.nudgeArmedAt : "",
				nudgeLastPolledAt: typeof body.nudgeLastPolledAt === "string" ? body.nudgeLastPolledAt : "",
				nudgeLastWakeAt: typeof body.nudgeLastWakeAt === "string" ? body.nudgeLastWakeAt : "",
				watchdogIntervalMinutes: typeof body.watchdogIntervalMinutes === "number" && Number.isSafeInteger(body.watchdogIntervalMinutes) ? Math.max(0, body.watchdogIntervalMinutes) : 5,
				pluginEnabled: body.pluginEnabled !== false,
				kernelUrl: typeof body.kernelUrl === "string" ? body.kernelUrl : "",
				kernelToken: typeof body.kernelToken === "string" ? body.kernelToken : "",
				kernelConnected: body.kernelConnected === true || typeof body.kernelUrl === "string" && body.kernelUrl.length > 0 && typeof body.kernelToken === "string" && body.kernelToken.length > 0,
				error: null,
				busy: false,
				settingsOpen
			};
		}
		var AgentKernelHeaderController = class {
			fetcher;
			pollMs;
			store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(INITIAL$1);
			polls = /* @__PURE__ */ new Map();
			disposed = false;
			constructor(fetcher = (input, init) => fetch(input, init), pollMs = 15e3) {
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
					const response = await this.fetcher(new URL("/api/agent-kernel.nudge", hostBase$1()), {
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
		//#region src/client/format.ts
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
		* Remaining Session-nudge window label for the Header capsule.
		* @param enabled - whether nudge is armed.
		* @param armedAt - ISO arm start.
		* @param activeHours - `0` = forever.
		* @param nowMs - clock.
		* @param foreverLabel - copy when unlimited.
		* @returns remaining label, forever label, or empty when off.
		*/
		function formatNudgeCountdownLabel(enabled, armedAt, activeHours, nowMs, foreverLabel) {
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
		function formatNudgeNextCheckLabel(remainingMs, soonLabel) {
			if (remainingMs === null) return "";
			if (remainingMs <= 0) return soonLabel;
			return `↓ ${formatAutonomyDuration(remainingMs)}`;
		}
		//#endregion
		//#region \0dsh-css:/home/fr4iser/Documents/Git/deepseek-harness/packages/agent-kernel/mcp/src/client/HeaderAction.module.css.mjs
		const css$1 = "._3XsgEa_capsule{border:1px solid var(--dsw-alias-border-l2);min-height:32px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);background:0 0;border-radius:18px;justify-content:center;align-items:center;gap:8px;padding:4px 12px;font-size:13px;font-weight:400;line-height:20px;display:inline-flex}._3XsgEa_label{cursor:pointer;white-space:nowrap;align-items:center;gap:6px;display:inline-flex}._3XsgEa_label:has(input:disabled){cursor:default}._3XsgEa_checkbox{accent-color:var(--dsw-alias-label-primary);margin:0}._3XsgEa_gear{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;margin:0;padding:2px;display:inline-flex}._3XsgEa_gear:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-hover,transparent)}._3XsgEa_gear:disabled{cursor:default;opacity:.5}._3XsgEa_time{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}._3XsgEa_timeSecondary{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-dimmed);font-size:12px}._3XsgEa_footer{flex-wrap:wrap;justify-content:flex-end;gap:8px;display:flex}._3XsgEa_promptField{flex-direction:column;gap:8px;width:100%;margin-bottom:12px;display:flex}._3XsgEa_promptLabel{color:var(--dsw-alias-label-secondary);font-size:13px}._3XsgEa_prompt{border:1px solid var(--dsw-alias-border-l2);width:100%;min-height:100px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);resize:vertical;background:0 0;border-radius:8px;padding:8px 10px;font-size:13px;line-height:20px}._3XsgEa_durationField{border:none;flex-direction:column;gap:8px;margin:0;padding:0;display:flex}._3XsgEa_radioRow{color:var(--dsw-alias-label-primary);cursor:pointer;align-items:center;gap:8px;font-size:13px;display:inline-flex}._3XsgEa_hoursRow{align-items:center;gap:8px;margin-left:24px;display:flex}._3XsgEa_hoursInput{border:1px solid var(--dsw-alias-border-l2);width:88px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);background:0 0;border-radius:6px;padding:4px 8px;font-size:13px}._3XsgEa_error{color:var(--dsw-alias-label-danger,#c44);margin:8px 0 0;font-size:13px}";
		const tagId$1 = "agent-kernel-mcp/HeaderAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "agent-kernel-mcp";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var HeaderAction_module_css_default = {
			"label": "_3XsgEa_label",
			"capsule": "_3XsgEa_capsule",
			"timeSecondary": "_3XsgEa_timeSecondary",
			"promptLabel": "_3XsgEa_promptLabel",
			"hoursRow": "_3XsgEa_hoursRow",
			"footer": "_3XsgEa_footer",
			"time": "_3XsgEa_time",
			"error": "_3XsgEa_error",
			"checkbox": "_3XsgEa_checkbox",
			"prompt": "_3XsgEa_prompt",
			"gear": "_3XsgEa_gear",
			"hoursInput": "_3XsgEa_hoursInput",
			"radioRow": "_3XsgEa_radioRow",
			"promptField": "_3XsgEa_promptField",
			"durationField": "_3XsgEa_durationField"
		};
		//#endregion
		//#region src/client/HeaderAction.tsx
		function AgentKernelHeaderAction({ sessionId, useAgentKernelHeader, watch, unwatch, setEnabled, saveSettings, setSettingsOpen, t }) {
			const entry = useAgentKernelHeader((state) => state.bySession[String(sessionId)]);
			const [nowMs, setNowMs] = (0, react.useState)(() => Date.now());
			const [draftPrompt, setDraftPrompt] = (0, react.useState)("");
			const [draftForever, setDraftForever] = (0, react.useState)(true);
			const [draftHours, setDraftHours] = (0, react.useState)("8");
			const [draftUrl, setDraftUrl] = (0, react.useState)("");
			const [draftToken, setDraftToken] = (0, react.useState)("");
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
			const savedPrompt = entry?.nudgePrompt ?? "Continue";
			const savedHours = entry?.nudgeActiveHours ?? 0;
			const savedUrl = entry?.kernelUrl ?? "";
			const savedToken = entry?.kernelToken ?? "";
			const nextCheck = formatNudgeNextCheckLabel(enabled ? nudgeNextCheckRemainingMs({
				enabled: true,
				prompt: savedPrompt,
				activeHours: savedHours,
				armedAt: entry?.nudgeArmedAt ?? "",
				lastPolledAt: entry?.nudgeLastPolledAt ?? "",
				lastWakeAt: entry?.nudgeLastWakeAt ?? "",
				updatedAt: ""
			}, entry?.watchdogIntervalMinutes ?? 5, nowMs) : null, t("nudge.nextSoon"));
			const nudgeClock = formatNudgeCountdownLabel(enabled, entry?.nudgeArmedAt ?? "", savedHours, nowMs, t("nudge.forever"));
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: HeaderAction_module_css_default.capsule,
				title: t("watchdog.title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.label,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: HeaderAction_module_css_default.checkbox,
							type: "checkbox",
							checked: enabled,
							disabled: busy,
							"aria-label": t("watchdog.label"),
							onChange: (event) => {
								setEnabled(sessionId, event.target.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("watchdog.label") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: HeaderAction_module_css_default.gear,
						disabled: busy,
						"aria-label": t("settings.open"),
						onClick: () => {
							setSettingsOpen(sessionId, true);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutline14, { size: 14 })
					}),
					nextCheck.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: HeaderAction_module_css_default.time,
						"aria-live": "polite",
						children: nextCheck
					}) : null,
					nudgeClock.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: HeaderAction_module_css_default.timeSecondary,
						"aria-live": "polite",
						children: nudgeClock
					}) : null
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: settingsOpen,
				onClose: () => {
					setSettingsOpen(sessionId, false);
				},
				title: t("dialog.title"),
				description: t("dialog.description"),
				closeLabel: t("dialog.close"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: HeaderAction_module_css_default.footer,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						onClick: () => {
							setSettingsOpen(sessionId, false);
						},
						children: t("dialog.close")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.promptField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: HeaderAction_module_css_default.promptLabel,
							children: t("dialog.targetLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.promptField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: HeaderAction_module_css_default.promptLabel,
							children: t("dialog.tokenLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: HeaderAction_module_css_default.promptField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: HeaderAction_module_css_default.promptLabel,
							children: t("dialog.promptLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
						className: HeaderAction_module_css_default.durationField,
						disabled: busy,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", {
								className: HeaderAction_module_css_default.promptLabel,
								children: t("dialog.durationLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: HeaderAction_module_css_default.radioRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "radio",
									name: `ak-nudge-duration-${String(sessionId)}`,
									checked: draftForever,
									onChange: () => {
										setDraftForever(true);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dialog.durationForever") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: HeaderAction_module_css_default.radioRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "radio",
									name: `ak-nudge-duration-${String(sessionId)}`,
									checked: !draftForever,
									onChange: () => {
										setDraftForever(false);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dialog.durationHours") })]
							}),
							!draftForever ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: HeaderAction_module_css_default.hoursRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: HeaderAction_module_css_default.promptLabel,
									children: t("dialog.hoursLabel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
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
					entry?.error !== null && entry?.error !== void 0 && entry.error.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
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
		//#region src/client/nudge-index.ts
		/** Browser poll of Host Session ids with idle nudge armed. */
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
		* Poll `/api/agent-kernel.nudge-index` for Workspaces sidebar marks.
		*/
		var NudgeIndexController = class {
			fetcher;
			pollMs;
			/** uSES-safe enabled-id map. */
			store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(INITIAL);
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
					const response = await this.fetcher(new URL("/api/agent-kernel.nudge-index", hostBase()), { method: "GET" });
					if (!response.ok) {
						/* v8 ignore next -- text() rarely rejects */
						const detail = await response.text().catch(() => "");
						throw new Error(`Nudge index failed: HTTP ${String(response.status)}${detail === "" ? "" : ` ${detail}`}`);
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
		//#region \0dsh-css:/home/fr4iser/Documents/Git/deepseek-harness/packages/agent-kernel/mcp/src/client/NudgeRowMark.module.css.mjs
		const css = ".M_cbAa_mark{width:14px;height:14px;color:var(--dsw-alias-label-secondary,#8b8b9a);opacity:.9;flex:none;justify-content:center;align-items:center;display:inline-flex}";
		const tagId = "agent-kernel-mcp/NudgeRowMark.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "agent-kernel-mcp";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var NudgeRowMark_module_css_default = { "mark": "M_cbAa_mark" };
		//#endregion
		//#region src/client/NudgeRowMark.tsx
		/**
		* Show a refresh glyph left of the relative time when this Session's nudge is on.
		* @param props - owner `sessionId` + index store + locale.
		*/
		function NudgeRowMark({ sessionId, useNudgeIndex, t }) {
			if (!useNudgeIndex((state) => state.enabled[String(sessionId)] === true)) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: NudgeRowMark_module_css_default.mark,
				title: t("nudge.rowMarkTitle"),
				"aria-label": t("nudge.rowMarkTitle"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14, { size: 12 })
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Locale for Agent Kernel Session Header. */
		const NS = "agent-kernel-mcp";
		const zh = {
			"watchdog.label": "Agent Kernel",
			"watchdog.title": "本会话空闲续跑 + Agent Kernel 连接。",
			"time.placeholder": "—",
			"nudge.forever": "∞",
			"nudge.nextSoon": "↓ …",
			"settings.open": "Agent Kernel 设置",
			"dialog.title": "Agent Kernel",
			"dialog.description": "Target / Token 供 MCP。空闲消息与时长仅本会话。",
			"dialog.targetLabel": "Target URL",
			"dialog.tokenLabel": "Token (ak_session)",
			"dialog.promptLabel": "空闲消息",
			"dialog.durationLabel": "有效时长",
			"dialog.durationForever": "一直开着",
			"dialog.durationHours": "限时（小时）",
			"dialog.hoursLabel": "小时",
			"dialog.save": "保存",
			"dialog.close": "关闭",
			"dialog.error": "保存失败",
			"nudge.rowMarkTitle": "Agent Kernel 已开启"
		};
		const en = {
			"watchdog.label": "Agent Kernel",
			"watchdog.title": "This Session idle nudge + Agent Kernel connection.",
			"time.placeholder": "—",
			"nudge.forever": "∞",
			"nudge.nextSoon": "↓ …",
			"settings.open": "Agent Kernel settings",
			"dialog.title": "Agent Kernel",
			"dialog.description": "Target URL and token for MCP. Idle message and duration apply to this Session only.",
			"dialog.targetLabel": "Target URL",
			"dialog.tokenLabel": "Token (ak_session)",
			"dialog.promptLabel": "Idle message",
			"dialog.durationLabel": "How long active",
			"dialog.durationForever": "Forever",
			"dialog.durationHours": "Limited (hours)",
			"dialog.hoursLabel": "Hours",
			"dialog.save": "Save",
			"dialog.close": "Close",
			"dialog.error": "Save failed",
			"nudge.rowMarkTitle": "Agent Kernel nudge on"
		};
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "locale"];
		function apply(ctx) {
			const controller = new AgentKernelHeaderController();
			const nudgeIndex = new NudgeIndexController();
			ctx.provide("agentKernelHeader", controller);
			ctx.provide("nudgeIndex", nudgeIndex);
			ctx.effect(() => {
				nudgeIndex.start();
				return () => {
					nudgeIndex.dispose();
				};
			}, "agent-kernel: nudge-index poll");
			ctx.effect(() => async () => {
				await controller.dispose();
				nudgeIndex.dispose();
			}, "agent-kernel: browser lifecycle");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "agent-kernel: dictionaries");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "agent-kernel-nudge",
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
						nudgeIndex.setLocal(String(sessionId), enabled);
						await controller.setEnabled(sessionId, enabled);
						nudgeIndex.refresh();
					},
					saveSettings: (sessionId, settings) => controller.saveSettings(sessionId, settings),
					setSettingsOpen: (sessionId, open) => {
						controller.setSettingsOpen(sessionId, open);
					}
				})
			}, AgentKernelHeaderAction));
			ctx.slots.inject("sidebar.workspaces.session.trailing", () => ctx.slots.register({
				name: "sidebar.workspaces.session.trailing",
				id: "agent-kernel-nudge-mark",
				order: 10,
				locale: NS,
				inject: () => ({ hooks: { nudgeIndex: nudgeIndex.store } })
			}, NudgeRowMark));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map