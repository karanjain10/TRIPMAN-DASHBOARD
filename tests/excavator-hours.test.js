// Run: node tests/excavator-hours.test.js
// Excavator report hours come from shift readings (HMR closing - opening), never from machine sessions.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ ex:pure:start([\s\S]*?)\/\/ ex:pure:end/);
assert(m, 'ex:pure markers not found in index.html');
const { exShiftHours } = new Function(m[1] + '; return { exShiftHours };')();

const rd = (id, date, shift, o, c) => ({ vehicle_id: id, date, shift, equipment_type: 'excavator', readings: { HMR: { opening_value: o, closing_value: c } } });
const A = ['m1'];

// one closed reading = closing minus opening, keyed by date and shift
let h = exShiftHours([rd('m1', '2026-10-01', 'A', 1000, 1007.5)], A);
assert.deepStrictEqual(h['2026-10-01||A'], { date: '2026-10-01', shift: 'A', hours: 7.5, partial: false });

// two operators in one shift: 1000-1004 and 1004-1008 = 8 hours, not 4
h = exShiftHours([rd('m1', '2026-10-01', 'B', 1000, 1004), rd('m1', '2026-10-01', 'B', 1004, 1008)], A);
assert.strictEqual(h['2026-10-01||B'].hours, 8);

// the same shift entered twice (driver reading + admin correction) is not counted twice
h = exShiftHours([rd('m1', '2026-10-01', 'C', 1000, 1006), rd('m1', '2026-10-01', 'C', 1000, 1006)], A);
assert.strictEqual(h['2026-10-01||C'].hours, 6);

// no closing value yet: flagged, adds nothing; a bad reading (closing < opening) is treated the same
h = exShiftHours([rd('m1', '2026-10-02', 'A', 1010, null), rd('m1', '2026-10-02', 'B', 1010, 1005)], A);
assert.deepStrictEqual([h['2026-10-02||A'].hours, h['2026-10-02||A'].partial, h['2026-10-02||B'].partial], [0, true, true]);
// a closed reading beside an open one keeps its hours and is flagged
h = exShiftHours([rd('m1', '2026-10-03', 'A', 1000, 1004), rd('m1', '2026-10-03', 'A', 1004, '')], A);
assert.deepStrictEqual([h['2026-10-03||A'].hours, h['2026-10-03||A'].partial], [4, true]);

// other machines are ignored; the machine can be matched by any of its ids; shift case is normalised
h = exShiftHours([rd('m2', '2026-10-01', 'A', 0, 9), rd('abc', '2026-10-01', 'a', 50, 53)], ['m1', 'abc']);
assert.deepStrictEqual(Object.keys(h), ['2026-10-01||A']); assert.strictEqual(h['2026-10-01||A'].hours, 3);
assert.deepStrictEqual(exShiftHours(undefined, A), {});
console.log('excavator-hours: ok');
