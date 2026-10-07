// ADDAC112 SCALES.CFG: two sets (Default, Custom) of 7 scales, each NAME={ratios={r,r,},per_octave=0|1}.
// Mirrors Preset::save_scales_to_file() / load_scales_from_file() and Granular::init_all_scales().
(function (root) {
    'use strict';

    const N_SCALES = 7;
    const NAME_MAX = 12;        // what fits in the top bar (the firmware keeps up to 19)
    const RATIOS_MAX = 48;      // keeps the line under the firmware's 511 characters
    const NAME_FORBIDDEN = /[={},\r\n]/;
    const SETS = [{ id: 'default', header: 'Default', label: 'Default set' }, { id: 'custom', header: 'Custom', label: 'Custom set' }];

    const ET = [1, 1.05946, 1.12246, 1.18921, 1.25992, 1.33483, 1.41421, 1.49831, 1.58740, 1.68179, 1.78180, 1.88775];
    const pick = (...i) => i.map((n) => ET[n]);
    const MAJOR = pick(0, 2, 4, 5, 7, 9, 11), MINOR = pick(0, 2, 3, 5, 7, 8, 11);
    const PENTA_MAJOR = pick(0, 2, 4, 7, 9), PENTA_MINOR = pick(0, 2, 5, 7, 10);
    const s = (name, ratios, perOctave = true) => ({ name, ratios: ratios.slice(), perOctave });
    // Granular::init_all_scales()
    const FACTORY = () => ({
        default: [s('CHROMATIC', ET), s('MAJOR', MAJOR), s('MINOR', MINOR), s('PENTA MAJOR', PENTA_MAJOR), s('PENTA MINOR', PENTA_MINOR),
            s('TIZITA MINOR', pick(0, 2, 3, 5, 6)), s('OCTAVES', [1])],
        custom: [s('CHROMATIC', ET), s('MAJOR', MAJOR), s('MINOR', MINOR),
            s('HARMONIC', Array.from({ length: 16 }, (_, i) => i + 1), false),
            s('WELL TUNED', [1, 567 / 512, 9 / 8, 147 / 128, 21 / 16, 1323 / 1024, 189 / 128, 3 / 2, 49 / 32, 7 / 4, 441 / 256, 63 / 32]),
            s('PENTA MAJOR', PENTA_MAJOR), s('PENTA MINOR', PENTA_MINOR)],
    });

    // firmware: float_to_parts(r, 100000) then "%d" when there are no decimals, else "%d.%05d"
    function formatRatio(r) {
        const f = Math.round(r * 100000);
        const i = Math.floor(f / 100000), d = f % 100000;
        return d === 0 ? String(i) : `${i}.${String(d).padStart(5, '0')}`;
    }

    // "1.125", "9/8", "3:2" -> number; NaN if invalid
    function parseRatio(text) {
        const t = String(text).trim();
        const frac = /^(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)$/.exec(t);
        if (frac) return parseFloat(frac[1]) / parseFloat(frac[2]);
        return /^\d*\.?\d+$/.test(t) ? parseFloat(t) : NaN;
    }

    const cents = (r) => 1200 * Math.log2(r);

    class ScalesFile {
        // text null/'' -> factory scales
        constructor(text) {
            this.sets = FACTORY();
            this.notes = [];
            this.missingFile = !text;
            if (!text) return;
            let set = 'default';
            const idx = { default: 0, custom: 0 };
            for (const raw of text.split(/\r?\n/)) {
                const line = raw;
                if (/^default$/i.test(line)) { set = 'default'; idx.default = 0; continue; }
                if (/^custom$/i.test(line)) { set = 'custom'; idx.custom = 0; continue; }
                const eq = line.indexOf('=');
                if (eq < 0 || !line.includes('ratios={', eq)) continue; // the firmware skips these too
                if (idx[set] >= N_SCALES) { this.notes.push(`${SETS.find((x) => x.id === set).label}: more than ${N_SCALES} scales, "${line.slice(0, eq)}" is ignored by the module`); continue; }
                const sc = this.sets[set][idx[set]++];
                sc.name = line.slice(0, eq).slice(0, 19);
                const po = /per_octave=(-?\d+)/.exec(line.slice(eq));
                if (po) sc.perOctave = parseInt(po[1], 10) !== 0;
                const m = /ratios=\{([^}]*)\}/.exec(line.slice(eq));
                if (m) {
                    const ratios = m[1].split(',').map((x) => x.trim()).filter((x) => x !== '').map(parseFloat).filter((r) => r > 0).slice(0, 64);
                    if (ratios.length) sc.ratios = ratios;
                }
            }
            for (const set of SETS) if (idx[set.id] < N_SCALES) this.notes.push(`${set.label}: only ${idx[set.id]} scales in the file, the others use the factory scales`);
        }

        // problems that must be fixed before saving: [{set, index, field, message}]
        errors() {
            const out = [];
            for (const set of SETS) {
                this.sets[set.id].forEach((sc, i) => {
                    const at = (field, message) => out.push({ set: set.id, index: i, field, message });
                    if (!sc.name.trim()) at('name', 'Name is empty');
                    else if (sc.name.length > NAME_MAX) at('name', `Name is longer than ${NAME_MAX} characters`);
                    else if (NAME_FORBIDDEN.test(sc.name)) at('name', 'Name can\'t contain = { } or ,');
                    if (!sc.ratios.length) at('ratios', 'Needs at least one ratio');
                    else if (sc.ratios.length > RATIOS_MAX) at('ratios', `At most ${RATIOS_MAX} ratios`);
                    else if (sc.ratios.some((r) => !(r > 0) || r > 1000)) at('ratios', 'Ratios must be between 0 and 1000');
                });
            }
            return out;
        }

        // things that work but are probably not intended
        warnings() {
            const out = [];
            for (const set of SETS) {
                this.sets[set.id].forEach((sc, i) => {
                    if (sc.perOctave && sc.ratios.some((r) => r < 1 || r >= 2)) out.push({ set: set.id, index: i, message: 'Per octave: ratios outside 1-2 land in other octaves' });
                    if (!sc.perOctave && sc.ratios[0] !== 1) out.push({ set: set.id, index: i, message: 'Not per octave: the first ratio is the pitch at knob centre, usually 1' });
                });
            }
            return out;
        }

        resetSet(setId) { this.sets[setId] = FACTORY()[setId]; }

        serialize() {
            const out = [];
            for (const set of SETS) {
                out.push(set.header);
                for (const sc of this.sets[set.id]) {
                    out.push(`${sc.name}={ratios={${sc.ratios.map((r) => formatRatio(r) + ',').join('')}},per_octave=${sc.perOctave ? 1 : 0}}`);
                }
            }
            return out.join('\n') + '\n';
        }

        clone() { const c = new ScalesFile(this.serialize()); c.missingFile = this.missingFile; return c; }
    }

    const api = { ScalesFile, SETS, N_SCALES, NAME_MAX, RATIOS_MAX, formatRatio, parseRatio, cents, FACTORY };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Scales112 = api;
})(typeof window !== 'undefined' ? window : globalThis);
