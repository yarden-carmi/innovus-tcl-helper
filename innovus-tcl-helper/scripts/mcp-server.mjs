#!/usr/bin/env node
/**
 * Innovus TCL MCP Server v0.6.0
 *
 * Model Context Protocol server providing 5 tools:
 *   1. innovus_list_commands      — list/search the Innovus TCL commands
 *   2. innovus_get_command_help   — get the full documentation of a command
 *   3. innovus_parse_tcl_script   — parse a TCL script (by file path or content)
 *   4. innovus_lint_tcl           — quick lint summary (by file path, very token-efficient)
 *   5. innovus_lint_tcl_detailed  — detailed lint report (by file path)
 *
 * The lint tools accept a .f file path or a list of .tcl file paths, read the files
 * themselves and analyze them with the TclCompiler engine. The model only passes
 * paths rather than file contents, which saves a lot of tokens.
 *
 * Usage:
 *   node scripts/mcp-server.mjs [--data-root <path>] [--lang zh|en]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let DATA_ROOT = '';
let LANGUAGE = 'en';
const VERSION = '0.6.2';
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--data-root' && i + 1 < process.argv.length) DATA_ROOT = process.argv[++i];
  else if (process.argv[i] === '--lang' && i + 1 < process.argv.length) LANGUAGE = process.argv[++i];
}
if (!DATA_ROOT) {
  for (const c of [path.join(__dirname, '..', 'data'), path.join(__dirname, '..', '..', 'data_base'), path.join(process.cwd(), 'data')]) {
    if (fs.existsSync(c)) { DATA_ROOT = c; break; }
  }
}
function logToStderr(msg) { process.stderr.write(`[innovus-mcp] ${msg}\n`); }
function sendResponse(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function sendError(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

// ── Command DB ──
const commandDB = new Map(); let dbLoaded = false;
function getHelpDir() { const v = '25.1'; const d = LANGUAGE === 'zh' ? 'cn' : 'en'; return path.join(DATA_ROOT, 'cmds', 'innovus', v, d, 'help'); }
function loadDB() {
  if (dbLoaded) return; const d = getHelpDir();
  if (!fs.existsSync(d)) { logToStderr(`Help dir not found: ${d}`); return; }
  fs.readdirSync(d).filter(f => f.endsWith('.json')).forEach(f => {
    try { const c = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')); if (c.command) commandDB.set(c.command, c); } catch { }
  });
  dbLoaded = true; logToStderr(`Loaded ${commandDB.size} Innovus commands`);
}
function getCmd(n) { loadDB(); return commandDB.get(n) || null; }
function allCmds() { loadDB(); return Array.from(commandDB.keys()); }
function searchCmds(kw, lim = 50) {
  loadDB(); const r = []; const l = kw.toLowerCase();
  for (const [n, i] of commandDB) { if (n.toLowerCase().includes(l) || (i.summary || '').toLowerCase().includes(l)) { r.push({ name: n, summary: i.summary || '', is_cmd: i.is_cmd !== false }); if (r.length >= lim) break; } }
  return r;
}
function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let p = Array.from({ length: n + 1 }, (_, i) => i), c = new Array(n + 1).fill(0); for (let i = 1; i <= m; i++) { c[0] = i; for (let j = 1; j <= n; j++)c[j] = a[i - 1] === b[j - 1] ? p[j - 1] : 1 + Math.min(p[j], c[j - 1], p[j - 1]);[p, c] = [c, p]; } return p[n]; }

// ── TclCompiler-based Lint ──
async function lintWithCompiler(fFilePath, tclFiles) {
  try {
    const { TclCompiler } = await import(path.join(__dirname, '..', 'out', 'compiler.js'));
    let wd, ff;
    if (fFilePath && fs.existsSync(fFilePath)) { wd = path.dirname(path.resolve(fFilePath)); ff = path.basename(fFilePath); }
    else if (tclFiles && tclFiles.length > 0) { wd = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-mcp-')); ff = 'tcl.f'; fs.writeFileSync(path.join(wd, ff), tclFiles.map(f => path.basename(f)).join('\n'), 'utf-8'); for (const tf of tclFiles) { if (fs.existsSync(tf)) fs.copyFileSync(tf, path.join(wd, path.basename(tf))); } }
    else return { error: 'Provide f_file_path or tcl_files' };
    const c = new TclCompiler(); const r = c.compile(wd, ff);
    if (!fFilePath && tclFiles) try { fs.rmSync(wd, { recursive: true, force: true }); } catch { }
    return { result: r, error: null };
  } catch (e) {
    logToStderr(`TclCompiler fail: ${e.message}, fallback linter`);
    return lintBuiltin(fFilePath, tclFiles);
  }
}
function lintBuiltin(fFilePath, tclFiles) {
  const scrs = [];
  if (fFilePath && fs.existsSync(fFilePath)) { const d = path.dirname(fFilePath); fs.readFileSync(fFilePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).forEach(f => { const ap = path.resolve(d, f); if (fs.existsSync(ap)) scrs.push({ file: f, content: fs.readFileSync(ap, 'utf-8') }); }); }
  else if (tclFiles) tclFiles.forEach(f => { if (fs.existsSync(f)) scrs.push({ file: path.basename(f), content: fs.readFileSync(f, 'utf-8') }); });
  if (!scrs.length) return { error: 'No TCL files found' };
  const errs = [], warns = [], vars = {}, refs = []; const re = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
  for (let o = 0; o < scrs.length; o++) {
    const { file, content } = scrs[o]; const ls = content.split('\n');
    for (let li = 0; li < ls.length; li++) {
      const ln = ls[li].trim(); if (!ln || ln.startsWith('#')) continue; const n = li + 1;
      const sm = ln.match(/^set\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/);
      if (sm) { const vn = sm[1]; let v = sm[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('{') && v.endsWith('}'))) v = v.slice(1, -1); if (!vars[vn]) vars[vn] = []; vars[vn].push({ value: v, file, line: n, order: o }); continue; }
      let m; while ((m = re.exec(ln)) !== null) { const vn = m[2]; refs.push({ name: vn, file, line: n }); if (!vars[vn] || !vars[vn].length) errs.push({ message: `Undefined "${vn}"`, file, line: n }); }
    }
  }
  const used = new Set(refs.map(r => r.name)); for (const [vn, ds] of Object.entries(vars)) { if (!used.has(vn)) { const d = ds[ds.length - 1]; warns.push({ message: `"${vn}" never used`, file: d.file, line: d.line }); } }
  return { result: { units: scrs.map(s => ({ relativePath: s.file })), variables: new Map(Object.entries(vars)), variableRefs: refs, errors: errs, warnings: warns }, error: null };
}

// ── TclRunner-based Run tools ──
const EXT_ROOT = path.join(__dirname, '..');

async function toolRunProject({ f_file_path, sim_output_mode }) {
  if (!f_file_path || !fs.existsSync(f_file_path)) {
    return { error: `.f file not found: ${f_file_path}` };
  }
  try {
    const { TclRunner } = await import(path.join(EXT_ROOT, 'out', 'runner.js'));
    const runner = new TclRunner();
    runner.language = LANGUAGE === 'zh' ? 'zh' : 'en';
    const tclsh = runner.findTclsh(EXT_ROOT);
    if (!tclsh) return { error: 'tclsh not found' };
    const mode = sim_output_mode || 'dry-run';
    const wsRoot = path.dirname(f_file_path);
    // Argument order: fFilePath, workspaceRoot, extensionPath, configTclshPath?, outputConfig?, simOutputMode
    const result = await runner.runProject(f_file_path, wsRoot, EXT_ROOT, undefined, undefined, mode);
    return {
      success: result.success,
      fileCount: result.fileCount,
      errorCount: result.errorCount,
      totalDuration: result.totalDuration,
      files: result.results.map(r => ({
        file: r.filePath,
        ok: r.success,
        innovusCommands: r.innovusCommands,
        duration: r.duration,
        output: r.stdout?.slice(-3000),
        stderr: r.stderr?.slice(-2000)
      }))
    };
  } catch (e) {
    return { error: `Runner exception: ${e.message}`, stack: e.stack?.split('\n').slice(0, 3).join('\n') };
  }
}

async function toolRunScript({ script_path, sim_output_mode }) {
  if (!script_path || !fs.existsSync(script_path)) {
    return { error: `Script not found: ${script_path}` };
  }
  try {
    const { TclRunner } = await import(path.join(EXT_ROOT, 'out', 'runner.js'));
    const runner = new TclRunner();
    runner.language = LANGUAGE === 'zh' ? 'zh' : 'en';
    const tclsh = runner.findTclsh(EXT_ROOT);
    if (!tclsh) return { error: 'tclsh not found' };
    const content = fs.readFileSync(script_path, 'utf-8');
    const mode = sim_output_mode || 'dry-run';
    // Argument order: content, workDir, extensionPath, configTclshPath?, outputConfig?, simOutputMode
    const result = await runner.runScript(content, path.dirname(script_path), EXT_ROOT, undefined, undefined, mode);
    return {
      success: result.success,
      duration: result.duration,
      exitCode: result.exitCode,
      innovusCommands: result.innovusCommands,
      output: result.stdout?.slice(-5000),
      stderr: result.stderr?.slice(-3000)
    };
  } catch (e) {
    return { error: `Runner exception: ${e.message}`, stack: e.stack?.split('\n').slice(0, 3).join('\n') };
  }
}

// ── Tools ──
function toolParse({ script_content, script_path }) {
  loadDB(); let c = script_content;
  if (!c && script_path && fs.existsSync(script_path)) c = fs.readFileSync(script_path, 'utf-8');
  if (!c) return { error: 'Provide script_content or script_path' };
  const ls = c.split('\n'); const cmds = new Map(); const mv = new Map(); const uk = new Map(); let bl = 0, cl = 0;
  const TB = new Set(['set', 'puts', 'if', 'else', 'elseif', 'for', 'foreach', 'while', 'proc', 'return', 'source', 'eval', 'expr', 'switch', 'catch', 'error', 'break', 'continue', 'global', 'variable', 'upvar', 'uplevel', 'namespace', 'open', 'close', 'read', 'write', 'gets', 'file', 'cd', 'pwd', 'exec', 'list', 'lindex', 'llength', 'lappend', 'lassign', 'lrange', 'lreplace', 'lsearch', 'lsort', 'lset', 'concat', 'join', 'split', 'string', 'regexp', 'regsub', 'format', 'scan', 'array', 'dict', 'incr', 'append', 'subst', 'unset', 'after', 'clock', 'info', 'trace', 'package', 'rename', 'interp']);
  for (let i = 0; i < ls.length; i++) {
    const t = ls[i].trim(); if (!t) { bl++; continue; } if (t.startsWith('#')) { cl++; continue; } const ft = t.split(/\s/)[0]; if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ft)) continue; if (TB.has(ft)) continue;
    const ci = getCmd(ft);
    if (ci && ci.is_cmd !== false) {
      const ps = {}; const tks = t.split(/\s+/); for (let ti = 0; ti < tks.length; ti++) { const tk = tks[ti]; if (tk.startsWith('-')) { const fg = tk.replace(/[,;]$/, ''); ps[fg] = null; if (ti + 1 < tks.length && !tks[ti + 1].startsWith('-')) { let v = tks[ti + 1].replace(/[,;]$/, ''); v = v.replace(/^\{/, '').replace(/\}$/, ''); ps[fg] = v; ti++; } } }
      const cl2 = { lineNumber: i + 1, lineText: t, params: ps }; const ex = cmds.get(ft); if (ex) ex.push(cl2); else cmds.set(ft, [cl2]);
    }
    else if (ci) { const u = mv.get(ft) || []; u.push(t); mv.set(ft, u); } else uk.set(ft, (uk.get(ft) || 0) + 1);
  }
  const r = { summary: { totalLines: ls.length, codeLines: ls.length - cl - bl, commentLines: cl, blankLines: bl, innovusCommandTypes: cmds.size, totalCommandCalls: Array.from(cmds.values()).reduce((s, v) => s + v.length, 0) }, commands: [] };
  for (const [cn, cls] of cmds) { const ci = getCmd(cn); if (!ci) continue; r.commands.push({ command: cn, summary: ci.summary || '', usage: ci.usage || '', description: ci.description || '', options: ci.options || [], callCount: cls.length, calls: cls.map(cl => ({ line: cl.lineNumber, text: cl.lineText, paramStatus: (ci.options || []).map(o => ({ option: o.name, type: o.type, required: o.required, used: o.name in cl.params, value: cl.params[o.name] ?? null, status: (o.name in cl.params) ? 'used' : o.required ? 'missing_required' : 'not_used' })) })) }); }
  return r;
}
async function toolLintSummary({ f_file_path, tcl_files }) {
  const { result, error } = await lintWithCompiler(f_file_path || null, tcl_files || null); if (error) return { error };
  const { units, variables, errors: errs, warnings: warns } = result;
  const r = { files: units.length, variables: variables.size, errors: errs.length, warnings: warns.length, errorByFile: {}, warningByFile: {} };
  for (const e of errs) { const f = path.basename(e.filePath); r.errorByFile[f] = (r.errorByFile[f] || 0) + 1; }
  for (const w of warns) { const f = path.basename(w.filePath); r.warningByFile[f] = (r.warningByFile[f] || 0) + 1; }
  r.message = errs.length === 0 && warns.length === 0 ? '✅ No issues' : `Found ${errs.length} errors, ${warns.length} warnings`;
  return r;
}
async function toolLintDetailed({ f_file_path, tcl_files }) {
  const { result, error } = await lintWithCompiler(f_file_path || null, tcl_files || null); if (error) return { error };
  const { units, variables, variableRefs, errors, warnings } = result;
  const vt = []; for (const [n, ds] of variables) for (const d of ds) vt.push({ name: n, value: d.value?.length > 80 ? d.value.substring(0, 77) + '...' : (d.value || ''), file: d.relativePath, line: d.line });
  const rt = variableRefs.slice(0, 30).map(r => ({ name: r.name, ref: `${r.relativePath}:${r.line}`, def: r.definition ? `${r.definition.relativePath}:${r.definition.line}` : 'undefined' }));
  return { summary: { files: units.length, variables: variables.size, refs: variableRefs.length, errors: errors.length, warnings: warnings.length, compiledFiles: units.map(u => u.relativePath) }, variables: vt, errors: errors.map(e => ({ file: path.basename(e.filePath), line: e.line, message: e.message })), warnings: warnings.map(w => ({ file: path.basename(w.filePath), line: w.line, message: w.message })), references: rt };
}

// ── Tool defs ──
function getToolDefs() {
  return [
    { name: 'innovus_list_commands', description: 'List/search Innovus TCL commands.', inputSchema: { type: 'object', properties: { search: { type: 'string' }, limit: { type: 'number' } } } },
    { name: 'innovus_get_command_help', description: 'Get full Innovus command docs.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
    { name: 'innovus_parse_tcl_script', description: 'Parse TCL script (content or path).', inputSchema: { type: 'object', properties: { script_content: { type: 'string' }, script_path: { type: 'string' } } } },
    { name: 'innovus_lint_tcl', description: 'Quick lint summary by file paths. Minimal token usage.', inputSchema: { type: 'object', properties: { f_file_path: { type: 'string' }, tcl_files: { type: 'array', items: { type: 'string' } } } } },
    { name: 'innovus_lint_tcl_detailed', description: 'Detailed lint report by file paths.', inputSchema: { type: 'object', properties: { f_file_path: { type: 'string' }, tcl_files: { type: 'array', items: { type: 'string' } } } } },
    { name: 'innovus_run_project', description: 'Run Innovus TCL project (.f file), all Innovus commands simulated.', inputSchema: { type: 'object', properties: { f_file_path: { type: 'string', description: 'Absolute path to .f file' }, sim_output_mode: { type: 'string', enum: ['dry-run', 'mkdir'], description: 'dry-run=print only, mkdir=create output dirs and files' } }, required: ['f_file_path'] } },
    { name: 'innovus_run_script', description: 'Run single TCL script, all Innovus commands simulated.', inputSchema: { type: 'object', properties: { script_path: { type: 'string', description: 'Absolute path to .tcl file' }, sim_output_mode: { type: 'string', enum: ['dry-run', 'mkdir'] } }, required: ['script_path'] } }
  ];
}

// ── JSON-RPC ──
async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'initialize': sendResponse(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'innovus-tcl-mcp', version: VERSION } }); break;
      case 'notifications/initialized': break;
      case 'tools/list': sendResponse(id, { tools: getToolDefs() }); break;
      case 'tools/call': {
        const tn = params?.name, args = params?.arguments || {}; let r;
        switch (tn) {
          case 'innovus_list_commands': r = { total: allCmds().length, commands: args.search ? searchCmds(args.search, args.limit || 50) : allCmds().slice(0, args.limit || 50).map(n => { const i = getCmd(n); return { name: n, summary: i?.summary || '', is_cmd: i?.is_cmd !== false } }) }; break;
          case 'innovus_get_command_help': { const i = getCmd(args.command); r = i || { error: `Command not found: ${args.command}` }; } break;
          case 'innovus_parse_tcl_script': r = toolParse(args); break;
          case 'innovus_lint_tcl': r = await toolLintSummary(args); break;
          case 'innovus_lint_tcl_detailed': r = await toolLintDetailed(args); break;
          case 'innovus_run_project': r = await toolRunProject(args); break;
          case 'innovus_run_script': r = await toolRunScript(args); break;
          default: sendError(id, -32601, `Unknown tool: ${tn}`); return;
        }
        sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }); break;
      }
      default: sendError(id, -32601, `Unknown method: ${method}`);
    }
  } catch (e) { logToStderr(`Error: ${e.message}`); sendError(id, -32603, e.message); }
}

// ── Main ──
logToStderr(`Starting Innovus TCL MCP Server v${VERSION}`);
loadDB();
const rl = createInterface({ input: process.stdin, terminal: false }); let buf = '';
rl.on('line', l => { buf += l; try { const m = JSON.parse(buf); buf = ''; handleRequest(m); } catch { } });
rl.on('close', () => logToStderr('MCP Server shutting down'));
process.stdin.resume();
