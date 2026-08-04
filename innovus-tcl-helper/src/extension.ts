/**
 * Innovus TCL Helper - VS Code extension entry point
 *
 * Features:
 * 1. Hover tooltips with Innovus command documentation (Chinese/English database)
 * 2. Command name and option auto-completion
 * 3. TCL static checking + Innovus command argument validation (3 levels)
 * 4. Cross-file TCL compilation analysis + variable tracking (driven by the .f file)
 * 5. Support for multiple Innovus data versions
 * 6. Copilot AI tool integration (LM Tools)
 * 7. F12/Ctrl+Click navigation to the help documentation
 * 8. Semantic token syntax highlighting
 * 9. MCP lint interface
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getDB, Language } from './commands';
import { InnovusHoverProvider, setBuiltinsDataRoot } from './hover';
import { InnovusCompletionProvider } from './completion';
import { TclDiagnosticsProvider } from './diagnostics';
import { TclLintProvider } from './lint';
import { InnovusDefinitionProvider, InnovusPlainHelpProvider, InnovusDocumentLinkProvider, TclVariableDefinitionProvider, showHelp } from './definition';
import { InnovusSemanticTokensProvider } from './semantic';
import { registerAllTools, buildScriptContextForCommand } from './tools';
import { getRunner, TclRunner, getTclshInstallGuide, skippedMessage } from './runner';
import { t, setUiLanguage } from './i18n';

let diagnosticsProvider: TclDiagnosticsProvider | undefined;
let lintProvider: TclLintProvider | undefined;
let variableDefProvider: TclVariableDefinitionProvider | undefined;

/**
 * Install the agent skills into the workspace at .agents/skills/&lt;name&gt;/SKILL.md.
 * VS Code Copilot discovers the SKILL.md files under .agents/skills automatically.
 * Called on extension activation; every skill gets its own subdirectory named in
 * lowercase-hyphen form.
 */
function installAgentSkills(extensionPath: string): void {
    const skillName = 'innovus-tcl-helper';
    const srcDir = path.join(extensionPath, '.agents', 'skills', skillName);
    if (!fs.existsSync(srcDir)) { return; }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) { return; }

    for (const ws of workspaceFolders) {
        try {
            const targetDir = path.join(ws.uri.fsPath, '.agents', 'skills', skillName);
            if (!fs.existsSync(targetDir)) { fs.mkdirSync(targetDir, { recursive: true }); }

            // Recursively copy every file under the source directory
            const copyDir = (src: string, dest: string) => {
                for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
                    const s = path.join(src, entry.name);
                    const d = path.join(dest, entry.name);
                    if (entry.isDirectory()) {
                        if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); }
                        copyDir(s, d);
                    } else {
                        let shouldCopy = !fs.existsSync(d);
                        if (!shouldCopy) {
                            shouldCopy = fs.statSync(s).mtimeMs > fs.statSync(d).mtimeMs;
                        }
                        if (shouldCopy) {
                            fs.copyFileSync(s, d);
                            console.log(`[Innovus TCL] Skill installed: ${d}`);
                        }
                    }
                }
            };
            copyDir(srcDir, targetDir);
        } catch (e: any) {
            console.log(`[Innovus TCL] Skill install skipped: ${e.message}`);
        }
    }
}

/**
 * Resolve `innovus-tcl.language` into a concrete language.
 * "auto" → follow the VS Code display language (Chinese → zh, anything else → en).
 * Anything unrecognized falls back to English.
 */
function resolveLanguage(configLang: string): Language {
    if (configLang === 'auto') {
        // vscode.env.language examples: "zh-cn", "zh-tw", "en", "ja", ...
        const vsLang = vscode.env.language.toLowerCase();
        return vsLang.startsWith('zh') ? 'zh' : 'en';
    }
    return configLang === 'zh' ? 'zh' : 'en';
}

/**
 * Read `innovus-tcl.language` and apply it to both the interface and the command
 * documentation database — one setting drives both. English is the default.
 */
function applyLanguage(db?: ReturnType<typeof getDB>): Language {
    const raw = vscode.workspace.getConfiguration('innovus-tcl')
        .get<string>('language', 'en');
    const lang = resolveLanguage(raw);
    setUiLanguage(lang);
    db?.setLanguage(lang);
    return lang;
}

export function activate(context: vscode.ExtensionContext) {
    // Resolve the language before anything renders a string
    applyLanguage();

    console.log('[Innovus TCL] Extension activated');

    // ── TCL run output channel ──
    const runChannel = vscode.window.createOutputChannel('Innovus TCL: Run', { log: true });
    context.subscriptions.push(runChannel);

    // ── Install the agent skills into the workspace ──
    installAgentSkills(context.extensionPath);

    // Initialize the path to the TCL built-in keyword documentation
    setBuiltinsDataRoot(context.extensionPath);

    const config = vscode.workspace.getConfiguration('innovus-tcl');

    // Initialize the command database — always uses the bundled data/innovus/ directory
    const db = getDB(context.extensionPath);

    // Apply the language to the database as well (the interface was set above)
    applyLanguage(db);

    // Read the version setting (25.1 by default)
    const version = config.get<string>('version', '25.1');
    db.setVersion(version);

    db.load();

    // ── Non-macOS platforms: check whether tclsh is available ──
    const tclshCheckRunner = getRunner();
    const configTclshPath = config.get<string>('tclshPath', '');
    const tclshFound = tclshCheckRunner.findTclsh(context.extensionPath, configTclshPath);
    if (!tclshFound) {
        const isMac = process.platform === 'darwin';
        const guide = getTclshInstallGuide();
        if (isMac) {
            console.log('[Innovus TCL] ⚠️ tclsh not found, install tcl-tk or set innovus-tcl.tclshPath');
        } else {
            // Linux / Windows: show a notification
            const onceKey = 'innovus-tcl.tclshWarningShown';
            const hasShown = context.globalState.get<boolean>(onceKey);
            if (!hasShown) {
                vscode.window.showWarningMessage(
                    t('tclsh.notFoundModal', guide),
                    { modal: true },
                    t('common.openSettings')
                ).then(choice => {
                    if (choice) {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'innovus-tcl.tclshPath');
                    }
                });
                context.globalState.update(onceKey, true);
            }
        }
    }

    const subs: vscode.Disposable[] = [];

    // 1. Hover Provider - command tooltips + cross-file variable values
    const hoverProvider = new InnovusHoverProvider();
    if (config.get<boolean>('enableHover', true)) {
        subs.push(vscode.languages.registerHoverProvider(
            { language: 'tcl' },
            hoverProvider
        ));
    }

    // Create the Variable Definition Provider early (setLintProvider below needs the reference)
    variableDefProvider = new TclVariableDefinitionProvider();

    // 2. Completion Provider - command/option auto-completion
    if (config.get<boolean>('enableCompletion', true)) {
        subs.push(vscode.languages.registerCompletionItemProvider(
            { language: 'tcl' },
            new InnovusCompletionProvider(),
            ' ', '-', '_'
        ));
    }

    // 3a. Diagnostics - single-file syntax and command checks
    if (config.get<boolean>('enableDiagnostics', true)) {
        diagnosticsProvider = new TclDiagnosticsProvider();

        if (vscode.window.activeTextEditor) {
            diagnosticsProvider.updateDiagnostics(vscode.window.activeTextEditor.document);
        }

        subs.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            diagnosticsProvider?.updateDiagnostics(doc);
            // Also trigger the incremental cross-file lint
            if (doc.languageId === 'tcl' && lintProvider) {
                lintProvider.runIncrementalLint(doc);
            }
        }));

        subs.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                diagnosticsProvider?.updateDiagnostics(editor.document);
            }
        }));
    }

    // 3b. Cross-file Lint - cross-file compilation analysis and variable tracking
    if (config.get<boolean>('enableCompilation', true)) {
        lintProvider = new TclLintProvider();
        hoverProvider.setLintProvider(lintProvider);
        variableDefProvider!.setLintProvider(lintProvider);

        // Initial lint run
        if (vscode.window.activeTextEditor?.document.languageId === 'tcl') {
            lintProvider.runLint(vscode.window.activeTextEditor.document);
        }

        // Incremental update when a file is saved
        subs.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.languageId === 'tcl' && lintProvider) {
                lintProvider.runIncrementalLint(doc);
            }
        }));

        // Recompile when the .f file changes
        subs.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            const fFile = vscode.workspace.getConfiguration('innovus-tcl')
                .get<string>('fFile', 'tcl.f');
            if (doc.fileName.endsWith('.f') || doc.fileName.endsWith(fFile)) {
                if (lintProvider) {
                    lintProvider.runLint();
                    vscode.window.setStatusBarMessage(
                        t('status.recompiled', lintProvider.getLastResult()?.units.length || 0),
                        3000
                    );
                }
            }
        }));

        // Refresh when the editor changes
        subs.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document.languageId === 'tcl' && lintProvider) {
                // No recompilation, but make sure the diagnostics are shown
                lintProvider.runLint();
            }
        }));
    }

    // 4a. Definition Provider — plain text mode (F12 → virtual document)
    const plainHelpProvider = new InnovusPlainHelpProvider();
    subs.push(vscode.workspace.registerTextDocumentContentProvider('innovus-tcl-help', plainHelpProvider));
    subs.push(vscode.languages.registerDefinitionProvider(
        { language: 'tcl' },
        new InnovusDefinitionProvider()
    ));

    // 4b. Variable Definition Provider — F12/Ctrl+Click jumps to the $varName definition
    subs.push(vscode.languages.registerDefinitionProvider(
        { language: 'tcl' },
        variableDefProvider
    ));

    // 4c. Document Link Provider — the Ctrl+Click entry point
    //     (always active, the mode is decided inside the callback)
    subs.push(vscode.languages.registerDocumentLinkProvider(
        { language: 'tcl' },
        new InnovusDocumentLinkProvider()
    ));

    // 4d. Ctrl+Click callback command — opens the Webview or the virtual document
    subs.push(vscode.commands.registerCommand('innovus-tcl._showHelp', (cmdName: string) => {
        showHelp(context, cmdName);
    }));

    // 5. Semantic Tokens - syntax highlighting for Innovus commands/options
    const semanticProvider = new InnovusSemanticTokensProvider();
    subs.push(vscode.languages.registerDocumentSemanticTokensProvider(
        { language: 'tcl' },
        semanticProvider,
        semanticProvider.getLegend()
    ));

    // 6. Copilot AI tool integration — register the LM Tools
    if (config.get<boolean>('enableAITools', true)) {
        registerAllTools(context);
    }

    // Watch the configuration and reload automatically when the language,
    // version, AI tools or compilation settings change
    subs.push(vscode.workspace.onDidChangeConfiguration((e) => {
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');

        if (e.affectsConfiguration('innovus-tcl.language')) {
            const newLang = applyLanguage(db);
            // Re-render the diagnostics so their messages pick up the new language
            if (vscode.window.activeTextEditor) {
                diagnosticsProvider?.updateDiagnostics(vscode.window.activeTextEditor.document);
            }
            lintProvider?.runLint();
            vscode.window.showInformationMessage(t('config.languageSwitched',
                newLang === 'zh' ? t('common.chinese') : t('common.english'),
                db.getCommandNames().length));
        }
        if (e.affectsConfiguration('innovus-tcl.version')) {
            const newVer = cfg.get<string>('version', '25.1');
            db.setVersion(newVer);
            db.reload();
            vscode.window.showInformationMessage(t('config.versionSwitched',
                db.getVersion() || t('common.default'), db.getCommandNames().length));
        }
        if (e.affectsConfiguration('innovus-tcl.enableAITools')) {
            const aiEnabled = cfg.get<boolean>('enableAITools', true);
            if (aiEnabled) {
                vscode.window.showInformationMessage(
                    t('config.aiToolsEnabled'),
                    { modal: true }
                );
            }
        }
        if (e.affectsConfiguration('innovus-tcl.fFile') ||
            e.affectsConfiguration('innovus-tcl.enableCompilation')) {
            if (lintProvider && cfg.get<boolean>('enableCompilation', true)) {
                lintProvider.runLint();
                vscode.window.showInformationMessage(
                    t('config.recompiled', lintProvider.getLastResult()?.units.length || 0)
                );
            } else if (!cfg.get<boolean>('enableCompilation', true)) {
                lintProvider?.clear();
            }
        }
    }));

    // Command: reload the database
    subs.push(vscode.commands.registerCommand('innovus-tcl.reloadDB', () => {
        db.reload();
        vscode.window.showInformationMessage(t('db.reloaded',
            db.getCommandNames().length,
            db.getLanguage() === 'zh' ? t('common.chinese') : t('common.english')));
    }));

    // Command: show the extension information
    subs.push(vscode.commands.registerCommand('innovus-tcl.showHelp', () => {
        const stats = db.getStats();
        const langLabel = db.getLanguage() === 'zh' ? t('common.chinese') : t('common.english');
        const versionLabel = stats.version || t('common.default');
        const level = vscode.workspace.getConfiguration('innovus-tcl').get<string>('diagnosticLevel', 'standard');
        const levelLabels: Record<string, string> = {
            basic: t('info.levelBasic'),
            standard: t('info.levelStandard'),
            strict: t('info.levelStrict')
        };
        const check = (on: unknown) => (on ? '✅' : '❌');
        const msg = [
            `🚀 Innovus TCL Helper v0.4.0`,
            ``,
            t('info.entriesLoaded', stats.totalEntries),
            t('info.commands', stats.commands),
            t('info.variables', stats.variables),
            t('info.version', versionLabel),
            t('info.language', langLabel),
            t('info.hover', check(config.get('enableHover'))),
            t('info.completion', check(config.get('enableCompletion'))),
            t('info.diagnostics', check(config.get('enableDiagnostics')), levelLabels[level] || level),
            t('info.compilation', check(config.get('enableCompilation'))),
            t('info.aiTools', check(config.get('enableAITools'))),
        ].join('\n');
        vscode.window.showInformationMessage(msg, { modal: true });
    }));

    // Command: switch the language of both the interface and the documentation
    subs.push(vscode.commands.registerCommand('innovus-tcl.switchLanguage', async () => {
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');
        const configured = cfg.get<string>('language', 'en');
        const picked = await vscode.window.showQuickPick(
            [
                {
                    label: t('lang.en'),
                    description: configured === 'en' ? t('version.current') : '',
                    detail: t('lang.enDetail'),
                    value: 'en'
                },
                {
                    label: t('lang.zh'),
                    description: configured === 'zh' ? t('version.current') : '',
                    detail: t('lang.zhDetail'),
                    value: 'zh'
                },
                {
                    label: t('lang.auto'),
                    description: configured === 'auto' ? t('version.current') : '',
                    detail: t('lang.autoDetail'),
                    value: 'auto'
                }
            ],
            { placeHolder: t('lang.pick') }
        );
        if (!picked || picked.value === configured) { return; }

        // The onDidChangeConfiguration handler applies the language and notifies
        await cfg.update('language', picked.value, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(t('lang.paletteNote'));
    }));

    // Command: toggle the help display style (Webview ↔ plain text)
    subs.push(vscode.commands.registerCommand('innovus-tcl.toggleHelpStyle', async () => {
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');
        const current = cfg.get<string>('helpStyle', 'webview');
        const next = current === 'webview' ? 'plain' : 'webview';
        await cfg.update('helpStyle', next, vscode.ConfigurationTarget.Global);
        const label = next === 'webview' ? t('helpStyle.webview') : t('helpStyle.plain');
        vscode.window.showInformationMessage(t('helpStyle.switched', label));
    }));

    // Command: switch the Innovus version
    subs.push(vscode.commands.registerCommand('innovus-tcl.switchVersion', async () => {
        const versions = db.getAvailableVersions();
        const currentVer = db.getVersion();

        const items = versions.map(v => ({
            label: v.label,
            description: v.description,
            detail: v.label === currentVer || (!currentVer && v.label === '25.1')
                ? t('version.current')
                : ''
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: t('version.pick')
        });

        if (picked) {
            const cfg = vscode.workspace.getConfiguration('innovus-tcl');
            await cfg.update('version', picked.label, vscode.ConfigurationTarget.Global);
        }
    }));

    // Command: AI-analyze the current TCL script
    subs.push(vscode.commands.registerCommand('innovus-tcl.analyzeScript', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'tcl') {
            vscode.window.showWarningMessage(t('need.tclFile'));
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const mcpConfigPath = workspaceFolder
            ? path.join(workspaceFolder.uri.fsPath, '.vscode', 'mcp.json')
            : '';

        // Check whether MCP is already installed
        let mcpAvailable = false;
        if (mcpConfigPath && fs.existsSync(mcpConfigPath)) {
            try {
                const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
                if (mcpConfig.servers?.['innovus-tcl']) {
                    mcpAvailable = true;
                }
            } catch { /* ignore */ }
        }

        // Build the option list
        const options: vscode.QuickPickItem[] = [
            {
                label: t('analyze.docLabel'),
                description: t('analyze.docDesc')
            }
        ];

        if (mcpAvailable) {
            options.push({
                label: t('analyze.mcpLabel'),
                description: t('analyze.mcpDesc')
            });
        } else {
            options.push({
                label: t('analyze.installLabel'),
                description: t('analyze.installDesc')
            });
        }

        const choice = await vscode.window.showQuickPick(options, {
            placeHolder: t('analyze.pick')
        });

        if (!choice) { return; }

        const content = editor.document.getText();
        const sourceLabel = editor.document.uri.fsPath || t('analyze.currentScript');

        if (choice.label.startsWith('📋')) {
            // Doc concatenation mode — documentation only, no AI analysis task
            const report = buildScriptContextForCommand(content, sourceLabel, false);
            const doc = await vscode.workspace.openTextDocument({
                content: report,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true
            });
        } else if (choice.label.startsWith('🤖')) {
            // AI analysis mode — copy the prompt to the clipboard, do not send the file
            const prompt = buildAiAnalysisPrompt(context.extensionPath, sourceLabel);
            await vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage(
                t('analyze.promptCopied'),
                { modal: true }
            );
        } else {
            await vscode.commands.executeCommand('innovus-tcl.installMcp');
        }
    }));

    // Command: list every Innovus command
    subs.push(vscode.commands.registerCommand('innovus-tcl.listCommands', async () => {
        const allNames = db.getCommandNames();
        const stats = db.getStats();

        const searchTerm = await vscode.window.showInputBox({
            placeHolder: t('list.filterPlaceholder'),
            prompt: t('list.filterPrompt', stats.commands, stats.variables)
        });

        let filtered = allNames;
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            filtered = allNames.filter(name => name.toLowerCase().includes(lower));
        }

        const maxDisplay = 500;
        const displayNames = filtered.slice(0, maxDisplay);

        const items = displayNames.map(name => {
            const info = db.get(name);
            const isCmd = info?.is_cmd !== false;
            return {
                label: name,
                description: info?.summary || '',
                detail: isCmd ? t('common.command') : t('common.variableMode')
            };
        });

        const picked = await vscode.window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: t('list.showing', displayNames.length, filtered.length)
        });

        if (picked) {
            // The user picked a command, show its help
            showHelp(context, picked.label);
        }
    }));

    // Command: install the Copilot MCP tools
    subs.push(vscode.commands.registerCommand('innovus-tcl.installMcp', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage(t('need.workspaceFolder'));
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // ---- Step 1: locate the MCP server script ----
        const extPath = context.extensionPath;
        let mcpScript = path.join(extPath, 'scripts', 'mcp-server.mjs');

        // Check whether the file exists
        if (!fs.existsSync(mcpScript)) {
            // In development mode the script may live in the project directory
            const devPath = path.join(extPath, 'scripts', 'mcp-server.mjs');
            if (fs.existsSync(devPath)) {
                mcpScript = devPath;
            } else {
                vscode.window.showErrorMessage(t('mcp.scriptNotFound', mcpScript));
                return;
            }
        }

        // ---- Step 2: locate the data directory ----
        let dataRoot = '';
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');
        const configuredRoot = cfg.get<string>('dataRoot', '');
        if (configuredRoot && fs.existsSync(configuredRoot)) {
            dataRoot = configuredRoot;
        } else {
            // Auto-detect: look for the data/cmds/innovus/ directory
            const candidates = [
                path.join(extPath, 'data'),
                path.join(workspaceRoot, 'data'),
            ];
            for (const c of candidates) {
                const testHelpDir = path.join(c, 'cmds', 'innovus', '25.1', 'cn', 'help');
                if (fs.existsSync(c) && fs.existsSync(testHelpDir)) {
                    dataRoot = c;
                    break;
                }
            }
        }

        if (!dataRoot) {
            vscode.window.showErrorMessage(t('mcp.dataNotFound'));
            return;
        }

        // ---- Step 3: locate Node.js ----
        const nodeCommand = process.execPath.includes('node') ? process.execPath : 'node';

        // ---- Step 4: pick the documentation language ----
        const lang = db.getLanguage();

        // ---- Step 5: write .vscode/mcp.json ----
        const vscodeDir = path.join(workspaceRoot, '.vscode');
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        const mcpConfigPath = path.join(vscodeDir, 'mcp.json');

        // Check for an existing configuration
        let existingConfig: { servers: Record<string, unknown> } = { servers: {} };
        if (fs.existsSync(mcpConfigPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
                if (existing.servers) {
                    existingConfig = existing;
                }
            } catch { /* ignore the parse error and overwrite */ }
        }

        // Add the innovus-tcl configuration
        existingConfig.servers['innovus-tcl'] = {
            type: 'stdio',
            command: nodeCommand,
            args: [
                mcpScript,
                '--data-root', dataRoot,
                '--lang', lang
            ]
        };

        fs.writeFileSync(mcpConfigPath, JSON.stringify(existingConfig, null, 2), 'utf-8');

        // ---- Step 6: confirm ----
        const msg = t('mcp.installed', mcpScript, dataRoot, lang);

        const reloadAction = t('mcp.reloadWindow');
        const result = await vscode.window.showInformationMessage(msg, { modal: true }, reloadAction);

        if (result === reloadAction) {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }));

    // Command: install the agent skills
    subs.push(vscode.commands.registerCommand('innovus-tcl.installSkills', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage(t('need.workspaceFolder'));
            return;
        }

        installAgentSkills(context.extensionPath);

        vscode.window.showInformationMessage(t('skills.installed'), { modal: true });
    }));

    // Command: run the cross-file compilation lint
    subs.push(vscode.commands.registerCommand('innovus-tcl.runLint', () => {
        if (!lintProvider) {
            vscode.window.showWarningMessage(t('lint.disabled'));
            return;
        }
        lintProvider.runLint();
        const result = lintProvider.getLastResult();
        if (result) {
            vscode.window.showInformationMessage(t('lint.done',
                result.units.length,
                Array.from(result.variables.values()).reduce((s, v) => s + v.length, 0),
                result.errors.length,
                result.warnings.length));
        }
    }));

    // Command: show the lint report
    subs.push(vscode.commands.registerCommand('innovus-tcl.showLintReport', async () => {
        if (!lintProvider || !lintProvider.getLastResult()) {
            vscode.window.showWarningMessage(t('lint.runFirst'));
            return;
        }
        const format = await vscode.window.showQuickPick(
            [
                { label: '📝 Markdown', description: t('lint.formatMarkdown') },
                { label: '📊 JSON', description: t('lint.formatJson') }
            ],
            { placeHolder: t('lint.formatPick') }
        );

        if (!format) { return; }

        const report = lintProvider.generateLintReport(
            format.label.includes('JSON') ? 'json' : 'text'
        );

        if (format.label.includes('JSON')) {
            // Pretty-print the JSON
            const formatted = JSON.stringify(JSON.parse(report), null, 2);
            const doc = await vscode.workspace.openTextDocument({
                content: formatted,
                language: 'json'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true
            });
        } else {
            const doc = await vscode.workspace.openTextDocument({
                content: report,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true
            });
        }
    }));

    // Command: open the .f file
    subs.push(vscode.commands.registerCommand('innovus-tcl.openFFile', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage(t('need.workspace'));
            return;
        }
        const fFile = vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('fFile', 'tcl.f');
        const fFilePath = path.join(workspaceFolders[0].uri.fsPath, fFile);

        // Create an empty .f file when it does not exist
        if (!fs.existsSync(fFilePath)) {
            fs.writeFileSync(fFilePath, t('ffile.defaultContent'), 'utf-8');
        }

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fFilePath));
        await vscode.window.showTextDocument(doc);
    }));

    // Command: set the .f file path
    subs.push(vscode.commands.registerCommand('innovus-tcl.setFFile', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage(t('need.workspace'));
            return;
        }

        const currentFfile = vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('fFile', 'tcl.f');

        const newFfile = await vscode.window.showInputBox({
            prompt: t('ffile.prompt'),
            value: currentFfile,
            placeHolder: t('ffile.placeholder'),
            validateInput: (value) => {
                if (!value || !value.trim()) {
                    return t('ffile.emptyPath');
                }
                if (!value.endsWith('.f')) {
                    return t('ffile.badSuffix');
                }
                return null; // Valid
            }
        });

        if (newFfile === undefined) { return; } // The user cancelled

        const trimmed = newFfile.trim();

        // Write the configuration (workspace scope)
        const config = vscode.workspace.getConfiguration('innovus-tcl');
        try {
            await config.update('fFile', trimmed, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage(t('ffile.updated', trimmed));

            // Re-run the lint automatically
            if (lintProvider) {
                lintProvider.runLint();
                const unitCount = lintProvider.getLastResult()?.units.length || 0;
                vscode.window.showInformationMessage(t('ffile.recompiled', unitCount));
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(t('ffile.setFailed', e.message));
        }
    }));

    // Command: run the TCL script
    subs.push(vscode.commands.registerCommand('innovus-tcl.runScript', async () => {
        const editor = vscode.window.activeTextEditor;

        if (!editor || editor.document.languageId !== 'tcl') {
            vscode.window.showWarningMessage(t('need.tclFile'));
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage(t('need.workspace'));
            return;
        }

        const document = editor.document;
        const content = document.getText();
        const workDir = path.dirname(document.uri.fsPath);

        // Show the output channel
        runChannel.clear();
        runChannel.show(true);

        runChannel.appendLine('═══════════════════════════════════════');
        runChannel.appendLine(t('run.scriptHeader'));
        runChannel.appendLine('═══════════════════════════════════════');
        runChannel.appendLine(t('run.file', path.basename(document.fileName)));
        runChannel.appendLine(t('run.workDir', workDir));
        runChannel.appendLine('');

        // Find tclsh and execute
        const runner = getRunner();
        runner.language = db.getLanguage() === 'zh' ? 'zh' : 'en';
        const configTclshPath = vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('tclshPath', '');
        const tclsh = runner.findTclsh(context.extensionPath, configTclshPath);

        if (!tclsh) {
            runChannel.appendLine(t('tclsh.notFound'));
            runChannel.appendLine(getTclshInstallGuide());
            runChannel.appendLine(t('tclsh.pathTip'));
            return;
        }

        runChannel.appendLine(t('run.usingInterpreter', tclsh));
        runChannel.appendLine(t('run.executing'));
        runChannel.appendLine('');

        try {
            const saveOutput = vscode.workspace.getConfiguration('innovus-tcl')
                .get<boolean>('runSaveOutput', false);
            const outDir = vscode.workspace.getConfiguration('innovus-tcl')
                .get<string>('runOutputDir', '') ||
                path.join(workspaceFolders[0].uri.fsPath, '.innovus-run');
            const outputConfig = saveOutput ? { enabled: true, dir: outDir } : undefined;
            const simOutputMode = vscode.workspace.getConfiguration('innovus-tcl')
                .get<string>('simOutputMode', 'dry-run') as 'dry-run' | 'mkdir';

            const result = await runner.runScript(
                content, workDir, context.extensionPath,
                configTclshPath, outputConfig, simOutputMode
            );

            // Print the intercepted Innovus commands
            if (result.innovusCommands.length > 0) {
                runChannel.appendLine(t('run.commandsDetected', result.innovusCommands.length));
                runChannel.appendLine(`   ${result.innovusCommands.join(', ')}`);
                runChannel.appendLine('');
            }

            // Print stdout
            if (result.stdout.trim()) {
                runChannel.appendLine(t('run.stdout'));
                runChannel.appendLine(result.stdout);
            }

            // Print stderr
            if (result.stderr.trim()) {
                runChannel.appendLine(t('run.stderr'));
                runChannel.appendLine(result.stderr);
            }

            // Print the result summary
            runChannel.appendLine('');
            runChannel.appendLine('───────────────────────────────────────');
            if (result.success) {
                runChannel.appendLine(t('run.success', result.duration));
            } else {
                runChannel.appendLine(t('run.completedWithErrors', result.duration));
            }
            runChannel.appendLine(t('run.exitCode', result.exitCode));
            if (result.outputFile) {
                runChannel.appendLine(t('run.outputFile', result.outputFile));
            }

        } catch (e: any) {
            runChannel.appendLine(t('run.exception', e.message));
        }
    }));

    // Command: run the whole .f project
    subs.push(vscode.commands.registerCommand('innovus-tcl.runProject', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage(t('need.workspace'));
            return;
        }

        const wsRoot = workspaceFolders[0].uri.fsPath;
        const fFile = vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('fFile', 'tcl.f');
        const fFilePath = path.join(wsRoot, fFile);

        if (!fs.existsSync(fFilePath)) {
            vscode.window.showErrorMessage(t('ffile.notFound', fFile));
            return;
        }

        runChannel.clear();
        runChannel.show(true);
        runChannel.appendLine('═══════════════════════════════════════');
        runChannel.appendLine(t('run.projectHeader'));
        runChannel.appendLine('═══════════════════════════════════════');
        runChannel.appendLine(t('run.fFile', fFile));
        runChannel.appendLine('');

        const runner = getRunner();
        runner.language = db.getLanguage() === 'zh' ? 'zh' : 'en';
        const configTclshPath2 = vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('tclshPath', '');
        const tclsh2 = runner.findTclsh(context.extensionPath, configTclshPath2);
        if (!tclsh2) {
            runChannel.appendLine(t('tclsh.notFound'));
            runChannel.appendLine(getTclshInstallGuide());
            runChannel.appendLine(t('tclsh.pathTip'));
            return;
        }

        runChannel.appendLine(`🔧 ${tclsh2}`);
        runChannel.appendLine(t('run.executing'));
        runChannel.appendLine('');

        try {
            const saveOutput2 = vscode.workspace.getConfiguration('innovus-tcl')
                .get<boolean>('runSaveOutput', false);
            const outDir2 = vscode.workspace.getConfiguration('innovus-tcl')
                .get<string>('runOutputDir', '') ||
                path.join(wsRoot, '.innovus-run');
            const outputConfig2 = saveOutput2 ? { enabled: true, dir: outDir2 } : undefined;
            const simOutputMode = vscode.workspace.getConfiguration('innovus-tcl')
                .get<string>('simOutputMode', 'dry-run') as 'dry-run' | 'mkdir';

            const result = await runner.runProject(
                fFilePath, wsRoot, context.extensionPath,
                configTclshPath2, outputConfig2, simOutputMode
            );

            // Show the full run output (with the marker lines removed)
            const firstR = result.results[0];
            const cleanOutput = firstR?.stdout
                ?.split('\n')
                .filter((l: string) => !l.startsWith('_FILE_') && !l.startsWith('_ERROR_MSG_') && !l.startsWith('_ERROR_INFO_'))
                .join('\n')
                .trim() || '';
            if (cleanOutput) {
                runChannel.appendLine(t('run.stdout'));
                runChannel.appendLine(cleanOutput);
            }

            // Per-file status
            runChannel.appendLine('');
            runChannel.appendLine(t('run.fileStatus'));
            const skipMsg = skippedMessage();
            for (const r of result.results) {
                const isSkipped = !r.success && r.stderr === skipMsg;
                const status = r.success ? '✅' : (isSkipped ? '⏭' : '❌');
                const cmdInfo = r.innovusCommands.length > 0
                    ? ` (${r.innovusCommands.length} cmds)` : '';
                const fileInfo = r.outputFile ? ` → ${r.outputFile}` : '';
                runChannel.appendLine(`${status} ${r.filePath} [${r.duration}ms]${cmdInfo}${fileInfo}`);
                if (!r.success && r.stderr && !isSkipped) {
                    // Print multi-line errors one line at a time
                    const errLines = r.stderr.split('\n');
                    for (const line of errLines) {
                        runChannel.appendLine(`   ⚠ ${line}`);
                    }
                    // Extract the line number and emit a clickable file:line link
                    const lineMatch = r.stderr.match(/\(file\s+"([^"]+)"\s+line\s+(\d+)\)/);
                    if (lineMatch) {
                        const linkedFile = lineMatch[1];
                        const lineNum = lineMatch[2];
                        // The VS Code output channel (log:true) recognizes the file:line format
                        runChannel.appendLine(`   🔗 ${linkedFile}:${lineNum}`);
                    }
                } else if (isSkipped) {
                    runChannel.appendLine(`   └─ ${skipMsg}`);
                }
            }

            runChannel.appendLine('');
            runChannel.appendLine('───────────────────────────────────────');
            runChannel.appendLine(t('run.projectSummary',
                result.fileCount, result.errorCount, result.totalDuration));
            if (result.success) {
                runChannel.appendLine(t('run.allPassed'));
            }
        } catch (e: any) {
            runChannel.appendLine(`❌ ${e.message}`);
        }
    }));

    // Command: edit the AI prompt
    subs.push(vscode.commands.registerCommand('innovus-tcl.editPrompt', async () => {
        const langDir = db.getLanguage() === 'zh' ? 'cn' : 'en';
        const cachePath = path.join(context.extensionPath, 'data', 'cache', langDir, 'ai-prompt.md');
        const systemPath = path.join(context.extensionPath, 'prompts', langDir, 'ai-analysis.md');

        // Read the system default and the user default
        let systemPrompt = '';
        try { systemPrompt = fs.readFileSync(systemPath, 'utf-8').trim(); } catch { /* ignore */ }
        let userPrompt = '';
        const hasUserPrompt = fs.existsSync(cachePath);
        if (hasUserPrompt) {
            try { userPrompt = fs.readFileSync(cachePath, 'utf-8').trim(); } catch { /* ignore */ }
        }

        const activeSource = userPrompt
            ? t('prompt.activeUser', langDir)
            : t('prompt.activeSystem', langDir);

        const actionEdit = t('prompt.actionEdit');
        const actionReset = t('prompt.actionReset');
        const actionView = t('prompt.actionView');

        const choice = await vscode.window.showQuickPick(
            [
                { label: actionEdit, description: t('prompt.editDesc', langDir) },
                { label: actionReset, description: t('prompt.resetDesc', langDir) },
                { label: actionView, description: activeSource }
            ],
            { placeHolder: t('prompt.pick') }
        );

        if (!choice) { return; }

        if (choice.label === actionEdit) {
            // Make sure the cache directory exists
            const cacheDir = path.dirname(cachePath);
            if (!fs.existsSync(cacheDir)) { fs.mkdirSync(cacheDir, { recursive: true }); }

            // Seed it from the system default when the user has not created one yet
            if (!hasUserPrompt) {
                fs.writeFileSync(cachePath, systemPrompt || t('prompt.seed'), 'utf-8');
            }

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cachePath));
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(t('prompt.editHint'));
        } else if (choice.label === actionReset) {
            if (hasUserPrompt) {
                fs.unlinkSync(cachePath);
                vscode.window.showInformationMessage(t('prompt.reset', langDir));
            } else {
                vscode.window.showInformationMessage(t('prompt.alreadyDefault'));
            }
        } else {
            // View the active prompt
            const active = userPrompt || systemPrompt || t('prompt.none');
            const source = userPrompt
                ? t('prompt.sourceUser', langDir)
                : t('prompt.sourceSystem', langDir);
            const viewDoc = await vscode.workspace.openTextDocument({
                content: `# ${t('prompt.viewTitle')}\n\n> ${source}\n\n${active}`,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(viewDoc, { preview: true });
        }
    }));

    // Command: open an example TCL script
    subs.push(vscode.commands.registerCommand('innovus-tcl.openExample', async () => {
        const exampleDir = path.join(context.extensionPath, 'data', 'example', 'innovus');

        if (!fs.existsSync(exampleDir)) {
            vscode.window.showErrorMessage(t('example.dirMissing', exampleDir));
            return;
        }

        // Read every .tcl file
        const tclFiles = fs.readdirSync(exampleDir)
            .filter(f => f.endsWith('.tcl'))
            .sort();

        if (tclFiles.length === 0) {
            vscode.window.showInformationMessage(t('example.none'));
            return;
        }

        // Preview the first few lines of every file as its description
        const items = tclFiles.map(f => {
            const filePath = path.join(exampleDir, f);
            let preview = '';
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const firstLine = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))[0] || '';
                preview = firstLine.substring(0, 60) + (firstLine.length > 60 ? '...' : '');
            } catch { /* ignore */ }
            return {
                label: f,
                description: preview,
                detail: filePath
            };
        });

        const picked = await vscode.window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: t('example.pick', tclFiles.length)
        });

        if (picked) {
            const doc = await vscode.workspace.openTextDocument(picked.detail);
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    }));

    // Cleanup
    subs.push({ dispose: () => diagnosticsProvider?.dispose() });
    subs.push({ dispose: () => lintProvider?.dispose() });

    context.subscriptions.push(...subs);
}

/**
 * Build the AI analysis prompt (copied to the clipboard for the user to paste
 * into Copilot Chat).
 *
 * Priority:
 *   1. The VS Code setting innovus-tcl.aiPrompt (highest)
 *   2. data/cache/{cn|en}/ai-prompt.md (user default)
 *   3. prompts/{cn|en}/ai-analysis.md (system default, shipped with the extension)
 */
function buildAiAnalysisPrompt(extensionPath: string, sourceLabel: string): string {
    const langDir = getDB().getLanguage() === 'zh' ? 'cn' : 'en';
    const cachePath = path.join(extensionPath, 'data', 'cache', langDir, 'ai-prompt.md');
    const systemPath = path.join(extensionPath, 'prompts', langDir, 'ai-analysis.md');

    // 1. The VS Code setting
    const cfg = vscode.workspace.getConfiguration('innovus-tcl');
    const customPrompt = cfg.get<string>('aiPrompt', '');
    if (customPrompt) {
        return customPrompt.replace(/\{script_name\}/g, sourceLabel);
    }

    // 2. The user default (data/cache/ai-prompt.md)
    if (cachePath && fs.existsSync(cachePath)) {
        try {
            const userPrompt = fs.readFileSync(cachePath, 'utf-8').trim();
            if (userPrompt) {
                return userPrompt.replace(/\{script_name\}/g, sourceLabel);
            }
        } catch { /* fall through */ }
    }

    // 3. The system default (prompts/ai-analysis.md)
    if (systemPath && fs.existsSync(systemPath)) {
        try {
            const sysPrompt = fs.readFileSync(systemPath, 'utf-8').trim();
            return sysPrompt.replace(/\{script_name\}/g, sourceLabel);
        } catch { /* fall through */ }
    }

    // Hard fallback
    return t('analyze.fallbackPrompt', sourceLabel);
}

export function deactivate() {
    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
    }
    if (lintProvider) {
        lintProvider.dispose();
    }
}

/**
 * Generate the MCP tool configuration guide
 */
function generateMcpGuide(): string {
    const extPath = '[extension install path]/fd-echoro.innovus-tcl-enhance-[version]';
    return `# 🔧 Innovus TCL MCP Tool Configuration Guide

## What are MCP Tools?

MCP (Model Context Protocol) allows Copilot to directly call tools provided by extensions. Once configured, in Copilot Chat:
- Copilot can **automatically** call \`innovus_parse_tcl_script\` to parse TCL scripts and get command docs
- Copilot can **automatically** call \`innovus_lint_tcl_script\` to check TCL scripts for errors

This enables Copilot to write low-hallucination TCL code based on **real command documentation**.

## Setup Steps

### 1. Find the MCP Server Script

The MCP server script is located in the extension directory:
\`\`\`
${extPath}/scripts/mcp-server.mjs
\`\`\`

### 2. Find the Data Directory

The data directory contains Innovus command JSON docs, typically at:
\`\`\`
/path/to/data_base
\`\`\`

### 3. Configure VS Code

Create \`.vscode/mcp.json\` in your project root:

\`\`\`json
{
    "servers": {
        "innovus-tcl": {
            "type": "stdio",
            "command": "node",
            "args": [
                "${extPath}/scripts/mcp-server.mjs",
                "--data-root",
                "/path/to/data_base",
                "--lang",
                "en"
            ]
        }
    }
}
\`\`\`

### 4. Reload VS Code Window

\`Ctrl+Shift+P\` → \`Developer: Reload Window\`

### 5. Test in Copilot Chat

Open Copilot Chat and type:
> Analyze my current TCL script

Copilot will automatically call the MCP tools to get command documentation and perform AI analysis.

## MCP Tools

| Tool Name | Function |
|-----------|----------|
| \`innovus_parse_tcl_script\` | Parse TCL script, return full docs + parameter comparison for all commands |
| \`innovus_lint_tcl_script\` | Static lint check (brackets/quotes/command parameters) |
`;
}
