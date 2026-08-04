/**
 * Completion Provider - auto-completes Innovus command names and their options while typing
 */

import * as vscode from 'vscode';
import { getDB, CmdInfo } from './commands';
import { t } from './i18n';

export class InnovusCompletionProvider implements vscode.CompletionItemProvider {

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {

        const db = getDB();
        const linePrefix = document.lineAt(position).text.substring(0, position.character);

        // Are we typing a command name (start of line or after whitespace, not in the option area)?
        const isCommandPosition = this.isAtCommandStart(linePrefix);

        if (isCommandPosition) {
            // --- Command name + variable name completion ---
            const allNames = db.getCommandNames();
            const items: vscode.CompletionItem[] = [];
            for (const name of allNames) {
                const info = db.get(name);
                const isCmd = info?.is_cmd !== false;  // Treated as a command by default
                const item = new vscode.CompletionItem(
                    name,
                    isCmd ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Variable
                );
                item.detail = isCmd ? t('completion.innovusCommand') : t('completion.modeVariable');
                item.documentation = new vscode.MarkdownString(
                    info ? `**${info.summary}**\n\n${info.description || ''}` : t('completion.innovusEntry')
                );
                // Sort order: commands first, variables after
                item.sortText = isCmd ? ('0' + name) : ('1' + name);
                items.push(item);
            }
            return items;
        }

        // --- Option completion ---
        // Find the command used on the current line
        const cmdName = this.extractCommandName(linePrefix);
        if (!cmdName) { return []; }

        const cmdInfo = db.get(cmdName);
        if (!cmdInfo || !cmdInfo.options) { return []; }

        // Collect the option names already used
        const usedFlags = this.extractUsedFlags(linePrefix);

        const items: vscode.CompletionItem[] = [];
        for (const opt of cmdInfo.options) {
            // Skip flag-type options that are already used
            if (opt.type === 'flag' && usedFlags.has(opt.name)) {
                continue;
            }

            const item = new vscode.CompletionItem(opt.name, vscode.CompletionItemKind.Property);

            // Label: option name + required/optional marker
            item.label = opt.name;
            if (opt.required) {
                item.label += '  🔴';
            }

            item.detail = `Innovus: ${cmdName}`;
            item.filterText = opt.name;
            item.sortText = opt.required ? '0' + opt.name : '1' + opt.name;

            // Documentation
            const typeLabel = (() => {
                switch (opt.type) {
                    case 'string': return t('completion.typeString');
                    case 'int': return t('completion.typeInt');
                    case 'float': return t('completion.typeFloat');
                    case 'flag': return t('completion.typeFlag');
                    case 'enum': return t('completion.typeEnum');
                    case 'point': return t('completion.typePoint');
                    default: return opt.type;
                }
            })();
            const reqLabel = opt.required ? t('completion.requiredMark') : t('common.optional');
            item.documentation = new vscode.MarkdownString(
                `**${opt.name}**  \n\n${opt.description}  \n\n*${t('common.type')}: \`${opt.type}\` (${typeLabel}) | ${reqLabel}*`
            );

            // Non-flag types: insert the option name plus a placeholder
            if (opt.type === 'flag') {
                item.insertText = new vscode.SnippetString(opt.name + ' ');
            } else if (opt.type === 'enum') {
                // Try to extract the enum values from the description
                const enumMatch = opt.description.match(/\{([^}]+)\}/);
                if (enumMatch) {
                    const enumValues = enumMatch[1].split(/[,|/]/).map(s => s.trim()).filter(Boolean);
                    item.insertText = new vscode.SnippetString(opt.name + ' ${1|' + enumValues.join(',') + '|} ');
                    item.documentation = new vscode.MarkdownString(
                        `**${opt.name}**  \n\n${opt.description}  \n\n*${t('completion.choices')}: ${enumValues.join(', ')}*  \n*${t('common.type')}: \`enum\` | ${reqLabel}*`
                    );
                } else {
                    item.insertText = new vscode.SnippetString(opt.name + ' ${1:<value>} ');
                }
            } else {
                const placeholder = opt.type === 'int' ? '<int>' : opt.type === 'float' ? '<float>' : '<value>';
                item.insertText = new vscode.SnippetString(opt.name + ' ${1:' + placeholder + '} ');
            }

            items.push(item);
        }
        return items;
    }

    /** Determine whether the cursor sits where a command name is typed */
    private isAtCommandStart(line: string): boolean {
        // Text after stripping the leading whitespace
        const trimmed = line.trimStart();
        if (trimmed.length === 0) { return true; }
        // If a complete word (the command name) is already there followed by a space,
        // this is no longer the command position.
        // Simple rule: no space yet, or a space was just typed.
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) {
            // No space yet, a command name may be in progress.
            // A leading - means an option is being typed instead.
            return !trimmed.startsWith('-');
        }
        // A space is already present, check whether the cursor is in the option area
        const afterLastSpace = line.lastIndexOf(' ');
        const textAfterSpace = line.substring(afterLastSpace + 1);
        return textAfterSpace.startsWith('-');
    }

    /** Extract the command name from the line text */
    private extractCommandName(line: string): string | null {
        const trimmed = line.trimStart();
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) { return null; }
        const cmdName = trimmed.substring(0, spaceIdx);
        // Verify it is a known command
        const db = getDB();
        if (db.isCommand(cmdName)) {
            return cmdName;
        }
        return null;
    }

    /** Extract the flag options already used on the line */
    private extractUsedFlags(line: string): Set<string> {
        const flags = new Set<string>();
        const regex = /(-\w+)/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
            flags.add(match[1]);
        }
        return flags;
    }
}
