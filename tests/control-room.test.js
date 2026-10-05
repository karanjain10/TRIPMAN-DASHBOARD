// Run: node tests/control-room.test.js
// Pulls the pure Control room functions out of index.html (between the ctl:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ ctl:pure:start([\s\S]*?)\/\/ ctl:pure:end/);
assert(m, 'ctl:pure markers not found in index.html');
const { silentLevel, ctlAlerts, ctlCurves, ctlAt, ctlFinish, ctlPaceState, fuelRisk } =
  new Function(m[1] + '; return { silentLevel, ctlAlerts, ctlCurves, ctlAt, ctlFinish, ctlPaceState, fuelRisk };')();

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
// ── refuel-first ──
const H = 3600e3, NOW = 1e12;
const { ctlTs, fuelHmrAt } = new Function(m[1] + '; return { ctlTs, fuelHmrAt };')();
// Shift-reading times are UTC without a Z; a string that has an offset is left alone.
assert.strictEqual(ctlTs('2026-07-06T08:53:47', true), Date.UTC(2026, 6, 6, 8, 53, 47));
assert.strictEqual(ctlTs('2026-07-06T08:53:47+05:30', true), Date.UTC(2026, 6, 6, 3, 23, 47));
assert(Number.isNaN(ctlTs('', true)));
// Meter between two readings is a straight line; after the last one it runs on at the machine's own rate (default 0.8 h per hour).
const pt = (hAgo, v) => ({ ts: NOW - hAgo * H, v });
assert.strictEqual(fuelHmrAt([pt(4, 100), pt(0, 104)], NOW - 2 * H), 102);
assert.strictEqual(fuelHmrAt([pt(2, 100)], NOW), 100 + 0.8 * 2);
assert.strictEqual(fuelHmrAt([pt(9, 100)], NOW), null);                                   // reading older than 8 h: no projection
assert.strictEqual(fuelHmrAt([pt(20, 100), pt(0, 110)], NOW - 10 * H), null);             // two readings 20 h apart: not a straight line
assert.strictEqual(fuelHmrAt([pt(2, 100)], NOW - 3 * H), null);                          // before the first reading
// ten readings 4 h apart that each moved 2 h = the machine runs half the clock: projection uses 0.5
const slow = Array.from({ length: 8 }, (_, i) => pt(28 - i * 4, 100 + i * 2)); // last point 0 h ago
assert.strictEqual(fuelHmrAt(slow, NOW + 3 * H), 114 + 1.5);

// 705 L excavator burning 30 L/h, a fill every 10 h (300 L each). hmr, litres, one fill per row.
const fills = (id, rows, type = 'excavator') => rows.map(([hmr, litres], i) => ({ id, type, hmr, litres, ts: NOW - 100 * H + i * H }));
const steady = id => fills(id, [[100, 300], [110, 300], [120, 300], [130, 300], [140, 300]]);
const tk = (...ids) => Object.fromEntries(ids.map(id => [id, { tank: 705, name: id }]));
const at = (id, v, hAgo = 0) => ({ [id]: [pt(hAgo + 5, v - 1), pt(hAgo, v)] });           // meter read hAgo ago
const risk = (o) => fuelRisk({ shiftHrs: {}, now: NOW, ...o });
// 10 h after the last fill: 705 - 10 x 30 = 405 L = 13.5 h left, next shift needs 8 h x 1.2: not flagged
let f = risk({ logs: steady('A'), tanks: tk('A'), readings: at('A', 150), shiftHrs: { A: 8 } });
assert.strictEqual(f.length, 0);
// 9 h after, but the next shift is 20 h long (x 1.2 = 24 h needed): 435 L = 14.5 h left, flagged
f = risk({ logs: steady('A'), tanks: tk('A'), readings: at('A', 149), shiftHrs: { A: 20 } });
assert.strictEqual(f.length, 1); assert(Math.abs(f[0].hoursLeft - (705 - 9 * 30) / 30) < 1e-6); assert.strictEqual(f[0].stale, false); assert.strictEqual(f[0].est, false);
// ranking: least hours left first
f = risk({ logs: [...steady('A'), ...steady('B')], tanks: tk('A', 'B'), readings: { ...at('A', 145), ...at('B', 149) }, shiftHrs: { A: 20, B: 20 } });
assert.deepStrictEqual(f.map(x => x.id), ['B', 'A']);
// more than ever run between fills (gap was 10 h, now 12 h): flagged as stale even though the fuel math looks fine
f = risk({ logs: steady('A'), tanks: tk('A'), readings: at('A', 152), shiftHrs: { A: 4 } });
assert.strictEqual(f.length, 1); assert.strictEqual(f[0].stale, true);
// fewer than 3 usable fills, no reading, or the meter behind the last fill: not shown
assert.strictEqual(risk({ logs: fills('A', [[100, 300], [110, 300], [120, 300]]), tanks: tk('A'), readings: at('A', 149), shiftHrs: { A: 20 } }).length, 0);
assert.strictEqual(risk({ logs: steady('A'), tanks: tk('A'), readings: {}, shiftHrs: { A: 20 } }).length, 0);
assert.deepStrictEqual(risk({ logs: steady('A'), tanks: tk('A'), readings: at('A', 149, 9), shiftHrs: { A: 20 } }).noMeter, ['A']); // last reading 9 h ago: named, not silently dropped
assert.strictEqual(risk({ logs: steady('A'), tanks: tk('A'), readings: at('A', 139), shiftHrs: { A: 20 } }).length, 0);
// tippers and machines without a tank size are skipped
assert.strictEqual(risk({ logs: fills('A', steady('A').map(l => [l.hmr, l.litres]), 'tipper'), tanks: tk('A'), readings: at('A', 149), shiftHrs: { A: 20 } }).length, 0);
assert.strictEqual(risk({ logs: steady('A'), tanks: {}, readings: at('A', 149), shiftHrs: { A: 20 } }).length, 0);
// bad entries: a 5,208 L typo and a 0.1 L test entry never become a fill or a rate
f = risk({ logs: fills('A', [[100, 300], [110, 300], [120, 300], [130, 300], [140, 300], [141, 0.1], [142, 5208]]), tanks: tk('A'), readings: at('A', 149), shiftHrs: { A: 20 } });
assert.strictEqual(f.length, 1); assert(Math.abs(f[0].hoursLeft - 14.5) < 1e-6);        // still measured from the hmr-140 fill at 30 L/h
// a partial top-up (150 L after 1.2 h = 125 L/h) is four times the type's rate and is ignored, not averaged in
const peer = steady('P'), mix = fills('A', [[100, 300], [110, 300], [120, 300], [130, 300], [140, 300], [141.2, 150]]);
f = risk({ logs: [...peer, ...mix], tanks: tk('A', 'P'), readings: { ...at('A', 150), ...at('P', 140) }, shiftHrs: { A: 20, P: 1 } });
assert.strictEqual(f.length, 1); assert(Math.abs(f[0].hoursLeft - (705 - 8.8 * 30) / 30) < 1e-6);

// The shift readings count. Meter read 07:20 = 100; the fill was at 08:00 with no meter logged; now it is 11:20, the meter was last read at 07:20.
// Fill meter = 100 + 0.8 x 2/3 h; now = 100 + 0.8 x 4 h (3.2) -> 2.67 h since the fill, not 0 (a stale reading) and not unknown (a missing meter).
const noMeter = [...steady('A'), { id: 'A', type: 'excavator', hmr: NaN, litres: 300, ts: NOW - 4 * H + 40 * 60e3 }];  // fill 40 min after the reading
f = risk({ logs: noMeter, tanks: tk('A'), readings: { A: [pt(4, 100)] }, shiftHrs: { A: 30 } });
assert.strictEqual(f.length, 1); assert.strictEqual(f[0].est, true);
assert(Math.abs(f[0].since - (0.8 * 4 - 0.8 * 40 / 60)) < 1e-6);                          // 3.2 - 0.53 = 2.67 h
assert(Math.abs(f[0].seenAge - 4) < 1e-9);
// the same with a reading AFTER the fill: interpolated, not projected
f = risk({ logs: noMeter, tanks: tk('A'), readings: { A: [pt(4, 100), pt(0.5, 103.5)] }, shiftHrs: { A: 30 } });
assert(Math.abs(f[0].since - ((103.5 + 0.8 * 0.5) - (100 + 3.5 * (40 / 60) / 3.5))) < 1e-6); // 103.9 - 100.67, tolerance covers the rate default
// a meter read 3 h ago is projected forward: 3 h of clock = 2.4 h of meter, so it counts as less fuel left than the raw reading
const stale3 = risk({ logs: steady('A'), tanks: tk('A'), readings: { A: [pt(3, 145)] }, shiftHrs: { A: 20 } });
const fresh = risk({ logs: steady('A'), tanks: tk('A'), readings: { A: [pt(0, 145)] }, shiftHrs: { A: 20 } });
assert(stale3[0].hoursLeft < fresh[0].hoursLeft);
assert(Math.abs(stale3[0].since - 7.4) < 1e-9);
console.log('control-room: all checks passed');
