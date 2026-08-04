#!/usr/bin/env node
/**
 * Batch converter: English help .log → structured JSON
 *
 * Usage:
 *   node scripts/generate_en_help.mjs
 *
 * Input:  data_base/en/ori_logs/help_logs/help_<cmd>.log
 * Output: data_base/en/help/help_<cmd>.json
 *
 * The output format matches data_base/cn/help/ and loads directly into the extension.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path configuration
// scripts/ → innovus-tcl-helper/ → vscode-plugins/ → data_base/
const ROOT = path.join(__dirname, '..', '..');
const LOG_DIR = path.join(ROOT, 'data_base', 'en', 'ori_logs', 'help_logs');
const OUT_DIR = path.join(ROOT, 'data_base', 'en', 'help');

// ===================== Parser (mirrors src/parser.ts) =====================

/**
 * Parse the raw English help .log text into structured JSON
 */
function parseHelpLog(cmdName, content) {
    const lines = content.split('\n');

    // Skip the license/version header lines
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.startsWith('Usage:') || t.startsWith('Description:') || t.startsWith('-') || t.startsWith('#') || t.startsWith('<')) {
            startIdx = i;
            break;
        }
    }

    // Detect a mode variable (not a command) — it starts with # instead of Usage
    const trimmedContent = content.trim();
    const isCmd = lines.some(l => l.trim().startsWith('Usage:'));

    if (!isCmd) {
        // A mode variable / setting rather than a real command.
        // Use the comments as its description.
        let description = '';
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('#')) {
                description += t.replace(/^#\s*/, '') + ' ';
            }
        }
        description = description.trim();
        return {
            command: cmdName,
            is_cmd: false,
            summary: description || `Mode setting: ${cmdName}`,
            description: description || `Mode setting variable for ${cmdName}.`,
            usage: null,
            options: null
        };
    }

    // Extract the Usage line (it may span several lines)
    let usage = '';
    let optionLines = [];
    let inUsage = true;
    let foundUsage = false;

    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (inUsage) {
            // The Usage line, or a continuation starting with a deep indent
            if (trimmed.startsWith('Usage:') || (foundUsage && line.match(/^\s{10,}[-\[]/))) {
                usage += (usage ? ' ' : '') + trimmed;
                foundUsage = true;
            } else if (trimmed.startsWith('Description:')) {
                // Skip the Description line
                continue;
            } else if (trimmed.startsWith('-') || trimmed.startsWith('<')) {
                // The first option line
                inUsage = false;
                optionLines.push(line);
            } else if (trimmed === '' && foundUsage) {
                inUsage = false;
            }
        } else {
            if (trimmed) {
                optionLines.push(line);
            }
        }
    }

    usage = usage.replace(/^Usage:\s*/, '').trim();

    const options = parseOptions(optionLines);

    // When no options were parsed but a usage exists (e.g. a command with only -help),
    // add at least the -help option
    if (options.length === 0 && usage) {
        options.push({
            name: '-help',
            description: 'Prints out the command usage',
            required: false,
            type: 'flag'
        });
    }

    const summary = generateSummary(cmdName);
    const description = summary;

    return {
        command: cmdName,
        is_cmd: true,
        summary: summary,
        description: description,
        usage: usage || `${cmdName} [-help]`,
        options: options.length > 0 ? options : null
    };
}

function parseOptions(lines) {
    const options = [];
    let currentOption = null;

    for (const line of lines) {
        const trimmed = line.trim();
        // Match -flagName or <positionalArg>
        const optionMatch = trimmed.match(/^(\s*)(-\w+|<\w+>)\b/);
        if (optionMatch) {
            if (currentOption) {
                options.push(buildOption(currentOption.name, currentOption.lines));
            }
            currentOption = {
                name: optionMatch[2],
                lines: [line]
            };
        } else if (currentOption && trimmed) {
            currentOption.lines.push(line);
        }
    }

    if (currentOption) {
        options.push(buildOption(currentOption.name, currentOption.lines));
    }

    return options;
}

function buildOption(name, lines) {
    const cleanedLines = lines.map((line, idx) => {
        if (idx === 0) { return line; }
        return line.replace(/^\s*#\s*/, ' ').trim();
    });

    let fullText = cleanedLines.join(' ');
    const hashIdx = fullText.indexOf('#');
    let description = '';
    let type = 'flag';
    let required = false;

    if (hashIdx >= 0) {
        description = fullText.substring(hashIdx + 1).trim();
    } else {
        description = fullText.substring(name.length).trim();
    }

    const typeMatch = description.match(/\(([^)]+)\)\s*$/);
    if (typeMatch) {
        const typeStr = typeMatch[1].toLowerCase();
        description = description.substring(0, description.lastIndexOf('(')).trim();

        if (typeStr.includes('string')) { type = 'string'; }
        else if (typeStr.includes('bool')) { type = 'flag'; }
        else if (typeStr.includes('enum')) { type = 'enum'; }
        else if (typeStr.includes('int')) { type = 'int'; }
        else if (typeStr.includes('float')) { type = 'float'; }
        else if (typeStr.includes('point') || typeStr.includes('box')) { type = 'point'; }

        required = typeStr.includes('required');
    }

    description = description.replace(/\s+/g, ' ').trim();

    if (lines[0] && lines[0].includes('<') && type === 'flag') {
        type = 'string';
    }

    return {
        name: name,
        description: description,
        required: required,
        type: type
    };
}

// ===================== Summary generation =====================

/**
 * Generate a sensible English summary from the command name
 * e.g. "addInst" → "Adds an instance to the design."
 *      "checkDesign" → "Checks the design."
 *      "report_timing" → "Reports timing analysis."
 *      "setPlaceMode" → "Sets placement mode options."
 */
function generateSummary(cmdName) {
    // Split camelCase and snake_case
    const words = cmdName
        .replace(/([a-z])([A-Z])/g, '$1 $2')     // camelCase → words
        .replace(/_/g, ' ')                        // snake_case → words
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 0);

    if (words.length === 0) { return `Executes the ${cmdName} command.`; }

    const first = words[0];
    const rest = words.slice(1).join(' ');

    // Verb mapping
    const verbMap = {
        'add': ['Adds', ''],
        'check': ['Checks', ''],
        'create': ['Creates', ''],
        'delete': ['Deletes', ''],
        'remove': ['Removes', ''],
        'report': ['Reports', ''],
        'set': ['Sets', 'options'],
        'get': ['Gets', 'information'],
        'reset': ['Resets', ''],
        'save': ['Saves', ''],
        'load': ['Loads', ''],
        'write': ['Writes', ''],
        'read': ['Reads', ''],
        'init': ['Initializes', ''],
        'start': ['Starts', ''],
        'end': ['Ends', ''],
        'route': ['Routes', ''],
        'place': ['Places', ''],
        'verify': ['Verifies', ''],
        'generate': ['Generates', ''],
        'define': ['Defines', ''],
        'change': ['Changes', ''],
        'edit': ['Edits', ''],
        'update': ['Updates', ''],
        'select': ['Selects', ''],
        'deselect': ['Deselects', ''],
        'assign': ['Assigns', ''],
        'unassign': ['Unassigns', ''],
        'connect': ['Connects', ''],
        'disconnect': ['Disconnects', ''],
        'highlight': ['Highlights', ''],
        'dehighlight': ['Dehighlights', ''],
        'display': ['Displays', ''],
        'dump': ['Dumps', ''],
        'extract': ['Extracts', ''],
        'fix': ['Fixes', ''],
        'flatten': ['Flattens', ''],
        'merge': ['Merges', ''],
        'move': ['Moves', ''],
        'clone': ['Clones', ''],
        'copy': ['Copies', ''],
        'paste': ['Pastes', ''],
        'replace': ['Replaces', ''],
        'restore': ['Restores', ''],
        'run': ['Runs', ''],
        'sort': ['Sorts', ''],
        'split': ['Splits', ''],
        'swap': ['Swaps', ''],
        'trim': ['Trims', ''],
        'undo': ['Undoes', ''],
        'redo': ['Redoes', ''],
        'zoom': ['Zooms', ''],
        'cut': ['Cuts', ''],
        'attach': ['Attaches', ''],
        'detach': ['Detaches', ''],
        'commit': ['Commits', ''],
        'import': ['Imports', ''],
        'export': ['Exports', ''],
        'map': ['Maps', ''],
        'query': ['Queries', ''],
        'legalize': ['Legalizes', ''],
        'optimize': ['Optimizes', ''],
        'partition': ['Partitions', ''],
        'mark': ['Marks', ''],
        'unmark': ['Unmarks', ''],
        'analyze': ['Analyzes', ''],
        'find': ['Finds', ''],
    };

    if (verbMap[first]) {
        const [verb, suffix] = verbMap[first];
        const obj = rest || suffix || 'the design';
        return `${verb} ${obj}.`;
    }

    // Fallback
    return `Executes the '${cmdName}' command.`;
}

// ===================== Main =====================

function main() {
    if (!fs.existsSync(LOG_DIR)) {
        console.error(`❌ Source directory not found: ${LOG_DIR}`);
        process.exit(1);
    }

    // Make sure the output directory exists
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const logFiles = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
    console.log(`📂 Found ${logFiles.length} .log files`);

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const file of logFiles) {
        const cmdName = file.replace(/^help_/, '').replace(/\.log$/, '');
        if (!cmdName) {
            skipped++;
            continue;
        }

        const outFile = path.join(OUT_DIR, file.replace(/\.log$/, '.json'));

        // Skip when the JSON already exists and is newer than the .log
        const logStat = fs.statSync(path.join(LOG_DIR, file));
        if (fs.existsSync(outFile)) {
            const jsonStat = fs.statSync(outFile);
            if (jsonStat.mtimeMs >= logStat.mtimeMs) {
                skipped++;
                continue;
            }
        }

        try {
            const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8');
            const info = parseHelpLog(cmdName, content);

            // Validate the basic structure
            if (!info.command) {
                throw new Error('The parse result has no command name');
            }

            fs.writeFileSync(outFile, JSON.stringify(info, null, 2), 'utf-8');
            success++;
        } catch (err) {
            failed++;
            if (failed <= 5) {
                console.error(`  ⚠️  ${cmdName}: ${err.message}`);
            }
        }
    }

    console.log(`\n✅ Done: ${success} succeeded, ${failed} failed, ${skipped} skipped`);
    console.log(`📁 Output directory: ${OUT_DIR}`);
}

main();
