// Run: node tests/control-room-breakdowns.test.js
// Pulls the breakdown strip rules (bk:pure) with the Maintenance rules they use (fleet:pure, mt:pure) out of index.html.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const block = n => { const m = html.match(new RegExp(`// ${n}:pure:start([\\s\\S]*?)// ${n}:pure:end`)); assert(m, `${n}:pure markers not found`); return m[1]; };
const { bkEvents } = new Function(block('fleet') + block('mt') + block('bk') + '; return { bkEvents };')();

const T = (h, m = 0) => new Date(2026, 9, 12, h, m).toISOString(); // 12 Oct 2026, local time; Shift B starts 14:00
const START = new Date(2026, 9, 12, 14, 0).getTime();
const log = (id, action, ts, extra) => ({ entity_id: id, action, timestamp: ts, performed_by_name: 'Ramesh', ...extra });
const tippers = { a: '52', b: '24', c: '33', d: '11', e: '07', f: '60', g: '18', h: '29' };
const exOf = id => ({ a: 'EX-01', b: 'EX-03', c: 'EX-03', d: 'EX-05' })[id] || '';
const run = (logs, lastTrip = {}) => bkEvents(logs, tippers, START, lastTrip, exOf);

const logs = [
  log('a', 'DEACTIVATED', T(14, 41), { reason: 'Tyre', notes: 'rear left', location: { latitude: 21.1, longitude: 79.1, accuracy: 12 } }), // down now, this shift
  log('b', 'DEACTIVATED', T(14, 2), { reason: 'Engine' }), log('b', 'ACTIVATED', T(15, 0)),                                    // down and back this shift
  log('c', 'DEACTIVATED', T(14, 20), { reason: 'Brake' }), log('c', 'ACTIVATED', T(14, 55)),                                  // back, then tripped
  log('d', 'DEACTIVATED', T(12, 43), { reason: 'Hose' }), log('d', 'ACTIVATED', T(14, 48), { performed_by_name: 'Suresh' }),  // down in A, back in B
  log('e', 'DEACTIVATED', T(9, 10), { reason: 'Hydraulic' }),                                                                 // still down from Shift A
  log('f', 'DEACTIVATED', T(14, 30), { reason: 'Others', notes: 'service due' }),                                             // off duty, not a breakdown
  log('x', 'DEACTIVATED', T(14, 30), { reason: 'Tyre' }),                                                                     // not a tipper
  log('g', 'DEACTIVATED', T(14, 5), { reason: 'Tyre' }), log('g', 'ACTIVATED', T(14, 10)), log('g', 'DEACTIVATED', T(15, 1), { reason: 'Engine' }), // down again
  log('h', 'DEACTIVATED', T(10, 0), { reason: 'Tyre' }), log('h', 'DEACTIVATED', T(14, 15), { reason: 'Brake' }), log('h', 'DEACTIVATED', T(14, 50), { reason: 'Engine' }),
];
const r = run(logs, { '33': new Date(2026, 9, 12, 15, 2).getTime(), '11': new Date(2026, 9, 12, 13, 0).getTime(), '24': new Date(2026, 9, 12, 14, 30).getTime() });
const ns = l => l.map(e => e.n);

// deactivated this shift, newest first: a 14:41, h 14:50 (latest of its in-shift reports), g 15:01 (down again), b, c
assert.deepStrictEqual(ns(r.dead), ['18', '29', '52', '33', '24']);
// ready: back this shift with no trip since. 33 tripped at 15:02 (after 14:55) so it leaves; 24 tripped at 14:30, BEFORE it was back, so it stays;
// 11 tripped at 13:00, before it was back; 18 is down again so it is not ready
assert.deepStrictEqual(ns(r.ready), ['24', '11']);
// never listed: still down from Shift A (07), off duty (60), not a tipper (x)
assert.ok(![...r.dead, ...r.ready].some(e => ['07', '60'].includes(e.n)));

const a = r.dead.find(e => e.n === '52');
assert.strictEqual(a.ex, 'EX-01'); assert.strictEqual(a.up, 0); assert.strictEqual(a.reason, 'Tyre'); assert.strictEqual(a.notes, 'rear left');
assert.deepStrictEqual(a.loc, { lat: 21.1, lng: 79.1, acc: 12 }); assert.strictEqual(a.shift, 'B'); assert.strictEqual(a.by, 'Ramesh');
const c = r.dead.find(e => e.n === '33');
assert.strictEqual(c.up > 0, true); assert.strictEqual(c.trip, new Date(2026, 9, 12, 15, 2).getTime());   // back and tripped: shown grey, not ready
const d = r.ready.find(e => e.n === '11');
assert.strictEqual(d.shift, 'A'); assert.strictEqual(d.upBy, 'Suresh'); assert.strictEqual(d.ex, 'EX-05'); assert.strictEqual(d.trip, 0);
assert.strictEqual(r.dead.find(e => e.n === '29').reason, 'Engine');                                        // the latest in-shift report
assert.strictEqual(r.dead.find(e => e.n === '29').rep, 3);                                                  // 3 breakdowns in 7 days
assert.strictEqual(r.dead.find(e => e.n === '18').up, 0);                                                   // down again after being ready
assert.strictEqual(r.ready.find(e => e.n === '24').ex, 'EX-03');

// handover window: Shift B is still on screen at 22:10, so 22:05 logs (Shift C) stay out of it
const END = new Date(2026, 9, 12, 22, 0).getTime();
const hand = bkEvents([
  log('a', 'DEACTIVATED', T(21, 50), { reason: 'Tyre' }),                                   // last minutes of B: stays
  log('b', 'DEACTIVATED', T(22, 5), { reason: 'Engine' }),                                  // Shift C: not in B
  log('c', 'DEACTIVATED', T(20, 0), { reason: 'Brake' }), log('c', 'ACTIVATED', T(22, 8)),  // back in C: not ready in B
], tippers, START, {}, exOf, END);
assert.deepStrictEqual(hand.dead.map(e => e.n).sort(), ['33', '52']); // 24 (22:05, Shift C) is left out
assert.deepStrictEqual(hand.ready, []);

// nothing at all
assert.deepStrictEqual(run([]), { dead: [], ready: [] });
console.log('control-room-breakdowns tests passed');
