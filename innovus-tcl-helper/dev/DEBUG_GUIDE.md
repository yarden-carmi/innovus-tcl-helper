# Debugging guide and debug data

## Preparing the debug environment

### 1. Check that the project is complete


```bash
cd innovus-tcl-helper
ls -la

# The following must exist:
#   package.json
#   tsconfig.json
#   src/extension.ts
#   src/commands.ts
#   src/hover.ts
#   src/completion.ts
#   src/diagnostics.ts
#   out/  (after compiling)
#   ../data_base/help/deepseek-chat/  (the data directory)
```

### 2. Check that it compiles

```bash
npm run compile
# No output means success
```

### 3. Check that the data loads

```bash
node -e "
const path = require('path');
const fs = require('fs');
const dir = path.join(__dirname, '..', 'data_base', 'help', 'deepseek-chat');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
console.log('Data files:', files.length);
const first = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
console.log('Example command:', first.command);
console.log('Summary:', first.summary);
"
```

Expected output:

```
Data files: 2175
Example command: Puts
Summary: Prints the help information of a variable or command
```

## Debug configuration

### VS Code launch.json

Create `.vscode/launch.json` (neither the directory nor the file is published):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "npm: compile"
    },
    {
      "name": "Extension Tests",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--extensionTestsPath=${workspaceFolder}/out/test/suite/index"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "npm: compile"
    }
  ]
}
```

### VS Code tasks.json

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "compile",
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "label": "npm: compile",
      "problemMatcher": "$tsc"
    },
    {
      "type": "npm",
      "script": "watch",
      "group": "build",
      "label": "npm: watch",
      "problemMatcher": "$tsc",
      "isBackground": true
    }
  ]
}
```

## Debugging steps

### Step 1: set breakpoints

Useful places to break:

| File | Location | Why |
| ---- | -------- | --- |
| `extension.ts` | the `activate()` function | The activation entry point |
| `commands.ts` | the `load()` method | Command data loading |
| `hover.ts` | `provideHover()` | Hover trigger |
| `completion.ts` | `provideCompletionItems()` | Completion trigger |
| `diagnostics.ts` | `updateDiagnostics()` | Diagnostics trigger |

### Step 2: start debugging

Press `F5` → pick "Run Extension"

### Step 3: exercise the features

In the Extension Development Host window:

1. Open `test/example.tcl` (or create a new .tcl file)
2. Type `addInst` → **check completion**: the command list should appear
3. Type `addInst -` → **check option completion**: `-cell`, `-inst` and friends should appear
4. Hover over `addInst` → **check the hover**: the documentation should appear
5. Type `set x [expr {1 + 2]]` → **check the diagnostics**: saving should report the extra `]`
6. Type `addInst` with no required arguments → **check the warning**: it should flag the
   missing `-cell` and `-inst`

### Step 4: read the logs

In the Extension Development Host:

- `Help → Toggle Developer Tools` → the Console tab
- Look for the `[Innovus TCL]` prefix

## Debug data

### test/example.tcl — feature verification

```tcl
# === Command completion ===
# Typing "add" should offer addInst, addNet and so on

# === Hover tooltips ===
# Hover over the commands below to verify:
addInst -cell AND2X1 -inst my_and1 -loc {100 200} -ori R0 -place_status placed
addNet -net my_net -pins {my_and1/A my_or1/Y}

# === Option completion ===
# Type " -" at the end of the line below to verify the option hints:
checkDesign -all

# === Diagnostics ===
# The lines below should produce an error or a warning on save:

# Bracket error:
set x [expr {1 + 2]]

# Quote error:
puts "hello world

# Missing required arguments (addInst needs -cell and -inst):
# addInst

# === Valid usage (must not be flagged) ===
report_timing -delay_type max -nworst 10
setPlaceMode -congEffort high
routeDesign -globalDetail
verify_drc
saveDesign my_design.enc
```

### Verification checklist

| Test | Expected | Pass |
| ---- | -------- | ---- |
| Open a .tcl file | The extension activates | ☐ |
| Type a command prefix | The completion list appears | ☐ |
| Accept a completion | The command name is inserted | ☐ |
| Type - after a command | The option completion appears | ☐ |
| A used flag is not re-offered | It is hidden on the second attempt | ☐ |
| Hover a command name | The Markdown documentation appears | ☐ |
| Save a file with a syntax error | A red squiggle appears | ☐ |
| Save a file with an argument warning | A yellow squiggle appears | ☐ |
| Run the reload command | It reports "reloaded" | ☐ |
| Run the info command | The modal panel appears | ☐ |
| Close the .tcl file | The extension does not error | ☐ |

## Common problems

### Q: the completion list is empty

- Check that the data directory `../data_base/help/deepseek-chat/` exists
- Look for load errors in the Developer Tools console

### Q: no hover appears

- Confirm that `innovus-tcl.enableHover` is `true`
- Confirm that the word exactly matches the `command` field in the JSON (it is case sensitive)

### Q: the diagnostics never fire

- Diagnostics only run **on save** (`onDidSaveTextDocument`)
- They also run when the active editor changes
- Confirm that `innovus-tcl.enableDiagnostics` is `true`

### Q: source changes have no effect

- Recompile: `npm run compile`
- Restart the debug session: `Ctrl+Shift+F5` (Restart Debugging)
- Or use watch mode: `npm run watch`
