import { type CliExecutorId } from './cli-sessions.ts';
export { readCliSession } from './cli-sessions.ts';
export declare function isCliExecutorId(id: string): id is CliExecutorId;
export declare function cliStart(opts: {
    executorId: CliExecutorId;
    cwd: string;
    objective: string;
    rolePromptText: string | null;
}): Promise<{
    executorSessionId: string;
}>;
export declare function cliContinueSession(opts: {
    executorSessionId: string;
    prompt: string;
}): Promise<{
    executorSessionId: string;
}>;
export declare function cliFetchTranscript(executorSessionId: string): Promise<Record<string, unknown>>;
//# sourceMappingURL=cli-runners.d.ts.map