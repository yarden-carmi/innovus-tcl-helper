# Build, test and release guide

## Project layout

```
vscode-plugins/                    ← Git repository root ✅
├── .gitignore                     # ignores node_modules, out/, data/, *.vsix
├── data_base/                     # ✅ open data, tracked in Git
│   ├── all_cmds.json
│   ├── cn/help/  (2175 JSON)      # Chinese command documentation
│   ├── cn/man/   (2178 JSON)
│   ├── en/help/  (2192 JSON)      # English command documentation
│   ├── en/man/   (2192 JSON)
│   ├── en/ori_logs/help_logs/     # the raw English .log files (source data)
│   └── sort_cmds_jsons/
│
└── innovus-tcl-helper/            ← the VS Code extension
    ├── package.json
    ├── tsconfig.json
    ├── .vscodeignore              # VSIX packaging exclusions
    ├── .vscode/
    │   ├── launch.json            # F5 debug configuration ✅
    │   └── tasks.json             # build tasks ✅
    ├── src/                       # TypeScript sources
    ├── scripts/
    │   ├── prepublish.mjs         # copies data_base → data/ before packaging
    │   └── generate_en_help.mjs   # English .log → JSON generator
    ├── docs/                      # user documentation (shipped in the VSIX)
    └── dev/                       # developer documentation (not shipped)
```

## 1. Developing and debugging in place

### 1.1 Open the project

Open either **`vscode-plugins/`** (the repository root) or **`innovus-tcl-helper/`** in VS Code.

> Opening `vscode-plugins/` is recommended: you see both data_base and the extension source.

### 1.2 Install the dependencies

```bash
cd innovus-tcl-helper
npm install
```

### 1.3 Compile

```bash
npm run compile      # one-off build
# or
npm run watch        # watch mode, rebuilds on every change
```

### 1.4 Start debugging (F5)

1. Open the `innovus-tcl-helper/` folder in VS Code
2. Press **`F5`** (compiles, then launches the Extension Development Host)
3. Open any `.tcl` file in the new window
4. Set breakpoints in the source and step through the features

> `.vscode/launch.json` and `.vscode/tasks.json` are already configured — nothing to set up.

### 1.5 Data paths

| Scenario | data_base location | What commands.ts finds |
|----------|--------------------|------------------------|
| Development | `vscode-plugins/data_base/` | `extensionPath/../data_base/` ✅ |
| Installed from a VSIX | the bundled `data/` | `extensionPath/data/` ✅ |
| Custom path | wherever you point it | the `innovus-tcl.dataRoot` setting |

## 2. Test checklist

Open a `.tcl` file in the Extension Development Host and verify each item:

| # | Test | Action | Expected |
|---|------|--------|----------|
| 1 | Command completion | Type `addI` | `addInst` and friends appear |
| 2 | Option completion | Type `addInst -` | `-cell`, `-inst` and the other options appear |
| 3 | Hover documentation | Hover `addInst` | The Markdown documentation appears |
| 4 | Chinese documentation | Set `innovus-tcl.language` = `zh` | The hover text switches to Chinese |
| 5 | Bracket error | Type `set x [expr {1]]` | On save, "Extra "]"" is flagged |
| 6 | Quote error | Type `puts "hello` | On save, "Unclosed double quote" is flagged |
| 7 | Missing argument | Type `addInst` alone | On save, "Missing required option" is warned |

## 3. Packaging a VSIX

### 3.1 Install the packaging tool

```bash
npm install -g @vscode/vsce
```

### 3.2 One-command package

```bash
cd innovus-tcl-helper
npm run package
```

That command:
1. Runs `scripts/prepublish.mjs` → copies the JSON from `../data_base/` into `data/`
2. Runs `tsc -p ./` → compiles the TypeScript
3. Runs `vsce package` → produces the `.vsix`

Output: `innovus-tcl-helper-0.1.0.vsix`

### 3.3 What the VSIX contains

```
innovus-tcl-helper-0.1.0.vsix
├── extension/
│   ├── package.json
│   ├── out/                     # the compiled JS
│   ├── data/                    # the bundled command data (cn/help/ + en/help/)
│   │   ├── cn/help/*.json       # Chinese
│   │   └── en/help/*.json       # English
│   └── docs/                    # README, CHANGELOG
```

> **Not included**: `src/`, `dev/`, `test/`, `scripts/`, `node_modules/` and the raw `.log` files

### 3.4 Install the VSIX

```bash
code --install-extension innovus-tcl-helper-0.1.0.vsix
```

Or inside VS Code: `Cmd+Shift+P` → `Extensions: Install from VSIX...`

## 4. Publishing to the VS Code Marketplace

### 4.1 Create a publisher account

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with a Microsoft account
3. Create a publisher (e.g. `echoro`)

### 4.2 Get a Personal Access Token

1. https://dev.azure.com → your organization → User Settings → Personal Access Tokens
2. Create a token with the **Marketplace (publish)** scope
3. Copy the token

### 4.3 Publish

```bash
cd innovus-tcl-helper

# Log in
vsce login echoro

# Publish (bumps the patch version automatically)
vsce publish patch

# Or pin the version
vsce publish 0.1.0
```

## 5. Git

### 5.1 Repository layout

```
vscode-plugins/          ← the Git repository
├── .gitignore           # excludes node_modules, out/, data/, *.vsix
├── data_base/           # ✅ tracked (the open data)
└── innovus-tcl-helper/  # ✅ tracked (the extension source)
```

### 5.2 Workflow

```bash
# Start a feature
git checkout -b feature/xxx
# ... edit ...
git add -A && git commit -m "feat: xxx"

# Before a release
npm run compile          # make sure it builds
git tag v0.1.0           # tag the version
git push origin main --tags
```

### 5.3 Does data_base need to be released separately?

**No.** `prepublish.mjs` copies the required JSON into the extension while the VSIX is
built, so end users only ever install the `.vsix`.

Keeping data_base in Git is still worthwhile:
- It is open to inspection, so the quality of the command data can be reviewed
- The English `.log` files are the source data and can be re-exported for a new Innovus release
- It makes community contributions (translation fixes, extra commands, ...) easy

## 6. Updating the data

When Innovus is upgraded:

```bash
# 1. Export the help output of the new release
#    (batch-run help <cmd> in Innovus and save into en/ori_logs/help_logs/)

# 2. Regenerate the English JSON
node scripts/generate_en_help.mjs

# 3. To refresh the Chinese translation, re-run DeepSeek (or another model) over it

# 4. Repackage
npm run package
```

## 7. NPM script reference

| Script | Purpose |
|--------|---------|
| `npm run compile` | Compile TypeScript → `out/` |
| `npm run watch` | Compile in watch mode |
| `npm run prepublish` | Copy the data_base JSON → `data/` |
| `npm run package` | prepublish + compile + vsce package |
| `npm run lint` | Run ESLint |
