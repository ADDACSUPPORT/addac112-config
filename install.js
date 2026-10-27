// Installing firmware on the SD card, from the files in firmware/ (listed in firmware/firmware.json,
// written by tools/update_firmware.js).
// The bootloader flashes the first .bin in the card root at power on and renames it to .bin.old
// (bootloader/src/fatloader.cpp), so the granular firmware always goes there. The engines go in
// ENGINES/, which Menu > ENGINE lists (ENGINES_DIR in src/defs.h); with them, the granular .bin goes
// there too, so the ENGINE menu can switch back to it.
(function (root) {
    'use strict';

    const ENGINES = 'ENGINES';
    const BASE = 'firmware/';
    const isBin = (name) => !name.startsWith('.') && /\.bin$/i.test(name);
    // engine = file name up to the first "_" (ADDAC112_V2.1.5-10-ge37e.bin -> ADDAC112)
    const engineId = (name) => name.replace(/\.bin$/i, '').split('_')[0].toUpperCase();
    // the module only reads the number after BANK (BANK0_LOOPS is bank 0)
    const bankNumber = (name) => { const m = /^BANK(\d+)/i.exec(name); return m ? parseInt(m[1], 10) : null; };
    const same = (a, b) => a.toUpperCase() === b.toUpperCase();
    const emptyCard = () => ({ rootFiles: [], engines: [], dirs: [] });

    // card: { rootFiles: [{name, size}], engines: [{name, size}] (files in ENGINES/), dirs: [names in the root] }
    // opts: { engines: bool, loopsBank: bool }
    // Returns the actions in the order they must run: {op: 'delete'|'write'|'mkdir'|'skip', dir, name, url, size, why}.
    // The root .bin is written last, so an install that stops halfway never leaves a forced update behind.
    function planInstall(manifest, card, opts) {
        const acts = [];
        const fw = manifest.firmware;
        const writeOnce = (dir, existing, f, url) => {
            const have = existing.find((e) => same(e.name, f.file));
            if (have && f.size !== undefined && have.size === f.size) acts.push({ op: 'skip', dir, name: f.file, why: 'already on the card' });
            else acts.push({ op: 'write', dir, name: f.file, url, size: f.size });
        };

        if (opts.engines) {
            const wanted = [fw, ...manifest.engines];
            const ids = new Set(wanted.map((f) => f.id));
            for (const e of card.engines) {
                if (isBin(e.name) && ids.has(engineId(e.name)) && !wanted.some((f) => same(f.file, e.name)))
                    acts.push({ op: 'delete', dir: ENGINES, name: e.name, why: 'older build' });
            }
            for (const f of wanted) writeOnce(ENGINES, card.engines, f, BASE + f.file);
        }

        if (opts.engines && opts.loopsBank) {
            for (const b of manifest.banks) {
                const taken = card.dirs.find((d) => bankNumber(d) === bankNumber(b.folder));
                if (taken) { acts.push({ op: 'skip', dir: '', name: b.folder, why: `bank ${bankNumber(b.folder)} is already on the card (${taken})` }); continue; }
                acts.push({ op: 'mkdir', dir: '', name: b.folder });
                for (const f of b.files) acts.push({ op: 'write', dir: b.folder, name: f, url: `${BASE}banks/${b.folder}/${f}` });
                for (const d of b.dirs) acts.push({ op: 'mkdir', dir: b.folder, name: d });
            }
        }

        // the module would flash whichever .bin it finds first
        for (const f of card.rootFiles) {
            if (isBin(f.name) && !same(f.name, fw.file)) acts.push({ op: 'delete', dir: '', name: f.name, why: 'not flashed yet, would be flashed instead' });
        }
        writeOnce('', card.rootFiles, fw, BASE + fw.file);
        return acts;
    }

    // ---------- File System Access API ----------
    async function find(dir, name, kind) {
        for await (const [n, h] of dir.entries()) if (h.kind === kind && same(n, name)) return h;
        return null;
    }
    async function listFiles(dir) {
        const out = [];
        for await (const [name, h] of dir.entries()) if (h.kind === 'file') out.push({ name, size: (await h.getFile()).size });
        return out;
    }

    async function readCard(rootDir) {
        const card = emptyCard();
        for await (const [name, h] of rootDir.entries()) {
            if (h.kind === 'directory') card.dirs.push(name);
            else card.rootFiles.push({ name, size: (await h.getFile()).size });
        }
        const eng = await find(rootDir, ENGINES, 'directory');
        if (eng) card.engines = await listFiles(eng);
        return card;
    }

    // path "" = root, "BANK0_LOOPS/WAV" = nested; folders are found ignoring case, as on the module
    async function dirAt(rootDir, path, create) {
        let d = rootDir;
        for (const part of path.split('/').filter(Boolean)) d = await find(d, part, 'directory') || (create ? await d.getDirectoryHandle(part, { create: true }) : null);
        return d;
    }

    // fetchFile(url) -> ArrayBuffer; onProgress(doneBytes, totalBytes, action) before each action
    async function runInstall(rootDir, acts, fetchFile, onProgress = () => {}) {
        if (await rootDir.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
            await rootDir.requestPermission({ mode: 'readwrite' }) !== 'granted') {
            throw new Error('Permission to write to the card was not given.');
        }
        const todo = acts.filter((a) => a.op !== 'skip');
        const total = todo.reduce((n, a) => n + (a.size || 0), 0);
        let done = 0;
        for (const a of todo) {
            onProgress(done, total, a);
            const where = a.dir ? `${a.dir}/${a.name}` : a.name;
            if (a.op === 'mkdir') await dirAt(rootDir, a.dir ? `${a.dir}/${a.name}` : a.name, true);
            else if (a.op === 'delete') {
                const d = await dirAt(rootDir, a.dir, false);
                if (d) await d.removeEntry(a.name);
            } else if (a.op === 'write') {
                const data = await fetchFile(a.url);
                if (a.size !== undefined && data.byteLength !== a.size) throw new Error(`${a.name}: downloaded ${data.byteLength} bytes instead of ${a.size}. Try again.`);
                const d = await dirAt(rootDir, a.dir, true);
                const h = await find(d, a.name, 'file') || await d.getFileHandle(a.name, { create: true });
                const w = await h.createWritable();
                await w.write(data);
                await w.close();
                if ((await h.getFile()).size !== data.byteLength) throw new Error(`${where} wasn't written completely. Check the card and try again.`);
                done += a.size || 0;
            }
        }
        onProgress(total, total, null);
    }

    const api = { ENGINES, planInstall, readCard, runInstall, engineId, bankNumber, emptyCard, isBin };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Install112 = api;
})(typeof window !== 'undefined' ? window : globalThis);
