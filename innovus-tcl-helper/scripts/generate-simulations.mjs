#!/usr/bin/env node
/**
 * Innovus command simulation data generator — DeepSeek Flash API
 *
 * Features:
 *   - Walks the command help JSON and asks the model for a TCL proc simulation wrapper
 *   - Generates both the cn and en data sets
 *   - Concurrency control + rate-limit retries + resumable runs
 *   - A main log plus one log per worker (rolling, capped at 500 lines)
 *   - Incremental: existing simulation data is skipped automatically
 *
 * Usage:
 *   node scripts/generate-simulations.mjs [--lang cn|en] [--limit N] [--concurrency N] [--dry-run]
 *   Concurrency defaults to 30 (deepseek-v4-flash allows up to 2500)
 *
 * Environment:
 *   DEEPSEEK_API_KEY
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ════════════════════════════════════════════════════════════
//  Configuration
// ════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const LANGS = args.includes('--lang') ? [args[args.indexOf('--lang') + 1]] : ['cn', 'en'];
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const DRY_RUN = args.includes('--dry-run');
const TARGET_CMDS = args.includes('--cmds')
    ? new Set(args[args.indexOf('--cmds') + 1].split(',').map(s => s.trim()))
    : null;

const API = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash';
const CONCURRENCY = args.includes('--concurrency')
    ? parseInt(args[args.indexOf('--concurrency') + 1])
    : 30;  // deepseek-v4-flash allows up to 2500 concurrent calls; 30 is fast and safe
const RETRY_DELAY = 2000;
const MAX_RETRIES = 3;
const MAX_LOG_LINES = 500;

// ════════════════════════════════════════════════════════════
//  Logging
// ════════════════════════════════════════════════════════════

const LOG_DIR = path.join(ROOT, 'data', 'simulations', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

class Logger {
    constructor(filePath) {
        this.filePath = filePath;
        this.buffer = [];
        this.count = 0;
    }
    log(msg) {
        const line = `[${new Date().toISOString().substring(11, 19)}] ${msg}`;
        this.buffer.push(line);
        this.count++;
        if (this.buffer.length >= 20) { this.flush(); }
    }
    flush() {
        if (this.buffer.length === 0) return;
        let content = fs.existsSync(this.filePath)
            ? fs.readFileSync(this.filePath, 'utf-8') : '';
        let lines = content.split('\n').filter(l => l.trim());
        lines.push(...this.buffer);
        // Rolling: keep only the most recent MAX_LOG_LINES lines
        if (lines.length > MAX_LOG_LINES) {
            lines = lines.slice(lines.length - MAX_LOG_LINES);
        }
        fs.writeFileSync(this.filePath, lines.join('\n') + '\n', 'utf-8');
        this.buffer = [];
    }
}

const mainLog = new Logger(path.join(LOG_DIR, 'generation.log'));
const workerLogs = [];
for (let i = 0; i < CONCURRENCY; i++) {
    workerLogs.push(new Logger(path.join(LOG_DIR, `worker-${i}.log`)));
}

// ════════════════════════════════════════════════════════════
//  Prompt templates
// ════════════════════════════════════════════════════════════

function buildPrompt(cmdInfo, lang) {
    const { command, summary, description, usage, options, is_cmd } = cmdInfo;
    const isVariable = (is_cmd === false);

    if (isVariable) {
        // The cn prompts below stay in Chinese on purpose: they are what makes the
        // model emit the Chinese simulation data set.
        if (lang === 'cn') {
            return {
                system: '你是 Innovus EDA 仿真专家。只输出 TCL proc 代码，不输出解释。',
                user: `为 Innovus 配置变量 "${command}" 生成 TCL proc。\n\n变量说明: ${summary}。${description || ''}\n设置方式: set ${command} <value>\n\n要求: 读取第一个参数作为值，puts 中文描述；无参数则只描述功能。只输出 TCL 代码。`
            };
        }
        return {
            system: 'You are an Innovus EDA simulation expert. Output only TCL proc code.',
            user: `Generate TCL proc for Innovus global variable "${command}".

Variable description: ${summary}. ${description || ''}
Usage: set ${command} <value>

Requirements:
1. Parse first positional arg as the value; if no args, just describe the variable
2. puts a short English description of what this variable controls and what value was set
3. proc signature: proc ${command} {args} { ... }
4. Return "", output TCL code only

Example:
proc example_var {args} {
    if {[llength $args] > 0} {
        set val [lindex $args 0]
        puts "Variable set: example_var = $val"
    } else {
        puts "Variable: example_var (controls XYZ behavior)"
    }
    return ""
}`
        };
    }

    // Commands: format the option list
    const optList = (options || []).map(o =>
        `  ${o.name} | ${o.type} | ${o.description || ''}`
    ).join('\n');

    if (lang === 'cn') {
        // Read the MD file as the system prompt (it holds the full rule set)
        const promptFile = path.join(ROOT, 'prompts', 'cn', 'simulation-prompt.md');
        let systemPrompt = '';
        if (fs.existsSync(promptFile)) {
            systemPrompt = fs.readFileSync(promptFile, 'utf-8');
        }
        if (!systemPrompt) {
            systemPrompt = '你是 Innovus EDA 仿真专家。只输出 TCL proc 代码，不输出解释。';
        }

        // User prompt: the command data
        const userPrompt = `为命令 "${command}" 生成仿真 proc。

## 命令基本信息
- 摘要: ${summary}
- 描述: ${description || '无'}
- 用法: ${usage || '无'}

## 参数列表（名称 | 类型 | 描述）
${optList || '  (无参数)'}

请根据 system prompt 中的规则生成 TCL proc 代码。`;

        return { system: systemPrompt, user: userPrompt };
    }

    // English prompt — also load from MD file
    const enPromptFile = path.join(ROOT, 'prompts', 'en', 'simulation-prompt.md');
    let enSystem = 'You are an Innovus EDA simulation expert. Output only TCL proc code. NO desc_map, NO array set.';
    if (fs.existsSync(enPromptFile)) {
        enSystem = fs.readFileSync(enPromptFile, 'utf-8');
    }

    const enUserPrompt = `Generate TCL proc for Innovus command "${command}".

Summary: ${summary}
Options (name | type | description):
${optList || '  (none)'}

Follow the rules in the system prompt exactly.`;

    return { system: enSystem, user: enUserPrompt };
}

// ════════════════════════════════════════════════════════════
//  API calls
// ════════════════════════════════════════════════════════════

async function callAPI(systemPrompt, userPrompt, opts = {}) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY not set');
    const retries = opts.retries || 0;
    const maxRetries = opts.maxRetries || MAX_RETRIES;

    try {
        const resp = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                temperature: opts.temperature || 0.3, stream: false
            }),
            signal: AbortSignal.timeout(60000)
        });

        if (resp.status === 429 && retries < maxRetries) {
            await sleep(RETRY_DELAY * (retries + 1));
            return callAPI(systemPrompt, userPrompt, { ...opts, retries: retries + 1 });
        }
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`API ${resp.status}: ${t.substring(0, 200)}`);
        }
        const data = await resp.json();
        return extractProc(data.choices?.[0]?.message?.content || '');

    } catch (e) {
        if (retries < maxRetries && e.name !== 'AbortError') {
            await sleep(RETRY_DELAY);
            return callAPI(systemPrompt, userPrompt, { ...opts, retries: retries + 1 });
        }
        throw e;
    }
}

function extractProc(text) {
    let code = text.replace(/```tcl\n?/gi, '').replace(/```\n?/g, '').trim();
    if (/^proc\s+\w+/i.test(code)) return code;
    const m = code.match(/proc\s+\w+\s*\{[^}]*\}\s*\{[\s\S]+/i);
    return m ? m[0] : '';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════
//  Main flow
// ════════════════════════════════════════════════════════════

async function processLang(lang) {
    const helpDir = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', lang, 'help');
    const simDir = path.join(ROOT, 'data', 'simulations', lang);
    fs.mkdirSync(simDir, { recursive: true });

    const files = fs.readdirSync(helpDir).filter(f => f.endsWith('.json')).sort();
    // With --cmds, only these commands are processed
    const filteredFiles = TARGET_CMDS
        ? files.filter(f => TARGET_CMDS.has(f.replace('help_', '').replace('.json', '')))
        : files;
    if (TARGET_CMDS) {
        mainLog.log(`[${lang}] target commands: ${TARGET_CMDS.size}, matched ${filteredFiles.length}`);
    }
    const total = LIMIT > 0 ? Math.min(LIMIT, filteredFiles.length) : filteredFiles.length;

    const TCL_BUILTINS = new Set(['Puts', 'set', 'if', 'while', 'for', 'foreach', 'proc', 'return', 'expr',
        'source', 'catch', 'error', 'list', 'concat', 'lindex', 'llength', 'lappend', 'split', 'join',
        'regexp', 'regsub', 'open', 'close', 'gets', 'read', 'file', 'glob', 'cd', 'pwd', 'exec', 'eval',
        'uplevel', 'upvar', 'namespace', 'variable', 'array', 'string', 'format', 'scan', 'clock', 'info']);

    // Compare against the file system: existing simulation files are skipped
    const existingCount = files.filter(f => {
        const name = f.replace('help_', '').replace('.json', '');
        return fs.existsSync(path.join(simDir, `${name}.tcl`));
    }).length;
    const pendingCount = total - existingCount;

    mainLog.log(`[${lang}] ${files.length} commands total, processing ${total}, ${existingCount} existing, ${pendingCount} to generate, concurrency=${CONCURRENCY}`);

    if (DRY_RUN) {
        const info = JSON.parse(fs.readFileSync(path.join(helpDir, files[0]), 'utf-8'));
        const p = buildPrompt(info, lang);
        mainLog.log(`[DRY RUN] System: ${p.system.substring(0, 80)}`);
        mainLog.log(`[DRY RUN] User: ${p.user.substring(0, 500)}`);
        return;
    }

    let completed = 0, skipped = 0, failed = 0;
    const t0 = Date.now();
    const queue = filteredFiles.slice(0, total);
    let idx = 0;

    // Count the skipped files up front (.tcl already present + variants + built-ins)
    let preSkipped = 0;
    for (const f of queue) {
        const name = f.replace('help_', '').replace('.json', '');
        // The .tcl file already exists
        if (fs.existsSync(path.join(simDir, `${name}.tcl`))) { preSkipped++; continue; }
        // Variant entry (the cmdName carries a space + numeric suffix)
        if (/\s+\d+$/.test(name)) { preSkipped++; continue; }
    }
    const needGenerate = total - preSkipped;
    if (preSkipped > 0) {
        console.log(`[${lang}] 📦 skipping ${preSkipped} (existing files + variant entries)`);
    }
    console.log(`[${lang}] 🔧 ${needGenerate} to generate (${total} total)`);

    // Progress bar
    const BAR_WIDTH = 30;
    let lastProgressLine = '';
    function progressBar(current, max) {
        const pct = (current / max * 100).toFixed(1);
        const filled = Math.round(current / max * BAR_WIDTH);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        return `[${bar}] ${pct}% skipped ${skipped} generated ${completed} failed ${failed} ${el}s`;
    }

    function drawProgress(current, max) {
        const line = progressBar(current, max);
        // Clear the previous line and redraw (\r returns to the start, spaces erase leftovers)
        if (lastProgressLine) {
            process.stdout.write('\r' + ' '.repeat(lastProgressLine.length) + '\r');
        }
        process.stdout.write(line);
        lastProgressLine = line;
    }

    // Refresh the progress every 3 seconds
    let progressTimer = setInterval(() => {
        const current = completed + skipped + failed;
        if (current > 0 && current < total) {
            drawProgress(current, total);
        }
    }, 3000);

    // When a worker writes to the console, clear the progress line first, then redraw it
    function consoleLog(msg) {
        // Clear the current progress line
        if (lastProgressLine) {
            process.stdout.write('\r' + ' '.repeat(lastProgressLine.length) + '\r');
        }
        console.log(msg);
        // Redraw the progress
        const current = completed + skipped + failed;
        if (current > 0 && current < total) {
            drawProgress(current, total);
        }
    }

    async function worker(workerId) {
        const wl = workerLogs[workerId];
        while (idx < queue.length) {
            const file = queue[idx++];
            const cmdName = file.replace('help_', '').replace('.json', '');
            const simFile = path.join(simDir, `${cmdName}.tcl`);

            // Skip files that already have simulation data (checked against the file system)
            if (fs.existsSync(simFile)) {
                skipped++;
                continue;
            }

            try {
                // Skip variant entries (a cmdName with a space + numeric suffix, e.g. "readSdpFile 2")
                if (/\s+\d+$/.test(cmdName)) {
                    skipped++;
                    continue;
                }

                const info = JSON.parse(fs.readFileSync(path.join(helpDir, file), 'utf-8'));

                // Skip pure TCL built-ins (they are not Innovus-specific)
                if (TCL_BUILTINS.has(info.command) && info.is_cmd === false) {
                    skipped++;
                    continue;
                }

                const { system, user } = buildPrompt(info, lang);

                // First attempt
                let tcl = await callAPI(system, user);
                let retried = false;

                // Retry when there is no proc, or the braces do not balance
                if (!tcl.includes('proc ')) {
                    const msg = `🔁 [${lang}] ${cmdName}(${info.summary?.substring(0, 30)}) no proc → retrying`;
                    wl.log(msg); consoleLog(msg);
                    tcl = await callAPI(system, user, { temperature: 0.1, maxRetries: 1 });
                    retried = true;
                }

                if (tcl.includes('proc ')) {
                    const openB = (tcl.match(/\{/g) || []).length;
                    const closeB = (tcl.match(/\}/g) || []).length;
                    if (openB !== closeB) {
                        const msg = `🔁 [${lang}] ${cmdName}(${info.summary?.substring(0, 30)}) {${openB}/}${closeB} → retrying`;
                        wl.log(msg); consoleLog(msg);
                        tcl = await callAPI(system, user, { temperature: 0.1, maxRetries: 1 });
                        retried = true;
                    }
                }

                // Final validation
                if (!tcl.includes('proc ')) {
                    const msg = `⚠ [${lang}] ${cmdName}(${info.summary?.substring(0, 40)}) still has no proc${retried ? ' after the retry' : ''}`;
                    wl.log(msg); consoleLog(msg);
                    failed++;
                    continue;
                }

                const openBraces = (tcl.match(/\{/g) || []).length;
                const closeBraces = (tcl.match(/\}/g) || []).length;
                if (openBraces !== closeBraces) {
                    const msg = `⚠ [${lang}] ${cmdName}(${info.summary?.substring(0, 40)}) unbalanced braces {${openBraces}/}${closeBraces}${retried ? ' after the retry' : ''}`;
                    wl.log(msg); consoleLog(msg);
                    failed++;
                    continue;
                }

                fs.writeFileSync(simFile, tcl.trim() + '\n', 'utf-8');

                completed++;

                // Write the success details to the worker log (every 50 entries)
                if (completed % 50 === 0) {
                    wl.log(`✅ [${lang}] ${cmdName}(${info.summary?.substring(0, 40)}) done`);
                }

                // Update the progress bar every 50 entries
                if (completed % 50 === 0) {
                    drawProgress(completed + skipped + failed, total);
                    mainLog.log(`[${lang}] ${progressBar(completed + skipped + failed, total)} latest: ${cmdName}`);
                }

            } catch (e) {
                const msg = `❌ [${lang}] ${cmdName} exception: ${e.message.substring(0, 100)}`;
                wl.log(msg); consoleLog(msg);
                failed++;
            }
        }
        wl.flush();
    }

    // Run the workers concurrently
    const workerCount = Math.min(CONCURRENCY, queue.length);
    await Promise.all(Array(workerCount).fill(null).map((_, i) => worker(i)));

    // Final flush
    if (progressTimer) clearInterval(progressTimer);
    // Clear the progress line and print the completion line
    if (lastProgressLine) {
        process.stdout.write('\r' + ' '.repeat(lastProgressLine.length) + '\r');
    }
    console.log(progressBar(total, total));
    mainLog.flush();
    for (const wl of workerLogs) wl.flush();

    const el = ((Date.now() - t0) / 1000).toFixed(0);
    mainLog.log(`[${lang}] ✅${completed} ⏭${skipped} ❌${failed} (${el}s)`);
    if (failed > 0) {
        mainLog.log(`[${lang}] 💡 ${failed} failures — see worker-*.log; the next run retries them automatically`);
    }
}


async function main() {
    mainLog.log('═══════════════════════════════════════');
    mainLog.log(`Starting: languages=${LANGS.join(',')} concurrency=${CONCURRENCY} limit=${LIMIT || 'none'}`);
    mainLog.log(`Logs: ${LOG_DIR}`);
    mainLog.log(`Mode: file-system comparison (existing simulations are skipped)`);

    for (const lang of LANGS) {
        await processLang(lang);
    }

    mainLog.log('═══════════════════════════════════════');
    mainLog.log('All done');
    mainLog.flush();
}

main().catch(e => {
    mainLog.log(`❌ Fatal error: ${e.message}`);
    mainLog.flush();
    process.exit(1);
});
