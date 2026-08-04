/**
 * TCL compilation engine — cross-file variable tracking and symbol table
 *
 * Core features:
 *   1. Parse the .f file to get the list of TCL scripts and their load order
 *   2. Compile every TCL file in order and build the global symbol table
 *   3. Track the definition site, value and references of every variable
 *   4. Support incremental compilation (partial update when a file changes)
 *   5. Handle nested file inclusion through the source command
 *
 * Symbol table:
 *   SymbolTable:
 *     variables: Map<varName, VariableInfo[]>
 *       a variable may have several definitions (different files/lines), ordered by file
 *
 *   VariableInfo:
 *     name: the variable name
 *     value: the resolved (simple) value
 *     rawValue: the raw value text
 *     filePath: the file holding the definition
 *     line: the definition line
 *     column: the definition column
 *     isResolved: whether the value is fully resolved (no unresolved variable references)
 */

import * as fs from 'fs';
import * as path from 'path';
import { t } from './i18n';
import {
    parse, ParseResult, AstNode,
    SetNode, VarRefNode, SourceNode, ProcNode,
    CommandNode, TokenType,
    resolveSimpleValue, containsVarRef
} from './tcl-ast';

// ════════════════════════════════════════════════════════════
//  Type definitions
// ════════════════════════════════════════════════════════════

/** Variable information */
export interface VariableInfo {
    name: string;
    value: string;             // the resolved simple value
    rawValue: string;          // the raw value text
    filePath: string;          // absolute path of the file holding the definition
    relativePath: string;      // path relative to the workspace root
    line: number;              // 1-based
    column: number;            // 1-based
    order: number;             // index in the compilation order (lower = earlier)
    isResolved: boolean;       // whether the value is fully resolved
    rawText: string;           // the raw set command text
}

/** Variable reference information */
export interface VariableRefInfo {
    name: string;
    filePath: string;
    relativePath: string;
    line: number;
    column: number;
    rawText: string;
    definition: VariableInfo | null;  // the definition it resolved to
}

/** Compilation unit (one TCL file) */
export interface CompilationUnit {
    filePath: string;           // absolute path
    relativePath: string;       // relative path
    order: number;              // compilation order
    parseResult: ParseResult;
    sets: SetNode[];
    varRefs: VarRefNode[];
    sources: SourceNode[];
    procs: ProcNode[];
}

/** Compilation result */
export interface CompileResult {
    workspaceRoot: string;
    fFilePath: string;          // absolute path of the .f file
    units: CompilationUnit[];   // ordered by compilation order
    variables: Map<string, VariableInfo[]>;  // the global variable table
    variableRefs: VariableRefInfo[];          // every variable reference
    errors: CompileError[];     // compilation errors
    warnings: CompileWarning[]; // compilation warnings
}

export interface CompileError {
    message: string;
    filePath: string;
    line: number;
    column: number;
}

export interface CompileWarning {
    message: string;
    filePath: string;
    line: number;
    column: number;
}

// ════════════════════════════════════════════════════════════
//  Command variable extraction — variables implicitly defined by TCL commands
// ════════════════════════════════════════════════════════════

/**
 * Extract the variable names implicitly defined by a TCL command
 * (foreach, lassign, gets, catch, scan, ...) and add them to the symbol table.
 *
 * @param cmd       - the parsed command node
 * @param unit      - the current compilation unit
 * @param line      - the line of the command (already offset)
 * @param column    - the column of the command
 * @param variables - the symbol table (modified in place)
 */
function addCmdDefinedVars(
    cmd: CommandNode,
    unit: CompilationUnit,
    line: number,
    column: number,
    variables: Map<string, VariableInfo[]>
): void {
    const cmdName = cmd.commandName;
    const args = cmd.args;

    /** Convenience helper that records one variable definition */
    const addVar = (varName: string, source: string): void => {
        if (!varName || varName.startsWith('-')) { return; }
        const info: VariableInfo = {
            name: varName,
            value: `<${source}>`,
            rawValue: `<${source}>`,
            filePath: unit.filePath,
            relativePath: unit.relativePath,
            line,
            column,
            order: unit.order,
            isResolved: true,
            rawText: cmd.rawText
        };
        const existing = variables.get(varName);
        if (existing) {
            existing.push(info);
        } else {
            variables.set(varName, [info]);
        }
    };

    // ── foreach varname list body ──
    // ── foreach {v1 v2 ...} list body ──
    if (cmdName === 'foreach' && args.length >= 3) {
        const varArg = args[0];
        const varNames: string[] = [];
        if (varArg.type === TokenType.BRACED) {
            varNames.push(...varArg.value.trim().split(/\s+/).filter(a => a.length > 0));
        } else if (varArg.type === TokenType.WORD) {
            varNames.push(varArg.value);
        }
        for (const vn of varNames) { addVar(vn, 'foreach'); }
        return;
    }

    // ── lassign list var1 var2 ... ──
    if (cmdName === 'lassign' && args.length >= 2) {
        for (let ai = 1; ai < args.length; ai++) {
            if (args[ai].type === TokenType.WORD) {
                addVar(args[ai].value, 'lassign');
            }
        }
        return;
    }

    // ── gets channelId ?varname? ──
    // When a second argument is given, that variable receives the line that was read
    if (cmdName === 'gets' && args.length >= 2) {
        const varArg = args[1];
        if (varArg.type === TokenType.WORD) {
            addVar(varArg.value, 'gets');
        }
        return;
    }

    // ── catch script ?resultVar? ?optionsVar? ──
    // The variable names start at the second argument (skipping the braced script body)
    if (cmdName === 'catch' && args.length >= 2) {
        // Skip the first argument (the script); the rest are variable names
        for (let ai = 1; ai < args.length; ai++) {
            if (args[ai].type === TokenType.WORD) {
                addVar(args[ai].value, 'catch');
            }
        }
        return;
    }

    // ── scan string format var1 var2 ... ──
    // The first two arguments are the string and the format; the rest receive the scan results
    if (cmdName === 'scan' && args.length >= 3) {
        for (let ai = 2; ai < args.length; ai++) {
            if (args[ai].type === TokenType.WORD) {
                addVar(args[ai].value, 'scan');
            }
        }
        return;
    }
}

/**
 * Get the indices of the braced body tokens of a control-flow command.
 * Used to recursively parse nested code blocks (the if/while/for/foreach/switch
 * bodies and the for init/incr blocks).
 *
 * @returns the indices in the argument array that hold executable code braces
 */
function getControlFlowBodyIndices(cmdName: string, args: CommandNode['args']): number[] {
    const indices: number[] = [];

    switch (cmdName) {
        case 'foreach':
            // foreach varname list body → args[2] is the body
            if (args.length >= 3 && args[2].type === TokenType.BRACED) {
                indices.push(2);
            }
            break;

        case 'while':
            // while cond body → args[1] is the body
            if (args.length >= 2 && args[1].type === TokenType.BRACED) {
                indices.push(1);
            }
            break;

        case 'for':
            // for init cond incr body
            // args[0]=init (may contain set), args[2]=incr (may contain set), args[3]=body
            if (args.length >= 1 && args[0].type === TokenType.BRACED) {
                indices.push(0);  // init block
            }
            if (args.length >= 3 && args[2].type === TokenType.BRACED) {
                indices.push(2);  // incr block
            }
            if (args.length >= 4 && args[3].type === TokenType.BRACED) {
                indices.push(3);  // body block
            }
            break;

        case 'if':
            // if cond body → args[1] is the body
            if (args.length >= 2 && args[1].type === TokenType.BRACED) {
                indices.push(1);
            }
            // if cond body else {elseBody} → args[3] is the else body
            // if cond body elseif {cond2} {body2} → args[3], args[4] ...
            // Scan the following BRACED args (skipping WORDs such as "else"/"elseif")
            for (let i = 2; i < args.length; i++) {
                if (args[i].type === TokenType.BRACED) {
                    indices.push(i);
                }
            }
            break;

        case 'elseif':
            // elseif cond body → args[1] is the body
            if (args.length >= 2 && args[1].type === TokenType.BRACED) {
                indices.push(1);
            }
            break;

        case 'else':
            // else body → args[0] is the body (else may be parsed as the command name)
            if (args.length >= 1 && args[0].type === TokenType.BRACED) {
                indices.push(0);
            }
            break;

        case 'switch':
            // switch ?opts? val body1 body2 ... → every trailing BRACED arg
            // Skip the leading 1-2 non-BRACED args (opts and val)
            for (let i = 0; i < args.length; i++) {
                if (args[i].type === TokenType.BRACED) {
                    indices.push(i);
                }
            }
            break;

        case 'try':
            // try body ?on? ?trap? ?finally?
            // Every BRACED arg is a code block
            for (let i = 0; i < args.length; i++) {
                if (args[i].type === TokenType.BRACED) {
                    indices.push(i);
                }
            }
            break;
    }

    return indices;
}

/**
 * Recursively extract every variable definition from a parse result
 * (including the nested control-flow bodies).
 *
 * @param parseResult  - the parse result
 * @param unit         - the compilation unit
 * @param lineOffset   - the line offset (line within the parse + offset = real file line)
 * @param variables    - the symbol table (modified in place)
 * @param depth        - the current recursion depth (capped at 4 levels)
 */
function extractVarsDeep(
    parseResult: ParseResult,
    unit: CompilationUnit,
    lineOffset: number,
    variables: Map<string, VariableInfo[]>,
    depth: number = 0
): void {
    if (depth > 4) { return; } // Guard against infinite recursion

    // 1. Extract the set definitions
    for (const setNode of parseResult.sets) {
        const info: VariableInfo = {
            name: setNode.varName,
            value: resolveSimpleValue(setNode.valueText),
            rawValue: setNode.valueText,
            filePath: unit.filePath,
            relativePath: unit.relativePath,
            line: setNode.line + lineOffset,
            column: setNode.column,
            order: unit.order,
            isResolved: !containsVarRef(setNode.valueText),
            rawText: setNode.rawText
        };
        const existing = variables.get(setNode.varName);
        if (existing) {
            existing.push(info);
        } else {
            variables.set(setNode.varName, [info]);
        }
    }

    // 2. Extract the implicitly defined variables (foreach, lassign, gets, catch, scan)
    for (const cmd of parseResult.commands) {
        addCmdDefinedVars(cmd, unit, cmd.line + lineOffset, cmd.column, variables);

        // 3. Recursively parse the braced bodies of control-flow commands
        const bodyIndices = getControlFlowBodyIndices(cmd.commandName, cmd.args);
        for (const bi of bodyIndices) {
            const bodyToken = cmd.args[bi];
            // bodyToken.value is the text inside the braces (without the outer {})
            const bodyText = bodyToken.value;
            if (!bodyText || bodyText.trim().length === 0) { continue; }
            const bodyParseResult = parse(unit.filePath, bodyText);
            // bodyToken.line is the line of the {; the body code starts on the next line
            const bodyLineOffset = bodyToken.line - 1;
            extractVarsDeep(bodyParseResult, unit, bodyLineOffset, variables, depth + 1);
        }
    }
}

// ════════════════════════════════════════════════════════════
//  Compilation engine
// ════════════════════════════════════════════════════════════

export class TclCompiler {
    private workspaceRoot: string = '';
    private fFilePath: string = '';
    private cache: Map<string, ParseResult> = new Map();
    private compileOrder: string[] = []; // list of absolute paths
    private processedSourceFiles: Set<string> = new Set(); // guards against source cycles

    constructor() { }

    /**
     * Compile the whole project.
     * @param workspaceRoot - the VS Code workspace root
     * @param fFileRelPath - the relative path of the .f file (defaults to "tcl.f")
     */
    compile(workspaceRoot: string, fFileRelPath: string = 'tcl.f'): CompileResult {
        this.workspaceRoot = workspaceRoot;
        this.fFilePath = path.join(workspaceRoot, fFileRelPath);
        this.cache.clear();
        this.compileOrder = [];
        this.processedSourceFiles.clear();

        const errors: CompileError[] = [];
        const warnings: CompileWarning[] = [];

        // 1. Parse the .f file
        const fileList = this.parseFFile(this.fFilePath, workspaceRoot, errors);
        if (fileList.length === 0 && errors.length === 0) {
            errors.push({
                message: t('compile.fFileEmpty', fFileRelPath),
                filePath: this.fFilePath,
                line: 1,
                column: 1
            });
        }

        // 2. Compile every TCL file in order
        const units: CompilationUnit[] = [];
        for (let i = 0; i < fileList.length; i++) {
            const absPath = fileList[i];
            const relPath = path.relative(workspaceRoot, absPath);

            if (!fs.existsSync(absPath)) {
                errors.push({
                    message: t('compile.fileNotFound', relPath),
                    filePath: absPath,
                    line: 1,
                    column: 1
                });
                continue;
            }

            try {
                const content = fs.readFileSync(absPath, 'utf-8');
                const parseResult = this.getOrParse(absPath, content);

                const unit: CompilationUnit = {
                    filePath: absPath,
                    relativePath: relPath,
                    order: i,
                    parseResult,
                    sets: parseResult.sets,
                    varRefs: parseResult.varRefs,
                    sources: parseResult.sources,
                    procs: parseResult.procs
                };
                units.push(unit);

                // Handle the source command (nested file inclusion)
                this.processSourceCommands(parseResult, absPath, i + 1, fileList, errors);

            } catch (e: any) {
                errors.push({
                    message: t('compile.readFailed', e.message),
                    filePath: absPath,
                    line: 1,
                    column: 1
                });
            }
        }

        // 3. Build the global symbol table
        const { variables, varRefs, varErrors, varWarnings } = this.buildSymbolTable(units);

        errors.push(...varErrors);
        warnings.push(...varWarnings);

        return {
            workspaceRoot,
            fFilePath: this.fFilePath,
            units,
            variables,
            variableRefs: varRefs,
            errors,
            warnings
        };
    }

    /**
     * Parse the .f file into a file list (in line order).
     * The recursive -F / -f directives are supported:
     *   -F xxx.f: resolve xxx.f against the current .f directory and continue parsing
     *             with xxx.f's own directory as the new base
     *   -f xxx.f: resolve xxx.f against the current .f directory, but keep resolving
     *             its inner relative paths against the calling .f directory
     * One file path per line (relative to the directory of the .f file);
     * blank lines and # comment lines are ignored.
     */
    private parseFFile(
        fFilePath: string,
        workspaceRoot: string,
        errors: CompileError[]
    ): string[] {
        const result: string[] = [];
        const visited = new Set<string>();

        this.parseFFileRecursive(fFilePath, path.dirname(fFilePath), workspaceRoot, errors, result, visited);
        this.compileOrder = [...result];
        return result;
    }

    /**
     * Recursively parse a .f file.
     * @param fFilePath - the absolute path of the current .f file
     * @param baseDir - the base directory used to resolve the paths on each line
     *                  (the caller's directory in -f mode, the current .f directory in -F mode)
     * @param workspaceRoot - the workspace root
     * @param errors - the error collection
     * @param result - the result collection (appended to)
     * @param visited - the set of already visited .f files (cycle guard)
     */
    private parseFFileRecursive(
        fFilePath: string,
        baseDir: string,
        workspaceRoot: string,
        errors: CompileError[],
        result: string[],
        visited: Set<string>
    ): void {
        // Normalize the path to avoid duplicates
        const normalized = path.resolve(fFilePath);

        // Cycle guard: never process an already visited .f file again
        if (visited.has(normalized)) {
            return;
        }
        visited.add(normalized);

        if (!fs.existsSync(fFilePath)) {
            errors.push({
                message: t('compile.fFileNotFound', path.relative(workspaceRoot, fFilePath)),
                filePath: fFilePath,
                line: 1,
                column: 1
            });
            return;
        }

        try {
            const content = fs.readFileSync(fFilePath, 'utf-8');
            const fDir = path.dirname(fFilePath);
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                // Skip blank lines and comments
                if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
                    continue;
                }

                // Strip the trailing comment (everything after the #)
                const commentIdx = trimmed.indexOf('#');
                const cleanLine = commentIdx >= 0
                    ? trimmed.substring(0, commentIdx).trim()
                    : trimmed;

                if (!cleanLine) { continue; }

                // ── Handle the -F directive: recurse and switch the base directory ──
                if (cleanLine.startsWith('-F') && (cleanLine.length === 2 || cleanLine[2] === ' ' || cleanLine[2] === '\t')) {
                    const subFPath = cleanLine.substring(2).trim();
                    if (!subFPath) {
                        errors.push({
                            message: `-F directive missing file path`,
                            filePath: fFilePath,
                            line: i + 1,
                            column: 1
                        });
                        continue;
                    }
                    // Resolve the sub .f path (relative to the current .f directory)
                    const subFAbs = path.isAbsolute(subFPath)
                        ? subFPath
                        : path.resolve(fDir, subFPath);
                    // -F: use the sub .f directory as the new baseDir
                    const subFDir = path.dirname(subFAbs);
                    this.parseFFileRecursive(subFAbs, subFDir, workspaceRoot, errors, result, visited);
                    continue;
                }

                // ── Handle the -f directive: recurse without switching the directory ──
                if (cleanLine.startsWith('-f') && (cleanLine.length === 2 || cleanLine[2] === ' ' || cleanLine[2] === '\t')) {
                    const subFPath = cleanLine.substring(2).trim();
                    if (!subFPath) {
                        errors.push({
                            message: `-f directive missing file path`,
                            filePath: fFilePath,
                            line: i + 1,
                            column: 1
                        });
                        continue;
                    }
                    // Resolve the sub .f path (relative to the current .f directory)
                    const subFAbs = path.isAbsolute(subFPath)
                        ? subFPath
                        : path.resolve(fDir, subFPath);
                    // -f: keep the current baseDir (do not switch to the sub .f directory)
                    this.parseFFileRecursive(subFAbs, baseDir, workspaceRoot, errors, result, visited);
                    continue;
                }

                // ── Ordinary line: a TCL file path (relative to baseDir, or absolute) ──
                let absPath: string;
                if (path.isAbsolute(cleanLine)) {
                    absPath = cleanLine;
                } else {
                    absPath = path.resolve(baseDir, cleanLine);
                }

                result.push(absPath);
            }
        } catch (e: any) {
            errors.push({
                message: `Failed to read .f file: ${e.message}`,
                filePath: fFilePath,
                line: 1,
                column: 1
            });
        }
    }

    /**
     * Handle the source command by inserting the referenced file into the compilation order.
     */
    private processSourceCommands(
        parseResult: ParseResult,
        currentFilePath: string,
        currentOrder: number,
        fileList: string[],
        errors: CompileError[],
        variables?: Map<string, VariableInfo[]>
    ): void {
        const currentDir = path.dirname(currentFilePath);
        for (const srcNode of parseResult.sources) {
            let rawPath = srcNode.filePath;

            // When the path contains a variable reference, try to resolve it from the symbol table
            if (rawPath.includes('$')) {
                const resolved = this.resolveVarPath(rawPath, variables);
                if (!resolved) {
                    // The variable is undefined, the path cannot be resolved statically — skip the check
                    continue;
                }
                rawPath = resolved;
            }

            let absPath: string;
            if (path.isAbsolute(rawPath)) {
                absPath = rawPath;
            } else {
                absPath = path.resolve(currentDir, rawPath);
            }

            // Guard against circular references
            if (this.processedSourceFiles.has(absPath)) {
                continue;
            }

            if (!fs.existsSync(absPath)) {
                errors.push({
                    message: t('compile.sourceNotFound', srcNode.filePath),
                    filePath: currentFilePath,
                    line: srcNode.line,
                    column: srcNode.column
                });
                continue;
            }

            // Append it to the end when it is not already in fileList
            if (!fileList.includes(absPath)) {
                fileList.push(absPath);
                this.compileOrder.push(absPath);
            }
            this.processedSourceFiles.add(absPath);
        }
    }

    /**
     * Resolve the $varName references inside a path.
     * @returns the resolved path, or null when a variable is undefined
     */
    private resolveVarPath(rawPath: string, variables?: Map<string, VariableInfo[]>): string | null {
        if (!variables) { return null; }

        let resolved = rawPath;
        const varRegex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
        let match: RegExpExecArray | null;

        while ((match = varRegex.exec(rawPath)) !== null) {
            const varName = match[2];
            const defs = variables.get(varName);
            if (!defs || defs.length === 0) { return null; }
            // Use the most recent definition
            const lastDef = defs[defs.length - 1];
            if (!lastDef.isResolved) { return null; }
            resolved = resolved.replace(match[0], lastDef.value);
        }

        return resolved;
    }

    /**
     * Get or parse a file (using the cache).
     */
    private getOrParse(filePath: string, content: string): ParseResult {
        const cached = this.cache.get(filePath);
        if (cached) { return cached; }
        const result = parse(filePath, content);
        this.cache.set(filePath, result);
        return result;
    }

    /**
     * Build the global symbol table.
     * Processes the set and varRef nodes of every file in compilation order.
     */
    private buildSymbolTable(units: CompilationUnit[]): {
        variables: Map<string, VariableInfo[]>;
        varRefs: VariableRefInfo[];
        varErrors: CompileError[];
        varWarnings: CompileWarning[];
    } {
        // Variables: Map<varName, list of definitions (in compilation order)>
        const variables = new Map<string, VariableInfo[]>();
        const varRefs: VariableRefInfo[] = [];
        const varErrors: CompileError[] = [];
        const varWarnings: CompileWarning[] = [];

        // Process every set in compilation order
        for (const unit of units) {
            for (const setNode of unit.sets) {
                const simpleValue = resolveSimpleValue(setNode.valueText);
                const hasUnresolved = containsVarRef(setNode.valueText);

                const info: VariableInfo = {
                    name: setNode.varName,
                    value: simpleValue,
                    rawValue: setNode.valueText,
                    filePath: unit.filePath,
                    relativePath: unit.relativePath,
                    line: setNode.line,
                    column: setNode.column,
                    order: unit.order,
                    isResolved: !hasUnresolved,
                    rawText: setNode.rawText
                };

                const existing = variables.get(setNode.varName);
                if (existing) {
                    existing.push(info);
                } else {
                    variables.set(setNode.varName, [info]);
                }
            }
        }

        // Handle the implicit variable definitions of foreach / lassign / gets / catch / scan
        for (const unit of units) {
            for (const cmd of unit.parseResult.commands) {
                addCmdDefinedVars(cmd, unit, cmd.line, cmd.column, variables);

                // Recursively parse the code blocks of top-level control-flow commands
                // (for init/incr/body, if body, ...)
                const bodyIndices = getControlFlowBodyIndices(cmd.commandName, cmd.args);
                for (const bi of bodyIndices) {
                    const bodyToken = cmd.args[bi];
                    const bodyText = bodyToken.value;
                    if (!bodyText || bodyText.trim().length === 0) { continue; }
                    const bodyResult = parse(unit.filePath, bodyText);
                    const bodyLineOffset = bodyToken.line - 1;
                    extractVarsDeep(bodyResult, unit, bodyLineOffset, variables);
                }
            }

            // Handle every variable definition inside a proc body (recursing into nested bodies)
            for (const proc of unit.procs) {
                if (!proc.bodyText) { continue; }
                const bodyResult = parse(unit.filePath, proc.bodyText);
                const lineOffset = proc.bodyStartLine - 1;

                // Recursively extract every variable in the proc body
                // (including nested if/while/for/foreach/switch bodies)
                extractVarsDeep(bodyResult, unit, lineOffset, variables);
            }
        }

        // Resolve the references between variables
        for (const unit of units) {
            for (const refNode of unit.varRefs) {
                const varName = refNode.varName;
                const definitions = variables.get(varName);

                // Find the most recent definition before this reference (in compilation order)
                let definition: VariableInfo | null = null;
                if (definitions && definitions.length > 0) {
                    // Find the closest definition (earlier in the same file, or in an earlier file)
                    for (let di = definitions.length - 1; di >= 0; di--) {
                        const def = definitions[di];
                        if (def.order < unit.order ||
                            (def.order === unit.order && def.line <= refNode.line)) {
                            definition = def;
                            break;
                        }
                    }
                    // When every definition comes after the reference, take the first one
                    // (it may be a forward declaration)
                    if (!definition) {
                        definition = definitions[0];
                        varWarnings.push({
                            message: t('compile.usedBeforeDefined', varName, unit.relativePath, refNode.line, definition.relativePath, definition.line),
                            filePath: unit.filePath,
                            line: refNode.line,
                            column: refNode.column
                        });
                    }
                } else {
                    // Undefined variable
                    // Check whether it is a proc argument
                    let isProcArg = false;
                    for (const pu of units) {
                        for (const proc of pu.procs) {
                            if (proc.args.includes(varName)) {
                                isProcArg = true;
                                break;
                            }
                        }
                        if (isProcArg) { break; }
                    }

                    if (!isProcArg) {
                        varErrors.push({
                            message: t('compile.undefinedVariable', varName),
                            filePath: unit.filePath,
                            line: refNode.line,
                            column: refNode.column
                        });
                    }
                }

                const refInfo: VariableRefInfo = {
                    name: varName,
                    filePath: unit.filePath,
                    relativePath: unit.relativePath,
                    line: refNode.line,
                    column: refNode.column,
                    rawText: refNode.rawText,
                    definition
                };
                varRefs.push(refInfo);
            }
        }

        return { variables, varRefs, varErrors, varWarnings };
    }

    /**
     * Incremental compilation: update the symbol table when a single file changes.
     * @param changedFilePath - the absolute path of the changed file
     * @param content - the new file content
     */
    incrementalUpdate(changedFilePath: string, content: string, lastResult: CompileResult): CompileResult {
        // Drop the cache entry for this file
        this.cache.delete(changedFilePath);

        // Re-parse the file
        const parseResult = parse(changedFilePath, content);
        this.cache.set(changedFilePath, parseResult);

        // Find or create the matching CompilationUnit
        const relPath = path.relative(lastResult.workspaceRoot, changedFilePath);
        let unit = lastResult.units.find(u => u.filePath === changedFilePath);
        const order = unit ? unit.order : lastResult.units.length;

        const newUnit: CompilationUnit = {
            filePath: changedFilePath,
            relativePath: relPath,
            order,
            parseResult,
            sets: parseResult.sets,
            varRefs: parseResult.varRefs,
            sources: parseResult.sources,
            procs: parseResult.procs
        };

        if (unit) {
            // Replace the old unit
            const idx = lastResult.units.indexOf(unit);
            lastResult.units[idx] = newUnit;
        } else {
            lastResult.units.push(newUnit);
        }

        // Rebuild the symbol table
        const { variables, varRefs, varErrors, varWarnings } =
            this.buildSymbolTable(lastResult.units);

        lastResult.variables = variables;
        lastResult.variableRefs = varRefs;
        lastResult.errors = varErrors;
        lastResult.warnings = varWarnings;

        return lastResult;
    }

    /**
     * Look up the definition information of a variable.
     * @param varName the variable name
     * @param result the compilation result
     * @param refFile the file holding the reference
     * @param refLine the line holding the reference
     */
    queryVariable(
        varName: string,
        result: CompileResult,
        refFile?: string,
        refLine?: number
    ): { definition: VariableInfo | null; allDefs: VariableInfo[]; refs: VariableRefInfo[] } {
        const allDefs = result.variables.get(varName) || [];
        const refs = result.variableRefs.filter(r => r.name === varName);

        let definition: VariableInfo | null = null;
        if (allDefs.length > 0) {
            if (refFile && refLine) {
                // Find the most recent definition before this reference
                const unit = result.units.find(u => u.filePath === refFile);
                const refOrder = unit ? unit.order : 99999;
                for (let di = allDefs.length - 1; di >= 0; di--) {
                    const def = allDefs[di];
                    if (def.order < refOrder ||
                        (def.order === refOrder && def.line <= refLine)) {
                        definition = def;
                        break;
                    }
                }
                if (!definition) {
                    definition = allDefs[allDefs.length - 1];
                }
            } else {
                // Take the value of the last definition
                definition = allDefs[allDefs.length - 1];
            }
        }

        return { definition, allDefs, refs };
    }

    /**
     * Get every file path in the compilation order.
     */
    getCompileOrder(): string[] {
        return [...this.compileOrder];
    }
}
