// Run: node tests/control-room.test.js
// Pulls the pure Control room functions out of index.html (between the ctl:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ ctl:pure:start([\s\S]*?)\/\/ ctl:pure:end/);
assert(m, 'ctl:pure markers not found in index.html');
const { silentLevel, ctlAlerts, ctlCurves, ctlAt, ctlFinish, ctlPaceState } =
  new Function(m[1] + '; return { silentLevel, ctlAlerts, ctlCurves, ctlAt, ctlFinish, ctlPaceState };')();

// silence levels: 30 = warning, 45 = alert
assert.deepStrictEqual([29, 30, 44, 45].map(silentLevel), ['ok', 'warn', 'warn', 'alert']);

// grouping: 3+ silent AND 60%+ of the excavator's tippers => one "may have stopped" alert
const tp = mins => mins.map((min, i) => ({ n: String(i + 1), min }));
let a = ctlAlerts([{ id: 'EX-04', tippers: tp([52, 49, 47, 31, 6, 10]) }]);          // 4 of 6
assert.strictEqual(a.length, 1); assert.strictEqual(a[0].key, 'EX-04:alert'); assert.deepStrictEqual(a[0].tippers, ['1', '2', '3', '4']);
a = ctlAlerts([{ id: 'EX-01', tippers: tp([31, 32, 33, 5, 6]) }]);                    // 3 of 5 = 60%
assert.strictEqual(a.length, 1); assert.strictEqual(a[0].level, 'warn');
a = ctlAlerts([{ id: 'EX-02', tippers: tp([31, 32, 33, 5, 6, 7]) }]);                 // 3 of 6 = 50%
assert.strictEqual(a.length, 3); assert(a.every(x => x.tipper));
a = ctlAlerts([{ id: 'EX-03', tippers: tp([34, 5, 6]) }, { id: 'EX-05', tippers: tp([48, 38, 5, 9]) }]);
assert.deepStrictEqual(a.map(x => x.key), ['T1:alert', 'T2:warn', 'T1:warn']);       // alerts first, then longest silence

// usual curve: the weak day is dropped, only the last 8 normal days count, fewer than 3 gives null
const day = n => Array.from({ length: n }, (_, i) => i * (480 / n));
const days = {}; for (let d = 1; d <= 10; d++) days['2026-09-' + String(d).padStart(2, '0')] = day(400 + d);
days['2026-09-05'] = day(210);                                                          // weak day: under 60% of the median
let c = ctlCurves(days);
assert.strictEqual(c.days, 8);
assert.strictEqual(Math.round(c.usual[16]), 406);                                      // mean of totals 403..410 (days 3-10 minus the weak 5th)
assert(c.lo[16] <= c.usual[16]);
assert.strictEqual(ctlCurves({ a: day(400), b: day(410) }), null);

// interpolation, projection, state
const line = Array.from({ length: 17 }, (_, i) => i * 30);
assert(Math.abs(ctlAt(line, 250) - 250) < 1e-9); assert.strictEqual(ctlAt(line, -5), 0); assert.strictEqual(ctlAt(line, 999), 480);
assert.strictEqual(ctlFinish(173, 184.67, 436), 412);                                  // the mockup's worked example
assert.strictEqual(ctlFinish(0, 0, 436), 436);                                         // first minute: just the usual total
assert.strictEqual(ctlPaceState(100, 150, 120), 'bad');
assert.strictEqual(ctlPaceState(130, 150, 120), 'warn');
assert.strictEqual(ctlPaceState(150, 150, 120), 'ok');
console.log('control-room: all checks passed');
