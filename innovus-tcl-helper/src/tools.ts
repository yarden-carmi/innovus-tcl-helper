/**
 * Copilot AI integration — Language Model Tools
 *
 * Architecture:
 *   An LM tool does not "call the AI", it is "called by the AI".
 *   Copilot's model invokes these tools automatically when it needs Innovus
 *   domain knowledge. The tools return raw data (script content + full command
 *   documentation) and the model reasons over that context.
 *
 * Five tools are registered:
 *   1. innovus_list_commands       — list/search the Innovus TCL commands
 *   2. innovus_get_command_help    — get the full documentation of one command
 *   3. innovus_parse_tcl_script    — parse a TCL script and return the
 *                                    [script + command docs + parameter mapping] context
 *   4. innovus_lint_tcl            — quick lint summary
 *   5. innovus_lint_tcl_detailed   — detailed lint report
 *
 * Design goal: help Copilot write low-hallucination Innovus TCL code.
 *   The tools supply the facts (command documentation), the model does the
 *   reasoning (analysis, summary, suggestions).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDB, CmdInfo } from './commands';
import { TclCompiler } from './compiler';
import { t } from './i18n';

// ════════════════════════════════════════════════════════════════
//  Shared helpers
// ════════════════════════════════════════════════════════════════

/** Levenshtein edit distance */
function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0) { return n; }
    if (n === 0) { return m; }
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            curr[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

/** Extract the -flag options and their values from a line of text */
function extractParamsFromLine(line: string): Map<string, string | null> {
    const params = new Map<string, string | null>();
    const tokens = line.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.startsWith('-')) {
            const flag = token.replace(/[,;]$/, '');
            if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
                let val = tokens[i + 1].replace(/[,;]$/, '');
                val = val.replace(/^\{/, '').replace(/\}$/, '');
                params.set(flag, val);
                i++;
            } else {
                params.set(flag, null);
            }
        }
    }
    return params;
}

// ════════════════════════════════════════════════════════════════
//  Tool 1: innovus_list_commands — list/search the Innovus commands
// ════════════════════════════════════════════════════════════════

class ListCommandsTool implements vscode.LanguageModelTool<{
    search?: string;
    limit?: number;
}> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
            search?: string;
            limit?: number;
        }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const db = getDB();
        const input = options.input;
        const search = input.search?.toLowerCase() || '';
        const limit = Math.min(input.limit || 50, 200);

        let commands: string[];
        if (search) {
            const allNames = db.getCommandNames();
            commands = [];
            for (const name of allNames) {
                if (name.toLowerCase().includes(search)) {
                    commands.push(name);
                    if (commands.length >= limit) { break; }
                }
            }
        } else {
            commands = db.getCommandNames().slice(0, limit);
        }

        const total = db.getCommandNames().length;

        let resultText = `Innovus TCL Command List (${total} total`;
        if (search) {
            resultText += `, search "${search}", ${commands.length} matched`;
        } else {
            resultText += `, showing first ${commands.length}`;
        }
        resultText += '):\n\n';

        for (const cmdName of commands) {
            const info = db.get(cmdName);
            if (info) {
                const summary = info.summary ? ` — ${info.summary}` : '';
                const typeTag = info.is_cmd !== false ? '[Cmd]' : '[Var/Mode]';
                resultText += `- \`${cmdName}\` ${typeTag}${summary}\n`;
            } else {
                resultText += `- \`${cmdName}\`\n`;
            }
        }

        if (commands.length < total && !search) {
            resultText += `\n... ${total - commands.length} more commands. Use search parameter.`;
        }

        resultText += '\n💡 Use innovus_get_command_help for full syntax and parameter docs.';

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(resultText)
        ]);
    }
}

// ════════════════════════════════════════════════════════════════
//  Tool 2: innovus_get_command_help — get the full command documentation
// ════════════════════════════════════════════════════════════════

class GetCommandHelpTool implements vscode.LanguageModelTool<{
    command: string;
}> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
            command: string;
        }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const db = getDB();
        const cmdName = options.input.command?.trim();
        if (!cmdName) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Error: Please provide a command name.')
            ]);
        }

        const info = db.get(cmdName);
        if (!info) {
            const suggestions = this.findSimilar(cmdName, db.getCommandNames());
            let msg = `Command "${cmdName}" not found.`;
            if (suggestions.length > 0) {
                msg += '\n\nDid you mean:\n';
                msg += suggestions.map(s => `- \`${s}\``).join('\n');
            }
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(msg)
            ]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(this.formatCommandDoc(info))
        ]);
    }

    /** Format the full command documentation as structured text for the model */
    private formatCommandDoc(info: CmdInfo): string {
        let doc = '';

        const typeLabel = info.is_cmd !== false ? 'Command' : 'Mode/Variable Setting';
        doc += `## \`${info.command}\` [${typeLabel}]\n\n`;

        if (info.summary) {
            doc += `**Summary:** ${info.summary}\n\n`;
        }
        if (info.usage) {
            doc += `**Syntax:**\n\`\`\`tcl\n${info.usage}\n\`\`\`\n\n`;
        }
        if (info.description && info.description !== info.summary) {
            doc += `**Description:**\n${info.description}\n\n`;
        }
        if (info.options && info.options.length > 0) {
            doc += `**Options (${info.options.length}):**\n\n`;
            doc += '| Option | Type | Required | Description |\n|--------|------|----------|-------------|\n';
            for (const opt of info.options) {
                const reqMark = opt.required ? '✅ Required' : 'Optional';
                const desc = opt.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
                doc += `| \`${opt.name}\` | \`${opt.type}\` | ${reqMark} | ${desc} |\n`;
            }
            doc += '\n';
        }

        doc += '---\n';
        doc += '**Type Guide:** `flag`=no value, `string`=string, `int`=integer, `float`=float, `enum`=preset choices, `point`=coordinates (e.g. {x y}).\n';
        return doc;
    }

    private findSimilar(target: string, candidates: string[]): string[] {
        const lower = target.toLowerCase();
        const scored: { name: string; score: number }[] = [];
        for (const name of candidates) {
            if (name.toLowerCase().startsWith(lower)) {
                scored.push({ name, score: 0 });
                if (scored.length >= 5) { break; }
            }
        }
        if (scored.length < 3) {
            for (const name of candidates) {
                if (name.toLowerCase().includes(lower) && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: 1 });
                    if (scored.length >= 5) { break; }
                }
            }
        }
        if (scored.length < 3) {
            for (const name of candidates) {
                const dist = levenshtein(lower, name.toLowerCase());
                if (dist <= 3 && dist > 0 && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: dist + 2 });
                    if (scored.length >= 5) { break; }
                }
            }
        }
        return scored.sort((a, b) => a.score - b.score).slice(0, 5).map(s => s.name);
    }
}

// ════════════════════════════════════════════════════════════════
//  Tool 3: innovus_parse_tcl_script — the core context provider
//
//  ★ Design principle:
//    This tool does no AI analysis of its own. It does exactly one thing:
//    hand Copilot's model the [most accurate context possible]. The result covers:
//      A. The full script
//      B. Overview statistics
//      C. The [full reference documentation] of every Innovus command
//      D. A [comparison table of the options actually used] on every command line
//      E. Mode/variable settings
//      F. Unrecognized identifiers
//      G. The AI analysis task (tells Copilot's model how to analyze)
//
//    With that context, Copilot's model produces:
//      purpose summary → per-command analysis → argument validation →
//      flow assessment → improvement suggestions
// ════════════════════════════════════════════════════════════════

class ParseTclScriptTool implements vscode.LanguageModelTool<{
    script_content?: string;
    script_uri?: string;
}> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
            script_content?: string;
            script_uri?: string;
        }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const db = getDB();
        let content: string;
        let sourceLabel: string;

        // --- 1. Obtain the script content ---
        if (options.input.script_content) {
            content = options.input.script_content;
            sourceLabel = 'user-provided script';
        } else if (options.input.script_uri) {
            try {
                const uri = vscode.Uri.parse(options.input.script_uri);
                const doc = await vscode.workspace.openTextDocument(uri);
                content = doc.getText();
                sourceLabel = uri.fsPath || options.input.script_uri;
            } catch {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `Error: Cannot read file "${options.input.script_uri}".`
                    )
                ]);
            }
        } else {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'tcl') {
                content = editor.document.getText();
                sourceLabel = editor.document.uri.fsPath || 'current editor';
            } else {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        'Error: Provide script_content or script_uri, or open a TCL file.'
                    )
                ]);
            }
        }

        // --- 2. Build the context ---
        const context = buildScriptContext(content, db, sourceLabel);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(context)
        ]);
    }
}

// ════════════════════════════════════════════════════════════════
//  Script context builder
// ════════════════════════════════════════════════════════════════

interface CommandCall {
    lineNumber: number;
    lineText: string;
    params: Map<string, string | null>;
}

function buildScriptContext(
    content: string,
    db: ReturnType<typeof getDB>,
    sourceLabel: string,
    includeAiTask: boolean = true
): string {
    const lines = content.split('\n');

    // Parse line by line
    const commandCalls = new Map<string, CommandCall[]>();
    const modeVariableUses = new Map<string, string[]>();
    const unknownTokens = new Map<string, number>();
    const tclBuiltins = new Map<string, number>();
    let commentLines = 0;
    let blankLines = 0;

    const TCL_BUILTINS = new Set([
        'set', 'puts', 'if', 'else', 'elseif', 'for', 'foreach', 'while',
        'proc', 'return', 'source', 'eval', 'expr', 'switch', 'catch',
        'error', 'uplevel', 'upvar', 'global', 'variable', 'namespace',
        'package', 'array', 'list', 'lindex', 'llength', 'lappend',
        'concat', 'split', 'join', 'string', 'regexp', 'regsub',
        'open', 'close', 'read', 'write', 'gets', 'file', 'cd', 'pwd',
        'exec', 'after', 'vwait', 'bind', 'trace', 'rename', 'interp',
        'clock', 'info', 'scan', 'format', 'binary', 'encoding',
        'fconfigure', 'socket', 'incr', 'append', 'lrange', 'lsearch',
        'lsort', 'break', 'continue', 'dict', 'lassign', 'lset', 'subst', 'unset'
    ]);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) { blankLines++; continue; }
        if (trimmed.startsWith('#')) { commentLines++; continue; }

        const firstToken = trimmed.split(/\s/)[0];
        if (!firstToken.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) { continue; }

        if (TCL_BUILTINS.has(firstToken)) {
            tclBuiltins.set(firstToken, (tclBuiltins.get(firstToken) || 0) + 1);
            continue;
        }

        if (db.isCommand(firstToken)) {
            const params = extractParamsFromLine(trimmed);
            const call: CommandCall = { lineNumber: i + 1, lineText: trimmed, params };
            const existing = commandCalls.get(firstToken);
            if (existing) { existing.push(call); }
            else { commandCalls.set(firstToken, [call]); }
        } else if (db.isKnown(firstToken)) {
            const uses = modeVariableUses.get(firstToken) || [];
            uses.push(trimmed);
            modeVariableUses.set(firstToken, uses);
        } else {
            unknownTokens.set(firstToken, (unknownTokens.get(firstToken) || 0) + 1);
        }
    }

    // ===== Build the output =====
    let ctx = '';

    // --- A: the full script ---
    ctx += t('ctx.title');
    ctx += t('ctx.source', sourceLabel);
    ctx += t('ctx.fullScript');
    ctx += '```tcl\n' + content + '\n```\n\n';

    // --- B: overview statistics ---
    const effectiveLines = lines.length - commentLines - blankLines;
    const cmdTypeCount = commandCalls.size;
    const cmdTotalCalls = Array.from(commandCalls.values()).reduce((s, v) => s + v.length, 0);

    ctx += t('ctx.overview');
    ctx += t('ctx.totalLines', lines.length, effectiveLines, commentLines, blankLines);
    ctx += t('ctx.commandCount', cmdTypeCount, cmdTotalCalls);
    ctx += t('ctx.modeCount', modeVariableUses.size);
    if (unknownTokens.size > 0) {
        const ut = Array.from(unknownTokens.values()).reduce((s, v) => s + v, 0);
        ctx += t('ctx.unknownCount', unknownTokens.size, ut);
    }
    ctx += '\n';

    // --- C: full documentation per command + option usage comparison ---
    if (commandCalls.size > 0) {
        ctx += t('ctx.docsHeading');
        ctx += t('ctx.docsNote');

        const sortedCmds = Array.from(commandCalls.entries())
            .sort((a, b) => b[1].length - a[1].length);

        for (const [cmdName, calls] of sortedCmds) {
            const info = db.get(cmdName);
            if (!info) { continue; }

            ctx += `---\n\n`;
            ctx += `### \`${cmdName}\` — ${t('ctx.calledTimes', calls.length)}\n\n`;

            // Full reference documentation
            ctx += t('ctx.refDoc');
            if (info.summary) {
                ctx += t('ctx.function', info.summary);
            }
            if (info.usage) {
                ctx += t('ctx.syntax', info.usage);
            }
            if (info.description && info.description !== info.summary) {
                ctx += `${info.description}\n\n`;
            }
            if (info.options && info.options.length > 0) {
                ctx += t('ctx.allOptions');
                ctx += t('ctx.optionTableHeader');
                for (const opt of info.options) {
                    const reqMark = opt.required ? t('ctx.reqShort') : t('ctx.optShort');
                    const desc = opt.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
                    ctx += `| \`${opt.name}\` | \`${opt.type}\` | ${reqMark} | ${desc} |\n`;
                }
                ctx += '\n';
            }

            // The actual usage on each line of the script + option comparison
            ctx += t('ctx.actualUsage');
            for (let ci = 0; ci < calls.length; ci++) {
                const call = calls[ci];
                ctx += t('ctx.call', ci + 1, call.lineNumber);
                ctx += '```tcl\n' + call.lineText + '\n```\n';

                if (info.options && info.options.length > 0) {
                    ctx += t('ctx.comparison');
                    ctx += t('ctx.comparisonHeader');

                    const usedFlags = new Set(call.params.keys());
                    for (const opt of info.options) {
                        if (usedFlags.has(opt.name)) {
                            const rawVal = call.params.get(opt.name);
                            const displayVal = rawVal
                                ? `\`${rawVal.length > 40 ? rawVal.substring(0, 37) + '...' : rawVal}\``
                                : t('ctx.flagValue');
                            ctx += `| \`${opt.name}\` | ${t('ctx.statusUsed')} | ${displayVal} | \`${opt.type}\` |\n`;
                        } else if (opt.required) {
                            ctx += `| \`${opt.name}\` | ${t('ctx.statusMissing')} | — | \`${opt.type}\` |\n`;
                        } else {
                            ctx += `| \`${opt.name}\` | ${t('ctx.statusUnused')} | — | \`${opt.type}\` |\n`;
                        }
                    }
                    ctx += '\n';
                }
            }

            // Quick option type reference
            ctx += t('ctx.typeLegend');
        }
    }

    // --- D: modes/variables ---
    if (modeVariableUses.size > 0) {
        ctx += `---\n\n`;
        ctx += t('ctx.modesHeading');
        for (const [name, uses] of modeVariableUses) {
            const info = db.get(name);
            const summary = info?.summary ? ` — ${info.summary}` : '';
            ctx += `- \`${name}\`${summary}: ${t('ctx.usedTimes', uses.length)}\n`;
            for (const u of uses) {
                ctx += `  \`\`\`tcl\n  ${u}\n  \`\`\`\n`;
            }
        }
        ctx += '\n';
    }

    // --- E: unrecognized identifiers ---
    if (unknownTokens.size > 0) {
        ctx += `---\n\n`;
        ctx += t('ctx.unknownHeading');
        ctx += t('ctx.unknownNote');
        const sortedUnknown = Array.from(unknownTokens.entries()).sort((a, b) => b[1] - a[1]);
        for (const [name, count] of sortedUnknown) {
            ctx += `- \`${name}\`: ${t('ctx.times', count)}\n`;
        }
        ctx += '\n';
    }

    // --- F: AI analysis task (only when includeAiTask=true) ---
    if (includeAiTask) {
        ctx += `---\n\n`;
        ctx += t('ctx.aiTaskHeading');

        // Check whether the user supplied a custom prompt
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');
        const customPrompt = cfg.get<string>('aiPrompt', '');

        if (customPrompt) {
            ctx += t('ctx.customPrompt');
            ctx += customPrompt + '\n\n';
        } else {
            ctx += t('ctx.taskIntro');
            ctx += t('ctx.taskA');
            ctx += t('ctx.taskB');
            ctx += t('ctx.taskC');
            ctx += t('ctx.taskD');
            ctx += t('ctx.taskConstraint');
        }
    } // end includeAiTask

    return ctx;
}

// ════════════════════════════════════════════════════════════════
//  Shared lint compilation helper
// ════════════════════════════════════════════════════════════════

/** Run the compiler over a set of file paths */
function compileFromPaths(fFilePath: string | null, tclFiles: string[] | null): {
    result: import('./compiler').CompileResult | null;
    error: string | null;
} {
    // Determine the .f file path and the working directory
    let workDir: string;
    let fFile: string;

    if (fFilePath && fs.existsSync(fFilePath)) {
        workDir = path.dirname(path.resolve(fFilePath));
        fFile = path.basename(fFilePath);
    } else if (tclFiles && tclFiles.length > 0) {
        // Use a temporary directory and generate a .f file
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-lint-'));
        fFile = 'tcl.f';
        const fLines = tclFiles.map(f => path.basename(f));
        fs.writeFileSync(path.join(workDir, fFile), fLines.join('\n'), 'utf-8');
        // Copy or link the tcl files into the temporary directory
        for (const tf of tclFiles) {
            if (fs.existsSync(tf)) {
                const dest = path.join(workDir, path.basename(tf));
                fs.copyFileSync(tf, dest);
            }
        }
    } else {
        return { result: null, error: 'Provide a .f file path or a list of .tcl file paths' };
    }

    try {
        const compiler = new TclCompiler();
        const result = compiler.compile(workDir, fFile);
        return { result, error: null };
    } catch (e: any) {
        return { result: null, error: `Compilation failed: ${e.message}` };
    } finally {
        // Clean up the temporary directory (only when one was created)
        if (!fFilePath && tclFiles && tclFiles.length > 0) {
            try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}

// ════════════════════════════════════════════════════════════════
//  Tool 4: innovus_lint_tcl — quick lint summary
// ════════════════════════════════════════════════════════════════

class LintTclSummaryTool implements vscode.LanguageModelTool<{
    f_file_path?: string;
    tcl_files?: string[];
}> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
            f_file_path?: string;
            tcl_files?: string[];
        }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input;

        const { result, error } = compileFromPaths(input.f_file_path || null, input.tcl_files || null);
        if (error) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(error)]);
        }
        if (!result) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
                'Provide f_file_path or tcl_files'
            )]);
        }

        const { units, variables, errors, warnings } = result;
        let report = '';
        report += '# 🔍 Lint Summary\n\n';
        report += `**Files:** ${units.length} | **Vars:** ${variables.size} | **Errors:** ${errors.length} | **Warnings:** ${warnings.length}\n\n`;

        if (errors.length === 0 && warnings.length === 0) {
            report += '✅ No issues.';
        } else {
            // Only report the error and warning counts, without the details
            if (errors.length > 0) {
                const errByFile = new Map<string, number>();
                for (const e of errors) {
                    const f = path.basename(e.filePath);
                    errByFile.set(f, (errByFile.get(f) || 0) + 1);
                }
                report += '### Error Distribution\n';
                for (const [f, c] of errByFile) {
                    report += `- \`${f}\`: ${c}\n`;
                }
                report += '\n';
            }
            if (warnings.length > 0) {
                const warnByFile = new Map<string, number>();
                for (const w of warnings) {
                    const f = path.basename(w.filePath);
                    warnByFile.set(f, (warnByFile.get(f) || 0) + 1);
                }
                report += '### Warning Distribution\n';
                for (const [f, c] of warnByFile) {
                    report += `- \`${f}\`: ${c}\n`;
                }
            }
            report += '\n> 💡 Use **innovus_lint_tcl_detailed** for full error details and variable table.';
        }

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(report)]);
    }
}

// ════════════════════════════════════════════════════════════════
//  Tool 5: innovus_lint_tcl_detailed — detailed lint report
// ════════════════════════════════════════════════════════════════

class LintTclDetailedTool implements vscode.LanguageModelTool<{
    f_file_path?: string;
    tcl_files?: string[];
}> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
            f_file_path?: string;
            tcl_files?: string[];
        }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input;

        const { result, error } = compileFromPaths(input.f_file_path || null, input.tcl_files || null);
        if (error) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(error)]);
        }
        if (!result) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
                'Provide f_file_path or tcl_files'
            )]);
        }

        const report = this.formatDetailedReport(result);
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(report)]);
    }

    private formatDetailedReport(result: import('./compiler').CompileResult): string {
        const { units, variables, variableRefs, errors, warnings } = result;

        let report = '';
        report += '# 🔍 TCL Lint Detailed Report\n\n';

        report += `**Files:** ${units.length} | **Variables:** ${variables.size} | **Refs:** ${variableRefs.length} | **Errors:** ${errors.length} | **Warnings:** ${warnings.length}\n\n`;

        if (units.length > 0) {
            report += '## 📁 Compiled Files\n\n';
            for (const u of units) {
                report += `- \`${u.relativePath}\`\n`;
            }
            report += '\n';
        }

        if (variables.size > 0) {
            report += '## 📊 Variable Table\n\n';
            report += '| Variable | Value | File | Line |\n|----------|-------|------|------|\n';
            for (const [varName, defs] of variables) {
                for (const def of defs) {
                    const displayVal = def.value.length > 60
                        ? def.value.substring(0, 57) + '...'
                        : def.value || '(empty)';
                    report += `| \`${varName}\` | \`${displayVal}\` | ${def.relativePath} | ${def.line} |\n`;
                }
            }
            report += '\n';
        }

        if (errors.length > 0) {
            report += `## ❌ Errors (${errors.length})\n\n`;
            for (const e of errors) {
                const fileLabel = path.basename(e.filePath);
                report += `- [\`${fileLabel}:${e.line}\`] ${e.message}\n`;
            }
            report += '\n';
        }

        if (warnings.length > 0) {
            report += `## ⚠️ Warnings (${warnings.length})\n\n`;
            for (const w of warnings) {
                const fileLabel = path.basename(w.filePath);
                report += `- [\`${fileLabel}:${w.line}\`] ${w.message}\n`;
            }
            report += '\n';
        }

        if (variableRefs.length > 0) {
            report += '## 🔗 Variable References\n\n';
            report += '| Variable | Reference | Definition |\n|----------|-----------|------------|\n';
            const showRefs = variableRefs.slice(0, 30);
            for (const ref of showRefs) {
                const defLoc = ref.definition
                    ? `${ref.definition.relativePath}:${ref.definition.line}`
                    : 'undefined';
                report += `| \`$${ref.name}\` | ${ref.relativePath}:${ref.line} | ${defLoc} |\n`;
            }
            if (variableRefs.length > 30) {
                report += `| ... | ${variableRefs.length - 30} more refs | ... |\n`;
            }
            report += '\n';
        }

        if (errors.length === 0 && warnings.length === 0) {
            report += '## ✅ No Issues\n\nAll checks passed.\n';
        }

        return report;
    }
}

// ════════════════════════════════════════════════════════════════
//  Exports
// ════════════════════════════════════════════════════════════════

/**
 * These descriptions are read by the language model, not by the user, so they stay
 * English regardless of `innovus-tcl.uiLanguage`. Only the text that reaches the user —
 * the script context built by buildScriptContextForCommand — is localized.
 */
export const TOOL_DEFINITIONS = {
    listCommands: {
        name: 'innovus_list_commands',
        description: 'List/search the TCL commands of the Cadence Innovus EDA tool. Returns the command name, summary and type. Always query this tool for the correct command names before writing an Innovus TCL script — never invent commands that do not exist.',
        inputSchema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Optional keyword to search for, e.g. "addInst", "route", "floorplan".' },
                limit: { type: 'number', description: 'Maximum number of results. Default 50, maximum 200.' }
            }
        } as object,
        tags: ['innovus', 'tcl', 'eda', 'cadence']
    },
    getCommandHelp: {
        name: 'innovus_get_command_help',
        description: 'Get the full reference documentation of one Cadence Innovus TCL command: summary, syntax and every option (name/type/required/description). Use this tool to confirm the correct option names and usage before calling an Innovus command, to avoid hallucinations.',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The exact Innovus TCL command name to look up, e.g. "addInst", "routeDesign".' }
            },
            required: ['command']
        } as object,
        tags: ['innovus', 'tcl', 'eda', 'cadence']
    },
    parseTclScript: {
        name: 'innovus_parse_tcl_script',
        description: 'Parse an Innovus TCL script and return [the full script + the complete documentation of every command + a per-line option comparison table]. With that context, reason from the documented facts: script purpose, command correctness, missing options, flow assessment and improvement suggestions.',
        inputSchema: {
            type: 'object',
            properties: {
                script_content: { type: 'string', description: 'The full text of the TCL script.' },
                script_uri: { type: 'string', description: 'The URI of the script file.' }
            }
        } as object,
        tags: ['innovus', 'tcl', 'eda', 'cadence']
    },
    lintTclSummary: {
        name: 'innovus_lint_tcl',
        description: 'Quick lint summary for TCL scripts. Accepts a .f file path or a list of .tcl file paths and returns the error/warning counts and their distribution per file. Good for a quick health check of the project. For the full details (variable table, error locations, reference tracking) use innovus_lint_tcl_detailed.',
        inputSchema: {
            type: 'object',
            properties: {
                f_file_path: {
                    type: 'string',
                    description: 'Absolute path of the .f file (e.g. /path/to/tcl.f). The .f file lists one .tcl file path per line, relative to the directory of the .f file. Takes precedence over tcl_files.'
                },
                tcl_files: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of absolute .tcl file paths (e.g. ["/path/to/0_init.tcl", "/path/to/1_floorplan.tcl"]). Used when f_file_path is not given. The order of the files determines the compilation order.'
                }
            }
        } as object,
        tags: ['innovus', 'tcl', 'lint', 'eda']
    },
    lintTclDetailed: {
        name: 'innovus_lint_tcl_detailed',
        description: 'Detailed lint report for TCL scripts. Accepts a .f file path or a list of .tcl file paths and returns the full analysis: variable table (name/value/file/line), every error and warning with its exact location, and the variable reference tracking table. This consumes a lot of tokens — prefer innovus_lint_tcl for a quick check first and use this tool once errors are found.',
        inputSchema: {
            type: 'object',
            properties: {
                f_file_path: {
                    type: 'string',
                    description: 'Absolute path of the .f file (e.g. /path/to/tcl.f). The .f file lists one .tcl file path per line, relative to the directory of the .f file. Takes precedence over tcl_files.'
                },
                tcl_files: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of absolute .tcl file paths (e.g. ["/path/to/0_init.tcl", "/path/to/1_floorplan.tcl"]). Used when f_file_path is not given. The order of the files determines the compilation order.'
                }
            }
        } as object,
        tags: ['innovus', 'tcl', 'lint', 'eda']
    }
};

/** Register every LM tool with VS Code */
export function registerAllTools(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.lm.registerTool(TOOL_DEFINITIONS.listCommands.name, new ListCommandsTool())
    );
    context.subscriptions.push(
        vscode.lm.registerTool(TOOL_DEFINITIONS.getCommandHelp.name, new GetCommandHelpTool())
    );
    context.subscriptions.push(
        vscode.lm.registerTool(TOOL_DEFINITIONS.parseTclScript.name, new ParseTclScriptTool())
    );
    context.subscriptions.push(
        vscode.lm.registerTool(TOOL_DEFINITIONS.lintTclSummary.name, new LintTclSummaryTool())
    );
    context.subscriptions.push(
        vscode.lm.registerTool(TOOL_DEFINITIONS.lintTclDetailed.name, new LintTclDetailedTool())
    );
    console.log('[Innovus TCL] Registered 5 Copilot LM Tools');
}

/**
 * Build the script context (used by the analyzeScript command in extension.ts).
 * Returns the full context text in Markdown format.
 */
export function buildScriptContextForCommand(content: string, sourceLabel?: string, includeAiTask?: boolean): string {
    const db = getDB();
    return buildScriptContext(content, db, sourceLabel || t('analyze.currentScript'), includeAiTask);
}
