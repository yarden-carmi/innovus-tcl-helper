#!/usr/bin/env node
/**
 * Pre-packaging step:
 *   1. Make sure the data/ directory structure exists
 *   2. Copy the command documentation from ../data_base/ into data/
 *   3. Copy the example scripts from ../example/innovus/ into data/example/innovus/
 *   4. Build the single-file help and simulation databases
 *
 * data/ is gitignored, so a fresh clone has nothing in it. Without step 2 the
 * packaged VSIX would ship an empty command database and neither hovers nor
 * completion would find anything.
 *
 * Every source directory is optional: when ../data_base/ is missing (for example
 * in a standalone checkout of just the extension) the copy is skipped with a
 * warning and whatever is already in data/ is packaged as-is.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`  📁 Created directory: ${path.relative(ROOT, dirPath)}`);
    }
}

/**
 * Copy the files of srcDir into destDir, skipping anything already up to date.
 * @param filter predicate on the file name; defaults to "every file"
 * @returns the number of files copied, or -1 when srcDir does not exist
 */
function syncDir(srcDir, destDir, filter = () => true) {
    if (!fs.existsSync(srcDir)) { return -1; }
    ensureDir(destDir);

    let copied = 0;
    for (const name of fs.readdirSync(srcDir)) {
        if (!filter(name)) { continue; }
        const src = path.join(srcDir, name);
        if (!fs.statSync(src).isFile()) { continue; }

        const dest = path.join(destDir, name);
        if (fs.existsSync(dest) &&
            fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) {
            continue;   // already current
        }
        fs.copyFileSync(src, dest);
        copied++;
    }
    return copied;
}

function report(label, srcDir, copied) {
    if (copied < 0) {
        console.log(`  ⚠ ${label}: source not found, skipped (${path.relative(REPO, srcDir)})`);
    } else if (copied === 0) {
        console.log(`  ✅ ${label}: already up to date`);
    } else {
        console.log(`  ✅ ${label}: ${copied} files copied`);
    }
}

function main() {
    console.log('📦 Checking the data/ directory structure ...');

    ensureDir(path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', 'cn', 'help'));
    ensureDir(path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', 'en', 'help'));
    ensureDir(path.join(ROOT, 'data', 'cmds', 'innovus', 'test', 'cn', 'help'));
    ensureDir(path.join(ROOT, 'data', 'cmds', 'innovus', 'test', 'en', 'help'));
    ensureDir(path.join(ROOT, 'data', 'example', 'innovus'));
    ensureDir(path.join(ROOT, 'data', 'cache', 'cn'));
    ensureDir(path.join(ROOT, 'data', 'cache', 'en'));
    ensureDir(path.join(ROOT, 'data', 'tcl-builtins', 'zh'));
    ensureDir(path.join(ROOT, 'data', 'tcl-builtins', 'en'));
    ensureDir(path.join(ROOT, 'data', 'simulations', 'cn'));
    ensureDir(path.join(ROOT, 'data', 'simulations', 'en'));

    console.log('✅ data/ directory structure ready\n');

    // Copy the command documentation out of data_base/
    console.log('📦 Copying the command documentation from data_base/ ...');
    const isJson = (name) => name.endsWith('.json');
    for (const lang of ['cn', 'en']) {
        const srcDir = path.join(REPO, 'data_base', lang, 'help');
        const destDir = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', lang, 'help');
        report(lang, srcDir, syncDir(srcDir, destDir, isJson));
    }

    // Copy the example scripts
    const exampleSrc = path.join(REPO, 'example', 'innovus');
    const exampleDest = path.join(ROOT, 'data', 'example', 'innovus');
    report('examples', exampleSrc, syncDir(exampleSrc, exampleDest,
        (name) => name.endsWith('.tcl') || name.endsWith('.f')));
    console.log('');

    // Build the help database
    console.log('📦 Building the help database ...');
    try {
        execSync('node scripts/build-help-db.mjs', { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
        console.log('  ⚠ Help database build failed:', e.message);
    }

    // Build the simulation database
    console.log('📦 Building the simulation database ...');
    try {
        execSync('node scripts/build-sim-db.mjs', { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
        console.log('  ⚠ Simulation database build failed:', e.message);
    }
}

main();
