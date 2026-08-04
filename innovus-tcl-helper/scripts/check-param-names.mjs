#!/usr/bin/env node
/**
 * Simulation option-name checker — verifies that the option names used in the .tcl
 * simulation files match the help JSON exactly.
 *
 * Usage: node scripts/check-param-names.mjs [--lang cn]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LANG = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'cn';

const helpDir = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', LANG, 'help');
const simDir = path.join(ROOT, 'data', 'simulations', LANG);

// Collect every documented option name from the JSON
function getHelpParams(cmdName) {
    const f = path.join(helpDir, `help_${cmdName}.json`);
    if (!fs.existsSync(f)) return null;
    const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return {
        command: d.command,
        params: new Set((d.options || []).map(o => o.name)),
        isCmd: d.is_cmd
    };
}

// Collect every -xxx option reference from the .tcl file
function getTclParams(cmdName) {
    const f = path.join(simDir, `${cmdName}.tcl`);
    if (!fs.existsSync(f)) return null;
    const tcl = fs.readFileSync(f, 'utf-8');
    // Extract every -word option reference (from desc_map, switch, info exists, ...)
    const matches = tcl.match(/-[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    // Filter out proc argument names, TCL built-ins and similar
    const params = new Set();
    for (const m of matches) {
        // Skip the obvious non-options: TCL switch flags such as -exact, -glob, -regexp, -nocase
        if (/^-(exact|glob|regexp|nocase|help|reset|true|false|yes|no|on|off|1|0)$/.test(m)) continue;
        params.add(m);
    }
    // Also take the keys of desc_map
    const descMapMatch = tcl.match(/array set desc_map \{([^}]+)\}/s);
    if (descMapMatch) {
        const keys = descMapMatch[1].match(/-[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
        for (const k of keys) {
            if (!/^-(exact|glob|regexp|nocase)$/.test(k)) params.add(k);
        }
    }
    // Take the case values of a switch (the "-xxx" form)
    const switchKeys = tcl.match(/\"(-[a-zA-Z_][a-zA-Z0-9_]*)\"/g) || [];
    for (const k of switchKeys) {
        const clean = k.replace(/"/g, '');
        if (!/^-(exact|glob|regexp|nocase)$/.test(clean)) params.add(clean);
    }
    return { command: cmdName, params };
}

async function main() {
    const helpFiles = fs.readdirSync(helpDir).filter(f => f.endsWith('.json')).sort();
    let total = 0, ok = 0, missing = 0, withExtra = 0, noSim = 0;
    const issues = [];

    for (const hf of helpFiles) {
        const cmdName = hf.replace('help_', '').replace('.json', '');
        const help = getHelpParams(cmdName);
        if (!help) continue;
        total++;

        const tcl = getTclParams(cmdName);
        if (!tcl) { noSim++; continue; } // No simulation file

        // Options present in the .tcl but missing from the help
        const extra = [...tcl.params].filter(p => !help.params.has(p));
        // Options present in the help but missing from the .tcl
        const absent = [...help.params].filter(p => !tcl.params.has(p));

        if (extra.length === 0 && absent.length === 0) {
            ok++;
        } else {
            if (extra.length > 0) withExtra++;
            if (absent.length > 0) missing++;
            issues.push({ cmd: cmdName, extra, absent, paramCount: help.params.size });
        }
    }

    // Print the results
    console.log('═══════════════════════════════════════');
    console.log(`  Option name check report (${LANG})`);
    console.log('═══════════════════════════════════════');
    console.log(`  Total commands: ${total}`);
    console.log(`  ✅ Exact match: ${ok}`);
    console.log(`  ❌ .tcl has extra options (not in help): ${withExtra}`);
    console.log(`  ⚠️  help options missing from .tcl: ${missing}`);
    console.log(`  📁 No simulation file: ${noSim}`);

    // Sort by the number of extra options and show the top 20
    console.log('');
    console.log('── Top 20 by extra options ──');
    issues.sort((a, b) => b.extra.length - a.extra.length);
    for (const issue of issues.slice(0, 20)) {
        console.log(`  ${issue.cmd} (help has ${issue.paramCount} options, ${issue.extra.length} extra, ${issue.absent.length} missing)`);
        if (issue.extra.length <= 10) {
            console.log(`    Extra: ${issue.extra.join(', ')}`);
        } else {
            console.log(`    Extra (first 10): ${issue.extra.slice(0, 10).join(', ')}...`);
        }
        if (issue.absent.length > 0 && issue.absent.length <= 10) {
            console.log(`    Missing: ${issue.absent.join(', ')}`);
        }
    }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
