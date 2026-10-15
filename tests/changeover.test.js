// Run: node tests/changeover.test.js
// Pulls the truck-by-truck rules (co:pure) out of index.html.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ co:pure:start([\s\S]*?)\/\/ co:pure:end/);
assert(m, 'co:pure markers not found');
const { coSegments } = new Function(m[1] + '; return { coSegments };')();

const at = (h, mi) => new Date(2026, 9, 15, h, mi).getTime();
const trip = (h, mi, vid, trk) => ({ drv: 'd1', shift: 'A', date: '2026-10-15', ms: at(h, mi), vid, trk });
// Hanuman, 15 Oct Shift A: three trips on truck 90, then seven on truck 29 (from the Driver trips list)
const trips = [
  trip(8, 23, 'v90', '90'), trip(8, 40, 'v90', '90'), trip(9, 0, 'v90', '90'),
  ...[[11, 38], [12, 5], [12, 22], [12, 43], [13, 2], [13, 36], [13, 50]].map(([h, mi]) => trip(h, mi, 'v29', '29')),
];
// the page today has only the truck 29 row, deployed 11:17
const rows = [{ drv: 'd1', shift: 'A', date: '2026-10-15', vid: 'v29', trk: '29', depMs: at(11, 17) }];
const logs = [
  { entity: 'v90', ms: at(9, 4), action: 'DEACTIVATED', reason: 'Engine', notes: 'no pickup' },
  { entity: 'v90', ms: at(7, 0), action: 'DEACTIVATED', reason: 'Tyre', notes: '' },          // before the trips: not the reason
  { entity: 'v29', ms: at(9, 4), action: 'DEACTIVATED', reason: 'Brake', notes: '' },          // another truck
];
const [G] = coSegments(trips, rows, logs);

assert.strictEqual(G.multi, true);
assert.deepStrictEqual(G.segs.map(s => [s.trk, s.n, s.covered]), [['90', 3, false], ['29', 7, true]]); // 90 has no row, 29 does
assert.strictEqual(G.n, 10);
assert.strictEqual(Math.round((G.last - G.first) / 60000), 327);   // worked 08:23 -> 13:50, 5h 27m
const c = G.changes[0];
assert.strictEqual(c.viaDeploy, true);                              // truck 29 was deployed at 11:17, between the two trucks' trips
assert.strictEqual(c.noTruck, 137);                                 // 09:00 -> 11:17
assert.strictEqual(G.noTruck, 137);
assert.deepStrictEqual([c.log.reason, c.log.notes], ['Engine', 'no pickup']);

// the new truck's deployment time is from before the old truck's last trip: use the first trip instead
const [early] = coSegments(trips, [{ drv: 'd1', shift: 'A', date: '2026-10-15', vid: 'v29', trk: '29', depMs: at(8, 0) }], []);
assert.strictEqual(early.changes[0].viaDeploy, false);
assert.strictEqual(early.changes[0].noTruck, 158);                 // 09:00 -> 11:38
assert.strictEqual(early.changes[0].log, null);                    // nothing logged for truck 90

// a row of the same truck that carries a different driver does not cover this driver's trips
const [other] = coSegments(trips, [{ drv: 'd2', shift: 'A', date: '2026-10-15', vid: 'v90', trk: '90', depMs: at(9, 10) }], []);
assert.strictEqual(other.segs[0].covered, false);
// a row with no driver at all does
const [anon] = coSegments(trips, [{ drv: '', shift: 'A', date: '2026-10-15', vid: 'v90', trk: '90', depMs: 0 }], []);
assert.strictEqual(anon.segs[0].covered, true);

// one truck all shift is not a changeover; a trip with no driver is left out
const [one] = coSegments([trip(8, 0, 'v1', '1'), trip(9, 0, 'v1', '1'), { ...trip(9, 5, 'v2', '2'), drv: '' }], [], []);
assert.strictEqual(one.multi, false);
assert.deepStrictEqual(one.changes, []);
assert.deepStrictEqual(coSegments([], [], []), []);
console.log('changeover tests passed');
