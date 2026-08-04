/**
 * Interface localization for the extension.
 *
 * English is the default. The active language comes from the
 * `innovus-tcl.language` setting — the single switch covering both the interface
 * and the command documentation database — and is pushed in through
 * `setUiLanguage()` by extension.ts. This module deliberately does not import
 * `vscode`, so runner.ts stays testable outside the extension host.
 *
 * Adding a message:
 *   1. Add a key to MESSAGES with its `en` and `zh` text
 *   2. Use `t('key')`, or `t('key', arg0, arg1)` for `{0}` / `{1}` placeholders
 */

export type UiLanguage = 'en' | 'zh';

let uiLanguage: UiLanguage = 'en';

/** Set the interface language (called by extension.ts on activation and on config change). */
export function setUiLanguage(lang: UiLanguage): void {
    uiLanguage = lang === 'zh' ? 'zh' : 'en';
}

/** Get the interface language. Defaults to English. */
export function getUiLanguage(): UiLanguage {
    return uiLanguage;
}

/** Convenience predicate for the few places that branch on layout rather than text. */
export function isZhUi(): boolean {
    return uiLanguage === 'zh';
}

interface Message {
    en: string;
    zh: string;
}

const MESSAGES = {
    // ── Generic ──
    'common.command': { en: 'Command', zh: '命令' },
    'common.variableMode': { en: 'Variable/Mode', zh: '变量/模式' },
    'common.modeVariable': { en: '⚙️ Mode/Variable', zh: '⚙️ 模式/变量' },
    'common.syntax': { en: 'Syntax', zh: '语法' },
    'common.description': { en: 'Description', zh: '说明' },
    'common.options': { en: 'Options', zh: '参数' },
    'common.required': { en: 'Required', zh: '必需' },
    'common.optional': { en: 'Optional', zh: '可选' },
    'common.type': { en: 'Type', zh: '类型' },
    'common.value': { en: 'Value', zh: '值' },
    'common.file': { en: 'File', zh: '文件' },
    'common.line': { en: 'Line', zh: '行' },
    'common.empty': { en: '(empty)', zh: '(空)' },
    'common.english': { en: 'English', zh: '英文' },
    'common.chinese': { en: 'Chinese', zh: '中文' },
    'common.default': { en: '(default)', zh: '(默认)' },
    'common.openSettings': { en: 'Open Settings', zh: '打开设置' },

    // ── Workspace / editor preconditions ──
    'need.tclFile': { en: 'Please open a TCL file first.', zh: '请先打开一个 TCL 文件。' },
    'need.workspace': { en: 'Please open a workspace first.', zh: '请先打开一个工作区。' },
    'need.workspaceFolder': { en: 'Please open a workspace folder first.', zh: '请先打开一个工作区文件夹。' },

    // ── tclsh ──
    'tclsh.notFoundModal': {
        en: '⚠️ tclsh interpreter not found. TCL script execution is unavailable.\n\n{0}\n\nAfter configuration, use the ▶️ button or command palette to run scripts.',
        zh: '⚠️ 未找到 tclsh 解释器，运行 TCL 脚本功能不可用。\n\n{0}\n\n配置后可通过 ▶️ 按钮或命令面板运行脚本。'
    },
    'tclsh.notFound': { en: '❌ tclsh interpreter not found', zh: '❌ 未找到 tclsh 解释器' },
    'tclsh.notFoundShort': { en: 'tclsh not found', zh: '未找到 tclsh' },
    'tclsh.pathTip': {
        en: '\n💡 Tip: Search innovus-tcl.tclshPath in VS Code settings to configure a custom path',
        zh: '\n💡 提示: 在 VS Code 设置中搜索 innovus-tcl.tclshPath 配置自定义路径'
    },
    'tclsh.guideMac': {
        en: 'Install tcl-tk: brew install tcl-tk\nOr set innovus-tcl.tclshPath to your tclsh path',
        zh: '请安装 tcl-tk: brew install tcl-tk\n或在设置中配置 innovus-tcl.tclshPath 指向 tclsh 路径'
    },
    'tclsh.guideWindows': {
        en: 'Install ActiveTcl from https://www.activestate.com/products/tcl/\nOr set innovus-tcl.tclshPath to your tclsh.exe path',
        zh: '请安装 ActiveTcl (https://www.activestate.com/products/tcl/)\n或在设置中配置 innovus-tcl.tclshPath 指向 tclsh.exe 路径'
    },
    'tclsh.guideLinux': {
        en: 'Install tcl: sudo apt install tcl or sudo dnf install tcl\nOr set innovus-tcl.tclshPath to your tclsh path',
        zh: '请安装 tcl: sudo apt install tcl 或 sudo dnf install tcl\n或在设置中配置 innovus-tcl.tclshPath 指向 tclsh 路径'
    },

    // ── Configuration change notifications ──
    'config.languageSwitched': {
        en: 'Innovus TCL: language switched to {0} ({1} commands)',
        zh: 'Innovus TCL: 语言已切换为{0} ({1} 个命令)'
    },
    'config.versionSwitched': {
        en: 'Innovus TCL: switched to version {0}, {1} commands',
        zh: 'Innovus TCL: 已切换至版本 {0}，{1} 个命令'
    },
    'config.aiToolsEnabled': {
        en: 'Innovus TCL: Copilot AI tools enabled.\n\nIn Copilot Chat you can now:\n• Query every Innovus command\n• Get the detailed syntax and options of a command\n• Parse a TCL script and generate a description\n• Get the cross-file compilation analysis and lint report\n\n💡 Reload the window for the AI tools to take effect.',
        zh: 'Innovus TCL: Copilot AI 工具已启用。\n\n在 Copilot Chat 中，你可以:\n• 查询所有 Innovus 命令\n• 获取命令的详细语法和参数\n• 解析 TCL 脚本生成描述\n• 获取跨文件编译分析和 Lint 报告\n\n💡 请重新加载窗口以使 AI 工具生效。'
    },
    'config.recompiled': {
        en: 'Innovus TCL: recompiled ({0} files)',
        zh: 'Innovus TCL: 已重新编译 ({0} 个文件)'
    },
    'status.recompiled': {
        en: '$(sync) Innovus TCL: recompiled ({0} files)',
        zh: '$(sync) Innovus TCL: 已重新编译 ({0} 个文件)'
    },
    'db.reloaded': {
        en: 'Innovus TCL: reloaded {0} commands ({1})',
        zh: 'Innovus TCL: 已重新加载 {0} 个命令 ({1})'
    },

    // ── Extension info panel ──
    'info.entriesLoaded': { en: '📦 Entries loaded: {0}', zh: '📦 已加载条目: {0} 个' },
    'info.commands': { en: '   ├─ Commands: {0}', zh: '   ├─ 命令: {0} 个' },
    'info.variables': { en: '   └─ Variables/modes: {0}', zh: '   └─ 变量/模式: {0} 个' },
    'info.version': { en: '🔢 Innovus version: {0}', zh: '🔢 Innovus 版本: {0}' },
    'info.language': { en: '🌐 Language: {0}', zh: '🌐 语言: {0}' },
    'info.hover': { en: '🔍 Hover tooltips: {0}', zh: '🔍 悬停提示: {0}' },
    'info.completion': { en: '✏️  Auto-completion: {0}', zh: '✏️  自动补全: {0}' },
    'info.diagnostics': { en: '⚠️  Static checking: {0} ({1})', zh: '⚠️  静态检查: {0} ({1})' },
    'info.compilation': { en: '🔗 Cross-file compilation: {0}', zh: '🔗 跨文件编译: {0}' },
    'info.aiTools': { en: '🤖 AI tools: {0}', zh: '🤖 AI 工具: {0}' },
    'info.levelBasic': { en: 'basic (brackets/quotes only)', zh: '基础 (仅括号/引号)' },
    'info.levelStandard': { en: 'standard (+ argument validation)', zh: '标准 (+参数校验)' },
    'info.levelStrict': {
        en: 'strict (+ type validation + similar command suggestions)',
        zh: '严格 (+类型验证 +相似建议)'
    },

    // ── Help style ──
    'helpStyle.webview': { en: 'Webview Rich Panel', zh: 'Webview 富文本面板' },
    'helpStyle.plain': { en: 'Plain Text Editor', zh: '纯文本编辑器' },
    'helpStyle.switched': { en: 'Innovus TCL: help style → {0}', zh: 'Innovus TCL: 帮助风格 → {0}' },

    // ── Version picker ──
    'version.current': { en: '● Current', zh: '● 当前使用' },
    'version.pick': {
        en: 'Select version (test=no highlight, 25.1=full data)',
        zh: '选择版本 (test=关闭高亮, 25.1=完整数据)'
    },
    'version.innovus': { en: 'Innovus 25.1 — {0} files', zh: 'Innovus 25.1 — {0} 个文件' },
    'version.test': {
        en: 'Test mode — empty data (Innovus highlighting/hints off)',
        zh: '测试模式 — 空数据 (关闭 Innovus 高亮/提示)'
    },
    'version.custom': { en: 'Custom: {0} — {1} files', zh: '自定义: {0} — {1} 个文件' },

    // ── Language picker ──
    'lang.pick': {
        en: 'Select the language for the interface and the command documentation',
        zh: '选择界面与命令文档的语言'
    },
    'lang.en': { en: 'English', zh: 'English (英文)' },
    'lang.zh': { en: '中文 (Chinese)', zh: '中文' },
    'lang.auto': { en: 'Auto', zh: 'Auto (自动)' },
    'lang.enDetail': {
        en: 'English interface and English command documentation',
        zh: '英文界面 + 英文命令文档'
    },
    'lang.zhDetail': {
        en: 'Chinese interface and Chinese command documentation',
        zh: '中文界面 + 中文命令文档'
    },
    'lang.autoDetail': {
        en: 'Follow the VS Code display language',
        zh: '跟随 VS Code 显示语言'
    },
    'lang.paletteNote': {
        en: '💡 Command palette titles follow the VS Code display language, not this setting.',
        zh: '💡 命令面板中的标题跟随 VS Code 显示语言，不受此设置影响。'
    },

    // ── Analyze script ──
    'analyze.docLabel': { en: '📋 Doc Concatenation (Local View)', zh: '📋 拼接文档（本地查看）' },
    'analyze.docDesc': {
        en: 'Concatenate all command docs + parameter comparison as Markdown',
        zh: '将所有命令的完整文档 + 参数对照表拼接为 Markdown'
    },
    'analyze.mcpLabel': { en: '🤖 Copilot AI Analysis (MCP)', zh: '🤖 Copilot AI 分析 (MCP)' },
    'analyze.mcpDesc': {
        en: 'Copy analysis prompt to clipboard, paste in Copilot Chat',
        zh: '复制分析提示词到剪贴板，粘贴到 Copilot Chat 即可'
    },
    'analyze.installLabel': { en: '🔧 Install MCP Tools', zh: '🔧 一键安装 MCP 工具' },
    'analyze.installDesc': {
        en: 'Auto-configure MCP tools for AI analysis',
        zh: '自动配置 MCP 工具，之后可用 AI 分析脚本'
    },
    'analyze.pick': { en: 'Select analysis mode', zh: '选择分析方式' },
    'analyze.currentScript': { en: 'current script', zh: '当前脚本' },
    'analyze.promptCopied': {
        en: '✅ Analysis prompt copied to clipboard! Paste it in Copilot Chat.',
        zh: '✅ 分析提示词已复制到剪贴板！请粘贴到 Copilot Chat 中。'
    },
    'analyze.fallbackPrompt': {
        en: 'Analyze the Innovus TCL script `{0}`. Call innovus_lint_tcl_script and innovus_parse_tcl_script MCP tools, analyze based on returned docs, output in Markdown code block.',
        zh: '请分析 Innovus TCL 脚本 `{0}`。调用 innovus_lint_tcl_script 和 innovus_parse_tcl_script MCP 工具，基于返回的文档进行分析，输出 Markdown 代码块。'
    },

    // ── List commands ──
    'list.filterPlaceholder': {
        en: 'Enter keyword to filter (leave empty for all)',
        zh: '输入关键词过滤（留空显示全部）'
    },
    'list.filterPrompt': {
        en: '{0} commands + {1} variables/modes total',
        zh: '共 {0} 个命令 + {1} 个变量/模式'
    },
    'list.showing': { en: 'Showing {0} / {1} items', zh: '显示 {0} / {1} 个条目' },

    // ── MCP install ──
    'mcp.scriptNotFound': {
        en: 'MCP Server script not found.\nExpected: {0}\n\nPlease verify the extension installation.',
        zh: '找不到 MCP Server 脚本。\n预期位置: {0}\n\n请确认扩展安装完整。'
    },
    'mcp.dataNotFound': {
        en: 'Cannot find Innovus command data directory. Please configure innovus-tcl.dataRoot in settings first.',
        zh: '找不到 Innovus 命令数据目录。请先在设置中配置 innovus-tcl.dataRoot。'
    },
    'mcp.installed': {
        en: '✅ MCP Tools Installed Successfully!\n\n📁 Config: .vscode/mcp.json\n📜 Script: {0}\n📦 Data: {1}\n🌐 Language: {2}\n\n🔧 Registered Tools:\n   • innovus_parse_tcl_script — Parse TCL + command docs\n   • innovus_lint_tcl_script — TCL static lint\n\n⚠️ Reload window for MCP tools to take effect:\n   Ctrl+Shift+P → "Developer: Reload Window"\n\n💡 Then in Copilot Chat, just say:\n   "Analyze my current TCL script"',
        zh: '✅ MCP 工具安装成功！\n\n📁 配置文件: .vscode/mcp.json\n📜 MCP 脚本: {0}\n📦 数据目录: {1}\n🌐 语言: {2}\n\n🔧 已注册工具:\n   • innovus_parse_tcl_script — 解析 TCL 脚本 + 命令文档查询\n   • innovus_lint_tcl_script — TCL 脚本静态检查\n\n⚠️ 请重新加载窗口以使 MCP 工具生效:\n   Ctrl+Shift+P → "Developer: Reload Window"\n\n💡 之后在 Copilot Chat 中直接说:\n   "分析我当前打开的 TCL 脚本"'
    },
    'mcp.reloadWindow': { en: '🔄 Reload Window', zh: '🔄 重新加载窗口' },

    // ── Agent skills ──
    'skills.installed': {
        en: '✅ Agent Skill Installed\n\n`.agents/skills/innovus-tcl-helper/SKILL.md`\n\n💡 Use `/skills` to verify. Ask Innovus TCL questions in Copilot Chat.',
        zh: '✅ Agent Skill 已安装\n\n`.agents/skills/innovus-tcl-helper/SKILL.md`\n\n💡 使用 `/skills` 查看已安装的 skill。在 Copilot Chat 中输入 Innovus TCL 问题自动激活。'
    },

    // ── Lint commands ──
    'lint.disabled': {
        en: 'Cross-file compilation is disabled. Enable innovus-tcl.enableCompilation in settings.',
        zh: '跨文件编译分析未启用。请在设置中启用 innovus-tcl.enableCompilation。'
    },
    'lint.done': {
        en: '✅ Compilation done: {0} files, {1} variables, {2} errors, {3} warnings',
        zh: '✅ 编译完成: {0} 文件, {1} 变量, {2} 错误, {3} 警告'
    },
    'lint.runFirst': {
        en: 'Run compilation first (Cmd+Shift+P → Innovus TCL: Run Cross-file Lint).',
        zh: '请先运行编译分析 (Cmd+Shift+P → Innovus TCL: 运行跨文件 Lint)。'
    },
    'lint.formatMarkdown': { en: 'Formatted lint report', zh: '格式化的 Lint 报告' },
    'lint.formatJson': { en: 'Structured JSON report', zh: '结构化 JSON 报告' },
    'lint.formatPick': { en: 'Select report format', zh: '选择报告格式' },

    // ── .f file commands ──
    'ffile.defaultContent': {
        en: '# Innovus TCL compilation file list\n# One .tcl file per line (relative path)\n# Compiled in order from top to bottom\n',
        zh: '# Innovus TCL 编译文件列表\n# 每行一个 .tcl 文件路径（相对路径）\n# 按顺序从上到下编译\n'
    },
    'ffile.prompt': {
        en: 'Enter .f file path (relative to workspace root)',
        zh: '输入 .f 文件路径（相对于工作区根目录）'
    },
    'ffile.placeholder': {
        en: 'e.g. a.f, temp/a.f, subdir/proj.f',
        zh: '例如: a.f, temp/a.f, subdir/proj.f'
    },
    'ffile.emptyPath': { en: 'Path cannot be empty', zh: '路径不能为空' },
    'ffile.badSuffix': { en: 'File should end with .f', zh: '文件应以 .f 结尾' },
    'ffile.updated': { en: '✅ .f file path updated to: {0}', zh: '✅ .f 文件路径已更新为: {0}' },
    'ffile.recompiled': {
        en: '🔄 Recompiled with new .f file ({0} files)',
        zh: '🔄 已使用新 .f 文件重新编译 ({0} 个文件)'
    },
    'ffile.setFailed': { en: '❌ Failed to set: {0}', zh: '❌ 设置失败: {0}' },
    'ffile.notFound': { en: '.f file not found: {0}', zh: '.f 文件不存在: {0}' },

    // ── Run output channel ──
    'run.scriptHeader': { en: '  Innovus TCL Script Run', zh: '  Innovus TCL 脚本运行' },
    'run.projectHeader': { en: '  Innovus TCL Project Run', zh: '  Innovus TCL 项目运行' },
    'run.file': { en: '  File: {0}', zh: '  文件: {0}' },
    'run.workDir': { en: '  Working directory: {0}', zh: '  工作目录: {0}' },
    'run.fFile': { en: '  .f File: {0}', zh: '  .f 文件: {0}' },
    'run.usingInterpreter': { en: '🔧 Using interpreter: {0}', zh: '🔧 使用解释器: {0}' },
    'run.executing': { en: '⚡ Executing...', zh: '⚡ 执行中...' },
    'run.commandsDetected': {
        en: '📋 {0} Innovus commands detected (doc output instead of execution):',
        zh: '📋 检测到 {0} 个 Innovus 专有命令（以文档输出代替执行）:'
    },
    'run.stdout': { en: '── Run output ──', zh: '── 运行输出 ──' },
    'run.stderr': { en: '── Error output ──', zh: '── 错误输出 ──' },
    'run.fileStatus': { en: '── File status ──', zh: '── 文件状态 ──' },
    'run.success': { en: '✅ Success ({0}ms)', zh: '✅ 执行成功 ({0}ms)' },
    'run.completedWithErrors': {
        en: '⚠️ Completed with errors ({0}ms)',
        zh: '⚠️ 执行完成（有错误） ({0}ms)'
    },
    'run.exitCode': { en: '   Exit code: {0}', zh: '   退出码: {0}' },
    'run.outputFile': { en: '   📄 Output: {0}', zh: '   📄 输出文件: {0}' },
    'run.exception': { en: '❌ Execution error: {0}', zh: '❌ 执行异常: {0}' },
    'run.projectSummary': {
        en: '📊 {0} files, {1} errors, {2}ms',
        zh: '📊 {0} 个文件, {1} 个错误, {2}ms'
    },
    'run.allPassed': { en: '✅ All passed', zh: '✅ 全部通过' },
    'run.skipped': {
        en: 'Skipped due to prior file error',
        zh: '前置文件执行失败，未运行到此文件'
    },
    'run.error': { en: 'Error: {0}', zh: '错误: {0}' },
    'run.pathLabel': { en: 'Path: {0}', zh: '路径: {0}' },
    'run.processError': { en: 'Process error: {0}', zh: '进程错误: {0}' },
    'run.timeout': { en: '\n⏱ Timed out', zh: '\n⏱ 超时' },
    'run.genericException': { en: 'Exception: {0}', zh: '异常: {0}' },
    'run.outputSaved': { en: '[TCL Runner] Output saved: {0}', zh: '[TCL Runner] 输出已保存: {0}' },

    // ── Generated TCL wrapper output ──
    'sim.arguments': { en: 'Arguments', zh: '调用参数' },
    'sim.requiredOptions': { en: 'Required options:', zh: '必选参数:' },
    'sim.optionalOptions': { en: 'Optional options ({0}):', zh: '可选参数 ({0}个):' },
    'sim.moreOptions': { en: '... and {0} more options', zh: '... 还有 {0} 个参数' },
    'sim.inputFile': { en: 'Input file', zh: '输入文件' },
    'sim.inputFileMissing': { en: 'Input file not found', zh: '输入文件不存在' },
    'sim.createdDir': { en: 'Created directory', zh: '创建目录' },
    'sim.generatedFile': { en: 'Generated file', zh: '生成文件' },
    'sim.wouldGenerateFile': { en: 'Would generate file', zh: '将生成文件' },

    // ── Prompt editor ──
    'prompt.activeUser': {
        en: '(Active: user default data/cache/{0}/ai-prompt.md)',
        zh: '（当前：用户默认 data/cache/{0}/ai-prompt.md）'
    },
    'prompt.activeSystem': {
        en: '(Active: system default prompts/{0}/ai-analysis.md)',
        zh: '（当前：系统默认 prompts/{0}/ai-analysis.md）'
    },
    'prompt.actionEdit': { en: '✏️ Edit User Default', zh: '✏️ 编辑用户默认提示词' },
    'prompt.actionReset': { en: '🔄 Reset to System Default', zh: '🔄 恢复系统默认' },
    'prompt.actionView': { en: '👁️ View Active Prompt', zh: '👁️ 查看当前生效提示词' },
    'prompt.editDesc': {
        en: 'Edit data/cache/{0}/ai-prompt.md',
        zh: '编辑 data/cache/{0}/ai-prompt.md'
    },
    'prompt.resetDesc': {
        en: 'Delete user prompt, fall back to prompts/{0}/ai-analysis.md',
        zh: '删除用户提示词，回退到 prompts/{0}/ai-analysis.md'
    },
    'prompt.pick': { en: 'Select action', zh: '选择操作' },
    'prompt.seed': {
        en: '# Write your custom AI analysis prompt here\n',
        zh: '# 在此处编写你的自定义 AI 分析提示词\n'
    },
    'prompt.editHint': {
        en: '💡 Edit and Ctrl+S to save. This file overrides the system default prompt.',
        zh: '💡 编辑后 Ctrl+S 保存即可。此文件会覆盖系统默认提示词。'
    },
    'prompt.reset': {
        en: '✅ User prompt deleted. Restored to system default prompts/{0}/ai-analysis.md.',
        zh: '✅ 已删除用户提示词，恢复为系统默认 prompts/{0}/ai-analysis.md。'
    },
    'prompt.alreadyDefault': {
        en: 'Already using system default prompt.',
        zh: '当前已是系统默认提示词，无需恢复。'
    },
    'prompt.none': { en: '(no prompt)', zh: '(无提示词)' },
    'prompt.sourceUser': {
        en: 'Source: data/cache/{0}/ai-prompt.md',
        zh: '来源：data/cache/{0}/ai-prompt.md'
    },
    'prompt.sourceSystem': {
        en: 'Source: prompts/{0}/ai-analysis.md (system default)',
        zh: '来源：prompts/{0}/ai-analysis.md（系统默认）'
    },
    'prompt.viewTitle': { en: 'Active AI Analysis Prompt', zh: '当前生效 AI 分析提示词' },

    // ── Examples ──
    'example.dirMissing': {
        en: 'Example directory not found: {0}',
        zh: '示例目录不存在: {0}'
    },
    'example.none': { en: 'No .tcl files in example directory.', zh: '示例目录中没有 .tcl 文件。' },
    'example.pick': {
        en: 'Select example script ({0} files)',
        zh: '选择示例脚本 ({0} 个文件)'
    },

    // ── Hover ──
    'hover.modeVariableHint': {
        en: '> 💡 This is a **mode/variable setting**, use as follows:\n\n',
        zh: '> 💡 这是一个**模式设置变量**，通过以下方式使用：\n\n'
    },
    'hover.enableView': { en: 'enable/view', zh: '启用/查看' },
    'hover.setValue': { en: 'set value', zh: '设置值' },
    'hover.optionTableHeader': {
        en: '| Option | Required | Type | Description |\n|--------|----------|------|-------------|\n',
        zh: '| 参数 | 必需 | 类型 | 说明 |\n|------|------|------|------|\n'
    },
    'hover.variableRef': { en: 'Variable Ref', zh: '变量引用' },
    'hover.tclVariable': { en: 'TCL Variable', zh: 'TCL 变量' },
    'hover.definedAt': { en: 'Defined at', zh: '定义位置' },
    'hover.raw': { en: 'Raw', zh: '原始语句' },
    'hover.unresolvedMayDiffer': {
        en: 'This value contains unresolved variable references, actual value may differ.',
        zh: '该值包含未解析的变量引用，实际值可能不同。'
    },
    'hover.unresolved': {
        en: 'This value contains unresolved variable references.',
        zh: '该值包含未解析的变量引用。'
    },
    'hover.definedAfter': {
        en: 'Variable defined after this reference.',
        zh: '该变量在引用之后定义。'
    },
    'hover.undefined': { en: 'Undefined variable', zh: '未定义的变量' },
    'hover.noDefinition': {
        en: 'No definition found for this variable in the entire compilation.',
        zh: '在整个编译过程中都未找到该变量的定义。'
    },
    'hover.assignmentHistory': { en: 'Assignment History', zh: '赋值历史' },
    'hover.historyTableHeader': {
        en: '| Value | File | Line |\n|-------|------|------|\n',
        zh: '| 值 | 文件 | 行 |\n|-----|------|----|\n'
    },

    // ── Plain / webview help ──
    'help.synopsis': { en: '▎SYNOPSIS', zh: '▎语法' },
    'help.descriptionHeading': { en: '▎DESCRIPTION', zh: '▎说明' },
    'help.optionsHeading': { en: '▎OPTIONS', zh: '▎参数' },
    'help.optionListHeading': { en: '▎OPTIONS', zh: '▎参数列表' },
    'help.relatedHeading': { en: '▎RELATED COMMANDS', zh: '▎相关命令' },
    'help.plainFooter': {
        en: '  Innovus TCL Helper — Plain Text Mode',
        zh: '  Innovus TCL Helper — 纯文本模式'
    },
    'help.title': { en: 'Help', zh: '帮助' },
    'help.analysisCard': { en: '📊 Parameter Analysis', zh: '📊 参数分析' },
    'help.analysisRequired': {
        en: '⚠️ This command has <strong>{0} required parameter(s)</strong>: {1}. Make sure to provide them before execution.',
        zh: '⚠️ 该命令有 <strong>{0} 个必需参数</strong>：{1}。执行前请确保已提供这些参数。'
    },
    'help.analysisAllOptional': {
        en: '✅ All parameters are optional.',
        zh: '✅ 所有参数均为可选。'
    },
    'help.analysisFlags': {
        en: '💡 {0} flag(s) (no value) + {1} value parameter(s) (needs value).',
        zh: '💡 {0} 个开关参数（无需值）+ {1} 个赋值参数（需指定值）。'
    },
    'help.analysisEnums': {
        en: '🔢 {0} are enum types with preset choices.',
        zh: '🔢 {0} 为枚举类型，有预设的可选值。'
    },
    'help.relatedHint': {
        en: '💡 F12 on any command name above to view its help',
        zh: '💡 点击上方命令名可用 F12 跳转查看详情'
    },
    'help.tipsCard': { en: '💡 Tips', zh: '💡 使用提示' },
    'help.tipHover': {
        en: 'Hover over the command name for a quick summary',
        zh: '鼠标悬停命令名可查看快速摘要'
    },
    'help.tipCompletion': {
        en: 'Auto-completion of parameters after typing the command',
        zh: '输入命令后会自动提示可用参数'
    },
    'help.tipToggle': {
        en: 'Ctrl+Shift+P → "Toggle Help Display Style" to switch between Webview and Plain Text',
        zh: '通过 Ctrl+Shift+P → "切换帮助显示风格" 可在 Webview/纯文本 间切换'
    },
    'help.footerHint': {
        en: 'F12 / Ctrl+Click to open help',
        zh: 'F12 / Ctrl+Click 打开帮助'
    },

    // ── Completion ──
    'completion.innovusCommand': { en: 'Innovus Command', zh: 'Innovus 命令' },
    'completion.modeVariable': { en: 'Mode/Variable Setting', zh: '模式/变量设置' },
    'completion.innovusEntry': { en: 'Innovus entry', zh: 'Innovus 条目' },
    'completion.requiredMark': { en: '⚠️ Required', zh: '⚠️ 必需' },
    'completion.typeString': { en: 'string', zh: '字符串' },
    'completion.typeInt': { en: 'integer', zh: '整数' },
    'completion.typeFloat': { en: 'float', zh: '浮点数' },
    'completion.typeFlag': { en: 'flag', zh: '开关' },
    'completion.typeEnum': { en: 'enum', zh: '枚举' },
    'completion.typePoint': { en: 'point', zh: '坐标' },
    'completion.choices': { en: 'Choices', zh: '可选值' },

    // ── Diagnostics ──
    'diag.extraBracket': {
        en: 'Extra "]" — no matching "[" found',
        zh: '多余的右方括号 "]" — 没有匹配的左方括号'
    },
    'diag.extraBrace': {
        en: 'Extra "}" — no matching "{" found',
        zh: '多余的右花括号 "}" — 没有匹配的左花括号'
    },
    'diag.missingBracket': {
        en: 'Missing {0} closing "]" — unclosed bracket(s) at end of file',
        zh: '缺少 {0} 个右方括号 "]" — 文件末尾仍有未闭合的方括号'
    },
    'diag.missingBrace': {
        en: 'Missing {0} closing "}" — unclosed brace(s) at end of file',
        zh: '缺少 {0} 个右花括号 "}" — 文件末尾仍有未闭合的花括号'
    },
    'diag.unclosedQuote': {
        en: 'Unclosed double quote — missing closing """ before end of line',
        zh: '未闭合的双引号 — 字符串从该位置开始到行尾未找到闭合引号'
    },
    'diag.duplicateOption': {
        en: 'Option {0} specified {1} times (duplicate)',
        zh: '参数 {0} 重复指定了 {1} 次'
    },
    'diag.missingExclusive': {
        en: 'Missing required option: {{0}} — one must be specified',
        zh: '缺少必需参数: {{0}} — 必须指定其中之一'
    },
    'diag.missingRequired': {
        en: 'Missing required option: {0} — {1}',
        zh: '缺少必需参数: {0} — {1}'
    },
    'diag.needsValue': {
        en: 'Option {0} requires a value (type: {1})',
        zh: '参数 {0} 需要值 (类型: {1})'
    },
    'diag.unknownCommand': {
        en: 'Unknown command "{0}". Did you mean: {1}?',
        zh: '未知命令 "{0}"。你是否想写: {1}？'
    },
    'diag.expectInt': {
        en: '{0} expects an integer, got "{1}"',
        zh: '{0} 期望整数类型，但得到 "{1}"'
    },
    'diag.expectFloat': {
        en: '{0} expects a float, got "{1}"',
        zh: '{0} 期望浮点数类型，但得到 "{1}"'
    },
    'diag.expectPoint': {
        en: '{0} expects coordinates (e.g. "{x y}"), got "{1}"',
        zh: '{0} 期望坐标类型 (如 "{x y}")，但得到 "{1}"'
    },
    'diag.unusedVariable': {
        en: 'Variable "{0}" is defined but never used',
        zh: '变量 "{0}" 已定义但从未使用'
    },
    'diag.unusedProc': {
        en: 'Procedure "{0}" is defined but never called',
        zh: '过程 "{0}" 已定义但从未被调用'
    },

    // ── Compiler diagnostics ──
    'compile.fFileEmpty': {
        en: '.f file is empty or missing: {0}',
        zh: '.f 文件为空或不存在: {0}'
    },
    'compile.fileNotFound': { en: 'File not found: {0}', zh: '文件不存在: {0}' },
    'compile.readFailed': { en: 'Failed to read the file: {0}', zh: '读取文件失败: {0}' },
    'compile.fFileNotFound': { en: '.f file not found: {0}', zh: '.f 文件不存在: {0}' },
    'compile.sourceNotFound': {
        en: 'File referenced by source not found: {0}',
        zh: 'source 引用的文件不存在: {0}'
    },
    'compile.usedBeforeDefined': {
        en: 'Variable "{0}" is defined after it is used (used at {1}:{2}, defined at {3}:{4})',
        zh: '变量 "{0}" 在使用之后定义（文件 {1}:{2}，定义在 {3}:{4}）'
    },
    'compile.undefinedVariable': {
        en: 'Undefined variable "{0}"',
        zh: '未定义的变量 "{0}"'
    },

    // ── Lint report ──
    'report.title': { en: '# Innovus TCL Lint Report', zh: '# Innovus TCL Lint 报告' },
    'report.workspace': { en: '**Workspace**: {0}', zh: '**工作区**: {0}' },
    'report.fFile': { en: '**Compilation file**: {0}', zh: '**编译文件**: {0}' },
    'report.files': { en: '**Files**: {0}', zh: '**文件数量**: {0}' },
    'report.varDefs': { en: '**Variable defs**: {0}', zh: '**变量定义数**: {0}' },
    'report.varRefs': { en: '**Variable refs**: {0}', zh: '**变量引用数**: {0}' },
    'report.errors': { en: '**Errors**: {0}', zh: '**错误数**: {0}' },
    'report.warnings': { en: '**Warnings**: {0}', zh: '**警告数**: {0}' },
    'report.fileListHeading': { en: '## 📋 Compilation File List', zh: '## 📋 编译文件列表' },
    'report.varDefsSuffix': { en: '{0} variable defs', zh: '{0} 个变量定义' },
    'report.varTableHeading': { en: '## 📊 Global Variable Table', zh: '## 📊 全局变量表' },
    'report.noVariables': { en: '*(no variable definitions)*', zh: '*(无变量定义)*' },
    'report.varTableHeader': {
        en: '| Variable | Value | Defined at |',
        zh: '| 变量名 | 值 | 定义位置 |'
    },
    'report.emptyValue': { en: '*(empty)*', zh: '*(空)*' },
    'report.errorsHeading': { en: '## ❌ Errors ({0})', zh: '## ❌ 错误 ({0})' },
    'report.warningsHeading': { en: '## ⚠️ Warnings ({0})', zh: '## ⚠️ 警告 ({0})' },
    'report.noIssuesHeading': { en: '## ✅ No Issues', zh: '## ✅ 无问题' },
    'report.noIssuesBody': {
        en: 'All files compiled successfully. No syntax errors or undefined variables found.',
        zh: '所有文件编译通过，未发现语法错误或未定义变量。'
    },
    'report.noResult': {
        en: 'No compilation result. Run Lint analysis first.',
        zh: '没有编译结果。请先运行 Lint 分析。'
    },

    // ── Script context builder (shown to the user in the doc concatenation view) ──
    'ctx.title': {
        en: '# 📄 TCL Script Context (for AI Analysis)\n\n',
        zh: '# 📄 TCL 脚本上下文（供 AI 分析）\n\n'
    },
    'ctx.source': { en: '**Source:** {0}\n\n', zh: '**来源:** {0}\n\n' },
    'ctx.fullScript': { en: '## 1. Full Script\n\n', zh: '## 1. 脚本全文\n\n' },
    'ctx.overview': { en: '## 2. Overview\n\n', zh: '## 2. 概览统计\n\n' },
    'ctx.totalLines': {
        en: '- Total: {0} lines ({1} code + {2} comments + {3} blank)\n',
        zh: '- 总行数: {0} (代码 {1} + 注释 {2} + 空行 {3})\n'
    },
    'ctx.commandCount': {
        en: '- Innovus Commands: {0} types ({1} calls)\n',
        zh: '- Innovus 命令: {0} 种 (共 {1} 次调用)\n'
    },
    'ctx.modeCount': {
        en: '- Mode/Variable Settings: {0}\n',
        zh: '- 模式/变量设置: {0} 个\n'
    },
    'ctx.unknownCount': {
        en: '- ⚠️ Unrecognized: {0} tokens ({1} occurrences)\n',
        zh: '- ⚠️ 未识别标识符: {0} 个 ({1} 次)\n'
    },
    'ctx.docsHeading': {
        en: '## 3. Innovus Command Docs & Parameter Usage\n\n',
        zh: '## 3. Innovus 命令完整文档 & 参数使用对照\n\n'
    },
    'ctx.docsNote': {
        en: '> ⚠️ **AI Note:** Each command below provides [Full Reference Doc] and [Per-line Parameter Comparison].\n> Analyze strictly based on docs: correct usage? complete params? missing required? type matches?\n\n',
        zh: '> ⚠️ **AI 注意:** 以下每个命令均提供【完整参考文档】和【脚本中每行的参数对照表】。\n> 请严格基于文档内容分析：用法是否正确？参数是否完整？是否缺失必需参数？参数类型是否匹配？\n\n'
    },
    'ctx.calledTimes': { en: 'called {0} time(s)', zh: '调用 {0} 次' },
    'ctx.refDoc': { en: '#### 📖 Full Reference Doc\n\n', zh: '#### 📖 完整参考文档\n\n' },
    'ctx.function': { en: '**Function:** {0}\n\n', zh: '**功能:** {0}\n\n' },
    'ctx.syntax': { en: '**Syntax:** `{0}`\n\n', zh: '**语法:** `{0}`\n\n' },
    'ctx.allOptions': { en: '**All Options:**\n\n', zh: '**所有参数:**\n\n' },
    'ctx.optionTableHeader': {
        en: '| Option | Type | Required | Description |\n|--------|------|----------|-------------|\n',
        zh: '| 参数 | 类型 | 必需 | 说明 |\n|------|------|------|------|\n'
    },
    'ctx.reqShort': { en: '✅Req', zh: '✅必需' },
    'ctx.optShort': { en: 'Opt', zh: '可选' },
    'ctx.actualUsage': {
        en: '#### 📝 Actual Usage & Parameter Comparison\n\n',
        zh: '#### 📝 脚本中实际使用 & 参数对照\n\n'
    },
    'ctx.call': { en: '**Call #{0}** (line {1}):\n', zh: '**调用 #{0}** (第 {1} 行):\n' },
    'ctx.comparison': { en: '**Parameter Comparison:**\n\n', zh: '**参数使用对照:**\n\n' },
    'ctx.comparisonHeader': {
        en: '| Option | Status | Value in Script | Doc Type |\n|--------|--------|-----------------|----------|\n',
        zh: '| 参数 | 状态 | 脚本中的值 | 文档类型 |\n|------|------|-----------|------|\n'
    },
    'ctx.statusUsed': { en: '✅ Used', zh: '✅ 已使用' },
    'ctx.statusMissing': { en: '❌ **MISSING (Required!)**', zh: '❌ **缺失(必需!)**' },
    'ctx.statusUnused': { en: '— Not used (optional)', zh: '— 未使用(可选)' },
    'ctx.flagValue': { en: '(flag)', zh: '(开关)' },
    'ctx.typeLegend': {
        en: '*Types: flag=no value string=string int=integer float=float enum=preset point=coordinates*\n\n',
        zh: '*类型: flag=开关(无需值) string=字符串 int=整数 float=浮点数 enum=枚举(预设值) point=坐标*\n\n'
    },
    'ctx.modesHeading': {
        en: '## 4. Mode/Variable Settings\n\n',
        zh: '## 4. 模式/变量设置\n\n'
    },
    'ctx.usedTimes': { en: 'used {0} time(s)', zh: '使用 {0} 次' },
    'ctx.unknownHeading': {
        en: '## 5. Unrecognized Tokens\n\n',
        zh: '## 5. 未识别标识符\n\n'
    },
    'ctx.unknownNote': {
        en: 'Not in Innovus command DB (may be user-defined procs):\n\n',
        zh: '以下不在 Innovus 已知命令库中（可能是用户自定义 proc）:\n\n'
    },
    'ctx.times': { en: '{0} time(s)', zh: '{0} 次' },
    'ctx.aiTaskHeading': {
        en: '## 6. 🤖 AI Analysis Task\n\n',
        zh: '## 6. 🤖 AI 分析任务\n\n'
    },
    'ctx.customPrompt': {
        en: '**(Using custom prompt)**\n\n',
        zh: '**（使用自定义提示词）**\n\n'
    },
    'ctx.taskIntro': {
        en: '**Based on ALL the context above, complete the following analysis:**\n\n',
        zh: '**请基于以上全部上下文，完成以下分析:**\n\n'
    },
    'ctx.taskA': {
        en: '### A. Overall Purpose\nSummarize the design goal and workflow in 2-3 sentences.\n\n',
        zh: '### A. 脚本整体目的\n用 2-3 句话概括此 TCL 脚本的设计目标和工作流程。\n\n'
    },
    'ctx.taskB': {
        en: '### B. Per-Command Analysis\nFor each Innovus command:\n- What it does in this script\n- Are parameters correct (compare with docs above)\n- Missing required params (lines marked ❌ above)\n- Do param values match the documented types\n\n',
        zh: '### B. 命令逐条分析\n对每个 Innovus 命令说明:\n- 在此脚本中的具体作用\n- 参数使用是否正确（对照上面提供的文档）\n- 是否有缺失的必需参数（上面 ❌ 标注的行）\n- 参数值类型是否匹配文档定义\n\n'
    },
    'ctx.taskC': {
        en: '### C. Flow Assessment\n- Is execution order logical?\n- Any dependency issues?\n- Optimization opportunities?\n\n',
        zh: '### C. 流程评估\n- 命令执行顺序是否合理？\n- 是否存在依赖关系问题？\n- 是否有可优化的地方？\n\n'
    },
    'ctx.taskD': {
        en: '### D. Suggestions\n- For missing required params, give specific fix examples\n- If better commands/params exist, suggest alternatives\n- Flag potential errors or risks\n\n',
        zh: '### D. 改进建议\n- 对缺失必需参数的行，给出具体的补充示例\n- 如有更优的命令或参数组合，建议替代方案\n- 标注潜在错误或风险\n\n'
    },
    'ctx.taskConstraint': {
        en: '**⚠️ Critical:** Full reference docs and per-line parameter comparison are provided above. Base analysis STRICTLY on these docs. Do NOT guess or fabricate parameters. If a parameter is not in the docs, point it out.\n',
        zh: '**⚠️ 关键约束:** 以上已提供每个命令的完整参考文档和逐行参数对照。请严格依据这些文档分析，**不要猜测或编造**命令的参数。如果某参数在文档中不存在，请明确指出。\n'
    },
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof MESSAGES;

/**
 * Look up a localized message and substitute the `{0}`, `{1}`, ... placeholders.
 */
export function t(key: MessageKey, ...args: (string | number)[]): string {
    const entry: Message = MESSAGES[key];
    let text = entry[uiLanguage] ?? entry.en;
    for (let i = 0; i < args.length; i++) {
        text = text.split(`{${i}}`).join(String(args[i]));
    }
    return text;
}
