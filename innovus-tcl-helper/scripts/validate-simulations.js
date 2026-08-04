#!/usr/bin/env node
/**
 * TCL simulation syntax checker — batch-checks the TCL code of every simulation file with tclsh
 *
 * Usage:
 *   node scripts/validate-simulations.mjs [--lang cn|en] [--fix]
 *   --fix  automatically try to repair the common AI-generated syntax errors
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'cn';
const FIX = args.includes('--fix');

// Locate tclsh
function findTclsh() {
    const platform = `${os.platform()}-${os.arch()}`;
    const binName = os.platform() === 'win32' ? 'tclsh9.0.exe' : 'tclsh9.0';
    const bundled = path.join(ROOT, 'bin', platform, binName);
    if (fs.existsSync(bundled)) return bundled;

    const candidates = {
        'darwin-arm64': ['/opt/homebrew/bin/tclsh9.0', '/usr/local/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh'],
        'darwin-x64': ['/usr/local/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh'],
        'linux-x64': ['/usr/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh'],
        'win32-x64': ['tclsh9.0.exe', 'tclsh.exe']
    }[platform] || ['tclsh', 'tclsh9.0'];

    for (const c of candidates) {
        try {
            const r = cp.spawnSync(c, ['-e', 'puts [info patchlevel]'], { timeout: 3000 });
            if (r.stdout.toString().trim().match(/^\d+\.\d+/)) return c;
        } catch (e) { /* ignore */ }
    }
    return null;
}

// Repair the common AI-generated syntax errors
function fixCommonErrors(tcl) {
    let fixed = tcl;

    // 1. Missing space in a switch statement: -word{ → -word {
    fixed = fixed.replace(/(-[a-zA-Z_][a-zA-Z0-9_]*) \{/g, (match, word) => {
        // In a switch context -word { is already correct, nothing to fix
        return match;
    });
    fixed = fixed.replace(/(-[a-zA-Z_][a-zA-Z0-9_]*)\{(?!\s)/g, '$1 {');

    // 2. Unescaped special characters in strings (quote problems inside [...])
    // 3. Missing space after if/while/foreach
    fixed = fixed.replace(/\b(if|while|foreach|switch)\{/g, '$1 {');
    fixed = fixed.replace(/\}(elseif|else)\{/g, '} $1 {');

    // 4. proc misdetected after a comment marker
    // (no-op for now)

    return fixed;
}

async function main() {
    const simDir = path.join(ROOT, 'data', 'simulations', LANG);
    const files = fs.readdirSync(simDir).filter(f => f.endsWith('.tcl')).sort();

    const tclsh = findTclsh();
    if (!tclsh) {
        console.error('❌ tclsh not found');
        process.exit(1);
    }
    console.log(`🔧 tclsh: ${tclsh}`);
    console.log(`📂 Directory: ${simDir}`);
    console.log(`📊 ${files.length} simulation files`);
    console.log('');

    let ok = 0, err = 0, fixed = 0;
    const errors = [];

    for (const f of files) {
        const cmdName = f.replace('.tcl', '');
        const filePath = path.join(simDir, f);

        try {
            let tcl = fs.readFileSync(filePath, 'utf-8').trim();

            if (!tcl.includes('proc ')) {
                console.log(`⚠ ${cmdName}: no proc definition`);
                continue;
            }

            // Build the test script: define the proc, then verify it
            const testScript = tcl + `\nputs "OK:${cmdName}"\n`;

            // Write a temporary file (avoids the multi-line argument problem of tclsh -e)
            const tmpFile = path.join(os.tmpdir(), `tcl_check_${cmdName}.tcl`);
            fs.writeFileSync(tmpFile, testScript, 'utf-8');

            const r = cp.spawnSync(tclsh, [tmpFile], {
                timeout: 5000,
                stdio: 'pipe',
                encoding: 'utf-8'
            });

            // Clean up the temporary file
            try { fs.unlinkSync(tmpFile); } catch (e) { }

            const stdout = r.stdout || '';
            const stderr = (r.stderr || '').trim();

            if (r.status === 0 && stdout.includes(`OK:${cmdName}`) && !stderr) {
                ok++;
                if (ok % 200 === 0) process.stdout.write(`\r  checked ${ok}/${files.length}...`);
            } else {
                // Something failed
                const errMsg = stderr || stdout || `exit code ${r.status}`;
                errors.push({ cmd: cmdName, msg: errMsg, path: filePath });

                if (FIX) {
                    const fixedTcl = fixCommonErrors(tcl);
                    if (fixedTcl !== tcl) {
                        fs.writeFileSync(filePath, fixedTcl.trim() + '\n', 'utf-8');
                        fixed++;
                        console.log(`\n🔧 ${cmdName}: auto-repaired`);
                        // Retry (through the temporary file)
                        const tmpFile2 = path.join(os.tmpdir(), `tcl_fix_${cmdName}.tcl`);
                        fs.writeFileSync(tmpFile2, fixedTcl + `\nputs "OK:${cmdName}"\n`, 'utf-8');
                        const r2 = cp.spawnSync(tclsh, [tmpFile2], {
                            timeout: 5000, stdio: 'pipe', encoding: 'utf-8'
                        });
                        try { fs.unlinkSync(tmpFile2); } catch (e) { }
                        if (r2.status === 0 && r2.stdout.includes(`OK:${cmdName}`)) {
                            ok++;
                            console.log(`   ✅ Passes after the repair`);
                            continue;
                        } else {
                            console.log(`   ❌ Still failing after the repair:`, (r2.stderr || r2.stdout || '').split('\n')[0]);
                        }
                    }
                } else {
                    // Print every error as soon as it is found
                    console.log(`\n❌ ${cmdName}`);
                    console.log(`   ${errMsg.split('\n').slice(0, 3).join('\n   ')}`);
                }
                err++;
            }
        } catch (e) {
            console.log(`\n💥 ${cmdName}: ${e.message}`);
            errors.push({ cmd: cmdName, msg: e.message, path: filePath });
            err++;
        }
    }

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log(`✅ ${ok} passed  ❌ ${err} failed`);
    if (FIX) console.log(`🔧 ${fixed} auto-repaired`);
    console.log(`📂 ${simDir}`);

    // Print the failure list
    if (errors.length > 0) {
        console.log('');
        console.log('── Failure details ──');
        // Group by error type
        const byType = {};
        errors.forEach(e => {
            const type = e.msg.split('\n')[0].substring(0, 60);
            byType[type] = (byType[type] || []).concat(e.cmd);
        });
        for (const [type, cmds] of Object.entries(byType)) {
            console.log(`\n[${cmds.length}] ${type}`);
            cmds.slice(0, 10).forEach(c => console.log(`  - ${c}`));
            if (cmds.length > 10) console.log(`  ... and ${cmds.length - 10} more`);
        }
    }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
