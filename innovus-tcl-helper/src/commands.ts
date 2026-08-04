/**
 * Innovus command database - lightweight loading and lookup of command information
 *
 * Data directory layout:
 *   data/cmds/innovus/
 *   ├── 25.1/                    ← default version (Innovus 25.1)
 *   │   ├── cn/help/*.json       ← Chinese command documentation
 *   │   └── en/help/*.json       ← English command documentation
 *   ├── test/                    ← test version (empty data / highlighting off)
 *   │   ├── cn/help/             ← empty directory
 *   │   └── en/help/             ← empty directory
 *   └── {custom}/                ← custom tool (e.g. dc)
 *       ├── cn/help/*.json
 *       └── en/help/*.json
 *
 * Version selection:
 *   default/25.1 → data/cmds/innovus/25.1/{lang}/help/
 *   test         → data/cmds/innovus/test/{lang}/help/
 *   other        → data/cmds/innovus/{version}/{lang}/help/
 */

import * as fs from 'fs';
import * as path from 'path';
import { t } from './i18n';

/** Supported documentation languages */
export type Language = 'zh' | 'en';

/** Command option/argument */
export interface CmdOption {
    name: string;
    description: string;
    required: boolean;
    type: string;          // "string" | "flag" | "enum" | "point" | "int" | "float"
}

/** Command information */
export interface CmdInfo {
    command: string;
    is_cmd: boolean;
    summary: string;
    description: string;
    usage: string;
    options: CmdOption[];
}

/** Command database */
class CommandDB {
    private commands: Map<string, CmdInfo> = new Map();
    private loaded: boolean = false;
    private dataRoot: string;        // the data/cmds/innovus/ directory
    private language: Language = 'en';
    private version: string = '';    // version identifier, e.g. "25.1", "test", "dc"

    constructor(extensionPath: string) {
        // Always use the data/cmds/innovus/ directory bundled with the extension
        this.dataRoot = path.join(extensionPath, 'data', 'cmds', 'innovus');
    }

    /** Set the documentation language */
    setLanguage(lang: Language): void {
        if (this.language !== lang) {
            this.language = lang;
            this.reload();
        }
    }

    /** Get the current documentation language */
    getLanguage(): Language { return this.language; }

    /** Set the version */
    setVersion(ver: string): void {
        if (this.version !== ver) {
            this.version = ver;
            this.reload();
        }
    }

    /** Get the current version */
    getVersion(): string { return this.version; }

    /** Scan data/innovus/ for all available versions */
    getAvailableVersions(): { label: string; description: string }[] {
        if (!fs.existsSync(this.dataRoot)) { return []; }

        const versions: { label: string; description: string }[] = [];
        try {
            const entries = fs.readdirSync(this.dataRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) { continue; }
                const verName = entry.name;
                // Check whether this version has a data directory
                const cnHelp = path.join(this.dataRoot, verName, 'cn', 'help');
                const enHelp = path.join(this.dataRoot, verName, 'en', 'help');
                if (fs.existsSync(cnHelp) || fs.existsSync(enHelp)) {
                    const fileCount = this.countFiles(cnHelp) + this.countFiles(enHelp);
                    if (verName === '25.1') {
                        versions.push({ label: '25.1', description: t('version.innovus', fileCount) });
                    } else if (verName === 'test') {
                        versions.push({ label: 'test', description: t('version.test') });
                    } else {
                        versions.push({ label: verName, description: t('version.custom', verName, fileCount) });
                    }
                }
            }
        } catch { /* ignore */ }

        // Make sure 25.1 comes first
        return versions.sort((a, b) => {
            if (a.label === '25.1') { return -1; }
            if (b.label === '25.1') { return 1; }
            return a.label.localeCompare(b.label);
        });
    }

    private countFiles(dir: string): number {
        if (!fs.existsSync(dir)) { return 0; }
        try {
            return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
        } catch { return 0; }
    }

    /** Get the database statistics */
    getStats(): { totalEntries: number; commands: number; variables: number; version: string; language: string } {
        this.load();
        let cmdCount = 0;
        let varCount = 0;
        for (const info of this.commands.values()) {
            if (info.is_cmd !== false) { cmdCount++; }
            else { varCount++; }
        }
        return {
            totalEntries: this.commands.size,
            commands: cmdCount,
            variables: varCount,
            version: this.version || '25.1',
            language: this.language
        };
    }

    /** Get the directory holding the data files.
     *  Layout: data/cmds/innovus/{version}/{langDir}/help/
     *  langDir: zh → cn, en → en
     */
    private getDataSourceDir(): string {
        const ver = this.version || '25.1';
        const langDir = this.language === 'zh' ? 'cn' : 'en';
        return path.join(this.dataRoot, ver, langDir, 'help');
    }

    /** Load the command data — prefers the single-file .db.json */
    load(): void {
        if (this.loaded) { return; }

        try {
            const dataDir = this.getDataSourceDir();
            const parentDir = path.dirname(dataDir);
            const dbFile = path.join(parentDir, 'help.db.json');

            // 1. Try the single-file DB
            if (fs.existsSync(dbFile)) {
                const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
                const cmds = db.commands || {};
                for (const [name, info] of Object.entries(cmds)) {
                    this.commands.set(name, info as CmdInfo);
                }
                this.loaded = true;
                console.log(`[Innovus TCL] Loaded ${this.commands.size} commands (version: ${this.version || '25.1'}, language: ${this.language}, DB mode)`);
                return;
            }

            // 2. Fall back to the individual .json files
            if (!fs.existsSync(dataDir)) {
                console.warn(`[Innovus TCL] Data directory not found: ${dataDir}`);
                this.loaded = true;
                return;
            }

            const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const filePath = path.join(dataDir, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const info: CmdInfo = JSON.parse(content);
                    if (info.command) {
                        this.commands.set(info.command, info);
                    }
                } catch {
                    // Skip files that fail to parse
                }
            }
            this.loaded = true;
            console.log(`[Innovus TCL] Loaded ${this.commands.size} commands (version: ${this.version || '25.1'}, language: ${this.language})`);
        } catch (err) {
            console.error(`[Innovus TCL] Failed to load command data: ${err}`);
            this.loaded = true;
        }
    }

    /** Reload */
    reload(): void {
        this.commands.clear();
        this.loaded = false;
        this.load();
    }

    /** Get the information for a command */
    get(name: string): CmdInfo | undefined {
        this.load();
        return this.commands.get(name);
    }

    /** Get every command name */
    getCommandNames(): string[] {
        this.load();
        return Array.from(this.commands.keys());
    }

    /** Fuzzy search for commands */
    search(prefix: string, limit: number = 50): CmdInfo[] {
        this.load();
        const results: CmdInfo[] = [];
        const lower = prefix.toLowerCase();
        for (const [name, info] of this.commands) {
            if (name.toLowerCase().startsWith(lower)) {
                results.push(info);
                if (results.length >= limit) { break; }
            }
        }
        return results;
    }

    /** Check whether this is a known command */
    isCommand(name: string): boolean {
        this.load();
        const info = this.commands.get(name);
        return info !== undefined && info.is_cmd === true;
    }

    /** Check whether this is a mode/variable setting (not a command) */
    isModeVariable(name: string): boolean {
        this.load();
        const info = this.commands.get(name);
        return info !== undefined && info.is_cmd === false;
    }

    /** Check whether this is a known entry (command or variable) */
    isKnown(name: string): boolean {
        this.load();
        return this.commands.has(name);
    }
}

/** Global singleton */
let dbInstance: CommandDB | null = null;

export function getDB(extensionPath?: string): CommandDB {
    if (!dbInstance && extensionPath) {
        dbInstance = new CommandDB(extensionPath);
    }
    if (!dbInstance) {
        dbInstance = new CommandDB('');
    }
    return dbInstance;
}
