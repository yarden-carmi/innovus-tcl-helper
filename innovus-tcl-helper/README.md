# Innovus TCL Helper

A TCL scripting companion for the Cadence Innovus EDA tool. It gives `.tcl` files command
completion, hover documentation, cross-file compilation analysis and static syntax checking.

## Feature overview

| Feature | Trigger | Description |
|---------|---------|-------------|
| 🔍 **Hover documentation** | Hover over a command or variable name | Shows the command summary, syntax and option table; for variables, the value and where it is defined |
| ✏️ **Auto-completion** | While typing a command name or `-` | Suggests Innovus command names and their options |
| ⚠️ **Static checking** | On save | Bracket/quote matching and required-argument validation |
| 🔗 **Cross-file compilation** | Automatic (driven by the `.f` file) | Tracks variable definitions and references, and shows variable values across files |
| 📊 **Lint report** | `Cmd+Shift+P` → Show Lint Report | Exports the full compilation analysis as Markdown or JSON |

## Quick start — cross-file compilation analysis

1. Create a `tcl.f` file in the workspace root with one `.tcl` relative path per line:
```
# tcl.f — TCL script compilation list
0_cmd.tcl
1_init.tcl
2_floorplan.tcl
3_powerplan.tcl
```

2. Open any `.tcl` file — the extension compiles every script in order automatically
3. Hover over a `$varName` to see its value and where it is defined
4. `Cmd+Shift+P` → `Innovus TCL: 📊 Show Lint Report` for the full analysis

## Installation

### From a VSIX
```bash
code --install-extension publish/innovus-tcl-helper-0.1.0.vsix
```
Or inside VS Code: `Cmd+Shift+P` → `Extensions: Install from VSIX...`

### Development mode
```bash
git clone https://github.com/echo-edai/innovus-tcl-helper.git
cd innovus-tcl-helper
npm install
# Press F5 to launch the Extension Development Host
```

## Publishing

### Build a VSIX (local/offline distribution)
```bash
npm run package
# → publish/innovus-tcl-helper-x.x.x.vsix
```

### Publish to the VS Code Marketplace

**One-time setup:**
```bash
# 1. Get a Personal Access Token
#    https://dev.azure.com → User Settings → Personal Access Tokens
#    Scope: Marketplace > Acquire & Manage

# 2. Create the publisher (once)
npx vsce create-publisher fd-echoro

# 3. Log in
npx vsce login fd-echoro
# Paste the PAT from step 1
```

**Every release:**
```bash
# 1. Bump the version in package.json "version": "x.y.z"
# 2. Run
npm run publish
# Or inside VS Code: Terminal → Run Task → 🚀 publish
```

## Configuration

Open the VS Code settings (`Cmd+,`) and search for `innovus-tcl`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `innovus-tcl.language` | string | `"en"` | Language of the interface **and** the command documentation (`en`/`zh`/`auto`) |
| `innovus-tcl.enableHover` | boolean | `true` | Enable hover tooltips |
| `innovus-tcl.enableCompletion` | boolean | `true` | Enable auto-completion |
| `innovus-tcl.enableDiagnostics` | boolean | `true` | Enable single-file static checking |
| `innovus-tcl.enableCompilation` | boolean | `true` | Enable cross-file TCL compilation analysis |
| `innovus-tcl.fFile` | string | `"tcl.f"` | Path of the `.f` compilation list (relative to the workspace root) |
| `innovus-tcl.diagnosticLevel` | string | `"standard"` | Strictness: basic/standard/strict |

### Cross-file compilation analysis

Create a `tcl.f` file in the project root (or point `innovus-tcl.fFile` at a different name)
with one `.tcl` relative path per line, compiled from top to bottom:

```
# tcl.f — example
0_setenv.tcl
1_init.tcl
2_floorplan.tcl
3_powerplan.tcl
```

After compilation:
- Hovering a `$varName` shows its value and where it is defined
- Undefined variables are flagged as errors
- `Cmd+Shift+P` → `Innovus TCL: 📊 Show Lint Report` for the full analysis

### Language

One setting, `innovus-tcl.language`, controls everything:

- `en` (default) — English interface and English command documentation
- `zh` — Chinese interface and Chinese command documentation
- `auto` — follow the VS Code display language

It covers the interface (notifications, quick picks, hover tooltips, the help panel,
diagnostic messages, the lint report and the run output channel) and which command
documentation database is loaded — English is parsed from the native `help` output,
Chinese is the DeepSeek-structured translation.

Switch it from the command palette with `Innovus TCL: Switch Language (English/中文)`, or
from the settings UI. The change applies immediately — diagnostics and lint results are
re-rendered, no reload needed.

> Command palette titles and settings descriptions are localized by VS Code itself
> (through `package.nls.json` / `package.nls.zh-cn.json`), so they follow the **VS Code
> display language** rather than this setting. That is the only mechanism VS Code offers
> for the manifest. Everything the extension renders at runtime follows
> `innovus-tcl.language`.

## Usage examples

Type Innovus commands in a `.tcl` file:

```tcl
# Hover addInst to read its documentation
addInst -cell AND2X1 -inst my_and1 -loc {100 200} -ori R0

# Command names and options are completed as you type
checkDesign -all

# Options are suggested when you type -
report_timing -delay_type max -nworst 10

# Syntax errors are flagged (an extra bracket here)
setPlaceMode -congEffort high]]

# Missing required arguments produce a warning
routeDesign
```

## Commands

Open the command palette with `Cmd+Shift+P`:

- **Innovus TCL: Reload Command Database** — reload after the external JSON data changed
- **Innovus TCL: Show Extension Info** — version and load status
- **Innovus TCL: Switch Language (English/中文)** — switch the interface and documentation language
- **Innovus TCL: 🔍 Run Cross-file Lint** — compile the `.f` project and refresh the diagnostics
- **Innovus TCL: 📊 Show Lint Report** — export the analysis as Markdown or JSON

## Command coverage

The current version ships documentation for **2175** Innovus commands, covering:
- Design initialization (`init_design`, `init_lef_file`, ...)
- Floorplanning (`floorPlan`, `place_design`, ...)
- Clock trees (`ccopt_design`, `create_ccopt_clock_tree`, ...)
- Timing analysis (`report_timing`, `set_clock_latency`, ...)
- Power networks (`addStripe`, `sroute`, `addRing`, ...)
- Physical verification (`verify_drc`, `verifyConnectivity`, ...)
- ... and the rest of the Innovus command set

## Requirements

- VS Code ≥ 1.85.0
- No extra runtime dependencies (Node.js is bundled with VS Code)

## License

MIT
