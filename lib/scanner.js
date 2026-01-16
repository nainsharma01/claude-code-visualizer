import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
/**
 * Parse YAML front matter from markdown content using regex
 */
function parseYamlFrontmatter(content) {
    const yamlPattern = /^---\s*\n(.*?)\n---\s*\n/s;
    const match = content.match(yamlPattern);
    if (!match) {
        return {};
    }
    const yamlContent = match[1];
    const result = {};
    let currentKey = null;
    let currentList = [];
    for (const line of yamlContent.split('\n')) {
        // Skip empty lines
        if (!line.trim()) {
            continue;
        }
        // Check for list item
        const listMatch = line.match(/^\s+-\s+(.+)$/);
        if (listMatch && currentKey) {
            currentList.push(listMatch[1].trim());
            continue;
        }
        // Check for key-value pair
        const kvMatch = line.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
            // Save previous list if exists
            if (currentKey && currentList.length > 0) {
                result[currentKey] = currentList;
                currentList = [];
            }
            const key = kvMatch[1];
            let value = kvMatch[2].trim();
            if (value) {
                // Handle quoted strings
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                result[key] = value;
                currentKey = null;
            }
            else {
                // Likely a list follows
                currentKey = key;
            }
        }
    }
    // Save final list if exists
    if (currentKey && currentList.length > 0) {
        result[currentKey] = currentList;
    }
    return result;
}
/**
 * Extract content after YAML front matter
 */
function extractBodyContent(content) {
    const yamlPattern = /^---\s*\n.*?\n---\s*\n/s;
    return content.replace(yamlPattern, '').trim();
}
/**
 * Parse a field that can be either a string (comma-separated) or array
 */
function parseListField(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'string') {
        return value.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
}
/**
 * Resolve symlinks and get real path
 */
async function resolveSymlink(filePath) {
    try {
        const stats = await fs.lstat(filePath);
        if (stats.isSymbolicLink()) {
            return await fs.realpath(filePath);
        }
        return filePath;
    }
    catch {
        return filePath;
    }
}
/**
 * Scan agents directory for agent definitions
 */
async function scanAgents(claudePath, scope, basePath) {
    const agents = [];
    const agentsDir = path.join(claudePath, 'agents');
    try {
        await fs.access(agentsDir);
    }
    catch {
        return agents;
    }
    const agentFiles = await glob('*.md', { cwd: agentsDir });
    for (const file of agentFiles) {
        try {
            let filePath = path.join(agentsDir, file);
            // Resolve symlinks
            const realPath = await resolveSymlink(filePath);
            const content = await fs.readFile(realPath, 'utf-8');
            const metadata = parseYamlFrontmatter(content);
            const body = extractBodyContent(content);
            const tools = parseListField(metadata.tools);
            const subagents = parseListField(metadata.subagents);
            const skills = parseListField(metadata.skills);
            const basename = path.parse(file).name;
            const relativePath = scope === 'global'
                ? `~/.claude/agents/${file}`
                : path.relative(basePath, filePath);
            const agent = {
                id: `agent:${basename}`,
                type: 'agent',
                name: metadata.name || basename,
                description: metadata.description || '',
                tools,
                model: metadata.model || '',
                subagents,
                skills,
                filePath: relativePath,
                scope,
                systemPrompt: body.length > 500 ? body.slice(0, 500) + '...' : body
            };
            agents.push(agent);
        }
        catch (error) {
            console.warn(`Warning: Failed to parse ${file}: ${error.message}`);
        }
    }
    return agents;
}
/**
 * Scan skills directory for skill definitions
 */
async function scanSkills(claudePath, scope, basePath) {
    const skills = [];
    const skillsDir = path.join(claudePath, 'skills');
    try {
        await fs.access(skillsDir);
    }
    catch {
        return skills;
    }
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
        // Handle both directories and symlinks
        const entryPath = path.join(skillsDir, entry.name);
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
            try {
                const realPath = await fs.realpath(entryPath);
                const realStats = await fs.stat(realPath);
                isDir = realStats.isDirectory();
            }
            catch {
                continue;
            }
        }
        if (!isDir) {
            continue;
        }
        const skillDir = entryPath;
        const skillFile = path.join(skillDir, 'SKILL.md');
        // Resolve symlinks for skill directory
        let realSkillDir = skillDir;
        try {
            realSkillDir = await resolveSymlink(skillDir);
        }
        catch { }
        const realSkillFile = path.join(realSkillDir, 'SKILL.md');
        try {
            await fs.access(realSkillFile);
        }
        catch {
            continue;
        }
        try {
            const content = await fs.readFile(realSkillFile, 'utf-8');
            const metadata = parseYamlFrontmatter(content);
            const body = extractBodyContent(content);
            // Extract trigger patterns from body
            const triggers = [];
            const triggerMatch = body.match(/##\s*(?:Triggers?|사용\s*시점).*?\n(.*?)(?=\n##|\Z)/is);
            if (triggerMatch) {
                const triggerLines = triggerMatch[1].trim().split('\n');
                triggers.push(...triggerLines
                    .filter(line => line.trim().startsWith('-'))
                    .map(line => line.replace(/^-\s*/, '').trim())
                    .slice(0, 5) // Limit to 5 triggers
                );
            }
            const relativePath = scope === 'global'
                ? `~/.claude/skills/${entry.name}/SKILL.md`
                : path.relative(basePath, skillFile);
            const hasScripts = await fs.access(path.join(realSkillDir, 'scripts'))
                .then(() => true)
                .catch(() => false);
            const hasWebapp = await fs.access(path.join(realSkillDir, 'webapp'))
                .then(() => true)
                .catch(() => false);
            const skill = {
                id: `skill:${entry.name}`,
                type: 'skill',
                name: metadata.name || entry.name,
                description: metadata.description || '',
                triggers,
                filePath: relativePath,
                scope,
                hasScripts,
                hasWebapp
            };
            skills.push(skill);
        }
        catch (error) {
            console.warn(`Warning: Failed to parse ${realSkillFile}: ${error.message}`);
        }
    }
    return skills;
}
/**
 * Scan commands directory for slash command definitions
 */
async function scanCommands(claudePath, scope, basePath) {
    const commands = [];
    const commandsDir = path.join(claudePath, 'commands');
    try {
        await fs.access(commandsDir);
    }
    catch {
        return commands;
    }
    const commandFiles = await glob('*.md', { cwd: commandsDir });
    for (const file of commandFiles) {
        try {
            let filePath = path.join(commandsDir, file);
            // Resolve symlinks
            const realPath = await resolveSymlink(filePath);
            const content = await fs.readFile(realPath, 'utf-8');
            const metadata = parseYamlFrontmatter(content);
            const basename = path.parse(file).name;
            const relativePath = scope === 'global'
                ? `~/.claude/commands/${file}`
                : path.relative(basePath, filePath);
            const command = {
                id: `command:${basename}`,
                type: 'command',
                name: `/${basename}`,
                description: metadata.description || '',
                argumentHint: metadata['argument-hint'] || '',
                filePath: relativePath,
                scope,
            };
            commands.push(command);
        }
        catch (error) {
            console.warn(`Warning: Failed to parse ${file}: ${error.message}`);
        }
    }
    return commands;
}
/**
 * Find relationships between agents, skills, and commands
 */
async function findRelationships(agents, skills, commands, claudePath) {
    const edges = [];
    const addedEdges = new Set();
    function addEdge(source, target, type) {
        const edgeKey = `${source}->${target}`;
        if (!addedEdges.has(edgeKey)) {
            edges.push({ source, target, type });
            addedEdges.add(edgeKey);
        }
    }
    // Build lookup maps
    const agentMap = new Map();
    for (const agent of agents) {
        agentMap.set(agent.name.toLowerCase(), agent.id);
        agentMap.set(agent.id.replace('agent:', '').toLowerCase(), agent.id);
    }
    const skillMap = new Map();
    for (const skill of skills) {
        skillMap.set(skill.name.toLowerCase(), skill.id);
        skillMap.set(skill.id.replace('skill:', '').toLowerCase(), skill.id);
    }
    const commandMap = new Map();
    for (const command of commands) {
        commandMap.set(command.name.toLowerCase(), command.id);
        commandMap.set(command.id.replace('command:', '').toLowerCase(), command.id);
    }
    // Process agent relationships from YAML metadata
    for (const agent of agents) {
        // Agent -> Subagent relationships
        for (const subagentName of agent.subagents) {
            const subagentKey = subagentName.toLowerCase().trim();
            const subagentId = agentMap.get(subagentKey);
            if (subagentId) {
                addEdge(agent.id, subagentId, 'calls');
            }
        }
        // Agent -> Skill relationships
        for (const skillName of agent.skills) {
            const skillKey = skillName.toLowerCase().trim();
            const skillId = skillMap.get(skillKey);
            if (skillId) {
                addEdge(agent.id, skillId, 'uses');
            }
        }
    }
    // Check agent files for skill/command references (content-based)
    for (const agent of agents) {
        const agentFilePath = path.join(path.dirname(claudePath), agent.filePath);
        try {
            const content = (await fs.readFile(agentFilePath, 'utf-8')).toLowerCase();
            for (const skill of skills) {
                const skillName = skill.name.toLowerCase();
                const skillId = skill.id.replace('skill:', '');
                if (content.includes(skillName) || content.includes(skillId)) {
                    addEdge(agent.id, skill.id, 'uses');
                }
            }
            for (const command of commands) {
                const commandName = command.name.toLowerCase();
                const commandId = command.id.replace('command:', '');
                if (content.includes(commandName) || content.includes(commandId)) {
                    addEdge(agent.id, command.id, 'uses');
                }
            }
        }
        catch {
            // Skip if file can't be read
        }
    }
    return edges;
}
/**
 * Get global Claude directory path
 */
function getGlobalClaudePath() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.claude');
}
/**
 * Merge nodes, handling duplicates (local takes precedence)
 */
function mergeNodes(localNodes, globalNodes) {
    const localIds = new Set(localNodes.map(n => n.id));
    const uniqueGlobalNodes = globalNodes.filter(n => !localIds.has(n.id));
    return [...localNodes, ...uniqueGlobalNodes];
}
/**
 * Scan a Claude Code project and generate graph data
 */
export async function scanProject(projectPath, outputPath, options = {}) {
    const { includeLocal = true, includeGlobal = true } = options;
    const project = path.resolve(projectPath);
    const localClaudePath = path.join(project, '.claude');
    const globalClaudePath = getGlobalClaudePath();
    // Verify at least one .claude directory exists
    let hasLocal = false;
    let hasGlobal = false;
    try {
        await fs.access(localClaudePath);
        hasLocal = true;
    }
    catch { }
    try {
        await fs.access(globalClaudePath);
        hasGlobal = true;
    }
    catch { }
    if (includeLocal && !hasLocal && !includeGlobal) {
        throw new Error(`No .claude folder found in ${project}`);
    }
    if (includeGlobal && !hasGlobal && !includeLocal) {
        throw new Error(`No global .claude folder found at ${globalClaudePath}`);
    }
    if (!hasLocal && !hasGlobal) {
        throw new Error(`No .claude folder found (local: ${project}, global: ${globalClaudePath})`);
    }
    // Scan local components
    let localAgents = [];
    let localSkills = [];
    let localCommands = [];
    if (includeLocal && hasLocal) {
        localAgents = await scanAgents(localClaudePath, 'local', project);
        localSkills = await scanSkills(localClaudePath, 'local', project);
        localCommands = await scanCommands(localClaudePath, 'local', project);
    }
    // Scan global components
    let globalAgents = [];
    let globalSkills = [];
    let globalCommands = [];
    if (includeGlobal && hasGlobal) {
        globalAgents = await scanAgents(globalClaudePath, 'global', globalClaudePath);
        globalSkills = await scanSkills(globalClaudePath, 'global', globalClaudePath);
        globalCommands = await scanCommands(globalClaudePath, 'global', globalClaudePath);
    }
    // Merge nodes (local takes precedence for duplicates)
    const agents = mergeNodes(localAgents, globalAgents);
    const skills = mergeNodes(localSkills, globalSkills);
    const commands = mergeNodes(localCommands, globalCommands);
    // Find relationships
    const edges = await findRelationships(agents, skills, commands, localClaudePath);
    // Build result
    const result = {
        nodes: [...agents, ...skills, ...commands],
        edges,
        metadata: {
            generatedAt: new Date().toISOString(),
            projectPath: project,
            projectName: path.basename(project),
            agentCount: localAgents.length,
            skillCount: localSkills.length,
            commandCount: localCommands.length,
            edgeCount: edges.length,
            globalAgentCount: globalAgents.length,
            globalSkillCount: globalSkills.length,
            globalCommandCount: globalCommands.length
        }
    };
    // Write output
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    return result.metadata;
}
//# sourceMappingURL=scanner.js.map