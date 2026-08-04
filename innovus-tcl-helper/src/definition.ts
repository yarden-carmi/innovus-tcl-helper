/**
 * Definition Provider — F12/Ctrl+Click jumps to command help / variable definitions
 *
 * Two kinds of jump target are supported:
 *   - Innovus command name → command help documentation (Webview or plain text)
 *   - $varName reference   → variable definition site (set / foreach / proc argument)
 *
 * Help display style (configured through innovus-tcl.helpStyle):
 *   "webview" — Webview rich panel (tutorial-style layout)
 *   "plain"   — virtual plain text document (man page style)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getDB, CmdInfo, CmdOption } from './commands';
import { TclLintProvider } from './lint';
import { t, isZhUi } from './i18n';

const HELP_SCHEME = 'innovus-tcl-help';

type HelpStyle = 'webview' | 'plain';

function getHelpStyle(): HelpStyle {
    return vscode.workspace.getConfiguration('innovus-tcl')
        .get<string>('helpStyle', 'webview') as HelpStyle;
}

// ════════════════════════════════════════════════════════════════
//  Plain text mode (TextDocumentContentProvider)
// ════════════════════════════════════════════════════════════════

export class InnovusPlainHelpProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        const cmdName = uri.path.replace(/^\//, '');
        const db = getDB();
        const info = db.get(cmdName);
        if (!info) { return `Command "${cmdName}" not found.\n`; }
        return formatPlain(info);
    }
}

function formatPlain(info: CmdInfo): string {
    const lines: string[] = [];
    const sep = '═'.repeat(72);

    lines.push(sep);
    lines.push(`  ${info.command}`);
    if (info.summary) { lines.push(`  ${info.summary}`); }
    lines.push(sep);
    lines.push('');

    lines.push(t('help.synopsis'));
    lines.push('  ' + (info.usage || info.command));
    lines.push('');

    if (info.description && info.description !== info.summary) {
        lines.push(t('help.descriptionHeading'));
        for (const w of wrapText(info.description, 68)) { lines.push('  ' + w); }
        lines.push('');
    }

    if (info.options && info.options.length > 0) {
        lines.push(t('help.optionsHeading'));
        lines.push('');
        for (const opt of info.options) {
            const req = opt.required ? ` [${t('common.required')}]` : ` [${t('common.optional')}]`;
            lines.push(`  ${opt.name}${req}`);
            lines.push(`      ${t('common.type')}: ${opt.type}`);
            for (const w of wrapText(opt.description, 64)) { lines.push('      ' + w); }
            lines.push('');
        }
    }

    lines.push('─'.repeat(72));
    lines.push(t('help.plainFooter'));

    return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════
//  Webview mode (rich tutorial-style panel)
// ════════════════════════════════════════════════════════════════

class HelpPanelManager {
    private static currentPanel: vscode.WebviewPanel | undefined;

    static show(context: vscode.ExtensionContext, info: CmdInfo): void {
        const db = getDB();
        const title = `${info.command} — ${t('help.title')}`;

        // Look up related commands
        const related = findRelatedCommands(info.command, db);

        const html = buildHtml(info, related);

        if (this.currentPanel) {
            this.currentPanel.title = title;
            this.currentPanel.webview.html = html;
            this.currentPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            this.currentPanel = vscode.window.createWebviewPanel(
                'innovusCommandHelp',
                title,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                { enableScripts: false, retainContextWhenHidden: true }
            );
            this.currentPanel.webview.html = html;
            this.currentPanel.onDidDispose(() => {
                this.currentPanel = undefined;
            }, null, context.subscriptions);
        }
    }
}

/** Find related commands sharing a prefix (at most 8) */
function findRelatedCommands(cmdName: string, db: ReturnType<typeof getDB>): CmdInfo[] {
    const parts = cmdName.split('_');
    if (parts.length < 2) { return []; }

    // Use the first two prefix segments as the keyword
    const prefix = parts.slice(0, 2).join('_');
    const allNames = db.getCommandNames();
    const related: CmdInfo[] = [];

    for (const name of allNames) {
        if (name === cmdName) { continue; }
        if (name.startsWith(prefix)) {
            const info = db.get(name);
            if (info && info.is_cmd !== false) {
                related.push(info);
                if (related.length >= 8) { break; }
            }
        }
    }
    return related;
}

/** Build the option analysis text */
function analyzeOptions(options: CmdOption[]): string {
    if (!options || options.length === 0) { return ''; }

    const required = options.filter(o => o.required);
    const flags = options.filter(o => o.type === 'flag');
    const valued = options.filter(o => o.type !== 'flag');
    const enumOpts = options.filter(o => o.type === 'enum');

    const parts: string[] = [];

    if (required.length > 0) {
        const names = required.map(o => `<code>${escapeHtml(o.name)}</code>`).join(', ');
        parts.push(t('help.analysisRequired', required.length, names));
    } else {
        parts.push(t('help.analysisAllOptional'));
    }

    if (flags.length > 0 && valued.length > 0) {
        parts.push(t('help.analysisFlags', flags.length, valued.length));
    }

    if (enumOpts.length > 0) {
        const names = enumOpts.map(o => `<code>${escapeHtml(o.name)}</code>`).join(', ');
        parts.push(t('help.analysisEnums', names));
    }

    return parts.map(p => `<p class="analysis-item">${p}</p>`).join('\n');
}

// ---- HTML template ----

function buildHtml(info: CmdInfo, related: CmdInfo[]): string {
    const analysis = analyzeOptions(info.options);

    return `<!DOCTYPE html>
<html lang="${isZhUi() ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(info.command)} — ${t('help.title')}</title>
<style>${styles}</style>
</head>
<body>

<!-- Header -->
<div class="header">
    <h1><code>${escapeHtml(info.command)}</code></h1>
    <span class="badge">${info.is_cmd !== false ? t('common.command') : t('common.variableMode')}</span>
    ${info.summary ? `<p class="summary">${escapeHtml(info.summary)}</p>` : ''}
</div>

<!-- Parameter analysis card -->
${analysis ? `
<div class="card analysis">
    <div class="card-title">${t('help.analysisCard')}</div>
    ${analysis}
</div>` : ''}

<!-- Synopsis -->
${info.usage ? `
<div class="section">
    <h2>${t('help.synopsis')}</h2>
    <pre class="usage"><code>${escapeHtml(info.usage)}</code></pre>
</div>` : ''}

<!-- Description -->
${(info.description && info.description !== info.summary) ? `
<div class="section">
    <h2>${t('help.descriptionHeading')}</h2>
    <p class="desc">${escapeHtml(info.description)}</p>
</div>` : ''}

<!-- Option table -->
${(info.options && info.options.length > 0) ? `
<div class="section">
    <h2>${t('help.optionListHeading')} <span class="count">(${info.options.length})</span></h2>
    <table class="opts">
        <thead>
            <tr>
                <th>${t('common.options')}</th>
                <th>${t('common.type')}</th>
                <th>${t('common.required')}</th>
                <th>${t('common.description')}</th>
            </tr>
        </thead>
        <tbody>
            ${info.options.map(opt => `
            <tr class="${opt.required ? 'row-required' : 'row-optional'}">
                <td><code class="opt-name">${escapeHtml(opt.name)}</code></td>
                <td><span class="type-tag">${escapeHtml(opt.type)}</span></td>
                <td>${opt.required
            ? `<span class="req-tag required">${t('common.required')}</span>`
            : `<span class="req-tag optional">${t('common.optional')}</span>`
        }</td>
                <td>${escapeHtml(opt.description)}</td>
            </tr>`).join('\n            ')}
        </tbody>
    </table>
</div>` : ''}

<!-- Related commands -->
${related.length > 0 ? `
<div class="section">
    <h2>${t('help.relatedHeading')} <span class="count">(${related.length})</span></h2>
    <div class="related-grid">
        ${related.map(r => `
        <div class="related-item">
            <code class="related-cmd">${escapeHtml(r.command)}</code>
            <span class="related-summary">${escapeHtml(r.summary || '')}</span>
        </div>`).join('\n        ')}
    </div>
    <p class="hint">${t('help.relatedHint')}</p>
</div>` : ''}

<!-- Tips -->
<div class="card tip">
    <div class="card-title">${t('help.tipsCard')}</div>
    <ul>
        <li>${t('help.tipHover')}</li>
        <li>${t('help.tipCompletion')}</li>
        <li>${t('help.tipToggle')}</li>
    </ul>
</div>

<!-- Footer -->
<div class="footer">
    <span>Innovus TCL Helper</span>
    <span>${t('help.footerHint')}</span>
</div>

</body>
</html>`;
}

// ---- CSS ----

const styles = /* css */ `
:root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --border: var(--vscode-panel-border, #3c3c3c);
    --accent: var(--vscode-textLink-foreground, #3794ff);
    --code-bg: var(--vscode-textCodeBlock-background, #1a1a1a);
    --warn: #e5a510;
    --ok: #89d185;
    --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, -apple-system, sans-serif);
    font-size: 14px;
    line-height: 1.65;
    padding: 24px 28px;
    max-width: 880px;
}

/* Header */
.header {
    margin-bottom: 24px;
    padding-bottom: 18px;
    border-bottom: 2px solid var(--border);
}
.header h1 { font-size: 22px; font-weight: 700; display: inline; margin-right: 12px; }
.header h1 code { font-size: 22px; color: var(--accent); background: none; padding: 0; }
.badge {
    display: inline-block; background: var(--code-bg); border: 1px solid var(--border);
    border-radius: 4px; padding: 2px 10px; font-size: 12px; vertical-align: middle;
}
.summary { margin-top: 10px; opacity: 0.85; font-size: 15px; }

/* Cards */
.card {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px 20px; margin-bottom: 20px;
}
.card-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.analysis p.analysis-item { margin-bottom: 6px; font-size: 13px; opacity: 0.9; }
.analysis code { font-size: 12px; }

.tip ul { padding-left: 20px; }
.tip li { font-size: 13px; opacity: 0.82; margin-bottom: 4px; }

/* Sections */
.section { margin-bottom: 24px; }
.section h2 { font-size: 16px; font-weight: 600; margin-bottom: 10px; color: var(--accent); }
.section .count { font-size: 12px; opacity: 0.5; font-weight: 400; }
.section .desc { opacity: 0.9; }
.section .hint { font-size: 12px; opacity: 0.55; margin-top: 10px; }

/* Synopsis */
.usage {
    background: var(--code-bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 14px 18px; overflow-x: auto;
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    font-size: 13px; line-height: 1.55;
}
.usage code { color: var(--fg); }

/* Option table */
.opts { width: 100%; border-collapse: collapse; font-size: 13px; }
.opts th {
    text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border);
    font-weight: 600; opacity: 0.8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
}
.opts td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
.opts tbody tr:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04)); }
.row-required td { background: rgba(229, 165, 16, 0.04); }
.opt-name { color: var(--accent); font-weight: 600; font-size: 13px; background: none; padding: 0; }
.type-tag {
    display: inline-block; background: var(--code-bg); border-radius: 3px;
    padding: 1px 8px; font-size: 11px; font-family: monospace;
}
.req-tag { display: inline-block; border-radius: 3px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
.req-tag.required { background: rgba(229, 165, 16, 0.15); color: var(--warn); }
.req-tag.optional { background: rgba(137, 209, 133, 0.12); color: var(--ok); }

/* Related commands */
.related-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.related-item {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 8px 12px;
}
.related-cmd { color: var(--accent); font-size: 12px; font-weight: 600; display: block; }
.related-summary { font-size: 11px; opacity: 0.65; display: block; margin-top: 2px; }

/* Footer */
.footer {
    margin-top: 32px; padding-top: 14px; border-top: 1px solid var(--border);
    font-size: 11px; opacity: 0.45; display: flex; justify-content: space-between;
}

/* Generic */
code {
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    background: var(--code-bg); border-radius: 3px; padding: 1px 5px; font-size: 13px;
}
`;

// ════════════════════════════════════════════════════════════════
//  Definition Provider — plain text mode F12/Ctrl+Click
// ════════════════════════════════════════════════════════════════

export class InnovusDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if (getHelpStyle() !== 'plain') { return null; }

        const db = getDB();
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) { return null; }

        const word = document.getText(wordRange);
        if (!db.isKnown(word)) { return null; }

        const uri = vscode.Uri.parse(`${HELP_SCHEME}://help/${word}`);
        return new vscode.Location(uri, new vscode.Position(0, 0));
    }
}

// ════════════════════════════════════════════════════════════════
//  Variable Definition Provider — F12/Ctrl+Click jumps to the $varName definition
// ════════════════════════════════════════════════════════════════

export class TclVariableDefinitionProvider implements vscode.DefinitionProvider {
    private lintProvider: TclLintProvider | null = null;

    /** Set the Lint Provider reference (injected by extension.ts) */
    setLintProvider(provider: TclLintProvider): void {
        this.lintProvider = provider;
    }

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if (!this.lintProvider) { return null; }
        const result = this.lintProvider.getLastResult();
        if (!result) { return null; }

        const line = document.lineAt(position.line).text;
        const col = position.character;

        // ── Detect $varName or ${varName} ──
        const dollarRegex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
        let match: RegExpExecArray | null;

        while ((match = dollarRegex.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (col >= start && col <= end) {
                const varName = match[2];

                // Look up the variable definitions
                const { allDefs } = this.lintProvider.getCompiler().queryVariable(
                    varName, result, document.uri.fsPath, position.line + 1
                );

                if (allDefs.length === 0) { return null; }

                // Return every definition site (VS Code shows a picker or jumps directly)
                const locations: vscode.Location[] = [];
                for (const def of allDefs) {
                    const defUri = vscode.Uri.file(def.filePath);
                    const defPos = new vscode.Position(
                        Math.max(0, def.line - 1),
                        Math.max(0, def.column - 1)
                    );
                    locations.push(new vscode.Location(defUri, defPos));
                }

                // With a single definition, return that Location directly
                if (locations.length === 1) {
                    return locations[0];
                }
                return locations;
            }
        }

        // ── Detect the variable name in a set command
        //    (with the cursor on the variable, jump to its references) ──
        const setRegex = /\bset\s+([a-zA-Z_][a-zA-Z0-9_:]*)/g;
        while ((match = setRegex.exec(line)) !== null) {
            const varName = match[1];
            const start = match.index + 4;
            const end = start + varName.length;

            if (col >= start && col <= end) {
                const refs = result.variableRefs.filter(
                    r => r.name === varName
                );
                if (refs.length === 0) { return null; }
                const locations: vscode.Location[] = [];
                for (const ref of refs) {
                    const refUri = vscode.Uri.file(ref.filePath);
                    const refPos = new vscode.Position(
                        Math.max(0, ref.line - 1),
                        Math.max(0, ref.column - 1)
                    );
                    locations.push(new vscode.Location(refUri, refPos));
                }
                return locations.length === 1 ? locations[0] : locations;
            }
        }

        // ── Detect a proc call (with the cursor on the proc name, jump to its definition) ──
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (wordRange) {
            const word = document.getText(wordRange);
            // Look for a matching proc definition across every compilation unit
            for (const unit of result.units) {
                for (const proc of unit.procs) {
                    if (proc.procName === word) {
                        // Jump to the proc definition
                        const defUri = vscode.Uri.file(unit.filePath);
                        const defPos = new vscode.Position(
                            Math.max(0, proc.line - 1),
                            Math.max(0, proc.column - 1)
                        );
                        return new vscode.Location(defUri, defPos);
                    }
                }
            }
        }

        return null;
    }
}

// ════════════════════════════════════════════════════════════════
//  Document Link Provider — the Ctrl+Click entry point (active in both modes)
//
//  Key detail: provideDocumentLinks never inspects the mode, it always
//  returns links, so VS Code has no stale cache when the mode changes.
//  The command callback decides the behaviour dynamically.
// ════════════════════════════════════════════════════════════════

const HELP_CMD = 'innovus-tcl._showHelp';

export class InnovusDocumentLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentLink[]> {
        const db = getDB();
        const links: vscode.DocumentLink[] = [];
        const text = document.getText();
        const regex = /\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            const word = match[1];
            if (!db.isKnown(word)) { continue; }

            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + word.length);
            const range = new vscode.Range(startPos, endPos);

            const args = encodeURIComponent(JSON.stringify([word]));
            const cmdUri = vscode.Uri.parse(`command:${HELP_CMD}?${args}`);
            links.push(new vscode.DocumentLink(range, cmdUri));
        }

        return links;
    }
}

/**
 * Ctrl+Click command callback — the behaviour depends on the current mode:
 *   Webview    → open the Webview panel
 *   Plain text → open the virtual document
 */
export function showHelp(context: vscode.ExtensionContext, cmdName: string): void {
    const db = getDB();
    const info = db.get(cmdName);
    if (!info) { return; }

    if (getHelpStyle() === 'webview') {
        HelpPanelManager.show(context, info);
    } else {
        const uri = vscode.Uri.parse(`${HELP_SCHEME}://help/${cmdName}`);
        vscode.window.showTextDocument(uri, { preview: true, preserveFocus: false });
    }
}

// ---- Helpers ----

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function wrapText(text: string, maxWidth: number): string[] {
    const result: string[] = [];
    const words = text.split(/\s+/);
    let line = '';
    for (const word of words) {
        if (line.length + word.length + 1 > maxWidth && line.length > 0) {
            result.push(line);
            line = word;
        } else {
            line = line ? line + ' ' + word : word;
        }
    }
    if (line) { result.push(line); }
    return result.length > 0 ? result : [text];
}
