// ADDAC112 config panel UI: bank settings, presets, scales and global settings (GLOBAL.CFG) of one SD card.
'use strict';
const { SECTIONS, PRESET_SECTIONS, OPTION_SECTIONS, FIELDS, VOL_BITS, GAIN_MAX, Settings, Preset, GlobalCfg, optionLabel, enumMatch } = window.Cfg112;
const { ScalesFile, SETS, NAME_MAX, formatRatio, parseRatio, cents } = window.Scales112;
const { FolderSource, FilesSource, isBankName } = window.Source112;

const MAX_PRESETS = 32; // MAX_PRESETS in defs.h
const TABS = [
    { id: 'settings', label: 'Bank settings' },
    { id: 'presets', label: 'Presets' },
    { id: 'scales', label: 'Scales' },
    { id: 'card', label: 'Global' },
];

let source = null;
let S = null;          // the open bank, see loadBank()
let tab = 'settings';
let presetSel = null;  // id of the preset shown
let scaleDrafts = {};  // ratio text that doesn't parse yet: "set:index" -> text

const $ = (id) => document.getElementById(id);
function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e[k] = v;
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
    return e;
}

// ---------- pending changes ----------
const presetName = (id) => `PRESET ${id}`;
const sameText = (a, b) => a.serialize() === b.serialize();
const clonePreset = (p) => new Preset(p.serialize(), p.id);

function pending() {
    const files = [], deletes = [], labels = [];
    if (!S) return { files, deletes, labels };
    const b = S.bank;
    if (S.settings.missing || !sameText(S.settings.cur, S.settings.orig)) {
        files.push({ bank: b, name: 'SETTINGS.CFG', text: S.settings.cur.serialize(), tab: 'settings' });
        labels.push(`${b}/SETTINGS.CFG${S.settings.missing ? ' (new)' : ''}`);
    }
    if (S.scales.cur.serialize() !== S.scales.orig.serialize()) {
        files.push({ bank: b, name: 'SCALES.CFG', text: S.scales.cur.serialize(), tab: 'scales' });
        labels.push(`${b}/SCALES.CFG${S.scales.missing ? ' (new)' : ''}`);
    }
    for (const p of S.presets) {
        if (p.deleted) {
            if (p.orig) { deletes.push({ bank: b, id: p.id, tab: 'presets' }); labels.push(`${b}/${p.id}.CFG (delete)`); }
        } else if (!p.orig || !sameText(p.cur, p.orig)) {
            files.push({ bank: b, name: `${p.id}.CFG`, text: p.cur.serialize(), tab: 'presets' });
            labels.push(`${b}/${p.id}.CFG${p.orig ? '' : ' (new)'}`);
        }
    }
    if (S.global && !sameGlobal()) {
        files.push({ bank: null, name: 'GLOBAL.CFG', text: S.global.cur.serialize(), tab: 'card' });
        labels.push('GLOBAL.CFG');
    }
    return { files, deletes, labels };
}
const sameGlobal = () => S.global.cur.serialize() === S.global.orig.serialize();
const isDirty = () => { const p = pending(); return p.files.length + p.deletes.length > 0; };
const confirmDiscard = () => !isDirty() || confirm('You have unsaved changes. Discard them?');

function scaleProblems() {
    const errs = S.scales.cur.errors();
    for (const k of Object.keys(scaleDrafts)) {
        const [set, index] = k.split(':');
        errs.push({ set, index: +index, field: 'ratios', message: 'Some ratios are not numbers or fractions' });
    }
    return errs;
}

// ---------- messages ----------
function showMessage(title, items = [], kind = '') {
    const close = el('button', { 'aria-label': 'Dismiss', text: '×' });
    const box = el('div', { class: `msg ${kind}` },
        el('div', null, el('div', { text: title }), items.length ? el('ul', null, items.map((i) => el('li', { text: i }))) : null),
        close);
    close.onclick = () => box.remove();
    $('messages').prepend(box);
}
function showError(title, e) {
    $('editor').hidden = false;
    showMessage(title, [e && e.message ? e.message : String(e)], 'err');
}

// ---------- generic fields ----------
const fid = (key) => `f-${key.replace('@', '_')}`;
const semitones = (r) => 12 * Math.log2(r);

function fieldChanged(f, cur, orig) {
    if (!orig) return false;
    if (f.key === 'special_functions') return ((cur.values.special_functions ^ orig.values.special_functions) & 0x07) !== 0;
    return cur.get(f.key) !== orig.get(f.key);
}

function valueLabel(f, v) {
    if (f.type === 'enum') return optionLabel(f, v);
    if (f.type === 'bits') return f.bits.filter(([b]) => (v >> b) & 1).map(([, l]) => l).join(', ') || 'none';
    if (f.type === 'pitch') return `${semitones(v) >= 0 ? '+' : ''}${semitones(v).toFixed(2)} st`;
    if (f.auto !== undefined && v === f.auto) return 'AUTO';
    if (f.zeroLabel && v === 0) return f.zeroLabel;
    if (f.percent) return `${+(v * 100).toFixed(1)} %`;
    return `${v}${f.unit ? ' ' + f.unit : ''}`;
}

function enumControl(f, v, options, locked, onChange) {
    const sel = el('select', { id: fid(f.key), disabled: !!locked });
    const list = options.slice();
    if (!enumMatch({ options: list, tol: f.tol }, v)) list.push({ v, label: f.otherLabel ? f.otherLabel(v) : `${v}` });
    for (const o of list) sel.append(el('option', { value: String(o.v), text: o.label, selected: !!enumMatch({ options: [o], tol: f.tol }, v) }));
    sel.onchange = () => onChange(Number(sel.value));
    return sel;
}

function bitsControl(f, v, onChange) {
    return el('div', { class: 'chips', role: 'group', 'aria-labelledby': `${fid(f.key)}-label` },
        f.bits.map(([bit, label]) => {
            const cb = el('input', { type: 'checkbox', checked: ((v >> bit) & 1) === 1 });
            cb.onchange = () => onChange(cb.checked ? (v | (1 << bit)) : (v & ~(1 << bit)));
            return el('label', { class: 'chip' }, cb, el('span', { text: label }));
        }));
}

function rangeControl(f, v, max, onChange, origValue) {
    const k = f.percent ? 100 : 1;
    const isAuto = f.auto !== undefined && v === f.auto;
    const slider = el('input', { type: 'range', min: f.min * k, max: max * k, step: f.percent ? 0.1 : f.step, value: isAuto ? f.min * k : v * k, disabled: isAuto, 'aria-label': f.label });
    const num = el('input', { type: 'number', id: fid(f.key), min: f.min * k, max: max * k, step: f.percent ? 0.1 : f.step, value: isAuto ? '' : +(v * k).toFixed(4), disabled: isAuto });
    slider.oninput = () => { num.value = slider.value; };
    slider.onchange = () => onChange(Number(slider.value) / k);
    num.onchange = () => { if (num.value !== '') onChange(Number(num.value) / k); else render(); };
    const wrap = el('div', { class: 'range' }, slider, num);
    const unit = f.percent ? '%' : f.unit;
    if (unit) wrap.append(el('span', { class: 'unit', text: unit }));
    if (f.zeroLabel) wrap.append(el('span', { class: 'zero', text: v === 0 ? f.zeroLabel : '' }));
    if (f.auto !== undefined) {
        const cb = el('input', { type: 'checkbox', checked: isAuto });
        cb.onchange = () => onChange(cb.checked ? f.auto : (origValue === f.auto || origValue === undefined ? f.min : origValue));
        wrap.append(el('label', { class: 'auto' }, cb, 'AUTO'));
    }
    return wrap;
}

function pitchControl(f, v, onChange) {
    const st = semitones(v);
    const slider = el('input', { type: 'range', min: -48, max: 48, step: 0.01, value: st, 'aria-label': f.label });
    const num = el('input', { type: 'number', id: fid(f.key), min: -48, max: 48, step: 0.01, value: st.toFixed(2) });
    const ratio = el('span', { class: 'unit', text: `st ×${v.toFixed(3)}` });
    const apply = (s) => onChange(Math.round(Math.pow(2, Number(s) / 12) * 1000) / 1000); // the file keeps 3 decimals
    slider.oninput = () => { num.value = Number(slider.value).toFixed(2); };
    slider.onchange = () => apply(slider.value);
    num.onchange = () => { if (num.value !== '') apply(num.value); else render(); };
    return el('div', { class: 'range' }, slider, num, ratio);
}

// sections: schema sections; rec/orig: Record (orig may be null for a new preset); ctx: {options(f), inactive(f), help(f)}
function renderSections(sections, rec, orig, ctx = {}) {
    const locks = rec.locks();
    const onChange = (key) => (value) => {
        const notes = rec.set(key, value);
        if (notes.length) showMessage('Also changed, as on the module:', notes);
        render();
    };
    return sections.map((s) => {
        const card = el('section', { class: 'card', id: `card-${s.id}` },
            el('h2', null, s.title, s.bankWide ? el('span', { class: 'tag', text: 'whole bank' }) : null));
        if (ctx.cardNote && ctx.cardNote(s)) card.append(el('div', { class: 'cardnote', text: ctx.cardNote(s) }));
        for (const f of s.fields) {
            if (!rec.has(f.key)) continue;
            const v = rec.get(f.key);
            const changed = fieldChanged(f, rec, orig);
            const inactive = ctx.inactive && ctx.inactive(f);
            let control;
            if (f.type === 'enum') control = enumControl(f, v, (ctx.options && ctx.options(f)) || f.options, locks[f.key], onChange(f.key));
            else if (f.type === 'bits') control = bitsControl(f, v, onChange(f.key));
            else if (f.type === 'pitch') control = pitchControl(f, v, onChange(f.key));
            else control = rangeControl(f, v, rec.max(f.key), onChange(f.key), orig ? orig.get(f.key) : undefined);
            const row = el('div', { class: 'row' + (f.type === 'bits' && f.bits.length > 5 ? ' wide' : '') + (changed ? ' changed' : '') + (locks[f.key] ? ' locked' : '') + (inactive ? ' inactive' : '') },
                el(f.type === 'bits' ? 'div' : 'label', { class: 'lbl', id: `${fid(f.key)}-label`, for: f.type === 'bits' ? null : fid(f.key), text: f.label }),
                control);
            const notes = [];
            if (locks[f.key]) notes.push(el('span', { text: locks[f.key] }));
            if (inactive) notes.push(el('span', { text: inactive }));
            if (changed) notes.push(el('span', { class: 'was', text: `was ${valueLabel(f, orig.get(f.key))}` }));
            if (f.help) notes.push(el('span', { text: f.help }));
            if (notes.length) row.append(el('div', { class: 'help' }, notes.flatMap((n, i) => (i ? [' · ', n] : [n]))));
            card.append(row);
        }
        return card;
    });
}

// ---------- bank settings tab ----------
function renderSettings(host) {
    host.append(el('p', { class: 'lead', text: 'Settings the bank uses with no preset selected. Presets keep their own copy of most of them (see the Presets tab); the ones marked "whole bank" apply to every preset.' }));
    host.append(el('div', { class: 'grid' }, renderSections(SECTIONS, S.settings.cur, S.settings.orig)));
}

// ---------- presets tab ----------
function scaleOptions(scalesSet) {
    const set = S.scales.cur.sets[scalesSet ? 'custom' : 'default'];
    return [{ v: 0, label: 'OFF' }].concat(set.map((sc, i) => ({ v: i + 1, label: `${i + 1} · ${sc.name}` })));
}

function presetIds() { return S.presets.map((p) => p.id); }
function newPresetId() { return S.presets.length ? Math.max(...presetIds()) + 1 : 0; }
const livePresets = () => S.presets.filter((p) => !p.deleted);

function addPreset(p) {
    S.presets.push({ id: p.id, orig: null, cur: p, deleted: false });
    S.presets.sort((a, b) => a.id - b.id);
    presetSel = p.id;
    render();
}

function renderPresets(host) {
    host.append(el('p', { class: 'lead', text: 'What a preset recalls when you select it on the module. Knobs are stored as knob positions (0–100 %): what a position means can depend on the loop (e.g. SIZE, POSITION). A recalled knob stays locked until you turn it past the preset value.' }));
    const p = S.presets.find((x) => x.id === presetSel);
    const full = livePresets().length >= MAX_PRESETS;

    const sel = el('select', { id: 'preset-select', 'aria-label': 'Preset' });
    for (const x of S.presets) {
        const tag = x.deleted ? ' (will be deleted)' : !x.orig ? ' (new)' : !sameText(x.cur, x.orig) ? ' • edited' : '';
        sel.append(el('option', { value: String(x.id), text: `${presetName(x.id)}${tag}`, selected: x.id === presetSel }));
    }
    sel.onchange = () => { presetSel = Number(sel.value); render(); };
    const newBtn = el('button', { class: 'btn', id: 'preset-new', disabled: full, text: 'New', title: 'New preset with the bank settings and all loops' });
    newBtn.onclick = () => addPreset(Preset.fromSettings(S.settings.cur, newPresetId(), S.wavs.map((w) => w.id)));
    const dupBtn = el('button', { class: 'btn', id: 'preset-dup', disabled: full || !p || p.deleted, text: 'Duplicate' });
    dupBtn.onclick = () => addPreset(new Preset(p.cur.serialize(), newPresetId()));
    const delBtn = el('button', { class: 'btn', id: 'preset-del', disabled: !p || p.deleted, text: 'Delete' });
    delBtn.onclick = () => {
        if (!p.orig) { S.presets = S.presets.filter((x) => x !== p); presetSel = S.presets.length ? S.presets[0].id : null; } else p.deleted = true;
        render();
    };
    host.append(el('div', { class: 'toolbar' }, S.presets.length ? sel : el('span', { class: 'small', text: 'This bank has no presets yet.' }), newBtn, dupBtn, delBtn,
        full ? el('span', { class: 'small', text: `The module holds up to ${MAX_PRESETS} presets.` }) : null));
    if (!p) return;

    if (p.deleted) {
        const undo = el('button', { class: 'btn small', id: 'preset-undo', text: 'Undo' });
        undo.onclick = () => { p.deleted = false; render(); };
        host.append(el('div', { class: 'banner' }, `${presetName(p.id)} will be deleted when you save (moved to ${S.bank}/DELETED/, like the module does).`, undo));
        return;
    }

    const vols = S.settings.cur.values.vols_in_presets;
    const ctx = {
        options: (f) => (f.key === 'quantizer' ? scaleOptions(p.cur.values.scales_set) : null),
        inactive: (f) => (f.key in VOL_BITS && !((vols >> VOL_BITS[f.key]) & 1) ? 'Not recalled: follows its knob (VOLS IN PRESETS, Bank settings)' : null),
        cardNote: (s) => (s.id === 'p-pitch' ? `Scales from the ${p.cur.values.scales_set ? 'Custom' : 'Default'} set (SCALES SET option below).` : null),
    };
    host.append(el('div', { class: 'grid' }, renderSections(PRESET_SECTIONS, p.cur, p.orig, ctx), renderLoops(p)));
    host.append(el('h3', { class: 'group', text: 'Options saved in this preset' }));
    host.append(el('div', { class: 'grid' }, renderSections(OPTION_SECTIONS, p.cur, p.orig)));
}

function renderLoops(p) {
    const rec = p.cur;
    const list = rec.loopList;
    const selIdx = rec.values.selected_loop;
    const wav = (id) => S.wavs.find((w) => w.id === id);
    const changed = p.orig && (p.orig.loopList.join() !== list.join() || p.orig.values.selected_loop !== selIdx);
    const set = (ids, sel) => { rec.setLoopList(ids, sel); render(); };

    const ul = el('ul', { class: 'loops', id: 'loop-list' });
    if (!list.length) ul.append(el('li', null, el('span', { class: 'empty', text: 'No loops: the preset plays nothing until loops are added.' })));
    list.forEach((id, i) => {
        const w = wav(id);
        const radio = el('input', { type: 'radio', name: 'selloop', checked: i === selIdx, 'aria-label': `Select loop ${i + 1} when the preset loads` });
        radio.onchange = () => set(list, i);
        const move = (d) => { const ids = list.slice(); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; set(ids, selIdx === i ? i + d : selIdx === i + d ? i : selIdx); };
        const up = el('button', { class: 'btn small', text: '↑', 'aria-label': 'Move up', disabled: i === 0 });
        up.onclick = () => move(-1);
        const down = el('button', { class: 'btn small', text: '↓', 'aria-label': 'Move down', disabled: i === list.length - 1 });
        down.onclick = () => move(1);
        const rm = el('button', { class: 'btn small', text: '✕', 'aria-label': 'Remove from preset' });
        rm.onclick = () => set(list.filter((_, j) => j !== i), selIdx > i ? selIdx - 1 : selIdx === i ? 0 : selIdx);
        ul.append(el('li', null, el('span', { class: 'pos', text: `${i + 1}.` }),
            el('span', { class: 'name', text: w ? w.file : `loop ${id}` }), w ? null : el('span', { class: 'missing', text: 'not in WAV/' }),
            el('label', { class: 'sel' }, radio, 'start'), up, down, rm));
    });
    const available = S.wavs.filter((w) => !list.includes(w.id));
    const addSel = el('select', { id: 'loop-add-select', 'aria-label': 'Loop to add', disabled: !available.length },
        available.length ? available.map((w) => el('option', { value: String(w.id), text: w.file })) : el('option', { text: 'All loops are in the preset' }));
    const add = el('button', { class: 'btn small', id: 'loop-add', text: 'Add', disabled: !available.length });
    add.onclick = () => set(list.concat(Number(addSel.value)), selIdx);
    const addAll = el('button', { class: 'btn small', text: 'Add all', disabled: !available.length });
    addAll.onclick = () => set(list.concat(available.map((w) => w.id)), selIdx);
    return el('section', { class: 'card', id: 'card-loops' },
        el('h2', null, 'Loops', changed ? el('span', { class: 'tag', text: 'edited' }) : null),
        el('div', { class: 'cardnote', text: 'The loops this preset uses, in LOOP SELECT order. "start" is the loop selected when the preset loads.' }),
        ul, el('div', { class: 'loopadd' }, addSel, add, addAll));
}

// ---------- scales tab ----------
function renderScales(host) {
    host.append(el('p', { class: 'lead', text: 'Each bank has two sets of 7 scales. QUANTIZE picks scale 1–7 from the set chosen by SCALES SET (in the bank settings, and in each preset). Ratios are relative to the root: type decimals or fractions (9/8), separated by commas.' }));
    if (S.scales.missing) host.append(el('div', { class: 'msg' }, el('div', { text: 'This bank has no SCALES.CFG yet, so the module uses the factory scales shown here. Saving creates the file if you change anything.' })));
    const errs = scaleProblems(), warns = S.scales.cur.warnings();
    const used = S.settings.cur.values.scales_set;
    const grid = el('div', { class: 'grid' });
    for (const set of SETS) {
        const reset = el('button', { class: 'btn small right', text: 'Reset to factory', id: `reset-${set.id}` });
        reset.onclick = () => {
            if (!confirm(`Replace the ${set.label.toLowerCase()} with the factory scales?`)) return;
            S.scales.cur.resetSet(set.id);
            for (const k of Object.keys(scaleDrafts)) if (k.startsWith(set.id + ':')) delete scaleDrafts[k];
            render();
        };
        const card = el('section', { class: 'card', id: `scales-${set.id}` },
            el('h2', null, set.label, (used === 1) === (set.id === 'custom') ? el('span', { class: 'tag', text: 'used by bank settings' }) : null, reset));
        S.scales.cur.sets[set.id].forEach((sc, i) => {
            const key = `${set.id}:${i}`;
            const o = S.scales.orig.sets[set.id][i];
            const changed = o.name !== sc.name || o.perOctave !== sc.perOctave || o.ratios.map(formatRatio).join() !== sc.ratios.map(formatRatio).join();
            const myErrs = errs.filter((e) => e.set === set.id && e.index === i);
            const myWarns = warns.filter((w) => w.set === set.id && w.index === i);
            const name = el('input', { type: 'text', id: `scale-${key.replace(':', '-')}-name`, value: sc.name, maxlength: 19, 'aria-label': `Scale ${i + 1} name`, class: myErrs.some((e) => e.field === 'name') ? 'bad' : null });
            name.onchange = () => { sc.name = name.value.toUpperCase(); render(); };
            const ratioText = key in scaleDrafts ? scaleDrafts[key] : sc.ratios.map(formatRatio).join(', ');
            const ratios = el('input', { type: 'text', id: `scale-${key.replace(':', '-')}-ratios`, value: ratioText, 'aria-label': `Scale ${i + 1} ratios`, class: 'ratios' + (myErrs.some((e) => e.field === 'ratios') ? ' bad' : ''), spellcheck: false });
            ratios.onchange = () => {
                const parts = ratios.value.split(/[\s,;]+/).filter(Boolean);
                const values = parts.map(parseRatio);
                if (values.some((v) => isNaN(v))) scaleDrafts[key] = ratios.value;
                else { delete scaleDrafts[key]; sc.ratios = values.map((v) => Number(formatRatio(v))); }
                render();
            };
            const po = el('select', { 'aria-label': `Scale ${i + 1} per octave`, id: `scale-${key.replace(':', '-')}-po` },
                el('option', { value: '1', text: 'PER OCTAVE', selected: sc.perOctave }),
                el('option', { value: '0', text: 'ABSOLUTE', selected: !sc.perOctave }));
            po.onchange = () => { sc.perOctave = po.value === '1'; render(); };
            const row = el('div', { class: 'scale' + (changed ? ' changed' : '') },
                el('span', { class: 'idx', text: String(i + 1) }), name, po, ratios,
                el('div', { class: 'cents', text: key in scaleDrafts ? '' : sc.ratios.map((r) => `${Math.round(cents(r))}¢`).join(' · ') }));
            for (const e of myErrs) row.append(el('div', { class: 'problem err', text: e.message }));
            for (const w of myWarns) row.append(el('div', { class: 'problem warn', text: w.message }));
            card.append(row);
        });
        grid.append(card);
    }
    host.append(grid);
}

// ---------- card tab (GLOBAL.CFG) ----------
function gainControl(key, label) {
    const g = S.global.cur.gains[key], o = S.global.orig.gains[key];
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    const slider = el('input', { type: 'range', min: 0, max: GAIN_MAX, step: 0.005, value: g, 'aria-label': label });
    const num = el('input', { type: 'number', id: `gain-${key}`, min: -60, max: +db(GAIN_MAX).toFixed(1), step: 0.1, value: g > 0 ? db(g).toFixed(1) : '' });
    const set = (x) => { S.global.cur.setGain(key, x); render(); };
    slider.oninput = () => { num.value = Number(slider.value) > 0 ? db(Number(slider.value)).toFixed(1) : ''; };
    slider.onchange = () => set(Number(slider.value));
    num.onchange = () => set(num.value === '' ? 0 : Math.pow(10, Number(num.value) / 20));
    const changed = g !== o;
    const row = el('div', { class: 'row' + (changed ? ' changed' : '') },
        el('label', { class: 'lbl', for: `gain-${key}`, text: label }),
        el('div', { class: 'range' }, slider, num, el('span', { class: 'unit', text: `dB ×${g.toFixed(3)}` })));
    if (changed) row.append(el('div', { class: 'help' }, el('span', { class: 'was', text: `was ${o > 0 ? db(o).toFixed(1) + ' dB' : 'muted'}` })));
    return row;
}

function renderCard(host) {
    host.append(el('p', { class: 'lead', text: 'Settings for the whole card, saved in GLOBAL.CFG at its root.' }));
    const g = S.global.cur, banks = source.listBanks();
    const sel = el('select', { id: 'global-bank' });
    if (!banks.includes(g.bank)) sel.append(el('option', { value: g.bank, text: g.bank ? `${g.bank} (not on the card)` : '(none)', selected: true }));
    for (const b of banks) sel.append(el('option', { value: b, text: isBankName(b) ? b : `${b} (the module only loads BANK<number> folders)`, disabled: !isBankName(b), selected: b === g.bank }));
    sel.onchange = () => { g.bank = sel.value; render(); };
    const bankChanged = g.bank !== S.global.orig.bank;
    const bankRow = el('div', { class: 'row' + (bankChanged ? ' changed' : '') }, el('label', { class: 'lbl', for: 'global-bank', text: 'BANK AT START' }), sel,
        el('div', { class: 'help' }, el('span', { text: 'The bank the 112 loads when it starts.' }), bankChanged ? [' · ', el('span', { class: 'was', text: `was ${S.global.orig.bank || '(none)'}` })] : null));
    host.append(el('div', { class: 'grid' },
        el('section', { class: 'card' }, el('h2', null, 'Startup'), bankRow),
        el('section', { class: 'card' }, el('h2', null, 'Outputs'), gainControl('out_gain_l', 'OUT GAIN LEFT'), gainControl('out_gain_r', 'OUT GAIN RIGHT'))));
}

// ---------- page ----------
function render() {
    if (!S) return;
    const focusedId = document.activeElement && document.activeElement.id;
    const { files, deletes, labels } = pending();
    const dirtyTabs = new Set(files.map((f) => f.tab).concat(deletes.map((d) => d.tab)));

    const tabs = $('tabs');
    tabs.textContent = '';
    for (const t of TABS) {
        if (t.id === 'card' && !S.global) continue;
        const b = el('button', { role: 'tab', id: `tab-${t.id}`, 'aria-selected': String(t.id === tab), text: t.id === 'presets' ? `${t.label} (${livePresets().length})` : t.label });
        if (dirtyTabs.has(t.id)) b.append(el('span', { class: 'dot', 'aria-label': 'unsaved changes' }));
        b.onclick = () => { tab = t.id; render(); window.scrollTo(0, 0); };
        tabs.append(b);
    }
    tabs.hidden = false;

    const host = $('panel');
    host.textContent = '';
    ({ settings: renderSettings, presets: renderPresets, scales: renderScales, card: renderCard })[tab](host);
    if (focusedId && $(focusedId)) $(focusedId).focus();

    const n = files.length + deletes.length;
    const blocked = scaleProblems().length > 0 && files.some((f) => f.name === 'SCALES.CFG');
    $('status').textContent = '';
    if (n) {
        $('status').append(el('b', { text: `${n} file${n > 1 ? 's' : ''}` }), ' not saved', el('span', { class: 'files', text: labels.join(', ') }));
        if (blocked) $('status').append(el('span', { class: 'files', text: 'Fix the scales marked in red before saving.' }));
    } else $('status').textContent = 'No changes';
    $('save').disabled = !n || blocked;
    $('revert').disabled = !n && !Object.keys(scaleDrafts).length;
    $('save').textContent = source.canWrite ? 'Save' : 'Download';
}

function renderContext() {
    const ctx = $('context');
    ctx.textContent = '';
    ctx.append(el('strong', { text: S.bank }), el('span', { text: source.hasCard ? `${source.name}/${S.bank}` : S.bank }),
        S.wavs.length ? el('span', { text: `${S.wavs.length} loop${S.wavs.length > 1 ? 's' : ''} in WAV/` }) : null);
}

async function loadBank(name) {
    try {
        const d = await source.loadBank(name);
        const gtext = source.hasCard ? await source.readGlobal() : null;
        const settings = new Settings(d.settings || '');
        const scales = new ScalesFile(d.scales);
        S = {
            bank: name,
            wavs: d.wavs,
            settings: { cur: settings, orig: new Settings(settings.serialize()), missing: d.settings === null },
            scales: { cur: scales, orig: scales.clone(), missing: d.scales === null },
            presets: d.presets.map((x) => { const cur = new Preset(x.text, x.id); return { id: x.id, cur, orig: clonePreset(cur), deleted: false, notes: cur.notes }; }),
            global: source.hasCard ? (() => { const cur = new GlobalCfg(gtext || ''); return { cur, orig: new GlobalCfg(cur.serialize()), notes: cur.notes }; })() : null,
        };
        presetSel = S.presets.length ? S.presets[0].id : null;
        scaleDrafts = {};
        if (tab === 'card' && !S.global) tab = 'settings';
        $('messages').textContent = '';
        const adjusted = [];
        settings.notes.forEach((n) => adjusted.push(`SETTINGS.CFG: ${n}`));
        S.presets.forEach((p) => p.notes.forEach((n) => adjusted.push(`${p.id}.CFG: ${n}`)));
        scales.notes.forEach((n) => adjusted.push(`SCALES.CFG: ${n}`));
        if (S.global) S.global.notes.forEach((n) => adjusted.push(`GLOBAL.CFG: ${n}`));
        if (adjusted.length) showMessage('Some values in the files are outside what the module accepts and are shown as the module will use them:', adjusted);
        if (S.settings.missing) showMessage('This bank has no SETTINGS.CFG yet: the bank settings are the module defaults, and saving creates the file.');
        $('intro').hidden = true;
        $('editor').hidden = false;
        $('savebar').hidden = false;
        renderContext();
        render();
    } catch (e) {
        showError('Could not read the bank', e);
    }
}

async function openSource(s) {
    const banks = s.listBanks();
    if (!banks.length) {
        showError('No banks found', new Error('Choose the SD card itself, or a bank folder (one with a WAV folder, presets or a SETTINGS.CFG inside).'));
        return;
    }
    source = s;
    const sel = $('bank');
    sel.textContent = '';
    for (const b of banks) sel.append(el('option', { value: b, text: b + (b === s.currentBank ? ' (at start)' : '') }));
    sel.hidden = banks.length < 2;
    const first = banks.includes(s.currentBank) ? s.currentBank : banks[0];
    sel.value = first;
    await loadBank(first);
}

$('open-sd').onclick = async () => {
    if (!confirmDiscard()) return;
    const s = new FolderSource();
    try { await s.pick(); } catch (e) { if (e.name !== 'AbortError') showError('Could not open the folder', e); return; }
    await openSource(s);
};
$('open-folder').onclick = () => { if (confirmDiscard()) $('folder-input').click(); };
$('folder-input').onchange = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    const s = new FilesSource(files);
    e.target.value = '';
    await openSource(s);
};
$('bank').onchange = async (e) => {
    if (!confirmDiscard()) { e.target.value = S.bank; return; }
    await loadBank(e.target.value);
};

$('revert').onclick = () => {
    S.settings.cur = new Settings(S.settings.orig.serialize());
    S.scales.cur = S.scales.orig.clone();
    S.presets = S.presets.filter((p) => p.orig).map((p) => Object.assign(p, { cur: clonePreset(p.orig), deleted: false }));
    if (!S.presets.some((p) => p.id === presetSel)) presetSel = S.presets.length ? S.presets[0].id : null;
    if (S.global) S.global.cur = new GlobalCfg(S.global.orig.serialize());
    scaleDrafts = {};
    render();
};

$('save').onclick = async () => {
    const { files, deletes } = pending();
    try {
        const msg = await source.save(files, deletes);
        // what was saved is the new baseline
        S.settings = { cur: S.settings.cur, orig: new Settings(S.settings.cur.serialize()), missing: false };
        if (files.some((f) => f.name === 'SCALES.CFG')) S.scales = { cur: S.scales.cur, orig: S.scales.cur.clone(), missing: false };
        S.presets = S.presets.filter((p) => !p.deleted).map((p) => Object.assign(p, { orig: clonePreset(p.cur) }));
        if (!S.presets.some((p) => p.id === presetSel)) presetSel = S.presets.length ? S.presets[0].id : null;
        if (S.global) S.global.orig = new GlobalCfg(S.global.cur.serialize());
        $('messages').textContent = '';
        showMessage(msg);
        render();
    } catch (e) {
        showError('Could not save', e);
    }
};

window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

if (FolderSource.supported) {
    $('open-sd').hidden = false;
    $('open-folder').hidden = true;
} else {
    $('step-sd').hidden = true;
    $('step-folder').hidden = false;
    $('browser-note').hidden = false;
    $('save-word').textContent = 'Download';
}
