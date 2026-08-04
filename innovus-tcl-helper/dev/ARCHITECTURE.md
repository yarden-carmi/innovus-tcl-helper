# Architecture

## Overall shape

```
┌───────────────────────────────────────────────── ────────┐
│                    VS Code Extension Host                │
│                                                          │
│  ┌────────────── ┐  ┌──────────────┐  ┌────── ─────────┐ │
│  │ HoverProvider │  │  Completion  │  │  Diagnostics   │ │
│  │   (hover.ts)  │  │ (completion  │  │ (diagnostics   │ │
│  │               │  │    .ts)      │  │    .ts)        │ │
│  └──────┬────────┘  └──────┬───────┘  └─────── ┬───────┘ │
│         │                  │                   │         │
│         └──────────────────┼───────────────────┘         │
│                            │                             │
│                    ┌───────▼───────┐                     │
│                    │   CommandDB   │                     │
│                    │  (commands.ts)│                     │
│                    └───────┬───────┘                     │
│                            │                             │
│                    ┌───────▼───────┐                     │
│                    │  JSON Files   │                     │
│                    │  (data_base/) │                     │
│                    └───────────────┘                     │
└───────────────────────────────────────────────────────── ┘
```

## Modules

### 1. `extension.ts` — extension entry point

**Responsibility**: the activate/deactivate lifecycle, plus registering every provider and command.

```typescript
activate(context) → read the configuration → initialize the DB → register the providers → register the commands
deactivate()      → dispose the diagnostics
```

**Activation event**: `onLanguage:tcl` — the extension only activates once a `.tcl` file is
opened, so it costs nothing in non-TCL projects.

**Configuration**: read from `vscode.workspace.getConfiguration('innovus-tcl')` on every activation:

- Each provider can be toggled independently
- The database path can be customized

### 2. `commands.ts` — the command database

**Design**: a lazily loaded singleton.

```
CommandDB (singleton)
├── Map<string, CmdInfo>  // command name → command information
├── load()                // walks data_base/help/deepseek-chat/*.json
├── get(name)             // O(1) exact lookup
├── search(prefix)        // fuzzy prefix search
├── isCommand(name)       // existence check
└── reload()              // clear and load again
```

**Data structures**:

```typescript
interface CmdInfo {
    command: string;       // e.g. "addInst"
    is_cmd: boolean;       // always true for commands
    summary: string;       // short summary
    description: string;   // full description
    usage: string;         // command syntax
    options: CmdOption[];  // option list
}

interface CmdOption {
    name: string;          // e.g. "-cell"
    description: string;   // option description
    required: boolean;
    type: string;          // "string"|"flag"|"enum"|"point"|"int"|"float"
}
```

**Performance notes**:

- **Lazy loading**: the files are only read on the first `get()` / `getCommandNames()` call
- **Single pass**: one `fs.readdirSync` plus one `fs.readFileSync` per file, no recursion
- **Memory**: 2175 commands × ~1KB each ≈ 2.5MB (the Map)
- **Lookup speed**: `Map.get()` is an O(1) hash lookup

### 3. `hover.ts` — hover tooltips

**Trigger**: hovering any word in a TCL file.

**Flow**:

```
take the word under the cursor → query the CommandDB → hit?  → build the Markdown → return a Hover
                                                     → miss? → return null (other providers stay unaffected)
```

**Markdown structure**:

1. The command name (a level-2 heading)
2. The summary (bold)
3. The syntax code block (with tcl highlighting)
4. The full description
5. The option table (option / required / type / description)

### 4. `completion.ts` — auto-completion

**Trigger**: typing a space, a dash `-` or an underscore `_`.

**Two cases**:

| Case | Condition | Behaviour |
| ---- | --------- | --------- |
| Command name completion | Start of a line, a single word that does not start with `-` | Lists all 2175 commands |
| Option completion | A command name plus a space is already on the line, cursor in the option area | Lists the options of that command |

**Option completion details**:

- `flag` options that are already used are no longer suggested (no duplicates)
- Required options sort before optional ones (`sortText: "0"` vs `"1"`)
- Enum options list their choices in the documentation

**Trigger characters**: `[' ', '-', '_']`, covering the TCL command separator and the option prefix.

### 5. `diagnostics.ts` — static checking

**Trigger**: on save (`onDidSaveTextDocument`) and on editor change.

**Checks**:

| Check | Level | Implementation |
| ----- | ----- | -------------- |
| Extra `]` | Error | Counted per line, reported when `depth < 0` |
| Extra `}` | Error | As above |
| Missing `]` | Error | `depth > 0` at the end of the document |
| Missing `}` | Error | As above |
| Unclosed `"` | Error | A per-line state machine that honours `\"` escapes |
| Missing required argument | Warning | Compared against the `required` options in the JSON |

**TCL-specific handling**:

- Comment-only `#` lines are skipped
- Everything after an unescaped inline `#` is skipped
- TCL built-ins (`set`, `if`, `for`, `puts` and 40+ more) are skipped
- Unknown commands are not reported (TCL allows user-defined `proc`s)

## Design decisions

| Decision | Rationale |
| -------- | --------- |
| TypeScript | The native VS Code API, type safety, errors caught at compile time |
| Zero runtime dependencies | Smaller extension, no dependency conflicts |
| Synchronous file I/O | The data loads once on activation, where synchronous reads are simple and reliable |
| Map data structure | O(1) lookup, native to ES6 |
| DiagnosticCollection | The standard VS Code diagnostics API, tied to the document lifecycle automatically |
