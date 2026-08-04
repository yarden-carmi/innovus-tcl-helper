/**
 * Parser for the raw English help .log files
 *
 * Parses the native Innovus "help <cmd>" output text into a CmdInfo structure.
 *
 * Input format (help_cmds/help_logs/help_<cmd>.log):
 *   Usage: cmdName [-help] -arg1 <val1> [-arg2 <val2>]
 *                    [-arg3] ...
 *   -help          # Prints out the command usage
 *   -arg1 <val1>   # Description (string, required)
 *   -arg2 <val2>   # Description continued
 *                  # more description (type, optional)
 */

import { CmdInfo, CmdOption } from './commands';

/**
 * Parse the raw English help .log text into a CmdInfo
 */
export function parseHelpLog(cmdName: string, content: string): CmdInfo {
    const lines = content.split('\n');

    // Extract the Usage line (it may span several lines)
    let usage = '';
    let optionLines: string[] = [];
    let inUsage = true;

    for (const line of lines) {
        if (inUsage) {
            if (line.startsWith('Usage:') || line.match(/^\s{15,}[-\[]/)) {
                // First Usage line or a continuation (15+ spaces of indent followed by - or [)
                usage += (usage ? ' ' : '') + line.trim();
            } else if (line.trim().startsWith('-')) {
                // First option line, switch mode
                inUsage = false;
                optionLines.push(line);
            } else if (line.trim() === '') {
                // Blank line, possibly a mode switch
                inUsage = false;
            }
        } else {
            if (line.trim()) {
                optionLines.push(line);
            }
        }
    }

    // Clean up the Usage text
    usage = usage.replace(/^Usage:\s*/, '').trim();

    // Parse the options
    const options = parseOptions(optionLines);
    const description = `Adds, modifies, or queries design objects related to '${cmdName}'.`;

    return {
        command: cmdName,
        is_cmd: true,
        summary: description,
        description: description,
        usage: usage,
        options: options
    };
}

/**
 * Parse the option lines
 *
 * Format:
 *   -flagName      # Description text (type, required/optional)
 *   -flagName <val># Description (type, required/optional)
 *   -flagName {v1 v2}  # Description (enum, optional)
 *                    # Description continuation line
 */
function parseOptions(lines: string[]): CmdOption[] {
    const options: CmdOption[] = [];
    let currentOption: { name: string; lines: string[] } | null = null;

    for (const line of lines) {
        // A new option line starts with - (possibly after a little whitespace)
        const optionMatch = line.match(/^(\s*)(-\w+)\b/);
        if (optionMatch) {
            // Flush the previous option
            if (currentOption) {
                options.push(buildOption(currentOption.name, currentOption.lines));
            }
            currentOption = {
                name: optionMatch[2],
                lines: [line.trim()]
            };
        } else if (currentOption && line.trim()) {
            // Continuation line
            currentOption.lines.push(line.trim());
        }
    }

    // Flush the last option
    if (currentOption) {
        options.push(buildOption(currentOption.name, currentOption.lines));
    }

    return options;
}

/**
 * Build a CmdOption from multiple lines of text
 */
function buildOption(name: string, lines: string[]): CmdOption {
    // Handle the # comment prefix on continuation lines: replace the leading # with a space
    const cleanedLines = lines.map((line, idx) => {
        if (idx === 0) { return line; } // Keep the first line as-is (the flag name line)
        // Continuation line: strip the leading whitespace and #
        return line.replace(/^\s*#\s*/, ' ').trim();
    });

    // Merge the description lines
    let fullText = cleanedLines.join(' ');

    // Strip the leading flag name and any value placeholder,
    // e.g. "-cell <cellName>     # Name of cell (string, required)"
    // keeping only the description after the #
    const hashIdx = fullText.indexOf('#');
    let description = '';
    let type = 'flag';
    let required = false;

    if (hashIdx >= 0) {
        description = fullText.substring(hashIdx + 1).trim();
    } else {
        description = fullText.substring(name.length).trim();
    }

    // Extract the type and whether the option is required from the description,
    // in the format: "... (type, required/optional)"
    const typeMatch = description.match(/\(([^)]+)\)\s*$/);
    if (typeMatch) {
        const typeStr = typeMatch[1].toLowerCase();
        description = description.substring(0, description.lastIndexOf('(')).trim();

        // Parse the type
        if (typeStr.includes('string')) { type = 'string'; }
        else if (typeStr.includes('bool')) { type = 'flag'; }
        else if (typeStr.includes('enum')) { type = 'enum'; }
        else if (typeStr.includes('int')) { type = 'int'; }
        else if (typeStr.includes('float')) { type = 'float'; }
        else if (typeStr.includes('point') || typeStr.includes('box')) { type = 'point'; }
        // If the name is followed by <...> or {...} and the type is still flag → correct it
        else if (lines[0] && /[<{]/.test(lines[0])) { type = 'string'; }

        // Parse whether the option is required
        required = typeStr.includes('required');
    }

    // Collapse redundant whitespace in the description
    description = description.replace(/\s+/g, ' ').trim();

    // If the name carries a value placeholder and the type is not a flag, adjust the type,
    // e.g. "-cell <cellName>" → the type should be string
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
