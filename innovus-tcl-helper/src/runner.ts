/**
 * TCL Script Runner — a tclsh-based TCL execution engine
 *
 * Core features:
 *   1. Executes standard TCL code through tclsh (tclsh9.0 is bundled, no user install needed)
 *   2. Automatically intercepts Innovus-only commands and prints their documentation
 *      instead of executing them
 *   3. Supports single-file runs and .f file project runs
 *   4. Supports a custom tclsh path (innovus-tcl.tclshPath)
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDB, CmdInfo } from './commands';
import { tokenize, TokenType } from './tcl-ast';
import { TclCompiler } from './compiler';
import { t } from './i18n';

// ════════════════════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════════════════════

export interface RunResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    innovusCommands: string[];
    duration: number;
    /** Output file path (when saving is configured) */
    outputFile?: string;
}

export interface ProjectRunResult {
    success: boolean;
    results: Array<{
        filePath: string;
        success: boolean;
        stdout: string;
        stderr: string;
        innovusCommands: string[];
        duration: number;
        outputFile?: string;
    }>;
    totalDuration: number;
    fileCount: number;
    errorCount: number;
}

/** Configuration for saving run output */
export interface RunOutputConfig {
    /** Whether to save the output to a file */
    enabled: boolean;
    /** Output directory (absolute path, created automatically when missing) */
    dir: string;
}

// ════════════════════════════════════════════════════════════
//  Constants
// ════════════════════════════════════════════════════════════

const RUN_TIMEOUT = 30000;

// ════════════════════════════════════════════════════════════
//  Platform detection
// ════════════════════════════════════════════════════════════

/** Get the current platform triplet, e.g. darwin-arm64, linux-x64, win32-x64 */
function getPlatformTriplet(): string {
    const plat = os.platform();    // 'darwin' | 'linux' | 'win32'
    const arch = os.arch();        // 'arm64' | 'x64' | 'ia32'
    // Normalized: macOS always uses darwin
    return `${plat}-${arch}`;
}

/** The tclsh binary name for each platform */
function getTclshBinaryName(): string {
    return os.platform() === 'win32' ? 'tclsh9.0.exe' : 'tclsh9.0';
}

/** Candidate system tclsh paths per platform */
const SYSTEM_TCLSH_CANDIDATES: Record<string, string[]> = {
    'darwin-arm64': ['/opt/homebrew/bin/tclsh9.0', '/usr/local/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh', 'tclsh9.0'],
    'darwin-x64': ['/usr/local/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh', 'tclsh9.0'],
    'linux-x64': ['/usr/bin/tclsh9.0', '/usr/bin/tclsh', '/usr/local/bin/tclsh9.0', 'tclsh', 'tclsh9.0'],
    'linux-arm64': ['/usr/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh', 'tclsh9.0'],
    'win32-x64': ['tclsh9.0.exe', 'tclsh.exe'],
    'win32-ia32': ['tclsh9.0.exe', 'tclsh.exe'],
};

/** Platform-specific installation guidance shown when tclsh is not found */
export function getTclshInstallGuide(): string {
    const plat = os.platform();
    if (plat === 'darwin') { return t('tclsh.guideMac'); }
    if (plat === 'win32') { return t('tclsh.guideWindows'); }
    return t('tclsh.guideLinux');
}

export class TclRunner {
    private tclshPathCache: string | null = null;
    /** Simulation data language: 'zh' prefers the Chinese procs, 'en' prefers the English procs */
    public language: 'zh' | 'en' = 'en';

    /** Find tclsh: bundled (platform subdirectory) > user configuration > system search */
    findTclsh(extensionPath: string, configTclshPath?: string): string | null {
        if (this.tclshPathCache && fs.existsSync(this.tclshPathCache)) {
            return this.tclshPathCache;
        }
        this.tclshPathCache = null;

        const triplet = getPlatformTriplet();
        const binName = getTclshBinaryName();

        // 1. tclsh9.0 bundled with the extension (bin/<platform>/tclsh9.0)
        const bundled = path.join(extensionPath, 'bin', triplet, binName);
        if (fs.existsSync(bundled)) {
            const v = this.verifyTclsh(bundled);
            if (v) { this.tclshPathCache = v; return v; }
        }

        // 2. User configuration
        if (configTclshPath && fs.existsSync(configTclshPath)) {
            const v = this.verifyTclsh(configTclshPath);
            if (v) { this.tclshPathCache = v; return v; }
        }

        // 3. System search (candidate paths per platform)
        const candidates = SYSTEM_TCLSH_CANDIDATES[triplet] ||
            ['tclsh', 'tclsh9.0', 'tclsh9.0.exe'];
        for (const c of candidates) {
            const v = this.verifyTclsh(c);
            if (v) { this.tclshPathCache = v; return v; }
        }

        return null;
    }

    private verifyTclsh(p: string): string | null {
        try {
            const r = cp.spawnSync(p, [], {
                input: 'puts [info patchlevel]', timeout: 3000, stdio: 'pipe'
            });
            const ver = r.stdout.toString().trim();
            if (ver && /^\d+\.\d+/.test(ver)) { return p; }
        } catch { /* ignore */ }
        return null;
    }

    /** Run a single TCL script */
    async runScript(
        content: string, workDir: string, extensionPath: string,
        configTclshPath?: string, outputConfig?: RunOutputConfig,
        simOutputMode: 'dry-run' | 'mkdir' = 'dry-run'
    ): Promise<RunResult> {
        const t0 = Date.now();
        const tclsh = this.findTclsh(extensionPath, configTclshPath);
        if (!tclsh) {
            return { success: false, stdout: '', stderr: t('tclsh.notFoundShort'), exitCode: -1, innovusCommands: [], duration: 0 };
        }

        const cmds = this.detectInnovusCommands(content, extensionPath);
        const preamble = this.generatePreamble(cmds, extensionPath);
        const script = preamble + '\n' + this.buildCompatLayer(simOutputMode) + '\n' + content;

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-run-'));
        const tmpFile = path.join(tmpDir, 'run.tcl');
        try {
            fs.writeFileSync(tmpFile, script, 'utf-8');
            const r = await this.executeTclsh(tclsh, tmpFile, workDir);
            const result: RunResult = {
                ...r, innovusCommands: cmds.map(c => c.command), duration: Date.now() - t0
            };

            // Save the output to a file
            if (outputConfig?.enabled && outputConfig.dir) {
                result.outputFile = this.saveOutputFile(
                    outputConfig.dir, 'run',
                    r.stdout, r.stderr, result.innovusCommands
                );
            }

            return result;
        } catch (e: any) {
            return { success: false, stdout: '', stderr: t('run.genericException', e.message), exitCode: -1, innovusCommands: cmds.map(c => c.command), duration: Date.now() - t0 };
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }

    /**
     * Run the whole project in .f file order (source + catch guarantee:
     * stop on the first error, track the status of every file).
     */
    async runProject(
        fFilePath: string, workspaceRoot: string, extensionPath: string,
        configTclshPath?: string, outputConfig?: RunOutputConfig,
        simOutputMode: 'dry-run' | 'mkdir' = 'dry-run'
    ): Promise<ProjectRunResult> {
        const t0 = Date.now();
        const tclsh = this.findTclsh(extensionPath, configTclshPath);
        if (!tclsh) {
            return { success: false, results: [], totalDuration: Date.now() - t0, fileCount: 0, errorCount: 1 };
        }

        const compiler = new TclCompiler();
        const fRel = path.relative(workspaceRoot, fFilePath);
        const cr = compiler.compile(workspaceRoot, fRel);
        if (cr.units.length === 0) {
            return { success: false, results: [], totalDuration: Date.now() - t0, fileCount: 0, errorCount: 1 };
        }

        // Pre-scan every Innovus command
        const allCmds = new Set<string>();
        const fileMetas: Array<{ relPath: string; absPath: string; cmds: string[] }> = [];
        for (const u of cr.units) {
            try {
                const c = fs.readFileSync(u.filePath, 'utf-8');
                const fcmds = this.detectInnovusCommands(c, extensionPath).map(cmd => cmd.command);
                fileMetas.push({ relPath: u.relativePath, absPath: u.filePath, cmds: fcmds });
                for (const cmd of fcmds) { allCmds.add(cmd); }
            } catch {
                fileMetas.push({ relPath: u.relativePath, absPath: u.filePath, cmds: [] });
            }
        }

        const db = getDB(extensionPath);
        const cmdList: CmdInfo[] = [];
        for (const n of allCmds) { const info = db.get(n); if (info) { cmdList.push(info); } }
        const preamble = this.generatePreamble(cmdList, extensionPath);

        // Build the script: wrap each file in catch {source} and stop on the first error
        let combinedScript = preamble + '\n' + this.buildCompatLayer(simOutputMode);
        combinedScript += '\n# ===== Execute the TCL files in order =====\n';
        combinedScript += 'set _project_ok 1\n';
        for (const fm of fileMetas) {
            const escapedPath = fm.absPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            combinedScript += `\nputs "_FILE_BEGIN_ ${fm.relPath}"\n`;
            // Visible separator (never filtered out)
            combinedScript += `puts "\\n─── 📄 ${fm.relPath} ───\\n"\n`;
            combinedScript += `if {[catch {source "${escapedPath}"} _err]} {\n`;
            combinedScript += `    puts "_FILE_ERROR_ ${fm.relPath}"\n`;
            combinedScript += `    puts "_ERROR_MSG_ $_err"\n`;
            combinedScript += `    puts "_ERROR_INFO_ $::errorInfo"\n`;
            combinedScript += `    set _project_ok 0\n`;
            combinedScript += `    exit 1\n`;
            combinedScript += `}\n`;
            combinedScript += `puts "_FILE_END_ ${fm.relPath}"\n`;
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-proj-'));
        const tmpFile = path.join(tmpDir, 'combined.tcl');
        try {
            fs.writeFileSync(tmpFile, combinedScript, 'utf-8');
            const workDir = fileMetas.length > 0
                ? path.dirname(fileMetas[0].absPath)
                : workspaceRoot;
            const execResult = await this.executeTclsh(tclsh, tmpFile, workDir);

            // Parse the markers and determine the status of every file
            const results: ProjectRunResult['results'] = [];
            const allOutput = execResult.stdout;
            let errors = 0;
            for (const fm of fileMetas) {
                const okMarker = `_FILE_END_ ${fm.relPath}`;
                const errMarker = `_FILE_ERROR_ ${fm.relPath}`;
                if (allOutput.includes(okMarker)) {
                    results.push({ filePath: fm.relPath, success: true, stdout: allOutput, stderr: '', innovusCommands: fm.cmds, duration: 0 });
                } else if (allOutput.includes(errMarker)) {
                    // Merge stdout + stderr into the full error message
                    const errIdx = allOutput.indexOf(errMarker);
                    const errInfoIdx = allOutput.indexOf('_ERROR_INFO_', errIdx);
                    const errMsgIdx = allOutput.indexOf('_ERROR_MSG_', errIdx);
                    const parts: string[] = [];

                    // 1. Short error message
                    if (errMsgIdx >= 0) {
                        const msgEnd = allOutput.indexOf('\n', errMsgIdx);
                        const msg = allOutput.substring(errMsgIdx + '_ERROR_MSG_ '.length, msgEnd >= 0 ? msgEnd : allOutput.length).trim();
                        if (msg) { parts.push(t('run.error', msg)); }
                    }

                    // 2. Stack trace (with proc names and line numbers)
                    if (errInfoIdx >= 0) {
                        const infoStart = errInfoIdx + '_ERROR_INFO_ '.length;
                        const nextMarker = allOutput.indexOf('_FILE_', infoStart);
                        const infoEnd = nextMarker >= 0 ? nextMarker : allOutput.length;
                        const info = allOutput.substring(infoStart, infoEnd).trim();
                        if (info) { parts.push(info); }
                    }

                    // 3. stderr (this is where tclsh compilation errors show up)
                    const stderrText = execResult.stderr.trim();
                    if (stderrText && !parts.some(p => p.includes(stderrText.substring(0, 30)))) {
                        parts.push(`[stderr] ${stderrText}`);
                    }

                    // 4. The offending file
                    parts.push(t('common.file') + `: ${fm.relPath}`);
                    parts.push(t('run.pathLabel', fm.absPath));

                    const errMsg = parts.join('\n');
                    results.push({ filePath: fm.relPath, success: false, stdout: allOutput, stderr: errMsg, innovusCommands: fm.cmds, duration: 0 });
                    errors++;
                    break;
                } else {
                    // Never reached (an earlier file failed)
                    results.push({ filePath: fm.relPath, success: false, stdout: '', stderr: skippedMessage(), innovusCommands: fm.cmds, duration: 0 });
                    errors++;
                }
            }

            // If some files ran without errors, fill in the remaining files that never ran
            for (let i = results.length; i < fileMetas.length; i++) {
                const fm = fileMetas[i];
                results.push({ filePath: fm.relPath, success: false, stdout: '', stderr: skippedMessage(), innovusCommands: fm.cmds, duration: 0 });
                errors++;
            }

            // Save the output to a file
            let outputFile: string | undefined;
            if (outputConfig?.enabled && outputConfig.dir) {
                outputFile = this.saveOutputFile(
                    outputConfig.dir, 'project_run',
                    execResult.stdout, execResult.stderr,
                    [...allCmds]
                );
            }

            return {
                success: errors === 0, results,
                totalDuration: Date.now() - t0, fileCount: fileMetas.length,
                errorCount: errors
            };
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }

    private detectInnovusCommands(content: string, extensionPath: string): CmdInfo[] {
        const db = getDB(extensionPath);
        const tokens = tokenize(content);
        const found = new Set<string>();
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === TokenType.COMMAND) {
                const info = db.get(tokens[i].value);
                if (info) { found.add(tokens[i].value); }
            }
        }
        const r: CmdInfo[] = [];
        for (const n of found) { const info = db.get(n); if (info) { r.push(info); } }
        return r;
    }

    /**
     * Save the run output to a file.
     * @returns the absolute path of the output file
     */
    private saveOutputFile(
        outDir: string, baseName: string,
        stdout: string, stderr: string, innovusCmds: string[]
    ): string {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${baseName}_${ts}.log`;
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const filePath = path.join(outDir, filename);
        let content = '';
        content += `# Innovus TCL Run Log\n`;
        content += `# Time: ${new Date().toISOString()}\n`;
        content += `# Innovus Commands: ${innovusCmds.join(', ') || '(none)'}\n`;
        content += `# ========================================\n\n`;
        if (stdout.trim()) {
            content += `── STDOUT ──\n${stdout}\n`;
        }
        if (stderr.trim()) {
            content += `── STDERR ──\n${stderr}\n`;
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(t('run.outputSaved', filePath));
        return filePath;
    }

    /** The set of TCL built-ins — wrapping these in a proc would break the execution flow */
    private static readonly TCL_BUILTINS = new Set([
        'source',   // native TCL file loading; overriding it stops .tcl files from loading
    ]);

    /**
     * Generate the proc wrappers for Innovus commands.
     * Prefers AI-generated simulation data, otherwise prints the command documentation.
     */
    private generatePreamble(cmds: CmdInfo[], extensionPath: string): string {
        if (cmds.length === 0) { return ''; }

        let preamble = '';
        preamble += '# ===== Innovus Command Wrappers (Auto-generated) =====\n\n';

        for (const cmd of cmds) {
            const cmdName = cmd.command;

            // Skip TCL built-ins to preserve their native behaviour
            if (TclRunner.TCL_BUILTINS.has(cmdName)) {
                continue;
            }

            // 1. Try to load the AI simulation data
            const simCode = this.loadSimulation(cmdName, extensionPath);
            if (simCode) {
                preamble += simCode + '\n';
                continue;
            }

            // 2. No simulation data: generate a documentation-printing wrapper
            const summary = cmd.summary || '';
            preamble += `# ${summary}\n`;
            preamble += `proc ${cmdName} {args} {\n`;
            preamble += `    puts "\\n═══════════════════════════════════════"\n`;
            preamble += `    puts "\\[Innovus\\] ${cmdName}"\n`;
            preamble += `    puts "═══════════════════════════════════════"\n`;
            preamble += `    puts "  ${summary}"\n    puts ""\n`;
            preamble += `    puts "  ${t('sim.arguments')}: $args"\n`;

            if (cmd.options && cmd.options.length > 0) {
                const req = cmd.options.filter(o => o.required);
                const opt = cmd.options.filter(o => !o.required);
                if (req.length > 0) {
                    preamble += `    puts "  ${t('sim.requiredOptions')}"\n`;
                    for (const o of req) {
                        preamble += `    puts "    ${o.name}  ${o.description.replace(/"/g, '\\"')}"\n`;
                    }
                }
                if (opt.length > 0) {
                    preamble += `    puts "  ${t('sim.optionalOptions', opt.length)}"\n`;
                    for (const o of opt.slice(0, 10)) {
                        const desc = (o.description || '').replace(/"/g, '\\"');
                        preamble += `    puts "    ${o.name}  ${desc}"\n`;
                    }
                    if (opt.length > 10) {
                        preamble += `    puts "    ${t('sim.moreOptions', opt.length - 10)}"\n`;
                    }
                }
            }
            preamble += `    puts ""\n    return ""\n}\n\n`;
        }

        return preamble;
    }

    /** Simulation DB cache: lang → (cmdName → procCode) */
    private simDbCache: Map<string, Map<string, string>> = new Map();

    /**
     * Load the AI pre-generated simulation data.
     * Prefers the single .db.tcl file (fewer file system round trips) and falls back
     * to the individual .tcl files.
     * Loading order follows the language: zh prefers cn → en, en prefers en → cn.
     */
    private loadSimulation(cmdName: string, extensionPath: string): string | null {
        const languages = this.language === 'zh' ? ['cn', 'en'] : ['en', 'cn'];
        for (const lang of languages) {
            // 1. Try the single-file DB
            const dbFile = path.join(extensionPath, 'data', 'simulations', `${lang}.db.tcl`);
            if (fs.existsSync(dbFile)) {
                const entry = this.loadFromDb(dbFile, lang, cmdName);
                if (entry) { return entry; }
                continue; // The DB exists but has no entry for this command, try the next language
            }
            // 2. Fall back to the individual .tcl file
            const simFile = path.join(extensionPath, 'data', 'simulations', lang, `${cmdName}.tcl`);
            if (fs.existsSync(simFile)) {
                try {
                    const tcl = fs.readFileSync(simFile, 'utf-8').trim();
                    if (tcl.includes('proc ') && this.bracesMatch(tcl)) {
                        return tcl;
                    }
                } catch { /* ignore */ }
            }
        }
        return null;
    }

    /** Extract a proc on demand from the single-file DB */
    private loadFromDb(dbFile: string, lang: string, cmdName: string): string | null {
        if (!this.simDbCache.has(lang)) {
            // First load: parse the whole DB file
            try {
                const content = fs.readFileSync(dbFile, 'utf-8');
                const map = new Map<string, string>();
                const re = /# === BEGIN (\S+) ===\n([\s\S]*?)\n# === END \1 ===/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(content)) !== null) {
                    const code = m[2].trim();
                    if (code.includes('proc ') && this.bracesMatch(code)) {
                        map.set(m[1], code);
                    }
                }
                this.simDbCache.set(lang, map);
            } catch {
                return null;
            }
        }
        return this.simDbCache.get(lang)?.get(cmdName) || null;
    }

    /** Check whether the braces in the TCL code are balanced */
    private bracesMatch(tcl: string): boolean {
        const openB = (tcl.match(/\{/g) || []).length;
        const closeB = (tcl.match(/\}/g) || []).length;
        return openB === closeB;
    }

    /**
     * Build the TCL compatibility layer: echo + file helper procs + an enhanced unknown handler
     */
    private buildCompatLayer(simOutputMode: 'dry-run' | 'mkdir'): string {
        let code = '\n# ===== TCL compatibility layer =====\n';
        code += 'if {[info commands echo] eq ""} { proc echo {args} { puts [join $args " "] } }\n';

        // File operation helpers
        code += '\n# ===== File operation helpers =====\n';
        code += `set ::_sim_file_mode "${simOutputMode}"\n`;
        code += 'proc _check_input_file {filepath} {\n';
        code += '    if {[file exists $filepath]} {\n';
        code += `        puts "   📂 ${t('sim.inputFile')}: $filepath"\n`;
        code += '    } else {\n';
        code += `        puts "   ⚠ ${t('sim.inputFileMissing')}: $filepath"\n`;
        code += '    }\n';
        code += '}\n';
        code += 'proc _handle_output_file {filepath} {\n';
        code += '    if {$::_sim_file_mode eq "mkdir"} {\n';
        code += '        set dir [file dirname $filepath]\n';
        code += '        if {![file exists $dir]} {\n';
        code += '            file mkdir $dir\n';
        code += `            puts "   📁 ${t('sim.createdDir')}: $dir"\n`;
        code += '        }\n';
        code += '        if {![file exists $filepath]} {\n';
        code += '            set f [open $filepath w]\n';
        code += '            puts $f "# Innovus TCL Simulator Output"\n';
        code += '            close $f\n';
        code += '        }\n';
        code += `        puts "   📄 ${t('sim.generatedFile')}: $filepath"\n`;
        code += '    } else {\n';
        code += `        puts "   📄 \\[dry-run\\] ${t('sim.wouldGenerateFile')}: $filepath"\n`;
        code += '    }\n';
        code += '}\n';

        // Unknown command handling + -file argument detection
        code += '\n# Fallback: unregistered commands + file detection\n';
        code += 'rename unknown _tcl_unknown\n';
        // The set of TCL built-ins (used by the unknown handler)
        code += 'set ::_tcl_builtins {set puts proc if while for foreach switch return break continue catch error eval expr source incr append lappend llength lindex lrange lsort split join regexp regsub string scan format open close gets read file glob cd pwd exit rename info array dict upvar uplevel namespace variable global after vwait update clock encoding fconfigure socket package require apply coroutine tailcall try throw}\n';
        code += 'proc unknown {args} {\n';
        code += '    set _cmd [lindex $args 0]\n';
        code += '    set _is_tcl [lsearch -exact $::_tcl_builtins $_cmd]\n';
        code += '    if {$_is_tcl >= 0} {\n';
        code += '        # A TCL built-in, run the native behaviour\n';
        code += '        return [uplevel ::_tcl_unknown {*}$args]\n';
        code += '    }\n';
        code += '    puts "\\[⚠ Unknown\\] $_cmd: [lrange $args 1 end]"\n';
        code += '    set _rest [lrange $args 1 end]\n';
        code += '    # Determine the command kind: input command vs output command\n';
        code += '    set _is_input [regexp {^(read_|load_|source$|defIn$|init_)} $_cmd]\n';
        code += '    set _is_output [regexp {^(report_|write_|save_|defOut$)} $_cmd]\n';
        code += '    for {set _i 0} {$_i < [llength $_rest]} {incr _i} {\n';
        code += '        set _arg [lindex $_rest $_i]\n';
        code += '        if {$_arg eq "-file" || $_arg eq "-outDir"} {\n';
        code += '            incr _i\n';
        code += '            if {$_i < [llength $_rest]} {\n';
        code += '                set _fp [lindex $_rest $_i]\n';
        code += '                if {$_is_input} {\n';
        code += '                    _check_input_file $_fp\n';
        code += '                } else {\n';
        code += '                    _handle_output_file $_fp\n';
        code += '                }\n';
        code += '            }\n';
        code += '        }\n';
        code += '    }\n';
        code += '    return ""\n';
        code += '}\n';

        return code;
    }

    private executeTclsh(
        tclshPath: string, scriptFile: string, workDir: string
    ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
        return new Promise((resolve) => {
            const proc = cp.spawn(tclshPath, [scriptFile], {
                cwd: workDir, timeout: RUN_TIMEOUT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env }
            });
            let stdout = '', stderr = '';
            let settled = false;
            const done = (ok: boolean, code: number) => {
                if (settled) { return; }
                settled = true;
                resolve({ success: ok, stdout, stderr, exitCode: code });
            };
            proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
            proc.on('close', (code: number | null) => { done(code === 0 && !stderr.trim(), code ?? -1); });
            proc.on('error', (e: Error) => { stderr += t('run.processError', e.message); done(false, -1); });
            setTimeout(() => { if (!settled) { proc.kill(); stderr += t('run.timeout'); done(false, -1); } }, RUN_TIMEOUT);
        });
    }
}

/**
 * stderr message used for files that were never reached because an earlier file failed.
 * extension.ts compares against this exact string to render the ⏭ status, so both sides
 * must resolve it through the same helper.
 */
export function skippedMessage(): string {
    return t('run.skipped');
}

// ════════════════════════════════════════════════════════════
//  Singleton
// ════════════════════════════════════════════════════════════

let runnerInstance: TclRunner | null = null;

export function getRunner(): TclRunner {
    if (!runnerInstance) { runnerInstance = new TclRunner(); }
    return runnerInstance;
}
