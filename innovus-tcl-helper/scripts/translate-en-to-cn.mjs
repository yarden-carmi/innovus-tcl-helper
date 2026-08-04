#!/usr/bin/env node
/**
 * EN→CN translation script — translates the data_base/en/help entries that are
 * still missing from the CN help set into Chinese.
 *
 * Usage:
 *   node scripts/translate-en-to-cn.mjs [--limit N] [--concurrency N] [--dry-run]
 *   Concurrency defaults to 20
 *
 * Environment:
 *   DEEPSEEK_API_KEY
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = args.includes('--concurrency')
    ? parseInt(args[args.indexOf('--concurrency') + 1])
    : 20;

const API = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash';
const RETRY_DELAY = 2000;
const MAX_RETRIES = 3;

const BASE_EN = '/Users/echoro/Documents/时擎实习/vscode-plugins/data_base/en/help';
const BASE_CN = '/Users/echoro/Documents/时擎实习/vscode-plugins/data_base/cn/help';
const PROJ_CN = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', 'cn', 'help');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callAPI(systemPrompt, userPrompt, retries = 0) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY not set');
    try {
        const resp = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                temperature: 0.1, stream: false
            }),
            signal: AbortSignal.timeout(60000)
        });
        if (resp.status === 429 && retries < MAX_RETRIES) {
            await sleep(RETRY_DELAY * (retries + 1));
            return callAPI(systemPrompt, userPrompt, retries + 1);
        }
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`API ${resp.status}: ${t.substring(0, 200)}`);
        }
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || '';
    } catch (e) {
        if (retries < MAX_RETRIES && e.name !== 'AbortError') {
            await sleep(RETRY_DELAY);
            return callAPI(systemPrompt, userPrompt, retries + 1);
        }
        throw e;
    }
}

function extractJSON(text) {
    let t = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    const m = t.match(/\{[\s\S]*\}/);
    return m ? m[0] : t;
}

async function translateEntry(enData) {
    const { command, summary, description, options } = enData;

    // Build the options list (only name + description are sent to the model)
    const optList = (options || []).map(o => ({
        name: o.name,
        description: o.description || ''
    }));

    // The prompt below deliberately keeps its Chinese terminology: it is the payload
    // of an English -> Simplified Chinese translator, not user-facing text.
    const systemPrompt = `You are a professional EDA (electronic design automation) technical translator. Translate Innovus TCL command documentation from English into Simplified Chinese.

Terminology:
- timing → 时序, netlist → 网表, placement → 布局, routing → 布线
- clock tree → 时钟树, power → 电源, ground → 地, cell → 单元
- instance → 实例, port → 端口, pin → 引脚, layer → 层
- net → 网络, via → 通孔, bump → 凸块, rail → 电源轨
- opt/optimization → 优化, signoff → 签核, analysis → 分析
- mode → 模式, constraint → 约束, slack → 裕量

Output JSON only, in this shape:
{"summary":"Chinese summary (10-20 characters)","description":"full Chinese description","options":[{"name":"keep the original name","description":"Chinese translation"},...]}`;

    const userPrompt = `Command: ${command}
English summary: ${summary}
English description: ${description || '(none)'}
Options: ${JSON.stringify(optList)}

Translate the summary, the description and the description of every option into Chinese. Keep the option names unchanged.`;

    const result = await callAPI(systemPrompt, userPrompt);
    const jsonStr = extractJSON(result);

    try {
        const translated = JSON.parse(jsonStr);

        // Build the complete Chinese entry
        const cnOptions = (options || []).map((o, i) => ({
            name: o.name,
            description: translated.options?.[i]?.description || o.description || '',
            required: o.required,
            type: o.type
        }));

        return {
            command: command,
            is_cmd: enData.is_cmd,
            summary: translated.summary || summary,
            description: translated.description || description,
            usage: enData.usage || '',
            options: cnOptions
        };
    } catch (e) {
        console.error(`  Parse failed: ${e.message}`);
        console.error(`  Raw: ${jsonStr.substring(0, 200)}`);
        return null;
    }
}

async function main() {
    console.log('═══════════════════════════════════════');
    console.log('  EN→CN translation tool');
    console.log('═══════════════════════════════════════');

    // Find the entries missing from the CN set
    const enFiles = fs.readdirSync(BASE_EN).filter(f => f.endsWith('.json')).sort();
    const cnExisting = new Set(
        fs.readdirSync(BASE_CN).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
    );

    const missing = enFiles.filter(f => {
        const name = f.replace('.json', '');
        return !cnExisting.has(name);
    });

    const total = LIMIT > 0 ? Math.min(LIMIT, missing.length) : missing.length;
    const queue = missing.slice(0, total);

    console.log(`EN total:    ${enFiles.length}`);
    console.log(`CN existing: ${cnExisting.size}`);
    console.log(`To translate: ${missing.length}`);
    console.log(`This run:    ${total}`);
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log('');

    if (DRY_RUN) {
        console.log('[DRY RUN] first 5 to translate:');
        queue.slice(0, 5).forEach(f => console.log(`  - ${f.replace('.json', '')}`));
        return;
    }

    let completed = 0, failed = 0;
    const t0 = Date.now();
    let idx = 0;

    // Progress bar
    function drawProgress(current, max) {
        const pct = (current / max * 100).toFixed(1);
        const BAR_WIDTH = 30;
        const filled = Math.round(current / max * BAR_WIDTH);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        process.stdout.write(`\r[${bar}] ${pct}% (${current}/${max}) ${el}s`);
    }

    async function worker() {
        while (idx < queue.length) {
            const file = queue[idx++];
            const cmdName = file.replace('.json', '');

            try {
                const enData = JSON.parse(fs.readFileSync(path.join(BASE_EN, file), 'utf-8'));
                const cnData = await translateEntry(enData);

                if (cnData) {
                    // Write into data_base/cn/help/
                    fs.writeFileSync(
                        path.join(BASE_CN, file),
                        JSON.stringify(cnData, null, 2),
                        'utf-8'
                    );
                    // And into the project help directory
                    fs.writeFileSync(
                        path.join(PROJ_CN, file),
                        JSON.stringify(cnData, null, 2),
                        'utf-8'
                    );
                    completed++;
                } else {
                    failed++;
                }
            } catch (e) {
                console.error(`\n❌ ${cmdName}: ${e.message.substring(0, 100)}`);
                failed++;
            }

            if ((completed + failed) % 10 === 0) {
                drawProgress(completed + failed, total);
            }
        }
    }

    const workerCount = Math.min(CONCURRENCY, queue.length);
    await Promise.all(Array(workerCount).fill(null).map(() => worker()));

    drawProgress(total, total);
    console.log('');

    const el = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`✅ ${completed} translated, ❌ ${failed} failed (${el}s)`);
    console.log('');
    console.log('Next step:');
    console.log('  node scripts/generate-simulations.mjs --lang cn');
}

main().catch(e => {
    console.error('Fatal error:', e.message);
    process.exit(1);
});
