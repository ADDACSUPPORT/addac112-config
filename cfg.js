// ADDAC112 bank settings (SETTINGS.CFG), presets (<id>.CFG) and GLOBAL.CFG: schema, rules and file text.
// No DOM or file access here, so the same model can be fed by the SD card editor or, later, by a live USB
// transport. Keys, encodings, ranges and defaults mirror Preset::init(), Preset::save_preset_to_file(),
// Preset::sanitize_(), Preset::set_max_grains(), SD::save_global_config_to_file() and the menus in gui.cpp.
(function (root) {
    'use strict';
    const { KvDoc, parseInt10, parseFloatFw } = typeof module !== 'undefined' && module.exports ? require('./kv.js') : root.Kv112;

    const opts = (pairs) => pairs.map(([v, label]) => ({ v, label }));
    const ON_OFF = opts([[0, 'OFF'], [1, 'ON']]);
    const knob = (key, label, def, extra) => Object.assign({ key, label, type: 'range', min: 0, max: 1, step: 0.001, percent: true, def, fmt: 3 }, extra);

    // special_functions bits
    const SF_KILL = 0, SF_DUPLICATE = 1, SF_NORMALIZE = 2, SF_AUTO_NEW_REC = 3, SF_AUTO_REC = 4;
    const SF_AUTOREC_MASK = (1 << SF_AUTO_NEW_REC) | (1 << SF_AUTO_REC);

    // preset_override bit = Pot index in hw.h (only the ones listed in Menu > Preset > PRESETS OVERRIDE)
    const OVERRIDE_POTS = [
        [0, 'PLAY POS'], [1, 'PLAY POS DEV'], [2, 'GRAIN LEN'], [3, 'LEN DEV'], [4, 'DELAY'], [5, 'DELAY DEV'],
        [6, 'DIRECTION'], [7, 'REPEAT PROB'], [8, 'VOL MIN'], [9, 'VOL DEV'], [10, 'PAN'], [12, 'ATTACK'],
        [13, 'LOOP SELECT'], [14, 'N GRAINS'], [16, 'LOOP PITCH CV'], [17, 'GRAIN PITCH CV'], [18, 'QUANTIZE'],
        [19, 'DECAY'], [20, 'GRAIN PITCH'], [21, 'LOOP PITCH'], [27, 'REC PROB'], [28, 'REC DELAY'], [29, 'REC DELAY DEV'],
    ];
    // vols_in_presets bits
    const VOL_BITS = { vol_in: 0, vol_loop: 1, vol_grains: 2, overdub_decay: 3, feedback: 4 };

    // Field types:
    //  enum   - value is one of options[].v (numbers compared with tolerance for floats)
    //  range  - number in [min, max] snapped to step (percent: shown as 0-100 %)
    //  bits   - bitmask field, edited one bit at a time (bits: [[bit, label]]), other bits are preserved
    //  pitch  - pitch ratio, edited in semitones
    // fmt: how the firmware writes the value ('int', or number of decimals)

    // ---------- options (SETTINGS.CFG; the non bank-wide ones are also in every preset) ----------
    const SECTIONS = [
        {
            id: 'rec', title: 'Rec settings', fields: [
                { key: 'stereo', label: 'MONO/STEREO', type: 'enum', options: opts([[0, 'MONO'], [1, 'STEREO']]), def: 1, fmt: 'int' },
                { key: 'samplerate', label: 'SAMPLERATE', type: 'enum', options: opts([[8000, '8000'], [11025, '11025'], [16000, '16000'], [22050, '22050'], [32000, '32000'], [44100, '44100'], [48000, '48000'], [96000, '96000']]), def: 44100, fmt: 'int' },
                { key: 'bit_depth', label: 'BIT DEPTH', type: 'enum', options: opts([[1, '8 BIT'], [2, '16 BIT'], [4, '24 BIT']]), def: 4, fmt: 'int' },
                { key: 'antialiasing', label: 'ANTI-ALIASING', type: 'enum', options: ON_OFF, def: 1, fmt: 'int' },
                { key: 'overdub_origin', label: 'OVERDUB ORIGIN', type: 'enum', options: opts([[0, 'PLAY HEAD'], [1, 'REC HEAD'], [2, 'BOTH']]), def: 0, fmt: 'int' },
                { key: 'resampling_pitch', label: 'RESAMPLING PITCH', type: 'enum', options: opts([[0, 'FIXED AT 0'], [1, 'FOLLOWS LOOP']]), def: 1, fmt: 'int' },
                { key: 'rec_dir_en', label: 'REC DIRECTION', type: 'enum', options: opts([[0, 'DISABLED'], [1, 'ENABLED']]), def: 1, fmt: 'int' },
                { key: 'rec_vol_pre_post', label: 'REC VOL PRE/POST', type: 'enum', options: opts([[0, 'POST'], [1, 'PRE']]), def: 1, fmt: 'int' },
            ],
        },
        {
            id: 'pitch', title: 'Pitch settings', fields: [
                { key: 'pitch_range_octaves', label: 'PITCH RANGE', type: 'enum', options: opts([[2.5, '-24 +36'], [1, '-12 +12'], [1 / 6, '-2 +2'], [-1, '-INF +24']]), def: 2.5, fmt: 3, tol: 0.01 },
                { key: 'pitch_zero_notch', label: 'PITCH 0 NOTCH', type: 'enum', options: ON_OFF, def: 1, fmt: 'int' },
                { key: 'pitch_direction_ctrl', label: 'PITCH DIR CTRL', type: 'enum', options: opts([[0, 'OFF'], [1, 'NARROW'], [2, 'WIDE']]), def: 0, fmt: 'int' },
                { key: 'pitch_mode', label: 'LOOP PITCH MODE', type: 'enum', options: opts([[0, 'SAMPLERATE'], [1, 'PITCH SHIFT'], [2, 'TIME STRETCH'], [3, 'PITCH/TIME SIM'], [4, 'PITCH AND TIME']]), def: 0, fmt: 'int' },
                { key: 'pitch_mode_grains', label: 'GRAIN PITCH MODE', type: 'enum', options: opts([[0, 'SAMPLERATE'], [1, 'PITCH SHIFT'], [2, 'TIME STRETCH']]), def: 0, fmt: 'int' },
                { key: 'pitch_buf_size', label: 'PITCH BUF SIZE', type: 'enum', options: opts([[800, 'SHORT'], [1200, 'MEDIUM'], [2000, 'LONG']]), def: 800, fmt: 'int' },
                { key: 'quant_mode', label: 'QUANTIZER', type: 'enum', options: opts([[0, 'BOTH'], [1, 'LOOPS ONLY'], [2, 'GRAINS ONLY']]), def: 0, fmt: 'int' },
                { key: 'scales_set', label: 'SCALES SET', type: 'enum', options: opts([[0, 'DEFAULT'], [1, 'CUSTOM']]), def: 0, fmt: 'int' },
            ],
        },
        {
            id: 'grains', title: 'Grains settings', fields: [
                { key: 'grains_samplerate_mode', label: 'GRAINS SAMPLERATE', type: 'enum', options: opts([[0, 'FULL'], [1, 'HALF'], [2, 'QUARTER']]), def: 0, fmt: 'int' },
                { key: 'keep_grain_pitch', label: 'GRAINS PITCH', type: 'enum', options: opts([[0, 'CHANGE'], [1, 'KEEP']]), def: 1, fmt: 'int' },
                { key: 'grain_trigger_mode', label: 'GRAINS TRIGGER', type: 'enum', options: ON_OFF, def: 0, fmt: 'int' },
                { key: 'grains_length_mode', label: 'GRAINS LENGTH', type: 'enum', options: opts([[0, 'DEFAULT'], [1, 'KEEP LENGTH']]), def: 0, fmt: 'int' },
                { key: 'grain_dev_mode', label: 'GRAINS DEVIATION', type: 'enum', options: opts([[0, 'RANDOM'], [1, 'SPREAD']]), def: 0, fmt: 'int' },
                { key: 'grain_pan_mode', label: 'GRAINS PAN MODE', type: 'enum', options: opts([[0, 'FIXED'], [1, 'TRAVEL']]), def: 0, fmt: 'int' },
                { key: 'pos_follow_loop', label: 'POS FOLLOWS LOOP', type: 'enum', options: ON_OFF, def: 0, fmt: 'int' },
                // any other value is "LOOP SIZE" (the loop length in ms at the time it was set): kept as is
                { key: 'max_grain_delay', label: 'MAX GRAIN DELAY', type: 'enum', options: opts([[5000, '5 SECS'], [30000, '30 SECS']]), otherLabel: (v) => `LOOP SIZE (${(v / 1000).toFixed(1)} s)`, def: 5000, fmt: 'int' },
                { key: 'grain_delay_mode', label: 'GRAIN DELAY MODE', type: 'enum', options: opts([[0, 'PER GRAIN'], [1, 'ABSOLUTE']]), def: 0, fmt: 'int' },
                { key: 'grain_pos_mode', label: 'GRAIN POS MODE', type: 'enum', options: opts([[0, 'WINDOW'], [1, 'FIXED START']]), def: 0, fmt: 'int' },
            ],
        },
        {
            id: 'other', title: 'Other settings', fields: [
                { key: 'clocked_mode', label: 'CLOCKED MODE', type: 'enum', options: ON_OFF, def: 0, fmt: 'int' },
                { key: 'pause_mode', label: 'PAUSE MODE', type: 'enum', options: opts([[0, 'TOGGLE'], [1, 'MOMENTARY']]), def: 0, fmt: 'int' },
                { key: 'trigger_size_ms', label: 'TRIGGERS SIZE', type: 'enum', options: opts([[1, '1 ms'], [10, '10 ms'], [100, '100 ms'], [500, '500 ms']]), def: 10, fmt: 'int' },
                { key: 'special_functions', label: 'SPECIAL FUNCTIONS', type: 'bits', bits: [[SF_KILL, 'KILL ALL GRAINS'], [SF_DUPLICATE, 'DUPLICATE'], [SF_NORMALIZE, 'NORMALIZE']], def: 0xE7, fmt: 'int' },
                { key: '@autorec', label: 'AUTOREC', type: 'enum', virtual: true, options: opts([[0, 'OFF'], [1, 'NEW REC'], [2, 'REC'], [3, 'BOTH']]) },
                { key: 'autorec_threshold_db', label: 'AUTOREC THRES', type: 'range', min: -54, max: 0, step: 1, unit: 'dB', def: -18, fmt: 1 },
                { key: 'edit_with_pots', label: 'EDIT WITH POTS', type: 'enum', options: opts([[0, 'OFF'], [1, 'POS/SIZE'], [2, 'START/END']]), def: 0, fmt: 'int' },
            ],
        },
        {
            id: 'grid', title: 'Time grid & triggers', fields: [
                { key: 'time_grid_divisions', label: 'TIME GRID', type: 'range', min: 0, max: 32, step: 1, zeroLabel: 'OFF', def: 0, fmt: 'int' },
                { key: 'grid_pitch_sh_mode', label: 'GRID PITCH S&H', type: 'enum', options: opts([[0, 'OFF'], [1, 'LOOP'], [2, 'GRAIN'], [3, 'BOTH']]), def: 0, fmt: 'int' },
                { key: 'loop_cycle_mode', label: 'LOOP CYCLE', type: 'enum', options: ON_OFF, def: 0, fmt: 'int' },
                { key: 'env_trigger_mode', label: 'ENV TRIGGER', type: 'enum', options: ON_OFF, def: 0, fmt: 'int' },
                { key: 'env_trigger_threshold_db', label: 'ENV THRESHOLD', type: 'range', min: -54, max: 0, step: 1, unit: 'dB', def: -18, fmt: 1 },
                { key: 'env_trigger_probability', label: 'ENV PROBABILITY', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 100, fmt: 'int' },
                { key: 'env_trigger_response_ms', label: 'ENV SPEED', type: 'range', min: 0, max: 10, step: 0.5, unit: 'ms', zeroLabel: 'INSTANT', def: 5, fmt: 1 },
            ],
        },
        {
            id: 'motor', title: 'Pitch motor', fields: [
                { key: 'pitch_motor_mode', label: 'PITCH MOTOR', type: 'enum', options: opts([[0, 'OFF'], [1, 'LOOP ONLY'], [2, 'GRAINS ONLY'], [3, 'LOOP AND GRAINS']]), def: 0, fmt: 'int' },
                { key: 'pitch_motor_acceleration', label: 'ACCEL UP', type: 'range', min: 0, max: 100, step: 1, def: 20, fmt: 'int' },
                { key: 'pitch_motor_decceleration', label: 'ACCEL DOWN', type: 'range', min: 0, max: 100, step: 1, def: 10, fmt: 'int' },
                { key: 'pitch_motor_start_stop', label: 'START/STOP', type: 'enum', options: ON_OFF, def: 0, fmt: 'int' },
            ],
        },
        {
            id: 'presets', title: 'Presets', bankWide: true, fields: [
                { key: 'vols_in_presets', label: 'VOLS IN PRESETS', type: 'bits', bits: [[0, 'DRY'], [1, 'LOOP'], [2, 'GRAINS'], [3, 'OVERDUB'], [4, 'FEEDBACK']], def: 0, fmt: 'int' },
                { key: 'preset_override', label: 'PRESETS OVERRIDE', type: 'bits', bits: OVERRIDE_POTS, def: 0, fmt: 'int' },
            ],
        },
        {
            id: 'scc', title: 'Sidechain compressor', bankWide: true, fields: [
                { key: 'scc_state', label: 'STATE', type: 'enum', options: opts([[0, 'OFF'], [1, 'GRAINS'], [2, 'LOOP'], [3, 'BOTH']]), def: 0, fmt: 'int' },
                { key: 'scc_attack', label: 'ATTACK', type: 'range', min: 0.001, max: 10, step: 0.001, unit: 's', def: 0.3, fmt: 3 },
                { key: 'scc_release', label: 'RELEASE', type: 'range', min: 0.001, max: 10, step: 0.001, unit: 's', def: 0.3, fmt: 3 },
                { key: 'scc_ratio', label: 'RATIO', type: 'range', min: 1, max: 40, step: 0.5, unit: ':1', def: 8, fmt: 1 },
                { key: 'scc_threshold', label: 'THRESHOLD', type: 'range', min: -80, max: 0, step: 0.5, unit: 'dB', def: -30, fmt: 1 },
                { key: 'scc_makeup_gain', label: 'MAKEUP GAIN', type: 'range', min: 0, max: 80, step: 0.5, unit: 'dB', auto: -1, def: 3, fmt: 1 },
            ],
        },
        {
            id: 'compin', title: 'Input compressor', bankWide: true, fields: [
                { key: 'compressor_input_state', label: 'STATE', type: 'enum', options: ON_OFF, def: 0, fmt: 'int' },
                { key: 'compressor_input_attack', label: 'ATTACK', type: 'range', min: 0.001, max: 10, step: 0.001, unit: 's', def: 0.3, fmt: 3 },
                { key: 'compressor_input_release', label: 'RELEASE', type: 'range', min: 0.001, max: 10, step: 0.001, unit: 's', def: 0.3, fmt: 3 },
                { key: 'compressor_input_ratio', label: 'RATIO', type: 'range', min: 1, max: 40, step: 0.5, unit: ':1', def: 8, fmt: 1 },
                { key: 'compressor_input_threshold', label: 'THRESHOLD', type: 'range', min: -80, max: 0, step: 0.5, unit: 'dB', def: -30, fmt: 1 },
                { key: 'compressor_input_makeup_gain', label: 'MAKEUP GAIN', type: 'range', min: 0, max: 80, step: 0.5, unit: 'dB', auto: -1, def: 3, fmt: 1 },
            ],
        },
        {
            id: 'display', title: 'Display', bankWide: true, fields: [
                { key: '@screensaver', label: 'SCREENSAVER', type: 'enum', virtual: true, options: opts([[0, 'OFF'], [10, '10 SECS'], [60, '1 MIN'], [120, '2 MIN'], [300, '5 MIN']]) },
            ],
        },
    ];

    // ---------- preset-only values (knobs, switches, loops), in the order the firmware writes them ----------
    const PRESET_SECTIONS = [
        {
            id: 'p-grains', title: 'Grains', fields: [
                knob('pos', 'POSITION', 0),
                knob('pos_dev', 'POSITION DEV', 0),
                Object.assign(knob('length', 'SIZE', 0.5)),
                knob('length_dev', 'SIZE DEV', 0),
                { key: 'delay', label: 'DELAY', type: 'range', min: 0, max: 30000, step: 1, unit: 'ms', def: 0, fmt: 'int' },
                knob('delay_dev', 'DELAY DEV', 0),
                { key: 'n_grains', label: 'N GRAINS', type: 'range', min: 0, max: 78, step: 1, def: 0, fmt: 'int' },
                knob('direction', 'DIRECTION', 1),
                { key: 'repeat_mode', label: 'REPEAT MODE', type: 'enum', options: opts([[0, 'PROBABILITY'], [1, 'N TIMES']]), def: 0, fmt: 'int' },
                knob('repeats', 'REPEAT', 0),
                knob('attack', 'ATTACK', 1),
                knob('decay', 'DECAY', 1),
                knob('vol_min', 'VOL MIN', 1),
                knob('vol_dev', 'VOL DEV', 1),
                knob('grain_pan', 'PAN', 0.5),
            ],
        },
        {
            id: 'p-pitch', title: 'Pitch', fields: [
                { key: 'loop_pitch', label: 'LOOP PITCH', type: 'pitch', def: 1, fmt: 3 },
                { key: 'grain_pitch', label: 'GRAIN PITCH', type: 'pitch', def: 1, fmt: 3 },
                // labels of 1-7 come from the bank's SCALES.CFG (see Preset.quantizerOptions)
                { key: 'quantizer', label: 'QUANTIZE', type: 'enum', options: opts([[0, 'OFF'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7']]), def: 0, fmt: 'int' },
            ],
        },
        {
            id: 'p-rec', title: 'Rec', fields: [
                knob('rec_prob', 'REC PROB', 1),
                knob('rec_delay', 'REC DELAY', 0),
                knob('rec_delay_dev', 'REC DELAY DEV', 0),
                { key: 'rec_mode', label: 'AFTER REC', type: 'enum', options: opts([[0, 'REC'], [1, 'PLAY'], [2, 'STOP']]), def: 0, fmt: 'int' },
                { key: 'rec_sync', label: 'REC FROM PLAY HEAD', type: 'enum', options: ON_OFF, def: 0, fmt: 'int' },
            ],
        },
        {
            id: 'p-loop', title: 'Loop', fields: [
                { key: 'loop_play_mode', label: 'PLAY FROM', type: 'enum', options: opts([[0, 'START'], [1, 'LAST POSITION']]), def: 0, fmt: 'int' },
                { key: 'pause_retrigger', label: 'RETRIGGER', type: 'enum', options: opts([[0, 'PLAY FROM START'], [2, 'PAUSE']]), def: 0, fmt: 'int' },
                { key: 'on_loop_change_mode', label: 'LOOP CHANGE', type: 'enum', options: opts([[0, 'IMMEDIATE'], [1, 'AT LOOP END']]), def: 1, fmt: 'int' },
                { key: 'loop_direction', label: 'DIRECTION', type: 'enum', options: opts([[1, 'FORWARD'], [-1, 'REVERSE']]), def: 1, fmt: 'int' },
            ],
        },
        {
            id: 'p-vols', title: 'Volumes', fields: [
                knob('vol_in', 'DRY', 0.75),
                knob('vol_loop', 'LOOP', 0.75),
                knob('vol_grains', 'GRAINS', 0.75),
                knob('overdub_decay', 'OVERDUB', 1),
                knob('feedback', 'FEEDBACK', 0),
            ],
        },
    ];
    // stored but not shown: kept as read (pos_quant follows the quantize switch; selected_loop is edited with the loop list)
    const PRESET_HIDDEN = [
        { key: 'pos_quant', def: 0, fmt: 'int' },
        { key: 'selected_loop', def: 0, fmt: 'int' },
    ];
    const SETTINGS_HIDDEN = [
        { key: 'screensaver_mode', def: 1, fmt: 'int' },
        { key: 'screensaver_wait_time', def: 300, fmt: 'int' },
    ];

    const FIELDS = {};
    for (const s of SECTIONS.concat(PRESET_SECTIONS)) for (const f of s.fields) { f.section = s.id; FIELDS[f.key] = f; }
    for (const f of SETTINGS_HIDDEN.concat(PRESET_HIDDEN)) FIELDS[f.key] = Object.assign({ hidden: true }, f);

    const storedKeys = (sections) => sections.flatMap((s) => s.fields).filter((f) => !f.virtual).map((f) => f.key);
    const BANK_WIDE_KEYS = storedKeys(SECTIONS.filter((s) => s.bankWide)).concat(SETTINGS_HIDDEN.map((f) => f.key));
    const OPTION_KEYS = storedKeys(SECTIONS.filter((s) => !s.bankWide));
    const SETTINGS_KEYS = OPTION_KEYS.concat(BANK_WIDE_KEYS);
    const PRESET_ONLY_KEYS = storedKeys(PRESET_SECTIONS).concat(PRESET_HIDDEN.map((f) => f.key));
    const PRESET_KEYS = PRESET_ONLY_KEYS.concat(OPTION_KEYS);
    const OPTION_SECTIONS = SECTIONS.filter((s) => !s.bankWide);

    // ---------- number helpers ----------
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    function snap(v, f) {
        const n = Math.round((v - f.min) / f.step);
        return parseFloat((f.min + n * f.step).toFixed(6));
    }
    function formatValue(f, v) {
        if (f.fmt === 'int') return String(Math.round(v));
        // keep the sign: the firmware's %d.%03d lost it once (#750)
        return Number(v).toFixed(f.fmt).replace(/^-(0\.0*)$/, '$1');
    }
    function enumMatch(f, v) {
        const tol = f.tol || 1e-9;
        return f.options.find((o) => Math.abs(o.v - v) < tol);
    }
    function parseValue(f, s) {
        return f.fmt === 'int' ? parseInt10(s) : parseFloatFw(s);
    }

    // port of Preset::set_max_grains()
    function maxGrains(samplerate, grainsSamplerateMode, pitchModeGrains) {
        const table = { 8000: 78, 11025: 60, 16000: 40, 22050: 30, 32000: 18, 44100: 12, 48000: 9, 96000: 3 };
        let m = table[samplerate] !== undefined ? table[samplerate] : 10;
        if (grainsSamplerateMode === 1) m *= 2;
        if (grainsSamplerateMode === 2) m *= 4;
        if (pitchModeGrains !== 0) m = 2 /* N_PSHIFT_GRAIN */ + 1;
        return m;
    }

    // ---------- a key=value file with a schema ----------
    class Record {
        constructor(text, keys) {
            this.keys = keys;
            this.kv = new KvDoc(text);
            this.values = {};
            this.missing = new Set();
            for (const k of keys) {
                const s = this.kv.get(k);
                if (s === undefined) { this.values[k] = FIELDS[k].def; this.missing.add(k); } else this.values[k] = parseValue(FIELDS[k], s);
            }
            this.notes = this.sanitize();
        }

        has(key) { return key in this.values || (key === '@autorec' && 'special_functions' in this.values) || (key === '@screensaver' && 'screensaver_mode' in this.values); }

        get(key) {
            if (key === '@autorec') {
                const sf = this.values.special_functions;
                return ((sf >> SF_AUTO_NEW_REC) & 1) | (((sf >> SF_AUTO_REC) & 1) << 1);
            }
            if (key === '@screensaver') return this.values.screensaver_mode === 0 ? 0 : this.values.screensaver_wait_time;
            return this.values[key];
        }

        // returns notes for other values changed by the firmware rules
        set(key, value) {
            const v = this.values;
            const notes = [];
            if (key === '@autorec') {
                v.special_functions = (v.special_functions & ~SF_AUTOREC_MASK) | ((value & 1) << SF_AUTO_NEW_REC) | (((value >> 1) & 1) << SF_AUTO_REC);
                if (value !== 0 && v.clocked_mode) { v.clocked_mode = 0; notes.push('CLOCKED MODE turned OFF (not available with AUTOREC)'); }
                return notes;
            }
            if (key === '@screensaver') {
                if (value === 0) v.screensaver_mode = 0; else { v.screensaver_mode = 1; v.screensaver_wait_time = value; }
                return notes;
            }
            const f = FIELDS[key];
            if (f.type === 'range' && !(f.auto !== undefined && value === f.auto)) value = snap(clamp(value, f.min, this.max(key)), f);
            if (f.type === 'pitch') value = clamp(value, 1 / 16, 16);
            v[key] = value;

            // same rules as Preset::set_clocked_mode(), set_auto_*_enabled(), set_time_grid_divisions(), set_pitch_motor_mode()
            if (key === 'clocked_mode' && value) {
                if (v.special_functions & SF_AUTOREC_MASK) { v.special_functions &= ~SF_AUTOREC_MASK; notes.push('AUTOREC turned OFF (not available with CLOCKED MODE)'); }
                if (v.time_grid_divisions) { v.time_grid_divisions = 0; notes.push('TIME GRID turned OFF (not available with CLOCKED MODE)'); }
            }
            if (key === 'time_grid_divisions' && value > 0 && v.clocked_mode) { v.clocked_mode = 0; notes.push('CLOCKED MODE turned OFF (not available with TIME GRID)'); }
            if (key === 'pitch_motor_mode') notes.push(...applyPitchMotor(v));
            notes.push(...this.applyLimits());
            return notes;
        }

        // upper limit that depends on other values
        max(key) { return FIELDS[key].max; }
        applyLimits() { return []; }

        // fields locked by another setting: key -> reason
        locks() {
            const l = {};
            if (this.values.pitch_motor_mode) {
                const why = 'Set by PITCH MOTOR';
                l.pitch_mode = why; l.overdub_origin = why; l.resampling_pitch = why;
            }
            return l;
        }

        // bring loaded values into what the firmware accepts (same as Preset::sanitize_())
        sanitize() {
            const v = this.values;
            const notes = [];
            for (const k of this.keys) {
                const f = FIELDS[k];
                const before = v[k];
                if (f.type === 'enum' && !enumMatch(f, before) && !f.otherLabel) {
                    v[k] = f.def;
                } else if (f.type === 'enum' && f.tol) {
                    v[k] = enumMatch(f, before).v; // e.g. 0.167 -> 1/6
                    continue;
                } else if (f.type === 'range') {
                    if (f.auto !== undefined && before < 0) { v[k] = f.auto; continue; }
                    v[k] = clamp(before, f.min, f.max);
                } else if (f.type === 'pitch') {
                    if (!(before > 0)) v[k] = 1;
                } else if (k === 'max_grain_delay' && !(before > 0)) {
                    v[k] = f.def;
                }
                if (v[k] !== before) notes.push(`${f.label || k}: ${before} is not a valid value, using ${v[k]}`);
            }
            notes.push(...applyPitchMotor(v));
            notes.push(...this.applyLimits());
            return notes;
        }

        valueMap() {
            const m = new Map();
            for (const k of this.keys) m.set(k, formatValue(FIELDS[k], this.values[k]));
            return m;
        }

        serialize() { return this.kv.serialize(this.valueMap()); }
    }

    function applyPitchMotor(v) {
        const notes = [];
        if (!v.pitch_motor_mode) return notes;
        if (v.pitch_mode !== 0) { v.pitch_mode = 0; notes.push('LOOP PITCH MODE set to SAMPLERATE (required by PITCH MOTOR)'); }
        if (v.overdub_origin !== 1) { v.overdub_origin = 1; notes.push('OVERDUB ORIGIN set to REC HEAD (required by PITCH MOTOR)'); }
        if (v.resampling_pitch !== 0) { v.resampling_pitch = 0; notes.push('RESAMPLING PITCH set to FIXED AT 0 (required by PITCH MOTOR)'); }
        return notes;
    }

    // ---------- SETTINGS.CFG ----------
    class Settings extends Record {
        constructor(text) { super(text, SETTINGS_KEYS); }
    }

    // ---------- <id>.CFG ----------
    const LOOP_LIST_RE = /^\{([^}]*)\}?/;
    class Preset extends Record {
        constructor(text, id) {
            super(text, PRESET_KEYS);
            this.id = id;
            const ll = this.kv.get('loop_list');
            this.loopList = [];
            if (ll !== undefined) {
                const m = LOOP_LIST_RE.exec(ll);
                if (m) for (const s of m[1].split(',')) if (s.trim() !== '') this.loopList.push(parseInt10(s));
            }
            const n = this.loopList.length;
            if (this.values.selected_loop >= n) {
                this.notes.push(`SELECTED LOOP ${this.values.selected_loop} is past the end of the loop list, using the first loop`);
                this.values.selected_loop = 0;
            }
        }

        // N GRAINS can't exceed what the samplerate / grain modes allow (Preset::set_max_grains())
        max(key) {
            if (key === 'n_grains') return maxGrains(this.values.samplerate, this.values.grains_samplerate_mode, this.values.pitch_mode_grains);
            if (key === 'delay') return this.values.max_grain_delay;
            return FIELDS[key].max;
        }

        applyLimits() {
            const notes = [];
            if (!this.values || this.values.n_grains === undefined) return notes;
            const m = this.max('n_grains');
            if (this.values.n_grains > m) { notes.push(`N GRAINS lowered to ${m} (the most this samplerate / grain pitch mode allows)`); this.values.n_grains = m; }
            const d = this.max('delay');
            if (this.values.delay > d) { notes.push(`DELAY lowered to ${d} ms (MAX GRAIN DELAY)`); this.values.delay = d; }
            return notes;
        }

        setLoopList(ids, selected) {
            this.loopList = ids.slice();
            this.values.selected_loop = this.loopList.length ? clamp(selected, 0, this.loopList.length - 1) : 0;
        }

        valueMap() {
            const m = super.valueMap();
            m.set('loop_list', `{${this.loopList.map((id) => `${id},`).join('')}}`);
            return m;
        }

        // a new preset: the bank's options (SETTINGS.CFG) with default knob values and the given loops
        static fromSettings(settings, id, loopIds) {
            const p = new Preset('', id);
            for (const k of OPTION_KEYS) p.values[k] = settings.values[k];
            p.notes = [];
            p.applyLimits();
            p.setLoopList(loopIds || [], 0);
            return p;
        }
    }

    // ---------- GLOBAL.CFG ----------
    const GLOBAL_FIELDS = [
        { key: 'out_gain_l', label: 'OUT GAIN LEFT', def: 1, fmt: 4 },
        { key: 'out_gain_r', label: 'OUT GAIN RIGHT', def: 1, fmt: 4 },
    ];
    const GAIN_MAX = 1.5; // menu: 0-300 / 200
    class GlobalCfg {
        constructor(text) {
            this.kv = new KvDoc(text);
            this.bank = (this.kv.get('bank') || '').trim();
            this.gains = {};
            this.notes = [];
            for (const f of GLOBAL_FIELDS) {
                const s = this.kv.get(f.key);
                let g = s === undefined ? f.def : parseFloatFw(s);
                if (g < 0 || g > GAIN_MAX) { this.notes.push(`${f.label}: ${g} is outside 0-${GAIN_MAX}, the module uses 1.0`); g = 1; }
                this.gains[f.key] = g;
            }
        }
        setGain(key, g) { this.gains[key] = Math.round(clamp(g, 0, GAIN_MAX) * 200) / 200; }
        serialize() {
            const m = new Map([['bank', this.bank]]);
            for (const f of GLOBAL_FIELDS) m.set(f.key, formatValue(f, this.gains[f.key]));
            return this.kv.serialize(m);
        }
    }

    function optionLabel(f, v) {
        if (f.type !== 'enum') return String(v);
        const o = enumMatch(f, v);
        if (o) return o.label;
        return f.otherLabel ? f.otherLabel(v) : String(v);
    }

    const api = {
        SECTIONS, PRESET_SECTIONS, OPTION_SECTIONS, FIELDS, VOL_BITS, GLOBAL_FIELDS, GAIN_MAX,
        SETTINGS_KEYS, PRESET_KEYS, PRESET_ONLY_KEYS, OPTION_KEYS, BANK_WIDE_KEYS,
        Settings, Preset, GlobalCfg, maxGrains, optionLabel, formatValue, enumMatch,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Cfg112 = api;
})(typeof window !== 'undefined' ? window : globalThis);
