# Data sources and processing

## Where the data comes from

The Innovus command documentation originates in the help system that ships with the
Cadence Innovus tool.

### Three layers

```
data_base/
├── innovus_cmd_db/
│   ├── all_cmds.json           # every command name (a deduplicated roll-up)
│   ├── help_cmds/help_logs/    # the raw output of help <cmd> (brief usage)
│   ├── man_cmds/man_logs/      # the raw output of man <cmd> (the full manual)
│   └── sort_cmds_jsons/        # command names grouped by first letter, as JSON
│
├── help/deepseek-chat/         # ★ what the extension actually loads ★
│   └── help_<cmd>.json         # the command documentation, structured by DeepSeek
│
└── man/deepseek-chat/          # the structured full manual (spare, unused today)
    └── env_PAGER=cat_man_<cmd>.json
```

### Raw data format

**Raw help output** (`help_addInst.log`):
```
Usage: addInst [-help] -cell <cellName> [-dontSnapToPlacementGrid]
               -inst <instName> [-loc {x y}] [-moduleBased <moduleName>]
               [-ori <orientation>] [-physical]
               [-place_status {fixed soft_fixed placed unplaced cover}]

-help                         # Prints out the command usage
-cell <cellName>              # Name of cell (string, required)
...
```

**Raw man output** (`env_PAGER=cat_man_addInst.log`):
```
Product Version     25.10    Cadence Design Systems, Inc.
addInst(25.10)

Name
       addInst - Adds an instance and places it in the design

Syntax
       addInst
       [-help]
       ...
```

### The DeepSeek pass

The raw help/man text is structured by the DeepSeek model into JSON:

```json
{
  "command": "addInst",
  "is_cmd": true,
  "summary": "Adds an instance to the design",
  "description": "Adds a new instance to the design. The instance name, its cell ...",
  "usage": "addInst [-help] -cell <cellName> ...",
  "options": [
    {
      "name": "-help",
      "description": "Prints out the command usage",
      "required": false,
      "type": "flag"
    },
    {
      "name": "-cell",
      "description": "Name of the cell",
      "required": true,
      "type": "string"
    }
    // ...
  ]
}
```

**What the pass does**:
- Translates the source text (for the `cn` data set)
- Extracts the command name and the usage syntax
- Structures the options (name, type, required, description)
- Produces a one-line summary

### Why help rather than man

| Dimension | help | man |
|-----------|------|-----|
| Content | Option list + brief description | The whole manual |
| JSON size | ~1-2KB | ~5-20KB |
| Hover display | Concise and readable at a glance | Too long for a popup |
| Load speed | Fast (small files) | Slow |
| Coverage | 2175 entries | Roughly 2000+ |

## Load flow

```
extension.ts: activate()
    │
    ▼
commands.ts: CommandDB.load()
    │
    ├─ check that dataDir exists
    ├─ fs.readdirSync() for every .json file name
    ├─ for each file:
    │   ├─ fs.readFileSync() to read it
    │   ├─ JSON.parse() to parse it
    │   └─ commands.set(cmdName, cmdInfo)
    │
    └─ set loaded = true
```

### Path resolution

```
Extension directory: .../innovus-tcl-helper/
Data directory:      .../data_base/help/deepseek-chat/

Relative path: path.join(extensionPath, '..', 'data_base', 'help', 'deepseek-chat')
                                        ↑
                                back up to vscode-plugins/
```

### Load performance

Measured on a MacBook Pro (M-series):

| Metric | Value |
|--------|-------|
| JSON files | 2,175 |
| Total data | ~4.5MB |
| First load | ~200ms (synchronous I/O) |
| Memory | ~15MB (including the V8 heap) |
| Command lookup | O(1) Map.get() |

## Updating the data

When an Innovus release changes the command set:

1. Re-export the `help <cmd>` output into `help_cmds/help_logs/`
2. Run your own DeepSeek structuring script
3. Write the new JSON into `help/deepseek-chat/`
4. Run `Innovus TCL: Reload Command Database` in VS Code
5. Or simply restart VS Code
