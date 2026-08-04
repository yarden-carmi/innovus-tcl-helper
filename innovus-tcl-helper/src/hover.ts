/**
 * Hover Provider - shows help for Innovus commands/variables/TCL keywords on mouse hover
 *
 * Supports:
 *   1. Innovus command documentation (from the command database)
 *   2. TCL variable values (from the cross-file compilation analysis)
 *   3. $varName variable reference values
 *   4. TCL built-in keyword documentation (from data/tcl-builtins/)
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getDB, CmdInfo, CmdOption } from './commands';
import { TclLintProvider } from './lint';
import { t } from './i18n';

// ════════════════════════════════════════════════════════════
//  TCL built-in keyword file loading
// ════════════════════════════════════════════════════════════

interface TclBuiltinDoc {
    command: string;
    category: string;
    summary: string;
    usage: string;
    description: string;
    note?: string;
}

/** Cache of already loaded documents */
const builtinCache: Map<string, TclBuiltinDoc> = new Map();
let builtinsDataRoot: string = '';

/** Set the data root for the TCL built-in documentation */
export function setBuiltinsDataRoot(extensionPath: string): void {
    builtinsDataRoot = path.join(extensionPath, 'data', 'tcl-builtins');
}

/** Load the documentation for a TCL built-in keyword */
function loadBuiltinDoc(cmdName: string, lang: string): TclBuiltinDoc | null {
    const cacheKey = `${lang}:${cmdName}`;
    const cached = builtinCache.get(cacheKey);
    if (cached) { return cached; }

    if (!builtinsDataRoot) { return null; }

    try {
        const filePath = path.join(builtinsDataRoot, lang, `${cmdName}.json`);
        if (!fs.existsSync(filePath)) { return null; }
        const content = fs.readFileSync(filePath, 'utf-8');
        const doc: TclBuiltinDoc = JSON.parse(content);
        builtinCache.set(cacheKey, doc);
        return doc;
    } catch {
        return null;
    }
}

export class InnovusHoverProvider implements vscode.HoverProvider {
    private lintProvider: TclLintProvider | null = null;

    /** Set the Lint Provider reference (used for cross-file variable lookups) */
    setLintProvider(provider: TclLintProvider): void {
        this.lintProvider = provider;
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {

        const db = getDB();

        // ── First check whether we are hovering over a $varName ──
        const dollarVarHover = this.checkDollarVar(document, position);
        if (dollarVarHover) { return dollarVarHover; }

        // ── Plain word match ──
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) { return null; }

        const word = document.getText(wordRange);

        // ── Check whether this is a TCL variable (from the compilation analysis) ──
        const varHover = this.checkCompiledVariable(word, document, position, wordRange);
        if (varHover) { return varHover; }

        // ── Check whether this is an Innovus command ──
        const cmdInfo = db.get(word);
        if (cmdInfo) {
            return this.buildInnovusHover(cmdInfo, wordRange);
        }

        // ── Check whether this is a TCL built-in keyword (when not an Innovus command) ──
        const builtinHover = this.checkTclBuiltin(word, wordRange);
        if (builtinHover) { return builtinHover; }

        return null;
    }

    /**
     * Build the hover content for an Innovus command.
     */
    private buildInnovusHover(cmdInfo: CmdInfo, wordRange: vscode.Range): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // --- Title + type label ---
        if (cmdInfo.is_cmd) {
            markdown.appendMarkdown(`## \`${escapeCode(cmdInfo.command)}\` \`${t('common.command')}\`\n\n`);
        } else {
            markdown.appendMarkdown(`## \`${escapeCode(cmdInfo.command)}\` \`${t('common.modeVariable')}\`\n\n`);
        }

        // --- Summary ---
        if (cmdInfo.summary) {
            markdown.appendMarkdown(`**${cmdInfo.summary}**\n\n`);
        }

        // --- Usage notes for mode variables ---
        if (!cmdInfo.is_cmd) {
            markdown.appendMarkdown('---\n\n');
            markdown.appendMarkdown(t('hover.modeVariableHint'));
            markdown.appendCodeblock(`set ${cmdInfo.command}  ;# ${t('hover.enableView')}\nset ${cmdInfo.command} <value>  ;# ${t('hover.setValue')}`, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // --- Syntax ---
        if (cmdInfo.usage) {
            markdown.appendMarkdown(`### ${t('common.syntax')}\n\n`);
            markdown.appendCodeblock(cmdInfo.usage, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // --- Description ---
        if (cmdInfo.description && cmdInfo.description !== cmdInfo.summary) {
            markdown.appendMarkdown(`### ${t('common.description')}\n\n`);
            markdown.appendMarkdown(cmdInfo.description + '\n\n');
        }

        // --- Options ---
        if (cmdInfo.options && cmdInfo.options.length > 0) {
            markdown.appendMarkdown(`### ${t('common.options')}\n\n`);
            markdown.appendMarkdown(t('hover.optionTableHeader'));
            for (const opt of cmdInfo.options) {
                const required = opt.required ? '✅' : '';
                const desc = escapeMd(opt.description).replace(/\n/g, ' ');
                markdown.appendMarkdown(`| \`${escapeCode(opt.name)}\` | ${required} | \`${escapeCode(opt.type)}\` | ${desc} |\n`);
            }
        }

        return new vscode.Hover(markdown, wordRange);
    }

    /**
     * Check whether we are hovering over $varName or ${varName}.
     * If so, look up the variable value from the compilation analysis and display it.
     */
    private checkDollarVar(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Hover | null {
        if (!this.lintProvider) { return null; }

        const line = document.lineAt(position.line).text;
        const col = position.character;

        // Match $varName or ${varName}
        const dollarRegex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
        let match: RegExpExecArray | null;

        while ((match = dollarRegex.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (col >= start && col <= end) {
                const varName = match[2];
                const isBraceForm = match[1] === '{';

                const result = this.lintProvider.getLastResult();
                if (!result) { return null; }

                const { definition, allDefs, refs } =
                    this.lintProvider.getCompiler().queryVariable(
                        varName, result, document.uri.fsPath, position.line + 1
                    );

                const markdown = new vscode.MarkdownString();
                markdown.isTrusted = true;
                markdown.supportHtml = true;

                markdown.appendMarkdown(`## \`$${isBraceForm ? '{' : ''}${varName}${isBraceForm ? '}' : ''}\` \`${t('hover.variableRef')}\`\n\n`);

                if (definition) {
                    const val = definition.value || t('common.empty');
                    const displayVal = val.length > 100 ? val.substring(0, 97) + '...' : val;
                    markdown.appendMarkdown(`**${t('common.value')}:** \`${escapeCode(displayVal)}\`\n\n`);
                    markdown.appendMarkdown(`**${t('hover.definedAt')}:** \`${definition.relativePath}:${definition.line}\`\n\n`);

                    if (!definition.isResolved) {
                        markdown.appendMarkdown(`> ⚠️ ${t('hover.unresolvedMayDiffer')}\n\n`);
                    }

                    // Full definition history
                    if (allDefs.length > 1) {
                        markdown.appendMarkdown(`---\n\n`);
                        markdown.appendMarkdown(`### ${t('hover.assignmentHistory')}\n\n`);
                        markdown.appendMarkdown(t('hover.historyTableHeader'));
                        for (const def of allDefs) {
                            const dVal = def.value.length > 40
                                ? def.value.substring(0, 37) + '...'
                                : def.value || t('common.empty');
                            markdown.appendMarkdown(`| \`${escapeCode(dVal)}\` | \`${def.relativePath}\` | ${def.line} |\n`);
                        }
                    }
                } else if (allDefs.length > 0) {
                    // A definition exists, but only after this reference
                    const def = allDefs[0];
                    markdown.appendMarkdown(`**${t('common.value')}:** \`${escapeCode(def.value || t('common.empty'))}\`\n\n`);
                    markdown.appendMarkdown(`**${t('hover.definedAt')}:** \`${def.relativePath}:${def.line}\`\n\n`);
                    markdown.appendMarkdown(`> ⚠️ ${t('hover.definedAfter')}\n\n`);
                } else {
                    markdown.appendMarkdown(`> ❌ ${t('hover.undefined')}\n\n`);
                    markdown.appendMarkdown(t('hover.noDefinition'));
                }

                const varRange = new vscode.Range(
                    position.line, start, position.line, end
                );
                return new vscode.Hover(markdown, varRange);
            }
        }
        return null;
    }

    /**
     * Check whether a plain word matches a variable name from the compilation analysis,
     * e.g. `my_var` in `set my_var 1` — hovering it shows the variable information.
     */
    private checkCompiledVariable(
        word: string,
        document: vscode.TextDocument,
        position: vscode.Position,
        wordRange: vscode.Range
    ): vscode.Hover | null {
        if (!this.lintProvider) { return null; }

        const result = this.lintProvider.getLastResult();
        if (!result) { return null; }

        const defs = result.variables.get(word);
        if (!defs || defs.length === 0) { return null; }

        // Make sure the cursor really is on the variable name (not on a command name)
        const line = document.lineAt(position.line).text;
        const trimmed = line.trimStart();
        // Exclude a match on the command name at the start of the line
        const firstWordMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (firstWordMatch && firstWordMatch[1] === word) {
            // If the word is the first one on the line and a known command,
            // do not show the variable hover
            const db = getDB();
            if (db.isCommand(word)) { return null; }
        }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // Find the most recent definition before the current file/line
        const filePath = document.uri.fsPath;
        const refLine = position.line + 1;
        const { definition, allDefs } =
            this.lintProvider.getCompiler().queryVariable(word, result, filePath, refLine);

        markdown.appendMarkdown(`## \`${escapeCode(word)}\` \`${t('hover.tclVariable')}\`\n\n`);

        if (definition) {
            const val = definition.value || t('common.empty');
            const displayVal = val.length > 100 ? val.substring(0, 97) + '...' : val;
            markdown.appendMarkdown(`**${t('common.value')}:** \`${escapeCode(displayVal)}\`\n\n`);
            markdown.appendMarkdown(`**${t('hover.definedAt')}:** \`${definition.relativePath}:${definition.line}\`\n\n`);
            markdown.appendMarkdown(`**${t('hover.raw')}:** \`${escapeCode(definition.rawText)}\`\n\n`);

            if (!definition.isResolved) {
                markdown.appendMarkdown(`> ⚠️ ${t('hover.unresolved')}\n\n`);
            }
        }

        if (allDefs.length > 1) {
            markdown.appendMarkdown(`---\n\n`);
            markdown.appendMarkdown(`### ${t('hover.assignmentHistory')}\n\n`);
            markdown.appendMarkdown(t('hover.historyTableHeader'));
            for (const def of allDefs) {
                const dVal = def.value.length > 40
                    ? def.value.substring(0, 37) + '...'
                    : def.value || t('common.empty');
                markdown.appendMarkdown(`| \`${escapeCode(dVal)}\` | \`${def.relativePath}\` | ${def.line} |\n`);
            }
        }

        return new vscode.Hover(markdown, wordRange);
    }

    /**
     * Check whether the word is a TCL built-in keyword and, if so,
     * display the documentation loaded from data/tcl-builtins/.
     * Only triggered when the word is not an Innovus command
     * (so it never shadows the more detailed help).
     */
    private checkTclBuiltin(word: string, wordRange: vscode.Range): vscode.Hover | null {
        const db = getDB();
        const lang = db.getLanguage();
        const doc = loadBuiltinDoc(word, lang);
        if (!doc) { return null; }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // Title + category label
        markdown.appendMarkdown(`## \`${escapeCode(doc.command)}\` \`TCL ${doc.category}\`\n\n`);

        // Syntax
        if (doc.usage) {
            markdown.appendMarkdown(`### ${t('common.syntax')}\n\n`);
            markdown.appendCodeblock(doc.usage, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // Summary + description
        markdown.appendMarkdown(`**${escapeMd(doc.summary)}**\n\n`);
        markdown.appendMarkdown(escapeMd(doc.description) + '\n\n');

        // Note
        if (doc.note) {
            markdown.appendMarkdown(`---\n\n`);
            markdown.appendMarkdown(`> 💡 ${escapeMd(doc.note)}\n\n`);
        }

        return new vscode.Hover(markdown, wordRange);
    }
}

/** Escape Markdown special characters */
function escapeMd(text: string): string {
    return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
}

/** Escape special characters inside a code span (backticks) — only the backtick itself */
function escapeCode(text: string): string {
    return text.replace(/`/g, '\\`');
}
