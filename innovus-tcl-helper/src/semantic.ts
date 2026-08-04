/**
 * Semantic Tokens Provider — semantic syntax highlighting for Innovus commands
 *
 * Token types:
 *   function  — Innovus command name (rendered with the function/command color)
 *   parameter — option flag (e.g. -help, -cell)
 *   variable  — mode/variable name (non-command entries)
 */

import * as vscode from 'vscode';
import { getDB } from './commands';

const tokenTypes = ['function', 'parameter', 'variable'];
const tokenModifiers: string[] = [];

export class InnovusSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    private db = getDB();

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SemanticTokens> {
        const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
        const builder = new vscode.SemanticTokensBuilder(legend);
        const text = document.getText();
        const lines = text.split('\n');

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const trimmed = line.trimStart();
            if (!trimmed || trimmed.startsWith('#')) { continue; }

            // Take the first word as a candidate command/variable name
            const firstWordMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (!firstWordMatch) { continue; }

            const word = firstWordMatch[1];
            const startChar = line.indexOf(word);

            const info = this.db.get(word);
            if (!info) { continue; }

            if (info.is_cmd !== false) {
                // Innovus command → highlight as function
                builder.push(lineIdx, startChar, word.length, 0, 0);
            } else {
                // Mode/variable → highlight as variable
                builder.push(lineIdx, startChar, word.length, 2, 0);
            }

            // Highlight the option flags (-xxx) on this line
            const flagRegex = /(-\w+)/g;
            let match: RegExpExecArray | null;
            while ((match = flagRegex.exec(line)) !== null) {
                // Skip non-flag content that follows the command name
                const flagName = match[1];
                const flagStart = match.index;
                // Only mark known options
                const isKnownFlag = info.options?.some(o => o.name === flagName);
                if (isKnownFlag) {
                    builder.push(lineIdx, flagStart, flagName.length, 1, 0);
                }
            }
        }

        return builder.build();
    }

    getLegend(): vscode.SemanticTokensLegend {
        return new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
    }
}
