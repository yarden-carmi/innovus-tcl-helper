/**
 * Diagnostics Provider - TCL static checking + Innovus command argument validation
 *
 * Three levels of checking (controlled by innovus-tcl.diagnosticLevel):
 *   "basic"    — bracket matching, quote matching
 *   "standard" — basic + required command argument checks
 *   "strict"   — standard + similar command suggestions + argument type validation
 *                + duplicate argument detection
 */

import * as vscode from 'vscode';
import { getDB } from './commands';
import { t } from './i18n';

type DiagnosticLevel = 'basic' | 'standard' | 'strict';

export class TclDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    // The full set of TCL 9.0 built-in commands (grouped by purpose).
    // Used to skip Innovus command validation so that standard TCL commands
    // are never reported as "unknown command".
    private static readonly TCL_BUILTINS = new Set([
        // ── Core: variables and assignment ──
        'set', 'unset', 'incr', 'append', 'lappend', 'subst',
        'global', 'variable', 'upvar', 'uplevel',
        'namespace', 'rename',
        // ── Core: procedures and scoping ──
        'proc', 'return', 'apply', 'tailcall', 'yield', 'yieldto',
        'coroutine', 'coroinject', 'coroprobe',
        // ── Core: evaluation and sourcing ──
        'eval', 'expr', 'source',
        // ── Control flow ──
        'if', 'else', 'elseif', 'switch', 'for', 'foreach', 'while',
        'break', 'continue', 'try', 'throw', 'catch', 'error',
        // ── List operations ──
        'list', 'concat', 'join', 'split', 'lindex', 'llength',
        'lsearch', 'lsort', 'lrange', 'lreplace', 'linsert', 'lset',
        'lassign', 'lrepeat', 'lreverse', 'lmap', 'lpop', 'lremove', 'ledit',
        'lseq',
        // ── Dictionary operations ──
        'dict',
        // ── Array operations ──
        'array', 'parray',
        // ── String operations ──
        'string', 'format', 'scan', 'regexp', 'regsub',
        // ── File I/O ──
        'open', 'close', 'read', 'write', 'gets', 'puts', 'seek', 'tell',
        'eof', 'flush', 'fconfigure', 'fcopy', 'fblocked', 'fileevent',
        'readFile', 'writeFile',
        // ── File system ──
        'file', 'glob', 'cd', 'pwd', 'filename',
        // ── Processes and system ──
        'exec', 'pid', 'exit', 'socket', 'chan', 'transchan', 'refchan',
        // ── Time and events ──
        'after', 'clock', 'time', 'timerate', 'vwait', 'update',
        // ── Package management ──
        'package', 'load', 'unload', 'pkg_mkIndex', 'pkg::create',
        // ── Information and introspection ──
        'info', 'encoding', 'binary',
        // ── Environment and configuration ──
        'env', 'configure',
        // ── Tracing and debugging ──
        'trace', 'interp', 'history', 'memory',
        // ── Error handling ──
        'bgerror', 'errorCode', 'errorInfo',
        // ── Tcl platform variables ──
        'tcl_version', 'tcl_patchLevel', 'tcl_pkgPath', 'tcl_platform',
        'tcl_library', 'tcl_interactive', 'tcl_rcFileName',
        'tcl_nonwordchars', 'tcl_wordchars',
        'tcl_startOfNextWord', 'tcl_startOfPreviousWord',
        'tcl_endOfWord', 'tcl_wordBreakAfter', 'tcl_wordBreakBefore',
        'tcl_traceCompile', 'tcl_traceExec', 'tcl_findLibrary',
        // ── Global variables ──
        'env', 'argc', 'argv', 'argv0', 'auto_path',
        'auto_execok', 'auto_import', 'auto_load',
        'auto_mkindex', 'auto_qualify', 'auto_reset',
        // ── OOP (TclOO) ──
        'oo::class', 'oo::define', 'oo::objdefine', 'oo::object',
        'oo::abstract', 'oo::singleton', 'oo::configurable',
        'oo::copy', 'oo::Slot',
        'my', 'myclass', 'mymethod', 'self', 'next', 'nextto',
        'classvariable', 'const', 'property',
        // ── Compression ──
        'zipfs', 'zlib',
        // ── Miscellaneous ──
        'unknown', 're_syntax', 'callback', 'safe', 'tcltest',
        'tm', 'platform', 'platform::shell', 'link', 'dde',
        'registry', 'http', 'cookiejar', 'msgcat',
        'tcl::idna', 'tcl::prefix', 'tcl::process',
        'Tcl', 'buildinfo',
        'fpclassify', 'mathfunc', 'mathop', 'tcl::mathop',
    ]);

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('innovus-tcl');
    }

    /** Get the current diagnostic level */
    private getLevel(): DiagnosticLevel {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('diagnosticLevel', 'standard') as DiagnosticLevel;
    }

    /** Run the diagnostics over the whole document */
    updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'tcl') { return; }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const db = getDB();
        const level = this.getLevel();

        // 1. Bracket matching (all levels)
        this.checkBrackets(document, text, diagnostics);

        // 2. Quote matching (all levels)
        this.checkQuotes(document, text, diagnostics);

        // 3. Command argument checks (standard + strict)
        if (level !== 'basic') {
            this.checkCommandArgs(document, text, diagnostics, db, level);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /** Bracket matching — tailored to the TCL [] {} syntax */
    private checkBrackets(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const lines = text.split('\n');
        let braceDepth = 0;
        let bracketDepth = 0;
        let inString = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comment-only lines
            if (line.trimStart().startsWith('#')) { continue; }

            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                const prevCh = j > 0 ? line[j - 1] : '';

                // Skip escaped characters
                if (ch === '\\' && j + 1 < line.length) {
                    j++;
                    continue;
                }

                // Track the double-quoted string state
                if (ch === '"' && prevCh !== '\\') {
                    inString = !inString;
                    continue;
                }

                // Skip comments (when not inside a string)
                if (!inString && ch === '#' && prevCh !== '\\') {
                    break; // Trailing comment, skip the rest of the line
                }

                // Brackets inside a string do not count (TCL never executes [] inside a string)
                if (inString) { continue; }

                if (ch === '[') { bracketDepth++; }
                if (ch === ']') { bracketDepth--; }
                if (ch === '{') { braceDepth++; }
                if (ch === '}') { braceDepth--; }

                if (bracketDepth < 0) {
                    diagnostics.push(this.createDiagnostic(
                        document, i, j, j + 1,
                        t('diag.extraBracket'),
                        vscode.DiagnosticSeverity.Error
                    ));
                    bracketDepth = 0;
                }
                if (braceDepth < 0) {
                    diagnostics.push(this.createDiagnostic(
                        document, i, j, j + 1,
                        t('diag.extraBrace'),
                        vscode.DiagnosticSeverity.Error
                    ));
                    braceDepth = 0;
                }
            }
        }

        if (bracketDepth > 0) {
            const lastLine = lines.length - 1;
            diagnostics.push(this.createDiagnostic(
                document, lastLine, 0, 1,
                t('diag.missingBracket', bracketDepth),
                vscode.DiagnosticSeverity.Error
            ));
        }
        if (braceDepth > 0) {
            const lastLine = lines.length - 1;
            diagnostics.push(this.createDiagnostic(
                document, lastLine, 0, 1,
                t('diag.missingBrace', braceDepth),
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    /** Quote matching */
    private checkQuotes(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trimStart().startsWith('#')) { continue; }

            let inString = false;
            let stringStart = -1;

            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                // Skip escaped characters
                if (ch === '\\' && j + 1 < line.length) {
                    j++;
                    continue;
                }
                if (ch === '"') {
                    if (!inString) {
                        inString = true;
                        stringStart = j;
                    } else {
                        inString = false;
                    }
                }
            }

            if (inString) {
                diagnostics.push(this.createDiagnostic(
                    document, i, stringStart, stringStart + 1,
                    t('diag.unclosedQuote'),
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    }

    /** Innovus command argument checks + similar command suggestions */
    private checkCommandArgs(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[],
        db: ReturnType<typeof getDB>,
        level: DiagnosticLevel
    ): void {
        const rawLines = text.split('\n');
        const allCommandNames = db.getCommandNames();

        // ── Pre-processing: join TCL backslash continuations
        //    (a trailing \ means the next line continues this one) ──
        const lines: { text: string; startLine: number }[] = [];
        for (let i = 0; i < rawLines.length; i++) {
            let current = rawLines[i];
            let startLine = i;
            // When the line ends with \ (possibly followed by whitespace), join the next one
            while (i < rawLines.length && /\\\s*$/.test(current)) {
                current = current.replace(/\\\s*$/, '') + ' ' + (rawLines[i + 1] || '');
                i++;
            }
            lines.push({ text: current.trim(), startLine });
        }

        for (let li = 0; li < lines.length; li++) {
            const line = lines[li].text;
            const lineIdx = lines[li].startLine;
            if (!line || line.startsWith('#')) { continue; }

            // Skip TCL built-in commands
            const firstToken = line.split(/\s/)[0];
            if (TclDiagnosticsProvider.TCL_BUILTINS.has(firstToken)) {
                continue;
            }

            // Take the first word as a candidate command name
            const firstWordMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (!firstWordMatch) { continue; }

            const cmdName = firstWordMatch[1];
            const cmdStartIdx = line.indexOf(cmdName);

            // === Known command: check its arguments ===
            if (db.isCommand(cmdName)) {
                const cmdInfo = db.get(cmdName);
                if (cmdInfo && cmdInfo.options) {
                    const parsedArgs = this.parseArguments(line, cmdInfo.options);

                    // Check for duplicate options (strict level)
                    if (level === 'strict') {
                        const flagCounts = new Map<string, number>();
                        for (const [flag] of parsedArgs) {
                            flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
                        }
                        for (const [flag, count] of flagCounts) {
                            if (count > 1) {
                                const flagIdx = line.lastIndexOf(flag);
                                diagnostics.push(this.createDiagnostic(
                                    document, lineIdx, flagIdx, flagIdx + flag.length,
                                    t('diag.duplicateOption', flag, count),
                                    vscode.DiagnosticSeverity.Warning
                                ));
                            }
                        }
                    }

                    // Check the required options.
                    // First parse the mutually exclusive groups out of the usage string.
                    const altGroups = cmdInfo.usage
                        ? this.parseAlternativeGroups(cmdInfo.usage)
                        : { mandatory: [] as Set<string>[], optional: [] as Set<string>[] };
                    const allAltGroups = [...altGroups.mandatory, ...altGroups.optional];

                    for (const opt of cmdInfo.options) {
                        if (!opt.required) { continue; }

                        // Skip members of an already satisfied exclusive group
                        // (one present member is enough for the whole group)
                        if (parsedArgs.has(opt.name)) { continue; }
                        const inSatisfiedGroup = allAltGroups.some(group =>
                            group.has(opt.name) &&
                            [...group].some(member => parsedArgs.has(member))
                        );
                        if (inSatisfiedGroup) { continue; }

                        // Part of an optional exclusive group with every member missing
                        // → no diagnostic (optional groups may be omitted entirely)
                        const inOptionalGroup = altGroups.optional.some(group =>
                            group.has(opt.name)
                        );
                        if (inOptionalGroup) { continue; }

                        // Check whether the whole mandatory exclusive group is missing
                        const inMandatoryGroup = altGroups.mandatory.some(group =>
                            group.has(opt.name)
                        );
                        if (inMandatoryGroup) {
                            // Find the group and report it once, using its first member as representative
                            for (const group of altGroups.mandatory) {
                                if (group.has(opt.name)) {
                                    const members = [...group];
                                    if (members[0] === opt.name) {
                                        const memberList = members.join(' | ');
                                        diagnostics.push(this.createDiagnostic(
                                            document, lineIdx,
                                            cmdStartIdx, cmdStartIdx + cmdName.length,
                                            t('diag.missingExclusive', memberList),
                                            vscode.DiagnosticSeverity.Warning
                                        ));
                                    }
                                    break;
                                }
                            }
                            continue;
                        }

                        // Regular required option check
                        if (!parsedArgs.has(opt.name)) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx,
                                cmdStartIdx, cmdStartIdx + cmdName.length,
                                t('diag.missingRequired', opt.name, opt.description),
                                vscode.DiagnosticSeverity.Warning
                            ));
                        } else if (opt.type !== 'flag' && !parsedArgs.get(opt.name)) {
                            const flagIdx = line.indexOf(opt.name);
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx,
                                flagIdx, flagIdx + opt.name.length,
                                t('diag.needsValue', opt.name, opt.type),
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }

                    // strict level: argument value type checks
                    if (level === 'strict') {
                        this.checkParamTypes(document, lineIdx, line, cmdInfo.options, parsedArgs, diagnostics);
                    }
                }
                continue;
            }

            // === Known entry (mode variable): skip the argument validation ===
            if (db.isKnown(cmdName)) {
                continue;
            }

            // === strict level: unknown command → similar command suggestions ===
            if (level === 'strict' && cmdName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
                const similar = this.findSimilarCommands(cmdName, allCommandNames);
                if (similar.length > 0) {
                    const suggestions = similar.map(s => `\`${s}\``).join(', ');
                    diagnostics.push(this.createDiagnostic(
                        document, lineIdx,
                        cmdStartIdx, cmdStartIdx + cmdName.length,
                        t('diag.unknownCommand', cmdName, suggestions),
                        vscode.DiagnosticSeverity.Information
                    ));
                }
            }
        }
    }

    /** strict level: argument value type validation */
    private checkParamTypes(
        document: vscode.TextDocument,
        lineIdx: number,
        line: string,
        options: import('./commands').CmdOption[],
        parsedArgs: Map<string, string | null>,
        diagnostics: vscode.Diagnostic[]
    ): void {
        for (const opt of options) {
            const value = parsedArgs.get(opt.name);
            if (value === null || value === undefined) { continue; }

            // Check that the type matches
            switch (opt.type) {
                case 'int':
                    // Accepts integers, [expr ...], $var and ${var}
                    if (!/^-?\d+$/.test(value) &&
                        !/^\s*\[/.test(value) &&
                        !/^\s*\$\w/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                t('diag.expectInt', opt.name, value),
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    break;
                case 'float':
                    // Accepts floats, [expr ...], $var and ${var}
                    if (!/^-?\d+\.?\d*$/.test(value) &&
                        !/^\s*\[/.test(value) &&
                        !/^\s*\$\w/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                t('diag.expectFloat', opt.name, value),
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    break;
                case 'point':
                    // Accepts coordinates, [expr ...] and $var
                    if (!/^\{?\s*-?\d+\.?\d*\s+-?\d+\.?\d*\s*\}?$/.test(value) &&
                        !/^\s*\[/.test(value) &&
                        !/^\s*\$\w/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                t('diag.expectPoint', opt.name, value),
                                vscode.DiagnosticSeverity.Information
                            ));
                        }
                    }
                    break;
            }
        }
    }

    /**
     * Parse the command line arguments and return Map<paramName, value | null>.
     * Two kinds of argument are supported:
     *   -flag arguments: named -xxx, optionally followed by a value (flag types map to null)
     *   <positional> arguments: named <xxx>, matched against the remaining
     *                           non-flag tokens in the order of options
     *
     * @param line     - the command line text
     * @param options  - the command option definitions (used to identify positional
     *                   arguments and their order)
     */
    private parseArguments(line: string, options?: import('./commands').CmdOption[]): Map<string, string | null> {
        const args = new Map<string, string | null>();
        const tokens = this.splitTclArgs(line);
        const consumed = new Set<number>(); // Indices of the tokens already consumed

        // ── First pass: parse the -flag arguments ──
        // Build the option lookup table (used to detect flag types)
        const optionMap = new Map<string, import('./commands').CmdOption>();
        if (options) {
            for (const opt of options) {
                optionMap.set(opt.name, opt);
            }
        }

        for (let idx = 1; idx < tokens.length; idx++) {
            if (consumed.has(idx)) { continue; }
            const token = tokens[idx];
            if (token.startsWith('-')) {
                const cleanFlag = token.replace(/[,;]$/, '');
                consumed.add(idx);
                // Look up the flag definition to see whether it is a pure flag (takes no value)
                const optDef = optionMap.get(cleanFlag);
                const isPureFlag = optDef?.type === 'flag';
                if (!isPureFlag && idx + 1 < tokens.length && !tokens[idx + 1].startsWith('-')) {
                    // Not a pure flag: the next token is its value
                    let nextToken = tokens[idx + 1];
                    nextToken = nextToken.replace(/[,;]$/, '');
                    nextToken = nextToken.replace(/^\{/, '').replace(/\}$/, '');
                    args.set(cleanFlag, nextToken);
                    consumed.add(idx + 1);
                    idx++;
                } else {
                    // Pure flag (or end of line): null means "present"
                    args.set(cleanFlag, null);
                }
            }
        }

        // ── Second pass: match the positional arguments (non-flag options named <...>) ──
        if (options && options.length > 0) {
            const positionalOpts = options.filter(
                o => o.name.startsWith('<') && !o.name.startsWith('-')
            );
            if (positionalOpts.length > 0) {
                let posIdx = 0;
                for (let idx = 1; idx < tokens.length; idx++) {
                    if (consumed.has(idx)) { continue; }
                    if (posIdx >= positionalOpts.length) { break; }
                    const token = tokens[idx];
                    // Skip flag values (already marked by the previous pass) and flag-looking tokens
                    if (token.startsWith('-')) { continue; }
                    const cleanToken = token.replace(/[,;]$/, '');
                    args.set(positionalOpts[posIdx].name, cleanToken);
                    consumed.add(idx);
                    posIdx++;
                }
                // Mark the remaining unmatched positional arguments as missing (null)
                for (let pi = posIdx; pi < positionalOpts.length; pi++) {
                    if (!args.has(positionalOpts[pi].name)) {
                        args.set(positionalOpts[pi].name, null);
                    }
                }
            }
        }

        return args;
    }

    /**
     * Split the command line arguments following the TCL syntax, keeping
     * [...] and {...} atomic — e.g. "[list $A $B]" stays a single token
     * instead of being split on whitespace.
     */
    private splitTclArgs(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let bracketDepth = 0;
        let braceDepth = 0;
        let inString = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            const prevCh = i > 0 ? line[i - 1] : '';

            // Double-quoted strings
            if (ch === '"' && prevCh !== '\\' && braceDepth === 0 && bracketDepth === 0) {
                inString = !inString;
                current += ch;
                continue;
            }

            // Inside a string, append verbatim
            if (inString) {
                current += ch;
                continue;
            }

            // Braces
            if (ch === '{') {
                braceDepth++;
                current += ch;
                continue;
            }
            if (ch === '}') {
                braceDepth = Math.max(0, braceDepth - 1);
                current += ch;
                continue;
            }

            // Brackets
            if (ch === '[') {
                bracketDepth++;
                current += ch;
                continue;
            }
            if (ch === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                current += ch;
                continue;
            }

            // Backslash escape (skip the next character)
            if (ch === '\\' && i + 1 < line.length) {
                current += ch;
                i++;
                current += line[i];
                continue;
            }

            // Whitespace: split when outside any nesting
            if (/\s/.test(ch) && braceDepth === 0 && bracketDepth === 0) {
                if (current.length > 0) {
                    result.push(current);
                    current = '';
                }
                continue;
            }

            current += ch;
        }

        // The final token
        if (current.length > 0) {
            result.push(current);
        }

        return result;
    }

    /** Find similar commands using the edit distance */
    private findSimilarCommands(target: string, candidates: string[]): string[] {
        const lower = target.toLowerCase();
        const scored: { name: string; score: number }[] = [];

        // Prefix matches first
        for (const name of candidates) {
            if (name.toLowerCase().startsWith(lower)) {
                scored.push({ name, score: 0 });
                if (scored.length >= 3) { break; }
            }
        }

        // Substring matches
        if (scored.length < 3) {
            for (const name of candidates) {
                if (name.toLowerCase().includes(lower) && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: 1 });
                    if (scored.length >= 3) { break; }
                }
            }
        }

        // Edit distance ≤ 3
        if (scored.length < 3) {
            for (const name of candidates) {
                const dist = levenshtein(lower, name.toLowerCase());
                if (dist <= 3 && dist > 0 && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: dist + 2 });
                    if (scored.length >= 3) { break; }
                }
            }
        }

        return scored.sort((a, b) => a.score - b.score).slice(0, 3).map(s => s.name);
    }

    /**
     * Parse the mutually exclusive option groups out of a usage string.
     * Three formats are supported:
     *   {-opt1 | -opt2}     — brace group (at least one must be chosen)
     *   [-opt1 | -opt2]     — bracket group (optional, at most one)
     *   -opt1 | -opt2       — bare trailing group (at least one must be chosen)
     *
     * @returns { mandatory, optional } — a mandatory group needs at least one member;
     *          an optional group may have every member missing without a diagnostic
     */
    private parseAlternativeGroups(usage: string): { mandatory: Set<string>[]; optional: Set<string>[] } {
        const mandatory: Set<string>[] = [];
        const optional: Set<string>[] = [];

        // ── Format 1: {xxx | yyy | zzz} → mandatory ──
        // Depth tracking handles nested braces (e.g. {-layer {layer | {top ...}}})
        const braceGroups = this.extractNestedBraces(usage);
        for (const content of braceGroups) {
            if (!content.includes('|')) { continue; }
            const members = content.split('|').map(s => s.trim().split(/\s+/)[0]).filter(s => s.length > 0);
            if (members.length >= 2) {
                mandatory.push(new Set(members));
            }
        }

        // ── Format 2: [...|...] → optional ──
        let match: RegExpExecArray | null;
        const bracketRegex = /\[([^\]]*\|[^\]]*)\]/g;
        while ((match = bracketRegex.exec(usage)) !== null) {
            const content = match[1];
            if (!content.includes('|')) { continue; }
            const members = content.split('|').map(s => s.trim().split(/\s+/)[0]).filter(s => s.length > 0);
            if (members.length >= 2) {
                optional.push(new Set(members));
            }
        }

        // ── Format 3: trailing, unbracketed -opt1 | -opt2 → mandatory ──
        const unbracketedRegex = /(?:^|\s)(-[a-zA-Z_][a-zA-Z0-9_]*\s*\|\s*-[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\|\s*-[a-zA-Z_][a-zA-Z0-9_]*)*)\s*$/;
        const ubMatch = usage.match(unbracketedRegex);
        if (ubMatch) {
            const content = ubMatch[1].trim();
            // Make sure it is not inside braces or brackets
            const openBrace = usage.lastIndexOf('{', ubMatch.index!);
            const closeBrace = usage.lastIndexOf('}', ubMatch.index!);
            const openBracket = usage.lastIndexOf('[', ubMatch.index!);
            const closeBracket = usage.lastIndexOf(']', ubMatch.index!);
            const inBrace = openBrace >= 0 && openBrace > closeBrace;
            const inBracket = openBracket >= 0 && openBracket > closeBracket;
            if (!inBrace && !inBracket) {
                const members = content.split('|').map(s => s.trim().split(/\s+/)[0]).filter(s => s.length > 0);
                if (members.length >= 2) {
                    const memberSet = new Set(members);
                    const isDuplicate = [...mandatory, ...optional].some(g =>
                        g.size === memberSet.size && [...g].every(m => memberSet.has(m))
                    );
                    if (!isDuplicate) {
                        mandatory.push(memberSet);
                    }
                }
            }
        }

        return { mandatory, optional };
    }

    /**
     * Extract the contents of every top-level {...} group from a string.
     * Nested braces are handled correctly (depth tracking, no early truncation).
     */
    private extractNestedBraces(text: string): string[] {
        const results: string[] = [];
        let i = 0;
        while (i < text.length) {
            if (text[i] === '{') {
                let depth = 1;
                let j = i + 1;
                while (j < text.length && depth > 0) {
                    if (text[j] === '{') { depth++; }
                    else if (text[j] === '}') { depth--; }
                    j++;
                }
                if (depth === 0) {
                    // Take the content inside {...} (without the outer braces)
                    results.push(text.substring(i + 1, j - 1));
                }
                i = j;
            } else {
                i++;
            }
        }
        return results;
    }

    private createDiagnostic(
        document: vscode.TextDocument,
        line: number,
        startChar: number,
        endChar: number,
        message: string,
        severity: vscode.DiagnosticSeverity
    ): vscode.Diagnostic {
        const range = new vscode.Range(line, startChar, line, endChar);
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'Innovus TCL';
        return diagnostic;
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

/** Levenshtein edit distance */
function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) { return n; }
    if (n === 0) { return m; }

    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1];
            } else {
                curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
            }
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}
