export type CliExecutorId = 'claude-code' | 'aider' | 'opencode';
export type CliSessionMessage = {
    readonly role: 'user' | 'assistant';
    readonly text: string;
    readonly at: string;
};
export type CliSession = {
    readonly id: string;
    readonly executorId: CliExecutorId;
    readonly cwd: string;
    readonly createdAt: string;
    updatedAt: string;
    /** Vendor session id when the CLI supports resume (claude / opencode). */
    externalSessionId: string | null;
    messages: CliSessionMessage[];
};
export declare function writeCliSession(session: CliSession): Promise<void>;
export declare function readCliSession(id: string): Promise<CliSession>;
export declare function appendCliMessage(session: CliSession, role: 'user' | 'assistant', text: string): CliSession;
//# sourceMappingURL=cli-sessions.d.ts.map