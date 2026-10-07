// Where the files come from. A source lists the banks on the card and reads/writes the text files of a bank.
// FolderSource: File System Access API (Chrome/Edge), reads and writes the card in place.
// FilesSource: a folder opened with <input webkitdirectory> (other browsers), read only; saving downloads.
// A live USB source can implement the same methods later.
(function (root) {
    'use strict';

    const SETTINGS = 'SETTINGS.CFG', SCALES = 'SCALES.CFG', GLOBAL = 'GLOBAL.CFG';
    const PRESET_RE = /^(\d+)\.CFG$/i;
    const WAV_RE = /^(\d+)(?:_[^.]*)?\.WAV$/i; // loop id = leading number (Bank::load_from_sd_card)
    const backupName = (name) => name.replace(/\.[^.]+$/, '') + '.BAK';
    const isBankName = (name) => /^BANK\d+$/i.test(name);

    function bankContents(files /* [{name, kind:'file'|'directory'}] */) {
        const has = (n, kind) => files.some((f) => f.kind === kind && f.name.toUpperCase() === n);
        return has(SETTINGS, 'file') || has('WAV', 'directory') || files.some((f) => f.kind === 'file' && PRESET_RE.test(f.name));
    }

    // ---------- File System Access API ----------
    async function entries(dir) {
        const out = [];
        for await (const [name, h] of dir.entries()) out.push({ name, kind: h.kind, h });
        return out;
    }
    async function find(dir, name, kind) {
        for await (const [n, h] of dir.entries()) if (h.kind === kind && n.toUpperCase() === name.toUpperCase()) return h;
        return null;
    }
    async function readText(dir, name) {
        const h = await find(dir, name, 'file');
        return h ? (await h.getFile()).text() : null;
    }

    class FolderSource {
        static get supported() { return 'showDirectoryPicker' in window; }
        constructor() { this.canWrite = true; this.backedUp = new Set(); }

        async pick() {
            this.root = await window.showDirectoryPicker({ id: 'addac112-sd', mode: 'readwrite' });
            this.banks = new Map();
            const top = await entries(this.root);
            if (bankContents(top)) {
                // a bank folder was picked: no card-level files
                this.cardDir = null;
                this.banks.set(this.root.name, this.root);
                this.currentBank = this.root.name;
                return;
            }
            this.cardDir = this.root;
            for (const e of top) {
                if (e.kind !== 'directory' || e.name.startsWith('.')) continue;
                if (bankContents(await entries(e.h))) this.banks.set(e.name, e.h);
            }
            const g = await readText(this.root, GLOBAL);
            const m = g && /^bank=(.*)$/m.exec(g);
            this.currentBank = m ? m[1].trim() : null;
        }

        get name() { return this.root.name; }
        get hasCard() { return !!this.cardDir; }
        listBanks() { return [...this.banks.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); }

        async readGlobal() { return this.cardDir ? readText(this.cardDir, GLOBAL) : null; }

        async loadBank(bank) {
            const dir = this.banks.get(bank);
            const list = await entries(dir);
            const out = { settings: null, scales: null, presets: [], wavs: [] };
            for (const e of list) {
                if (e.kind === 'file') {
                    const up = e.name.toUpperCase();
                    if (up === SETTINGS) out.settings = await (await e.h.getFile()).text();
                    else if (up === SCALES) out.scales = await (await e.h.getFile()).text();
                    else {
                        const m = PRESET_RE.exec(e.name);
                        if (m) out.presets.push({ id: parseInt(m[1], 10), text: await (await e.h.getFile()).text() });
                    }
                } else if (e.kind === 'directory' && e.name.toUpperCase() === 'WAV') {
                    for (const w of await entries(e.h)) {
                        const m = w.kind === 'file' && !w.name.startsWith('.') && WAV_RE.exec(w.name);
                        if (m) out.wavs.push({ id: parseInt(m[1], 10), file: w.name });
                    }
                }
            }
            out.presets.sort((a, b) => a.id - b.id);
            out.wavs.sort((a, b) => a.id - b.id);
            return out;
        }

        async ensureWrite(dir) {
            if (await dir.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
                await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') {
                throw new Error('Permission to write to the card was not given.');
            }
        }

        async writeFile(dir, label, name, text) {
            const existing = await find(dir, name, 'file');
            const key = `${label}/${name.toUpperCase()}`;
            let backup = '';
            // keep the original once per session, in case the edit needs undoing
            if (existing && !this.backedUp.has(key)) {
                const b = await (await dir.getFileHandle(backupName(name), { create: true })).createWritable();
                await b.write(await (await existing.getFile()).text());
                await b.close();
                this.backedUp.add(key);
                backup = backupName(name);
            }
            const h = existing || await dir.getFileHandle(name, { create: true });
            const w = await h.createWritable();
            await w.write(text);
            await w.close();
            return backup;
        }

        // files: [{bank|null, name, text}] (bank null = card root); deletes: [{bank, id}]
        async save(files, deletes) {
            const backups = [];
            for (const f of files) {
                const dir = f.bank ? this.banks.get(f.bank) : this.cardDir;
                await this.ensureWrite(dir);
                const b = await this.writeFile(dir, f.bank || '', f.name, f.text);
                if (b) backups.push(b);
            }
            for (const d of deletes) await this.deletePreset(d.bank, d.id);
            const n = files.length + deletes.length;
            return `Saved ${n} file${n > 1 ? 's' : ''} to the card.` + (backups.length ? ` Originals kept as .BAK (${[...new Set(backups)].join(', ')}).` : '');
        }

        // like the module: moved to DELETED/<id>.CFG, or <id>_<k>.CFG if that exists
        async deletePreset(bank, id) {
            const dir = this.banks.get(bank);
            await this.ensureWrite(dir);
            const src = await find(dir, `${id}.CFG`, 'file');
            if (!src) return;
            const del = await find(dir, 'DELETED', 'directory') || await dir.getDirectoryHandle('DELETED', { create: true });
            let name = `${id}.CFG`;
            for (let k = 1; await find(del, name, 'file'); k++) name = `${id}_${k}.CFG`;
            const w = await (await del.getFileHandle(name, { create: true })).createWritable();
            await w.write(await (await src.getFile()).text());
            await w.close();
            await dir.removeEntry(src.name);
        }
    }

    // ---------- <input webkitdirectory> (read only) ----------
    class FilesSource {
        constructor(fileList) {
            this.canWrite = false;
            this.files = [...fileList];
            const paths = this.files.map((f) => (f.webkitRelativePath || f.name).split('/'));
            this.rootName = paths.length ? paths[0][0] : '';
            // group files by folder path below the picked folder
            this.dirs = new Map();
            this.files.forEach((f, i) => {
                const p = paths[i].slice(1);
                const dir = p.slice(0, -1).join('/');
                if (!this.dirs.has(dir)) this.dirs.set(dir, []);
                this.dirs.get(dir).push({ name: p[p.length - 1], file: f });
            });
            const asEntries = (dir) => {
                const out = (this.dirs.get(dir) || []).map((x) => ({ name: x.name, kind: 'file' }));
                for (const d of this.dirs.keys()) {
                    const rel = dir ? (d.startsWith(dir + '/') ? d.slice(dir.length + 1) : null) : d;
                    if (rel && !rel.includes('/')) out.push({ name: rel, kind: 'directory' });
                }
                return out;
            };
            this.banks = new Map();
            if (bankContents(asEntries(''))) {
                this.isCard = false;
                this.banks.set(this.rootName, '');
            } else {
                this.isCard = true;
                const subdirs = new Set([...this.dirs.keys()].filter((d) => d).map((d) => d.split('/')[0]));
                for (const d of subdirs) if (bankContents(asEntries(d))) this.banks.set(d, d);
            }
        }

        get name() { return this.rootName; }
        get hasCard() { return this.isCard; }
        listBanks() { return [...this.banks.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); }
        fileIn(dir, name) { const x = (this.dirs.get(dir) || []).find((e) => e.name.toUpperCase() === name.toUpperCase()); return x && x.file; }

        async readGlobal() { const f = this.isCard && this.fileIn('', GLOBAL); return f ? f.text() : null; }
        get currentBank() { return null; }

        async loadBank(bank) {
            const dir = this.banks.get(bank);
            const out = { settings: null, scales: null, presets: [], wavs: [] };
            for (const e of this.dirs.get(dir) || []) {
                const up = e.name.toUpperCase();
                if (up === SETTINGS) out.settings = await e.file.text();
                else if (up === SCALES) out.scales = await e.file.text();
                else { const m = PRESET_RE.exec(e.name); if (m) out.presets.push({ id: parseInt(m[1], 10), text: await e.file.text() }); }
            }
            for (const e of this.dirs.get(dir ? `${dir}/WAV` : 'WAV') || []) {
                const m = !e.name.startsWith('.') && WAV_RE.exec(e.name);
                if (m) out.wavs.push({ id: parseInt(m[1], 10), file: e.name });
            }
            out.presets.sort((a, b) => a.id - b.id);
            out.wavs.sort((a, b) => a.id - b.id);
            return out;
        }

        async save(files, deletes) {
            for (const f of files) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([f.text], { type: 'text/plain' }));
                a.download = f.name;
                document.body.append(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }
            const where = files.map((f) => `${f.name} → ${f.bank ? f.bank + '/' : 'the card root'}`);
            const del = deletes.map((d) => `delete ${d.bank}/${d.id}.CFG`);
            return `Downloaded ${files.length} file${files.length === 1 ? '' : 's'}. Copy ${files.length === 1 ? 'it' : 'them'} to the card, replacing the old ones: ${where.concat(del).join('; ')}.`;
        }
    }

    const api = { FolderSource, FilesSource, isBankName };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Source112 = api;
})(typeof window !== 'undefined' ? window : globalThis);
