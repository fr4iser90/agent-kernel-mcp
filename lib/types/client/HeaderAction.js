import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Button, IconSettingsOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { MAX_FOLLOWUP_ACTIVE_HOURS, followupNextCheckRemainingMs } from "../host/idle-followup.js";
import { formatFollowupCountdownLabel, formatFollowupNextCheckLabel } from "./format.js";
import css from './HeaderAction.module.css';
export function AgentKernelHeaderAction({ sessionId, useAgentKernelHeader, watch, unwatch, setEnabled, saveSettings, claimPair, setSettingsOpen, t, }) {
    const entry = useAgentKernelHeader(state => state.bySession[String(sessionId)]);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [draftPrompt, setDraftPrompt] = useState('');
    const [draftForever, setDraftForever] = useState(true);
    const [draftHours, setDraftHours] = useState('8');
    const [draftUrl, setDraftUrl] = useState('');
    const [draftToken, setDraftToken] = useState('');
    const [draftPairCode, setDraftPairCode] = useState('');
    useEffect(() => {
        watch(sessionId);
        return () => { unwatch(sessionId); };
    }, [sessionId, watch, unwatch]);
    const enabled = entry?.watchdogEnabled === true;
    useEffect(() => {
        if (!enabled)
            return;
        const timer = setInterval(() => { setNowMs(Date.now()); }, 1_000);
        return () => { clearInterval(timer); };
    }, [enabled]);
    const busy = entry?.busy === true;
    const settingsOpen = entry?.settingsOpen === true;
    const savedPrompt = entry?.followupPrompt ?? 'Continue';
    const savedHours = entry?.followupActiveHours ?? 0;
    const savedUrl = entry?.kernelUrl ?? '';
    const savedToken = entry?.kernelToken ?? '';
    const nextCheck = formatFollowupNextCheckLabel(enabled
        ? followupNextCheckRemainingMs({
            enabled: true,
            prompt: savedPrompt,
            activeHours: savedHours,
            armedAt: entry?.followupArmedAt ?? '',
            lastPolledAt: entry?.followupLastPolledAt ?? '',
            lastWakeAt: entry?.followupLastWakeAt ?? '',
            updatedAt: '',
        }, entry?.watchdogIntervalMinutes ?? 5, nowMs)
        : null, t('followup.nextSoon'));
    const followupClock = formatFollowupCountdownLabel(enabled, entry?.followupArmedAt ?? '', savedHours, nowMs, t('followup.forever'));
    useEffect(() => {
        if (!settingsOpen)
            return;
        setDraftPrompt(savedPrompt);
        setDraftForever(savedHours <= 0);
        setDraftHours(savedHours > 0 ? String(savedHours) : '8');
        setDraftUrl(savedUrl);
        setDraftToken(savedToken);
    }, [settingsOpen, savedPrompt, savedHours, savedUrl, savedToken]);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.capsule, title: t('watchdog.title'), children: [_jsxs("label", { className: css.label, children: [_jsx("input", { className: css.checkbox, type: "checkbox", checked: enabled, disabled: busy, "aria-label": t('watchdog.label'), onChange: (event) => {
                                    void setEnabled(sessionId, event.target.checked);
                                } }), _jsx("span", { children: t('watchdog.label') })] }), _jsx("button", { type: "button", className: css.gear, disabled: busy, "aria-label": t('settings.open'), onClick: () => { setSettingsOpen(sessionId, true); }, children: _jsx(IconSettingsOutline14, { size: 14 }) }), nextCheck.length > 0 ? (_jsx("span", { className: css.time, "aria-live": "polite", children: nextCheck })) : null, followupClock.length > 0 ? (_jsx("span", { className: css.timeSecondary, "aria-live": "polite", children: followupClock })) : null] }), _jsxs(Modal, { open: settingsOpen, onClose: () => { setSettingsOpen(sessionId, false); }, title: t('dialog.title'), description: t('dialog.description'), closeLabel: t('dialog.close'), footer: (_jsxs("div", { className: css.footer, children: [_jsx(Button, { variant: "outline", onClick: () => { setSettingsOpen(sessionId, false); }, children: t('dialog.close') }), _jsx(Button, { variant: "primary", disabled: busy, onClick: () => {
                                void (async () => {
                                    const hours = draftForever
                                        ? 0
                                        : Math.min(MAX_FOLLOWUP_ACTIVE_HOURS, Math.max(1, Math.trunc(Number(draftHours)) || 1));
                                    await saveSettings(sessionId, {
                                        prompt: draftPrompt,
                                        activeHours: hours,
                                        kernelUrl: draftUrl,
                                        kernelToken: draftToken,
                                    });
                                    setSettingsOpen(sessionId, false);
                                })();
                            }, children: t('dialog.save') })] })), children: [_jsxs("label", { className: css.promptField, children: [_jsx("span", { className: css.promptLabel, children: t('dialog.targetLabel') }), _jsx("input", { className: css.hoursInput, style: { width: '100%' }, type: "url", value: draftUrl, disabled: busy, placeholder: "https://agent-kernel.example.com", "aria-label": t('dialog.targetLabel'), onChange: (event) => { setDraftUrl(event.target.value); } })] }), _jsxs("label", { className: css.promptField, children: [_jsx("span", { className: css.promptLabel, children: t('dialog.pairCodeLabel') }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', width: '100%' }, children: [_jsx("input", { className: css.hoursInput, style: { flex: 1 }, type: "text", autoComplete: "off", spellCheck: false, value: draftPairCode, disabled: busy, placeholder: "WD4K-9F2M", "aria-label": t('dialog.pairCodeLabel'), onChange: (event) => { setDraftPairCode(event.target.value.toUpperCase()); } }), _jsx(Button, { variant: "outline", disabled: busy || draftPairCode.trim().length === 0 || draftUrl.trim().length === 0, onClick: () => {
                                            void (async () => {
                                                await claimPair(sessionId, draftPairCode.trim(), draftUrl.trim());
                                                setDraftPairCode('');
                                            })();
                                        }, children: t('dialog.pair') })] })] }), _jsxs("label", { className: css.promptField, children: [_jsx("span", { className: css.promptLabel, children: t('dialog.tokenLabel') }), _jsx("input", { className: css.hoursInput, style: { width: '100%' }, type: "password", autoComplete: "off", value: draftToken, disabled: busy, "aria-label": t('dialog.tokenLabel'), onChange: (event) => { setDraftToken(event.target.value); } })] }), _jsxs("label", { className: css.promptField, children: [_jsx("span", { className: css.promptLabel, children: t('dialog.promptLabel') }), _jsx("textarea", { className: css.prompt, value: draftPrompt, rows: 5, disabled: busy, "aria-label": t('dialog.promptLabel'), onChange: (event) => { setDraftPrompt(event.target.value); } })] }), _jsxs("fieldset", { className: css.durationField, disabled: busy, children: [_jsx("legend", { className: css.promptLabel, children: t('dialog.durationLabel') }), _jsxs("label", { className: css.radioRow, children: [_jsx("input", { type: "radio", name: `ak-followup-duration-${String(sessionId)}`, checked: draftForever, onChange: () => { setDraftForever(true); } }), _jsx("span", { children: t('dialog.durationForever') })] }), _jsxs("label", { className: css.radioRow, children: [_jsx("input", { type: "radio", name: `ak-followup-duration-${String(sessionId)}`, checked: !draftForever, onChange: () => { setDraftForever(false); } }), _jsx("span", { children: t('dialog.durationHours') })] }), !draftForever ? (_jsxs("label", { className: css.hoursRow, children: [_jsx("span", { className: css.promptLabel, children: t('dialog.hoursLabel') }), _jsx("input", { className: css.hoursInput, type: "number", min: 1, max: MAX_FOLLOWUP_ACTIVE_HOURS, step: 1, value: draftHours, "aria-label": t('dialog.hoursLabel'), onChange: (event) => { setDraftHours(event.target.value); } })] })) : null] }), entry?.error !== null && entry?.error !== undefined && entry.error.length > 0 ? (_jsxs("p", { className: css.error, role: "alert", children: [t('dialog.error'), ": ", entry.error] })) : null] })] }));
}
//# sourceMappingURL=HeaderAction.js.map