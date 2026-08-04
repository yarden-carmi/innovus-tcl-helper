/**
 * TCL AST parser — tokenizer + parser
 *
 * Parses the key syntactic structures of a TCL script:
 *   - set varName value          → variable assignment
 *   - $varName / ${varName}      → variable reference
 *   - source file.tcl            → file inclusion
 *   - proc name {args} {body}    → procedure definition
 *   - [command ...]              → command substitution (nested command in brackets)
 *   - "string" / {literal}       → string/literal
 *   - # comment                  → comment
 *
 * Used for cross-file variable tracking and lint analysis.
 */

// ════════════════════════════════════════════════════════════
//  Token type definitions
// ════════════════════════════════════════════════════════════

export enum TokenType {
    COMMAND = 'COMMAND',         // command name (the first word)
    WORD = 'WORD',               // plain argument word
    STRING = 'STRING',           // "double-quoted string"
    BRACED = 'BRACED',           // {braced literal}
    VARIABLE_REF = 'VAR_REF',    // $varName or ${varName}
    NEWLINE = 'NEWLINE',         // newline (statement separator)
    EOF = 'EOF',                 // end of file
    SEMICOLON = 'SEMICOLON',     // ; semicolon (the other statement separator)
    COMMENT = 'COMMENT',         // # comment
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;       // 1-based
    column: number;     // 1-based
    rawLength: number;  // length of the raw text
}

// ════════════════════════════════════════════════════════════
//  AST node type definitions
// ════════════════════════════════════════════════════════════

/** Variable assignment node */
export interface SetNode {
    kind: 'set';
    varName: string;
    valueTokens: Token[];      // tokens of the value part (may contain variable references)
    valueText: string;         // raw value text
    line: number;
    column: number;
    rawText: string;           // raw text of the whole line
}

/** Variable reference node */
export interface VarRefNode {
    kind: 'var_ref';
    varName: string;           // variable name without the $ prefix
    isBraceForm: boolean;      // ${varName} vs $varName
    line: number;
    column: number;
    rawText: string;
}

/** File inclusion node */
export interface SourceNode {
    kind: 'source';
    filePath: string;
    line: number;
    column: number;
    rawText: string;
}

/** Procedure definition node */
export interface ProcNode {
    kind: 'proc';
    procName: string;
    args: string[];            // argument names only (no default values)
    bodyStartLine: number;     // first line of the body
    bodyEndLine: number;       // last line of the body
    bodyText: string;          // body text (without the outer braces)
    line: number;
    column: number;
    rawText: string;
}

/** Generic command call node */
export interface CommandNode {
    kind: 'command';
    commandName: string;
    args: Token[];
    line: number;
    column: number;
    rawText: string;
}

export type AstNode = SetNode | VarRefNode | SourceNode | ProcNode | CommandNode;

// ════════════════════════════════════════════════════════════
//  Parse result
// ════════════════════════════════════════════════════════════

export interface ParseResult {
    filePath: string;
    nodes: AstNode[];
    // Fast lookup indexes
    sets: SetNode[];
    varRefs: VarRefNode[];
    sources: SourceNode[];
    procs: ProcNode[];
    commands: CommandNode[];
    errors: ParseError[];
}

export interface ParseError {
    message: string;
    line: number;
    column: number;
}

// ════════════════════════════════════════════════════════════
//  Tokenizer
// ════════════════════════════════════════════════════════════

/**
 * Break the TCL text into a token stream.
 * Handles: double-quoted strings, braced literals, variable references,
 * bracketed command substitution, comments and line continuations.
 */
export function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    const len = text.length;
    let pos = 0;
    let line = 1;
    let col = 1;

    function advance(): string {
        const ch = text[pos];
        pos++;
        if (ch === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
        return ch;
    }

    function peek(): string {
        return pos < len ? text[pos] : '';
    }

    function peekAhead(n: number): string {
        return pos + n < len ? text[pos + n] : '';
    }

    while (pos < len) {
        const startLine = line;
        const startCol = col;
        const ch = text[pos];

        // Whitespace
        if (ch === ' ' || ch === '\t' || ch === '\r') {
            advance();
            continue;
        }

        // Newline
        if (ch === '\n') {
            advance();
            tokens.push({ type: TokenType.NEWLINE, value: '\n', line: startLine, column: startCol, rawLength: 1 });
            continue;
        }

        // Semicolon
        if (ch === ';') {
            advance();
            tokens.push({ type: TokenType.SEMICOLON, value: ';', line: startLine, column: startCol, rawLength: 1 });
            continue;
        }

        // Backslash line continuation
        if (ch === '\\' && peek() === '\n') {
            advance(); // \
            advance(); // \n
            // Skip the whitespace after the continuation
            while (peek() === ' ' || peek() === '\t') {
                advance();
            }
            continue;
        }
        if (ch === '\\' && peek() === '\r' && peekAhead(1) === '\n') {
            advance(); advance(); advance(); // \r\n
            while (peek() === ' ' || peek() === '\t') { advance(); }
            continue;
        }

        // Comment (only valid at the start of a line or after a semicolon)
        // In TCL a # only starts a comment at the beginning of a line or after a semicolon
        if (ch === '#') {
            const isFirstToken = tokens.length === 0;
            const lastToken = tokens.length > 0 ? tokens[tokens.length - 1] : null;
            const isAfterNewlineOrSemicolon = lastToken !== null &&
                (lastToken.type === TokenType.NEWLINE || lastToken.type === TokenType.SEMICOLON);

            if (isFirstToken || isAfterNewlineOrSemicolon) {
                // Read to the end of the line
                let commentText = '';
                const commentLine = line;
                const commentCol = col;
                while (pos < len && text[pos] !== '\n') {
                    commentText += advance();
                }
                tokens.push({
                    type: TokenType.COMMENT,
                    value: commentText,
                    line: commentLine,
                    column: commentCol,
                    rawLength: commentText.length
                });
                continue;
            }
            // Otherwise the # sits in a command argument and is an ordinary character
        }

        // Double-quoted string
        if (ch === '"') {
            const strLine = line;
            const strCol = col;
            advance(); // Skip the opening quote
            let strValue = '';
            while (pos < len && text[pos] !== '"') {
                if (text[pos] === '\\' && pos + 1 < len) {
                    strValue += advance(); // Backslash
                    strValue += advance(); // Escaped character
                } else if (text[pos] === '\n') {
                    // Multi-line string
                    strValue += advance();
                } else if (text[pos] === '$') {
                    // A variable reference inside a string stays part of the string content
                    strValue += advance();
                } else {
                    strValue += advance();
                }
            }
            if (pos < len) { advance(); } // Skip the closing quote
            tokens.push({
                type: TokenType.STRING,
                value: strValue,
                line: strLine,
                column: strCol,
                rawLength: strValue.length + 2
            });
            continue;
        }

        // Braced literal
        if (ch === '{') {
            const braceLine = line;
            const braceCol = col;
            advance(); // Skip the {
            let depth = 1;
            let braceValue = '';
            while (pos < len && depth > 0) {
                const c = text[pos];
                if (c === '{') {
                    depth++;
                    braceValue += advance();
                } else if (c === '}') {
                    depth--;
                    if (depth > 0) {
                        braceValue += advance();
                    }
                } else if (c === '\\' && pos + 1 < len) {
                    braceValue += advance();
                    braceValue += advance();
                } else {
                    braceValue += advance();
                }
            }
            if (pos < len) { advance(); } // Skip the }
            tokens.push({
                type: TokenType.BRACED,
                value: braceValue,
                line: braceLine,
                column: braceCol,
                rawLength: braceValue.length + 2
            });
            continue;
        }

        // Bracketed command substitution — treated like BRACED (nested commands are not parsed)
        if (ch === '[') {
            const bracketLine = line;
            const bracketCol = col;
            advance(); // Skip the [
            let depth = 1;
            let bracketValue = '';
            while (pos < len && depth > 0) {
                const c = text[pos];
                if (c === '[') { depth++; bracketValue += advance(); }
                else if (c === ']') { depth--; if (depth > 0) { bracketValue += advance(); } }
                else if (c === '"') {
                    bracketValue += advance();
                    while (pos < len && text[pos] !== '"') {
                        if (text[pos] === '\\' && pos + 1 < len) {
                            bracketValue += advance();
                            bracketValue += advance();
                        } else { bracketValue += advance(); }
                    }
                    if (pos < len) { bracketValue += advance(); }
                }
                else if (c === '{') {
                    let bd = 1;
                    bracketValue += advance();
                    while (pos < len && bd > 0) {
                        const bc = text[pos];
                        if (bc === '{') { bd++; }
                        else if (bc === '}') { bd--; }
                        bracketValue += advance();
                    }
                }
                else { bracketValue += advance(); }
            }
            if (pos < len) { advance(); } // Skip the ]
            tokens.push({
                type: TokenType.BRACED,
                value: `[${bracketValue}]`,
                line: bracketLine,
                column: bracketCol,
                rawLength: bracketValue.length + 2
            });
            continue;
        }

        // Variable reference
        if (ch === '$') {
            const varLine = line;
            const varCol = col;
            advance(); // Skip the $
            if (peek() === '{') {
                advance(); // Skip the {
                let varName = '';
                while (pos < len && text[pos] !== '}') {
                    varName += advance();
                }
                if (pos < len) { advance(); } // Skip the }
                tokens.push({
                    type: TokenType.VARIABLE_REF,
                    value: varName,
                    line: varLine,
                    column: varCol,
                    rawLength: varName.length + 3  // ${...}
                });
            } else {
                let varName = '';
                // TCL variable names: letters/digits/underscores, with :: as the namespace separator
                // A single : is not part of the name (the : in $BOTTOM_LAYER: is a literal character)
                while (pos < len && /[a-zA-Z0-9_]/.test(text[pos])) {
                    varName += advance();
                }
                // Handle the :: namespace separator
                while (pos + 1 < len && text[pos] === ':' && text[pos + 1] === ':') {
                    varName += advance(); // First :
                    varName += advance(); // Second :
                    while (pos < len && /[a-zA-Z0-9_]/.test(text[pos])) {
                        varName += advance();
                    }
                }
                tokens.push({
                    type: TokenType.VARIABLE_REF,
                    value: varName,
                    line: varLine,
                    column: varCol,
                    rawLength: varName.length + 1  // $name
                });
            }
            continue;
        }

        // Plain word (command name or argument)
        let word = '';
        const wordLine = line;
        const wordCol = col;
        while (pos < len && !/[\s;\[\]{}\"$\\#]/.test(text[pos])) {
            word += advance();
        }
        if (word.length > 0) {
            // Decide whether this starts a command: is the previous non-blank token a NEWLINE/SEMICOLON?
            let isCommand = true;
            for (let ti = tokens.length - 1; ti >= 0; ti--) {
                const pt = tokens[ti];
                if (pt.type === TokenType.NEWLINE || pt.type === TokenType.SEMICOLON) {
                    isCommand = true;
                    break;
                }
                if (pt.type !== TokenType.COMMENT) {
                    isCommand = false;
                    break;
                }
            }
            tokens.push({
                type: isCommand ? TokenType.COMMAND : TokenType.WORD,
                value: word,
                line: wordLine,
                column: wordCol,
                rawLength: word.length
            });
        }
        // When word is empty and ch is not whitespace, skip the character (prevents an infinite loop)
        if (word.length === 0) {
            advance();
        }
    }

    tokens.push({ type: TokenType.EOF, value: '', line, column: col, rawLength: 0 });
    return tokens;
}

// ════════════════════════════════════════════════════════════
//  Parser
// ════════════════════════════════════════════════════════════

/**
 * Parse the token stream into a list of AST nodes.
 * Recognizes the key commands (set, source, proc, ...) and every variable reference.
 */
export function parse(filePath: string, text: string): ParseResult {
    const tokens = tokenize(text);
    const nodes: AstNode[] = [];
    const errors: ParseError[] = [];

    // Collect by category
    const sets: SetNode[] = [];
    const varRefs: VarRefNode[] = [];
    const sources: SourceNode[] = [];
    const procs: ProcNode[] = [];
    const commands: CommandNode[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // Skip newlines, semicolons, comments and EOF
        if (token.type === TokenType.NEWLINE ||
            token.type === TokenType.SEMICOLON ||
            token.type === TokenType.COMMENT ||
            token.type === TokenType.EOF) {
            // Check for a variable reference (a standalone $var in the token stream)
            // In practice the tokenizer already turned these into VARIABLE_REF
            continue;
        }

        // Variable reference (standalone in the token stream, e.g. inside expr {...} or nested)
        if (token.type === TokenType.VARIABLE_REF) {
            const ref: VarRefNode = {
                kind: 'var_ref',
                varName: token.value,
                isBraceForm: false,
                line: token.line,
                column: token.column,
                rawText: token.value
            };
            nodes.push(ref);
            varRefs.push(ref);
            continue;
        }

        // Handle a command (a COMMAND token)
        if (token.type === TokenType.COMMAND) {
            const cmdName = token.value;
            const cmdLine = token.line;
            const cmdCol = token.column;

            // Collect every argument token of this command
            const argTokens: Token[] = [];
            let lastIdx = i;
            for (let j = i + 1; j < tokens.length; j++) {
                const nt = tokens[j];
                if (nt.type === TokenType.NEWLINE ||
                    nt.type === TokenType.SEMICOLON ||
                    nt.type === TokenType.EOF) {
                    lastIdx = j;
                    break;
                }
                if (nt.type === TokenType.COMMENT) {
                    lastIdx = j;
                    break;
                }
                argTokens.push(nt);
                lastIdx = j;
            }

            // Build the raw text
            const rawParts: string[] = [cmdName];
            for (const a of argTokens) {
                if (a.type === TokenType.STRING) { rawParts.push(`"${a.value}"`); }
                else if (a.type === TokenType.BRACED) { rawParts.push(a.value); }
                else { rawParts.push(a.value); }
            }
            const rawText = rawParts.join(' ');

            // ---- Handle the set command ----
            if (cmdName === 'set' && argTokens.length >= 2) {
                const varToken = argTokens[0];
                const varName = varToken.value;
                // The value tokens start at index 1
                const valueTokens = argTokens.slice(1);

                // Check whether the value tokens contain variable references
                for (const vt of valueTokens) {
                    if (vt.type === TokenType.VARIABLE_REF) {
                        const ref: VarRefNode = {
                            kind: 'var_ref',
                            varName: vt.value,
                            isBraceForm: false,
                            line: vt.line,
                            column: vt.column,
                            rawText: vt.value
                        };
                        nodes.push(ref);
                        varRefs.push(ref);
                    }
                    // Also look for $ inside STRING and BRACED tokens
                    if (vt.type === TokenType.STRING || vt.type === TokenType.BRACED) {
                        extractVarRefsFromText(vt.value, vt.line, vt.column)
                            .forEach(r => {
                                nodes.push(r);
                                varRefs.push(r);
                            });
                    }
                }

                // Build the value text (used for simple value parsing)
                const valueText = valueTokens.map(t => {
                    if (t.type === TokenType.STRING) { return `"${t.value}"`; }
                    if (t.type === TokenType.BRACED) { return t.value; }
                    return t.value;
                }).join(' ');

                const setNode: SetNode = {
                    kind: 'set',
                    varName,
                    valueTokens,
                    valueText,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(setNode);
                sets.push(setNode);
            }
            // ---- Handle the source command ----
            else if (cmdName === 'source' && argTokens.length >= 1) {
                // Join every argument token into the full path (supports $var/path/subpath)
                let filePath = '';
                for (const at of argTokens) {
                    if (at.type === TokenType.VARIABLE_REF) {
                        filePath += '$' + at.value;
                    } else if (at.type === TokenType.STRING) {
                        filePath += at.value; // Double-quoted string, value excludes the quotes
                    } else if (at.type === TokenType.BRACED) {
                        filePath += at.value; // Braced content
                    } else {
                        filePath += at.value;
                    }
                }
                // Trim the surrounding whitespace
                filePath = filePath.trim();
                const sourceNode: SourceNode = {
                    kind: 'source',
                    filePath,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(sourceNode);
                sources.push(sourceNode);
            }
            // ---- Handle the proc command ----
            else if (cmdName === 'proc' && argTokens.length >= 3) {
                const procToken = argTokens[0];
                const procName = procToken.value;
                // The args sit in braces — parsed as a TCL list (supports the {arg default} syntax)
                const argsToken = argTokens[1];
                let argsStr = '';
                if (argsToken.type === TokenType.BRACED) {
                    argsStr = argsToken.value;
                } else {
                    argsStr = argsToken.value;
                }
                const args = parseProcArgs(argsStr);

                // Extract the body text (joining argTokens[2..])
                const bodyStartLine = argTokens[2].line;
                const bodyEndLine = getTokenEndLine(argTokens[argTokens.length - 1], tokens);
                const bodyTextParts: string[] = [];
                for (let k = 2; k < argTokens.length; k++) {
                    bodyTextParts.push(argTokens[k].value);
                }
                const bodyText = bodyTextParts.join('');

                const procNode: ProcNode = {
                    kind: 'proc',
                    procName,
                    args,
                    bodyStartLine,
                    bodyEndLine,
                    bodyText,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(procNode);
                procs.push(procNode);

                // Variable references inside the proc body must be extracted too
                for (let k = 2; k < argTokens.length; k++) {
                    const at = argTokens[k];
                    if (at.type === TokenType.BRACED || at.type === TokenType.STRING) {
                        extractVarRefsFromText(at.value, at.line, at.column)
                            .forEach(r => {
                                nodes.push(r);
                                varRefs.push(r);
                            });
                    }
                }
            }
            // ---- Generic command ----
            else {
                const cmdNode: CommandNode = {
                    kind: 'command',
                    commandName: cmdName,
                    args: argTokens,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(cmdNode);
                commands.push(cmdNode);

                // Extract the variable references from the command arguments
                for (const at of argTokens) {
                    if (at.type === TokenType.VARIABLE_REF) {
                        const ref: VarRefNode = {
                            kind: 'var_ref',
                            varName: at.value,
                            isBraceForm: false,
                            line: at.line,
                            column: at.column,
                            rawText: at.value
                        };
                        nodes.push(ref);
                        varRefs.push(ref);
                    }
                    if (at.type === TokenType.STRING || at.type === TokenType.BRACED) {
                        extractVarRefsFromText(at.value, at.line, at.column)
                            .forEach(r => {
                                nodes.push(r);
                                varRefs.push(r);
                            });
                    }
                }
            }

            // Jump to the last token of this command
            i = lastIdx;
            continue;
        }

        // Other token types (a WORD that does not start a command, etc.) are skipped
    }

    return {
        filePath,
        nodes,
        sets,
        varRefs,
        sources,
        procs,
        commands,
        errors
    };
}

/**
 * Extract the $varName and ${varName} variable references from a piece of text.
 * Used to pull the variable references out of STRING and BRACED tokens.
 * Multi-line text is supported; the real line and column of every reference is computed.
 * References inside TCL comment lines (starting with #) and trailing comments (after ;#) are skipped.
 */
function extractVarRefsFromText(text: string, baseLine: number, baseCol: number): VarRefNode[] {
    const refs: VarRefNode[] = [];

    // Match $varName (not ${varName})
    // The :: namespace separator is valid, a single : is not part of the name
    const regex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const isBraceForm = match[1] === '{';
        const varName = match[2];

        // Look at the text before match.index to work out the real line and column
        const textBefore = text.substring(0, match.index);
        const linesBefore = textBefore.split('\n');
        const newlineCount = linesBefore.length - 1;
        const line = baseLine + newlineCount;

        // ── Skip $var references inside comments ──
        // Take the text of the current line before the match (from the last newline to the match)
        const currentLineText = newlineCount > 0
            ? linesBefore[linesBefore.length - 1]
            : textBefore;
        // Skip when the line starts with # after trimming, or the match sits after a ;#
        const trimmedLine = currentLineText.trimStart();
        if (trimmedLine.startsWith('#')) {
            continue;  // Whole-line comment
        }
        // Check the ;# trailing comment: the match appears after the ;#
        const inlineCommentIdx = currentLineText.indexOf(';#');
        if (inlineCommentIdx >= 0 && match.index > textBefore.lastIndexOf('\n') + inlineCommentIdx) {
            continue;  // After a trailing comment
        }

        // Column: the offset after the last newline
        // baseCol points at the start of the enclosing token (the { or ")
        // text is the inner token text (without the enclosing delimiters)
        const col = newlineCount > 0
            ? linesBefore[linesBefore.length - 1].length + 1  // 1-based column on new line
            : baseCol + match.index + 1;  // Same line: baseCol + 1 (skip the delimiter) + match.index

        refs.push({
            kind: 'var_ref',
            varName,
            isBraceForm,
            line,
            column: col,
            rawText: match[0]
        });
    }
    return refs;
}

/** Get the end line number of a token */
function getTokenEndLine(token: Token, allTokens: Token[]): number {
    // Simplification: return the line of the token
    // Tokens that span lines (multi-line strings or braced blocks) would need more work
    return token.line;
}

// ════════════════════════════════════════════════════════════
//  Proc argument parsing
// ════════════════════════════════════════════════════════════

/**
 * Parse a proc argument list, correctly supporting the TCL default-value syntax {argName defaultValue}.
 *
 * TCL proc argument format:
 *   proc name {arg1 arg2 {arg3 defaultVal}} {body}
 *
 * Here {arg3 defaultVal} is a single TCL list element meaning arg3 has a default value.
 * A naive split would wrongly turn "{arg3" and "defaultVal}" into two arguments.
 *
 * @param argsStr - the raw text inside the argument braces (without the outer braces)
 * @returns the argument names only (without the default values)
 */
export function parseProcArgs(argsStr: string): string[] {
    const argNames: string[] = [];
    let i = 0;
    const len = argsStr.length;

    while (i < len) {
        // Skip whitespace
        while (i < len && /\s/.test(argsStr[i])) { i++; }
        if (i >= len) { break; }

        if (argsStr[i] === '{') {
            // Braced element: {argName defaultValue} — treated as one atomic element
            let depth = 1;
            let element = '';
            i++; // Skip the opening {
            while (i < len && depth > 0) {
                if (argsStr[i] === '{') { depth++; element += argsStr[i]; }
                else if (argsStr[i] === '}') {
                    depth--;
                    if (depth > 0) { element += argsStr[i]; }
                } else {
                    element += argsStr[i];
                }
                i++;
            }
            // element now holds the text inside "{argName defaultValue}"
            // Take the first word as the argument name
            const firstWord = element.trim().split(/\s+/)[0];
            if (firstWord) { argNames.push(firstWord); }
        } else {
            // Plain word
            let word = '';
            while (i < len && !/\s/.test(argsStr[i])) {
                word += argsStr[i];
                i++;
            }
            if (word.length > 0) { argNames.push(word); }
        }
    }

    return argNames;
}

// ════════════════════════════════════════════════════════════
//  Helper functions
// ════════════════════════════════════════════════════════════

/**
 * Parse a TCL value text into a simple value.
 * Handles: quote stripping, brace stripping and simple variable values.
 */
export function resolveSimpleValue(valueText: string): string {
    let val = valueText.trim();

    // Strip the double quotes
    if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
    }
    // Strip the braces
    if (val.startsWith('{') && val.endsWith('}')) {
        val = val.slice(1, -1);
    }

    return val;
}

/**
 * Detect whether a value text still contains variable references (an unresolved $).
 */
export function containsVarRef(valueText: string): boolean {
    // Check for a $ that is not a TCL command substitution
    return /\$[a-zA-Z_{]/.test(valueText);
}
