# Changelog

## 0.6.5 (unreleased)

### Added — proper language switching, English by default
- **`innovus-tcl.language` is now a single switch for everything**: the interface
  (notifications, quick picks, input boxes, hover tooltips, the help panel in both Webview
  and plain-text mode, diagnostic messages, the lint report, the run output channel and the
  generated simulation output) *and* the command documentation database.
  - `en` — **new default** — English interface, English command documentation
  - `zh` — Chinese interface, Chinese command documentation
  - `auto` — follow the VS Code display language
  - The previous default was `auto`; English is now the default regardless of the VS Code
    display language.
- **`Innovus TCL: Switch Language (English/中文)`** replaces the old documentation-only
  toggle with a three-way picker that marks the current choice. The change applies
  immediately: diagnostics and lint results are re-rendered, no reload needed.
- **New `src/i18n.ts`**: a single message catalog holding the `en`/`zh` text for every
  runtime string, with `{0}`-style placeholders. The keys are a TypeScript literal union,
  so a typo in `t('...')` fails the build. This replaces the ad-hoc
  `isZh ? '中文' : 'English'` ternaries that used to be scattered across nine files —
  Chinese text now lives in exactly one file.
- **Manifest localization**: `package.json` strings moved to `package.nls.json` (English)
  and `package.nls.zh-cn.json` (Chinese). Command palette titles and setting descriptions
  follow the **VS Code display language** — that is the only mechanism VS Code offers for
  the manifest, so it cannot be driven by an extension setting.

### Fixed — `npm run package` now produces a usable VSIX
- **`scripts/prepublish.mjs` copies the command documentation** from `../data_base/{cn,en}/help/`
  into `data/cmds/innovus/25.1/{cn,en}/help/`, and the example scripts from
  `../example/innovus/` into `data/example/innovus/`, before building the single-file
  databases. `data/` is gitignored, so a fresh clone previously packaged an **empty**
  command database — 0 commands, with hovers and completion silently doing nothing.
  `BUILD_GUIDE.md` had always claimed this copy happened; now it does.
- The copy is incremental (mtime-based) and every source directory is optional: a
  standalone checkout without `../data_base/` warns and packages whatever is already in
  `data/`.

### Changed
- **Source**: all comments and internal documentation translated to English.
- **`runner.ts`**: the "skipped because an earlier file failed" message is now the exported
  `skippedMessage()` helper shared with `extension.ts`. The two files previously hard-coded
  different English strings, so the ⏭ status never rendered when the UI was English.
- **`commands.ts` / `mcp-server.mjs`**: the default documentation language fell back to
  `zh`; it is now `en`.
- **LM/MCP tool descriptions stay English**: they are read by the language model rather
  than the user. Only the script context that is shown to the user is localized.
- **Kept in Chinese on purpose**: the `data/` and `data_base/` Chinese command
  documentation, `prompts/cn/*`, and the Chinese literals inside
  `scripts/clean-fake-data.mjs`, `scripts/generate-simulations.mjs` and
  `scripts/translate-en-to-cn.mjs` — those are patterns and model prompts that must match
  or produce the Chinese data set.

## 0.6.4 (2026-07-10)

### Improved — cross-platform tclsh experience
- **Platform-aware installation guidance**: `getTclshInstallGuide()` returns a different
  install command per platform (macOS→brew, Linux→apt/dnf, Windows→ActiveTcl)
- **Detection on activation**: on non-macOS platforms the first activation shows a prompt
  to install tclsh with a shortcut to the `tclshPath` setting
- **Shown only once**: the prompt is recorded in `globalState` and never nags again
- **Better run errors**: the missing-tclsh errors of `runScript` / `runProject` now carry
  the platform-specific installation guidance
- **`package.json`**: the `tclshPath` description now states that macOS bundles an
  interpreter while Linux and Windows need manual configuration

## 0.6.3 (2026-07-10)

### Fixed — Chinese/English separation
- **`diagnostics.ts`**: every diagnostic message (bracket matching, quote matching, missing
  arguments, duplicate options, type validation, unknown-command suggestions) became
  bilingual instead of hard-coded Chinese, following the `innovus-tcl.language` setting
- **`lint.ts`**: fixed the bug where `isZh` was hard-coded to `true` in
  `generateTextReport()`; made the unused-variable/proc diagnostics and every lint report
  heading bilingual
- **`compiler.ts`**: compilation error messages switched to their English canonical form
  (`-F 指令缺少文件路径` → `-F directive missing file path`)
- **`runner.ts`**: the error messages of `runScript` / `runProject` became bilingual,
  following the `TclRunner.language` property
- **`completion.ts`**: the completion item detail, the type labels (string, integer, ...)
  and the required/optional markers became bilingual

## 0.6.0 (2026-07-08)

### Added — AI-driven Innovus command simulator
- **DeepSeek Flash data generation script**: `scripts/generate-simulations.mjs`
  - Walks all 2175 Innovus commands and asks the model for the simulated output
  - Concurrency control (3 concurrent) + rate-limit retries + incremental generation
  - Supports `--lang cn|en`, `--limit N`, `--dry-run`
- **Simulation data format**: `data/simulations/<lang>/<cmdName>.json`
- **Runner loads simulations automatically**: uses the simulation when data exists,
  otherwise falls back to printing the documentation

### Outstanding
- Run `node scripts/generate-simulations.mjs --lang cn` for the batch generation

## 0.5.2 (2026-07-08)

### Improved — editor buttons
- **Icon-only buttons**: `editor/title` + `navigation`, showing the Codicon without a label
- **Distinct icons**: `$(play)` runs the file, `$(run-all)` runs the project
- **Hover tooltip**: the command title is used as the tooltip automatically
- **tsconfig fix**: added `types: ["node"]` to resolve the fs/path type errors

## 0.5.1 (2026-07-08)

### Added — cross-platform tclsh support
- **Per-platform subdirectories**: `bin/<platform>/tclsh9.0`, detected from
  `os.platform() + os.arch()`
- **Supported today**: darwin-arm64 (compiled for macOS Apple Silicon)
- **Still to build**: darwin-x64 / linux-x64 / linux-arm64 / win32-x64
- **Lookup order**: bundled (platform subdirectory) > user configuration
  (`innovus-tcl.tclshPath`) > system search
- **Per-platform candidates**: macOS (Homebrew), Linux (/usr/bin), Windows (PATH)

### Added — saving the run output to a file
- **Setting `innovus-tcl.runSaveOutput`**: whether to save the run output to a file
  (default `false`)
- **Setting `innovus-tcl.runOutputDir`**: the output directory (defaults to the workspace
  `.innovus-run/`)
- **Log format**: timestamped file name, containing stdout, stderr and the Innovus command list
- **Directories created automatically**: the output directory is created recursively when missing
- **Output channel hint**: the run prints `📄 Output: /path/to/file.log`

### Added — .f project runs + editor buttons
- **New command `innovus-tcl.runProject`**: runs the whole project in `.f` file order
- **Shared wrappers**: pre-scans the Innovus commands of every file and generates one
  shared set of proc wrappers
- **File-by-file run**: executed in compilation order, each file using its own directory
  as the working directory
- **Buttons in the editor title bar**: the `editor/title/run` contribution point, shown
  only for TCL files
  - ▶️ Run the current file
  - 📦 Run the .f project
- **Summary report**: file count, error count, total duration and the per-file status

### Improved
- `runner.ts`: fully rewritten, `findTclsh` now takes `extensionPath` + `configTclshPath`
- `runner.ts`: added the `RunOutputConfig` interface and the `saveOutputFile` method
- `runner.ts`: dropped the direct dependency on the `vscode` module so it can be tested standalone
- `extension.ts`: added the `runProject` command and reads the output file configuration
- `package.json`: added 5 commands/settings and `menus.editor/title/run`

## 0.5.0 (2026-07-08)

### Added — TCL script execution engine
- **tclsh9.0-based engine**: runs TCL code through the system tclsh via child_process
- **Innovus command interception**: detects the Innovus-only commands in the script and
  injects documentation wrappers
- **Documentation instead of execution**: Innovus commands (`addRing`, `routeDesign`, ...)
  no longer fail — they print their documentation (syntax, option descriptions)
- **Standard TCL runs normally**: `set`, `puts`, `if`, `proc`, `expr` and friends execute
- **Output channel**: a dedicated `Innovus TCL: Run` panel showing the results live
- **tclsh discovery**: searches Homebrew tclsh9.0 → system tclsh, in that order
- **Error capture**: TCL runtime errors (undefined variables, syntax errors, ...) are
  captured and displayed correctly

### Added — VS Code commands
- **`Innovus TCL: ▶️ Run Current TCL Script`** (`innovus-tcl.runScript`)
  - Runs the complete TCL script from the active editor
  - The working directory is set to the script's own directory
  - Relative paths in `source` commands resolve correctly

### Internal
- `src/runner.ts`: new `TclRunner` class covering tclsh discovery, Innovus command
  detection, proc wrapper generation and process management
- `src/extension.ts`: added the output channel and registered the `runScript` command
- `package.json`: added the `innovus-tcl.runScript` command and bumped the version to 0.5.0

## 0.4.3 (2026-07-08)

### Added — recursive .f file parsing (the -F / -f directives)
- **-F xxx.f**: parse `xxx.f` recursively and **switch the base directory** to the
  directory of `xxx.f`
  - e.g. `-F dir1/b.f` → the `b.v` inside `b.f` resolves to `proj/dir1/b.v`
- **-f xxx.f**: parse `xxx.f` recursively but **keep the caller's directory** as the base
  - e.g. `-f dir2/c.f` → the `c.v` inside `c.f` resolves to `proj/c.v` (no switch to `dir2/`)
- **Arbitrary nesting**: `-F`/`-f` directives may nest to any depth
- **Cycle detection**: an already visited `.f` file is never parsed twice

### Added — command to set the .f file path
- **New command**: `Innovus TCL: 📝 Set .f Compilation File Path`
- **Interactive input**: the input box shows the current value and validates the path
  (non-empty, ends with .f)
- **Automatic recompile**: the lint analysis re-runs after the setting changes
- **Workspace-level persistence**: written to `.vscode/settings.json`
- **Subdirectory paths supported**: `temp/a.f`, `subdir/proj.f` and any other relative path

### Internal
- `compiler.ts`: `parseFFile` refactored into the `parseFFileRecursive` engine
- `extension.ts`: registered the `setFFile` command
- `package.json`: declared the `innovus-tcl.setFFile` command

## 0.4.2 (2026-07-08)

### Added — agent skills
- **Automatic skill installation**: activation syncs
  `.agents/skills/innovus-tcl-helper/` into the workspace
- **5 skill files**:
  - `SKILL.md` — entry point and core rules (anti-hallucination/MCP/log/lint)
  - `flow-guide.md` — the 9-stage Innovus design flow reference (real project patterns)
  - `tcl-basics.md` — TCL coding conventions and **log file output conventions**
  - `mcp-tools.md` — guide to the 5 MCP tools and the **mandatory anti-hallucination workflow**
  - `analysis-guide.md` — script analysis methodology
- **New command**: `Innovus TCL: 🤖 Install Agent Skill` (install/update the skill files manually)

### Added — cross-file proc definition navigation
- **F12 jumps to a proc definition**: press F12 on a proc call to jump to its definition
  in any file

### Added — stronger MCP anti-hallucination rules
- **Mandatory MCP lookup**: confirm the syntax and options with
  `innovus_get_command_help` before writing any Innovus command
- **Lint-before-deliver**: call `innovus_lint_tcl` as soon as a script is written

### Added — log output conventions
- **Files first**: every run result, report and error must go to a file, never only to
  `puts` on the terminal
- **Directory layout**: `$REPORT_DIR/stage_name/xxx.rpt`, created automatically when missing

### Improved — MCP server (v0.4.1 → v0.4.2)
- **Lint tools split**: `innovus_lint_tcl` (quick summary) + `innovus_lint_tcl_detailed`
  (full report)
- **Paths instead of contents save tokens**: accepts `f_file_path` or `tcl_files[]`
  (absolute file paths rather than file contents)
- **Dynamic compiler import**: loads `out/compiler.js` through `import()` and falls back
  to the built-in linter

### Improved — LM tools
- **Lint tools refactored**: the shared `compileFromPaths()` helper accepts a `.f` file
  path or an array of `.tcl` files
- **Temporary-directory compilation**: when only `.tcl` files are given, a `.f` file is
  generated in a temporary directory

### Added — AI prompts
- `prompts/cn/innovus-flow-guide.md` — Innovus flow guide (Chinese)
- `prompts/cn/innovus-tcl-analysis.md` — TCL script analysis guide (Chinese)
- `prompts/cn/innovus-tcl-dev.md` — TCL development guide (Chinese)
- `prompts/en/innovus-tcl-dev.md` — TCL development guide (English)

### Internal
- `definition.ts`: reworked the set-variable navigation and added proc definition navigation
- `extension.ts`: added `installAgentSkills()` and the `installSkills` command
- `tools.ts`: reworked the lint tools around the shared `compileFromPaths()` helper
- `scripts/mcp-server.mjs`: rewrote the lint tool I/O and bumped the version to v0.4.2
- Deleted the redundant `scripts/generate_en_help 2.mjs`

## 0.4.0 (2026-07-07)

### Added — cross-file TCL compilation analysis
- **`.f`-driven compilation engine**: `tcl.f` (configurable) lists every TCL script and
  its compilation order
- **Cross-file variable tracking**: compiles every script in `.f` order and builds a
  global symbol table
- **Variable values on hover**: hovering a `$varName` or a variable name shows its value
  and where it is defined
- **Cross-file variable diagnostics**: undefined variable references, variables used
  before they are defined, and similar
- **Incremental compilation**: saving a file updates it incrementally without disturbing
  the other files
- **Automatic recompile on `.f` change**: saving the `.f` file triggers a full recompile
- **Lint report export**: the lint report is available as Markdown or JSON
- **New commands**:
  - `Innovus TCL: 🔍 Run Cross-file Lint` — trigger the analysis manually
  - `Innovus TCL: 📊 Show Lint Report` — view/export the lint report
  - `Innovus TCL: 📄 Open .f Compilation File` — open/create the `.f` file
- **New settings**:
  - `innovus-tcl.enableCompilation` — enable the cross-file analysis (on by default)
  - `innovus-tcl.fFile` — the `.f` file path (defaults to `tcl.f`)

### Improved
- The hover provider now shows the value and definition site of TCL variables
- The diagnostics panel covers both single-file syntax checks and cross-file compilation errors
- The extension info panel reports whether the compilation analysis is enabled

## 0.3.0 (2026-07-07)

### Added — multi-version support
- **Version directories scanned automatically**: every new tool/version directory under
  `data/innovus/` is picked up on its own
- **Quick version switching**: the `Innovus TCL: Switch Innovus Version` command, with no
  VS Code restart
- Ships `25.1` (the Innovus production data) and `test` (empty data for testing)

### Added — richer static checking (three levels)
- **`basic`** — bracket matching + quote matching
- **`standard`** (default) — basic + required-argument checks (distinguishing required
  from optional options)
- **`strict`** — standard + similar command suggestions (Levenshtein distance) + argument
  type validation + duplicate option detection
- New setting `innovus-tcl.diagnosticLevel` (`basic` / `standard` / `strict`)

### Added — Copilot AI integration
- **MCP server** (`scripts/mcp-server.mjs`): exposes 3 LM tools to Copilot
  - `innovus_list_commands` — list every Innovus command
  - `innovus_get_command_help` — get the full help documentation of one command
  - `innovus_parse_tcl_script` — parse every Innovus command and its arguments in a TCL script
- **AI script analysis**: the `Innovus TCL: AI Analyze Current TCL Script` command calls
  the MCP tools for the command documentation and produces a Markdown flow analysis
- **One-click MCP install**: the `Innovus TCL: 🤖 Install Copilot MCP Tools` command
- **Customizable AI prompt**: the `Innovus TCL: ✏️ Edit AI Analysis Prompt` command
- New setting `innovus-tcl.enableAITools` (on by default)

### Improved
- Lowered the VS Code engine requirement to `^1.67.0` for wider compatibility
- Data path rework: dropped the `dataRoot` setting in favour of workspace-relative paths
- Prompts moved into files: the AI analysis prompts live under `prompts/` and can be
  configured per language

### Fixed
- The `zh` language → `cn` directory name path mapping bug
- Release pipeline: a leak-proof `.gitignore` and VSIX output into `publish/`
- The `rm -rf` compatibility problem of the `prepublish` script on Node v25 / macOS

## 0.2.1 (2026-07-07)

### Added
- Two help display modes: a rich Webview panel and a plain-text man page
- Ctrl+Shift+P toggles the help style (`innovus-tcl.toggleHelpStyle`)
- Tutorial-style Webview: parameter analysis card, related commands, usage tips
- Semantic token syntax highlighting (commands/options/variables)
- Automatic language detection (`auto` / `zh` / `en`)
- DocumentLinkProvider: Ctrl+Click goes straight to the Webview
- Precise required-argument diagnostics (by parsing the command line)

### Fixed
- The `\_` underscore escaping problem in code blocks
- Removed the redundant TCL language declaration (it shadowed the built-in highlighting)
- The `rm -rf` compatibility of the packaging script on Node v25 / macOS

## 0.1.0 (2026-07-07)

### Added
- Hover tooltips: hovering an Innovus command name shows its documentation
- Auto-completion: command names and options (marking required vs optional)
- Static checking: bracket matching, quote matching, missing required argument warnings
- F12/Ctrl+Click navigation to the virtual help document
- Bundled documentation for 2175 Innovus commands
