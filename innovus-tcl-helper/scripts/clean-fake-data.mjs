#!/usr/bin/env node
/**
 * Fake simulation data cleaner.
 * Scans the .tcl files for fabricated numeric output and replaces it with plain
 * descriptive text.
 *
 * NOTE: the Chinese literals below are DATA, not UI text — the patterns match the
 * Chinese (cn) simulation files and the replacements are written back into them.
 * Translating them would stop the script from matching the cn data set.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'cn';
const DRY_RUN = !args.includes('--apply');

const simDir = path.join(ROOT, 'data', 'simulations', LANG);
const files = fs.readdirSync(simDir).filter(f => f.endsWith('.tcl'));

let totalFixed = 0;
let totalFiles = 0;

for (const file of files) {
    const filePath = path.join(simDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;
    const original = content;

    // Pattern 1: fake timing numbers "Slack -0.xxxns", "WNS -0.xxx", "TNS -0.xxx"
    content = content.replace(
        /puts\s+"([^"]*Slack\s*[:-]?\s*-?[0-9]+\.[0-9]+(?:ns|ps)[^"]*)"/gi,
        (match, text) => {
            const cleaned = text.replace(/\s*-?[0-9]+\.[0-9]+(?:ns|ps)/g, '(模拟值)');
            return `puts "${cleaned}"`;
        }
    );

    // Pattern 2: fake skew/delay "Skew 0.xxxns", "delay 0.xxxns"
    content = content.replace(
        /puts\s+"([^"]*[Ss]kew\s*[:-]?\s*[0-9]+\.[0-9]+(?:ns|ps)[^"]*)"/g,
        (match, text) => {
            const cleaned = text.replace(/\s*[0-9]+\.[0-9]+(?:ns|ps)/g, '');
            return `puts "${cleaned} (仅描述参数，无仿真数值)"`;
        }
    );
    content = content.replace(
        /puts\s+"([^"]*delay\s*[:-]?\s*[0-9]+\.[0-9]+(?:ns|ps)[^"]*)"/gi,
        (match, text) => {
            const cleaned = text.replace(/\s*[0-9]+\.[0-9]+(?:ns|ps)/g, '');
            return `puts "${cleaned}"`;
        }
    );

    // Pattern 3: fake area/length "123.45 μm²", "567.89 μm"
    content = content.replace(
        /puts\s+"([^"]*[0-9]+\.[0-9]+\s*(?:μm²?|um²?|mm²?|nm)[^"]*)"/g,
        (match, text) => {
            const cleaned = text.replace(/[0-9]+\.[0-9]+\s*(?:μm²?|um²?|mm²?|nm)/g, '(测量值)');
            if (text === cleaned) return match;
            return `puts "${cleaned}"`;
        }
    );

    // Pattern 4: fake disk/memory "50GB", "32.1GB", "17.9GB"
    content = content.replace(
        /puts\s+"([^"]*[0-9]+(?:\.[0-9]+)?\s*[GMK]B[^"]*)"/g,
        (match, text) => {
            const cleaned = text.replace(/[0-9]+(?:\.[0-9]+)?\s*[GMK]B/g, '');
            if (text === cleaned) return match;
            return `puts "${cleaned}"`;
        }
    );

    // Pattern 5: fake counts "满足条件的信号数量为 3" / "Total: 4" / "found 42"
    content = content.replace(
        /puts\s+"([^"]*(?:数量|数量为|Total|total|found|Found|count|Count)\s*[:-]?\s*[0-9]+[^"]*)"/g,
        (match, text) => {
            const cleaned = text.replace(/(?:数量|数量为|Total|total|found|Found|count|Count)\s*[:-]?\s*[0-9]+/g, '$& (模拟计数)');
            return `puts "${cleaned.replace(/\s*[0-9]+/g, ' (动态值)')}"`;
        }
    );

    // Pattern 6: fake clock frequencies "100MHz", "2.5GHz"
    content = content.replace(
        /puts\s+"([^"]*(?:频率|frequency|Frequency|时钟|clock|Clock)[^"]*[0-9]+(?:\.[0-9]+)?\s*[MG]Hz[^"]*)"/gi,
        (match, text) => {
            const cleaned = text.replace(/[0-9]+(?:\.[0-9]+)?\s*[MG]Hz/g, '(时钟频率)');
            return `puts "${cleaned}"`;
        }
    );

    if (content !== original) {
        modified = true;
        totalFixed++;
    }

    // Pattern 7: rewrite a whole fake-data puts line (aimed at obvious report-style fakes)
    // e.g. puts "时序报告: 路径数 10, Slack -0.123ns" → puts "生成时序报告: 路径数 10"
    content = content.replace(
        /puts\s+"([^"]*(?:报告|report|Report|生成|generating|Generating)[^"]*)"\s*$/gm,
        (match) => {
            // Check whether it contains fabricated numbers
            if (/[0-9]+\.[0-9]+(?:ns|ps|μm|um|GHz|MHz)/.test(match)) {
                const cleaned = match.replace(
                    /,\s*(?:Slack|slack|Skew|skew|WNS|TNS|延迟|偏斜|面积|长度)\s*[:-]?\s*-?[0-9]+\.[0-9]+(?:ns|ps|μm|um|GHz|MHz|μm²|ns\))?/g,
                    ''
                );
                return cleaned;
            }
            return match;
        }
    );

    if (content !== original) {
        if (!DRY_RUN) {
            fs.writeFileSync(filePath, content, 'utf-8');
        }
        totalFiles++;
        console.log(`  ${DRY_RUN ? '[DRY]' : '✏️'}  ${file}`);
    }
}

console.log(`\n${DRY_RUN ? '🔍 DRY RUN' : '✅ Fixed'} ${totalFiles} files (${LANG})`);
if (DRY_RUN) {
    console.log('   Pass --apply to actually write the changes');
}
