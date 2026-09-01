export type KernelJob = {
    id: string;
    runId: string;
    kind: 'start' | 'session_continue' | 'fetch_transcript' | 'operator_turn' | 'list_workdir_candidates';
    payload: Record<string, unknown>;
    createdAt: string;
};
/** Run one kernel job via local Host RPC or CLI adapter. */
export declare function executeKernelJob(job: KernelJob): Promise<Record<string, unknown>>;
//# sourceMappingURL=jobs.d.ts.map