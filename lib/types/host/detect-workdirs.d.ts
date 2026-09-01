export type WorkdirCandidate = {
    path: string;
    name: string;
    source: string;
    gitRemote: string | null;
};
export declare function listWorkdirCandidates(opts?: {
    roots?: string[];
}): Promise<{
    candidates: WorkdirCandidate[];
}>;
//# sourceMappingURL=detect-workdirs.d.ts.map