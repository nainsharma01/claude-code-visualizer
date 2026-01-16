interface GraphMetadata {
    generatedAt: string;
    projectPath: string;
    projectName: string;
    agentCount: number;
    skillCount: number;
    commandCount: number;
    edgeCount: number;
    globalAgentCount: number;
    globalSkillCount: number;
    globalCommandCount: number;
}
interface ScanOptions {
    includeLocal?: boolean;
    includeGlobal?: boolean;
}
/**
 * Scan a Claude Code project and generate graph data
 */
export declare function scanProject(projectPath: string, outputPath: string, options?: ScanOptions): Promise<GraphMetadata>;
export {};
//# sourceMappingURL=scanner.d.ts.map