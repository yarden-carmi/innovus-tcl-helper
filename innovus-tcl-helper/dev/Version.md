0.2 ✅ Better auto-completion (option type hints + placeholders + enum choices), custom navigation (F12/Ctrl+Click → virtual help document), missing required-argument diagnostics (by parsing the argument line precisely)

0.3 ✅ Innovus version switching (multi-version data directory scanning + quick switch). Stronger TCL static checking (three levels: basic/standard/strict, with similar command suggestions, duplicate option detection and argument type validation). Copilot AI integration (3 LM tools: innovus_list_commands / innovus_get_command_help / innovus_parse_tcl_script). AI script analysis command (Ctrl+Shift+P → "AI Analyze Current TCL Script", producing a Markdown report).

0.4 ✅ Cross-file TCL compilation analysis: a `.f`-driven compilation engine (defaults to tcl.f, configurable) compiling every TCL script in order; cross-file variable tracking (a global symbol table); hovering `$varName`/a variable name shows its value and definition site; undefined/unused variable diagnostics; incremental compilation on save; automatic recompile when the `.f` file changes; lint report export (Markdown/JSON); the MCP server exposes a lint interface (the innovus_lint_tcl_script tool, with cross-file variable tracking and error detection); 3 new VS Code commands (run lint / show report / open the .f file); 2 new settings (enableCompilation / fFile)

0.4.2 ✅ Agent skills (5 skill files synced into the workspace automatically, the installSkills command). Stronger MCP anti-hallucination rules (a mandatory MCP lookup workflow, lint-before-deliver). Log output conventions (files first, a fixed directory layout). Cross-file F12 navigation to proc definitions (across any compilation unit). The MCP server lint tool split into `lint_tcl` (quick summary) + `lint_tcl_detailed` (full report), passing file paths to save tokens. LM tools reworked around the shared `compileFromPaths()` helper. 4 new AI prompt files (Chinese and English).

0.4.3 ✅ Recursive .f file parsing (the -F / -f directives, switching or keeping the base directory, nesting to any depth, cycle detection). A command to set the .f file path dynamically (interactive input, path validation, automatic recompile, workspace-level persistence, subdirectory paths such as temp/a.f).

0.5 ✅ TCL script execution engine (tclsh9.0 through child_process). Innovus command interception (auto-detection + injected proc documentation wrappers, printing the syntax/options instead of failing). Standard TCL runs normally (set/puts/proc/expr, ...). A dedicated `Innovus TCL: Run` output channel. Automatic tclsh discovery (Homebrew → system). TCL runtime errors captured and displayed. New VS Code command `innovus-tcl.runScript`.

0.5.1 ✅ Cross-platform tclsh support (the bin/<platform>/tclsh9.0 layout, detected at runtime from os.platform()+os.arch(), darwin-arm64 compiled). Run output saved to a file (the runSaveOutput + runOutputDir settings, a timestamped .log holding stdout/stderr/the Innovus command list, output directory created automatically). The .f project run command (runProject, pre-scanned shared wrappers, executed file by file in compilation order). Run buttons in the editor title bar (▶️ current file + 📦 .f project).

0.5.2 ✅ Icon-only editor buttons (editor/title + navigation, $(play)/$(run-all) as distinct icons + hover tooltip). tsconfig fix (types: [node]).

0.6

TCL run simulator: runs TCL commands and wraps the Innovus commands so they print text. Driven by the simulation database configuration, it prints the text result matching the arguments.

0.6.4 ✅ Better cross-platform tclsh experience: platform-aware installation guidance (macOS brew / Linux apt/dnf / Windows ActiveTcl), a one-time prompt on activation, richer run-command errors. The all-platform tclsh binaries are no longer bundled — only macOS arm64 ships with the extension.

0.6.5 ✅ The extension interface, source comments and developer documentation translated to English. `innovus-tcl.language` now only selects the documentation database (cn/en); the UI is always English.

TCL scripts are concatenated and analyzed by the AI to produce a more context-aware description of the script.
