// key=value file text (SETTINGS.CFG, <id>.CFG, GLOBAL.CFG), as the firmware reads it: one "key=value"
// per line, the last occurrence of a key wins, anything else is ignored. Saving keeps every other line
// (unknown keys, legacy keys, blanks) where it was, so only edited values change.
(function (root) {
    'use strict';

    class KvDoc {
        constructor(text) {
            text = text || '';
            this.eol = text.includes('\r\n') ? '\r\n' : '\n';
            const raw = text.split(/\r?\n/);
            if (raw.length && raw[raw.length - 1] === '') raw.pop();
            this.lines = raw.map((line) => {
                const i = line.indexOf('=');
                return i > 0 ? { line, key: line.slice(0, i), value: line.slice(i + 1) } : { line };
            });
        }

        // raw string value of a key, or undefined
        get(key) {
            let v;
            for (const l of this.lines) if (l.key === key) v = l.value;
            return v;
        }

        // values: Map key -> string for the keys this caller manages. Managed keys are updated in place
        // (one line each), missing ones are appended in the map's order; other lines are kept as they are.
        serialize(values) {
            const out = [];
            const written = new Set();
            for (const l of this.lines) {
                if (l.key !== undefined && values.has(l.key)) {
                    if (written.has(l.key)) continue;
                    out.push(`${l.key}=${values.get(l.key)}`);
                    written.add(l.key);
                } else {
                    out.push(l.line);
                }
            }
            for (const [k, v] of values) if (!written.has(k)) out.push(`${k}=${v}`);
            return out.join(this.eol) + this.eol;
        }
    }

    // firmware parsers: atoi() for ints, str_to_float() for floats
    function parseInt10(s) {
        const m = /^\s*[-+]?\d+/.exec(s || '');
        return m ? parseInt(m[0], 10) : 0;
    }
    function parseFloatFw(s) {
        const m = /^\s*-?\d*\.?\d*/.exec(s || '');
        const n = m ? parseFloat(m[0]) : NaN;
        return isNaN(n) ? 0 : n;
    }

    const api = { KvDoc, parseInt10, parseFloatFw };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Kv112 = api;
})(typeof window !== 'undefined' ? window : globalThis);
