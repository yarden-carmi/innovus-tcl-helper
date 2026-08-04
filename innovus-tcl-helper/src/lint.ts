/**
 * Lint Provider — cross-file static checking for TCL
 *
 * Turns the TclCompiler results into VS Code diagnostics and exposes
 * a lint report interface usable from MCP.
 *
 * Checks:
 *   1. References to undefined variables
 *   2. Variables used before they are defined (ordering warning)
 *   3. Missing files (files referenced by the .f file)
 *   4. Missing files referenced by source
 *   5. Variables assigned repeatedly but never used
 *   6. procs that are defined but never called
 *   7. Empty set commands (set var with no value)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { TclCompiler, CompileResult, VariableInfo, CompileError, CompileWarning } from './compiler';
import { t } from './i18n';

// ════════════════════════════════════════════════════════════
//  Configuration
// ════════════════════════════════════════════════════════════

const DIAGNOSTIC_SOURCE = 'innovus-tcl-lint';

/** Lint strictness */
export type LintLevel = 'basic' | 'standard' | 'strict';

// ════════════════════════════════════════════════════════════
//  Lint Provider
// ════════════════════════════════════════════════════════════

export class TclLintProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private compiler: TclCompiler;
    private lastResult: CompileResult | null = null;
    private workspaceRoot: string = '';

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
        this.compiler = new TclCompiler();
    }

    /** Get the compiler instance */
    getCompiler(): TclCompiler {
        return this.compiler;
    }

    /** Get the most recent compilation result */
    getLastResult(): CompileResult | null {
        return this.lastResult;
    }

    /** Get the workspace root directory */
    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    /** Get the current lint level */
    private getLevel(): LintLevel {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('diagnosticLevel', 'standard') as LintLevel;
    }

    /** Get the configured .f file path */
    private getFFilePath(): string {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('fFile', 'tcl.f');
    }

    /** Check whether cross-file compilation analysis is enabled */
    private isCompilationEnabled(): boolean {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<boolean>('enableCompilation', true);
    }

    /**
     * Run the lint analysis over the whole project.
     * Requires an open workspace.
     */
    runLint(document?: vscode.TextDocument): void {
        if (!this.isCompilationEnabled()) {
            this.diagnosticCollection.clear();
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        const fFile = this.getFFilePath();
        const level = this.getLevel();

        // Compile the project
        this.lastResult = this.compiler.compile(this.workspaceRoot, fFile);

        // Build the diagnostics
        const allDiagnostics = new Map<string, vscode.Diagnostic[]>();

        // Collect the diagnostics for every file
        for (const error of this.lastResult.errors) {
            this.addDiagnostic(allDiagnostics, error.filePath,
                this.createDiagnostic(error, vscode.DiagnosticSeverity.Error));
        }

        if (level !== 'basic') {
            for (const warning of this.lastResult.warnings) {
                this.addDiagnostic(allDiagnostics, warning.filePath,
                    this.createDiagnostic(warning, vscode.DiagnosticSeverity.Warning));
            }
        }

        // strict level: check for unused variables
        if (level === 'strict') {
            this.checkUnusedVariables(allDiagnostics);
            this.checkUnusedProcs(allDiagnostics);
        }

        // Apply the diagnostics to every file
        this.diagnosticCollection.clear();

        for (const [filePath, diagnostics] of allDiagnostics) {
            const uri = vscode.Uri.file(filePath);
            this.diagnosticCollection.set(uri, diagnostics);
        }

        // When a document was given, make sure its diagnostics are updated too
        if (document) {
            const existing = allDiagnostics.get(document.uri.fsPath) || [];
            this.diagnosticCollection.set(document.uri, existing);
        }
    }

    /**
     * Incremental lint: triggered when a single file is saved.
     */
    runIncrementalLint(document: vscode.TextDocument): void {
        if (!this.isCompilationEnabled() || !this.lastResult) {
            this.runLint(document);
            return;
        }

        const content = document.getText();
        const filePath = document.uri.fsPath;

        // Update the compilation result incrementally
        this.lastResult = this.compiler.incrementalUpdate(filePath, content, this.lastResult);

        // Regenerate the diagnostics for this file
        const diagnostics: vscode.Diagnostic[] = [];

        for (const error of this.lastResult.errors) {
            if (error.filePath === filePath) {
                diagnostics.push(this.createDiagnostic(error, vscode.DiagnosticSeverity.Error));
            }
        }

        for (const warning of this.lastResult.warnings) {
            if (warning.filePath === filePath) {
                diagnostics.push(this.createDiagnostic(warning, vscode.DiagnosticSeverity.Warning));
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /** Clear every diagnostic */
    clear(): void {
        this.diagnosticCollection.clear();
        this.lastResult = null;
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }

    // ════════════════════════════════════════════════════════
    //  Private helpers
    // ════════════════════════════════════════════════════════

    private addDiagnostic(
        map: Map<string, vscode.Diagnostic[]>,
        filePath: string,
        diagnostic: vscode.Diagnostic
    ): void {
        const existing = map.get(filePath);
        if (existing) {
            existing.push(diagnostic);
        } else {
            map.set(filePath, [diagnostic]);
        }
    }

    private createDiagnostic(
        item: { message: string; filePath: string; line: number; column: number },
        severity: vscode.DiagnosticSeverity
    ): vscode.Diagnostic {
        const line = Math.max(0, item.line - 1);
        const col = Math.max(0, item.column - 1);

        const range = new vscode.Range(line, col, line, col + 1);
        const diag = new vscode.Diagnostic(range, item.message, severity);
        diag.source = DIAGNOSTIC_SOURCE;
        return diag;
    }

    /** Check for unused variables */
    private checkUnusedVariables(diagnosticsMap: Map<string, vscode.Diagnostic[]>): void {
        if (!this.lastResult) { return; }

        for (const [varName, defs] of this.lastResult.variables) {
            // Check whether every definition has a matching reference
            const refs = this.lastResult.variableRefs.filter(r => r.name === varName);
            if (refs.length === 0 && defs.length > 0) {
                const lastDef = defs[defs.length - 1];
                const diag = new vscode.Diagnostic(
                    new vscode.Range(lastDef.line - 1, lastDef.column - 1,
                        lastDef.line - 1, lastDef.column + lastDef.name.length),
                    t('diag.unusedVariable', varName),
                    vscode.DiagnosticSeverity.Information
                );
                diag.source = DIAGNOSTIC_SOURCE;
                this.addDiagnostic(diagnosticsMap, lastDef.filePath, diag);
            }
        }
    }

    /** Check for unused procs */
    private checkUnusedProcs(diagnosticsMap: Map<string, vscode.Diagnostic[]>): void {
        if (!this.lastResult) { return; }

        const allCommandNames = new Set<string>();
        for (const unit of this.lastResult.units) {
            for (const cmd of unit.parseResult.commands) {
                allCommandNames.add(cmd.commandName);
            }
        }

        for (const unit of this.lastResult.units) {
            for (const proc of unit.procs) {
                if (!allCommandNames.has(proc.procName)) {
                    const diag = new vscode.Diagnostic(
                        new vscode.Range(proc.line - 1, proc.column - 1,
                            proc.line - 1, proc.column + proc.procName.length + 4),
                        t('diag.unusedProc', proc.procName),
                        vscode.DiagnosticSeverity.Information
                    );
                    diag.source = DIAGNOSTIC_SOURCE;
                    this.addDiagnostic(diagnosticsMap, unit.filePath, diag);
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════
    //  MCP interface: lint report
    // ════════════════════════════════════════════════════════

    /**
     * Generate the lint report (returned by the MCP tools).
     * @param format output format, "text" | "json"
     */
    generateLintReport(format: 'text' | 'json' = 'text'): string {
        if (!this.lastResult) {
            return JSON.stringify({
                error: t('report.noResult')
            });
        }

        if (format === 'json') {
            return this.generateJsonReport();
        }
        return this.generateTextReport();
    }

    private generateTextReport(): string {
        const r = this.lastResult!;
        const lines: string[] = [];

        lines.push(t('report.title'));
        lines.push(``);
        lines.push(t('report.workspace', r.workspaceRoot));
        lines.push(t('report.fFile', r.fFilePath));
        lines.push(t('report.files', r.units.length));
        lines.push(t('report.varDefs', Array.from(r.variables.values()).reduce((s, v) => s + v.length, 0)));
        lines.push(t('report.varRefs', r.variableRefs.length));
        lines.push(t('report.errors', r.errors.length));
        lines.push(t('report.warnings', r.warnings.length));
        lines.push(``);

        // Compilation order
        lines.push(t('report.fileListHeading'));
        lines.push(``);
        for (const unit of r.units) {
            lines.push(`- \`${unit.relativePath}\` (${t('report.varDefsSuffix', unit.sets.length)})`);
        }
        lines.push(``);

        // Variable table
        lines.push(t('report.varTableHeading'));
        lines.push(``);
        if (r.variables.size === 0) {
            lines.push(t('report.noVariables'));
        } else {
            lines.push(t('report.varTableHeader'));
            lines.push(`|--------|-----|---------|`);
            for (const [varName, defs] of r.variables) {
                for (const def of defs) {
                    const val = def.value.length > 40
                        ? def.value.substring(0, 37) + '...'
                        : def.value || t('report.emptyValue');
                    lines.push(`| \`${varName}\` | ${val} | ${def.relativePath}:${def.line} |`);
                }
            }
        }
        lines.push(``);

        // Errors
        if (r.errors.length > 0) {
            lines.push(t('report.errorsHeading', r.errors.length));
            lines.push(``);
            for (const err of r.errors) {
                const relPath = path.relative(r.workspaceRoot, err.filePath);
                lines.push(`- **${relPath}:${err.line}** — ${err.message}`);
            }
            lines.push(``);
        }

        // Warnings
        if (r.warnings.length > 0) {
            lines.push(t('report.warningsHeading', r.warnings.length));
            lines.push(``);
            for (const warn of r.warnings) {
                const relPath = path.relative(r.workspaceRoot, warn.filePath);
                lines.push(`- **${relPath}:${warn.line}** — ${warn.message}`);
            }
            lines.push(``);
        }

        if (r.errors.length === 0 && r.warnings.length === 0) {
            lines.push(t('report.noIssuesHeading'));
            lines.push(``);
            lines.push(t('report.noIssuesBody'));
        }

        return lines.join('\n');
    }

    private generateJsonReport(): string {
        const r = this.lastResult!;

        // Build the serializable report
        const report: any = {
            workspaceRoot: r.workspaceRoot,
            fFilePath: r.fFilePath,
            fileCount: r.units.length,
            variableDefCount: Array.from(r.variables.values()).reduce((s, v) => s + v.length, 0),
            variableRefCount: r.variableRefs.length,
            errorCount: r.errors.length,
            warningCount: r.warnings.length,
            files: r.units.map(u => ({
                path: u.relativePath,
                order: u.order,
                setCount: u.sets.length,
                varRefCount: u.varRefs.length,
                sourceCount: u.sources.length,
                procCount: u.procs.length,
                commandCount: u.parseResult.commands.length
            })),
            variables: {} as Record<string, any[]>,
            errors: r.errors.map(e => ({
                message: e.message,
                file: path.relative(r.workspaceRoot, e.filePath),
                line: e.line,
                column: e.column
            })),
            warnings: r.warnings.map(w => ({
                message: w.message,
                file: path.relative(r.workspaceRoot, w.filePath),
                line: w.line,
                column: w.column
            }))
        };

        for (const [varName, defs] of r.variables) {
            report.variables[varName] = defs.map(d => ({
                value: d.value,
                rawValue: d.rawValue,
                file: d.relativePath,
                line: d.line,
                order: d.order,
                isResolved: d.isResolved
            }));
        }

        return JSON.stringify(report, null, 2);
    }

    /**
     * Look up variable information (MCP interface).
     */
    queryVariable(varName: string, filePath?: string, line?: number): {
        found: boolean;
        definition: VariableInfo | null;
        allDefinitions: VariableInfo[];
        references: { file: string; line: number; column: number }[];
    } {
        if (!this.lastResult) {
            return { found: false, definition: null, allDefinitions: [], references: [] };
        }

        const r = this.lastResult;
        // Turn a relative path into an absolute one
        let absPath = filePath;
        if (filePath && !path.isAbsolute(filePath)) {
            absPath = path.resolve(r.workspaceRoot, filePath);
        }

        const { definition, allDefs, refs } =
            this.compiler.queryVariable(varName, r, absPath, line);

        return {
            found: allDefs.length > 0 || refs.length > 0,
            definition,
            allDefinitions: allDefs,
            references: refs.map(rf => ({
                file: rf.relativePath,
                line: rf.line,
                column: rf.column
            }))
        };
    }
}
