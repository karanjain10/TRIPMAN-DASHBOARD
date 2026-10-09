// Run: node tests/drilling-report.test.js
// Pulls drillRollup out of index.html (between the drill:pure markers) and checks it.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ drill:pure:start([\s\S]*?)\/\/ drill:pure:end/);
assert(m, 'drill:pure markers not found in index.html');
const { drillRollup } = new Function(m[1] + '; return { drillRollup };')();

const units = [{ id: 'd1', name: 'DR-101', kind: 'drill' }, { id: 'd2', name: 'DR-102', kind: 'drill' }, { id: 'c1', name: 'CP-21', kind: 'comp' }, { id: 'c2', name: 'CP-22', kind: 'comp' }];
const rd = (id, date, shift, o, c) => ({ vehicle_id: id, date, shift, readings: { HMR: { opening_value: o, closing_value: c } } });
const fl = (id, date, l) => ({ vehicle_id: id, refill_date: date, litres_filled: l });
const as = (u, date, shift, comp, holes, mtr) => ({ unit_id: u, date, shift, compressor_number: comp, total_holes: holes, total_meterage: mtr });
const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const run = o => drillRollup({ units, from: '2026-09-01', to: '2026-09-30', fuel: [], readings: [], assigns: [], ...o });

// ── hours, metres, fuel, per hour ──
let r = run({
  assigns: [as('d1', '2026-09-01', 'A', 'cp-21', 10, 100), as('d1', '2026-09-02', 'A', 'CP-21', 8, 80), as('d2', '2026-09-01', 'A', 'CP-22', 5, 40)],
  readings: [rd('d1', '2026-09-01', 'A', 100, 108), rd('d1', '2026-09-02', 'A', 108, 112), rd('c1', '2026-09-01', 'A', 50, 60), rd('c1', '2026-09-02', 'A', 60, 66), rd('d2', '2026-09-01', 'A', 0, 4), rd('c2', '2026-09-01', 'A', 0, 5)],
  fuel: [fl('d1', '2026-09-03', 240), fl('c1', '2026-09-03', 320), fl('d2', '2026-09-03', 100), fl('d1', '2026-10-01', 999)] });   // the October refill is outside the range
const d1 = r.rows.find(x => x.name === 'DR-101');
assert.deepStrictEqual([d1.holes, d1.m, d1.dh, d1.ch, d1.dfu, d1.cfu], [18, 180, 12, 16, 240, 320]);
near(d1.mph, 15, 'DR-101 m/h'); near(d1.dlph, 20, 'drill L/h'); near(d1.clph, 20, 'comp L/h'); near(d1.lpm, 560 / 180, 'L per m');
assert.deepStrictEqual(d1.comps, ['CP-21'], 'compressor matched case-insensitively, shown by its own name');
near(r.T.m, 220, 'fleet metres'); near(r.T.dh, 16, 'fleet drill hours'); near(r.T.ch, 21, 'fleet compressor hours'); near(r.T.mph, 220 / 16, 'fleet m/h');
near(r.T.dfu, 340, 'drill fuel'); near(r.T.cfu, 320, 'compressor fuel: only CP-21 was refilled');

// ── cumulative per hour runs day by day ──
assert.deepStrictEqual(r.days.map(d => d.date), ['2026-09-01', '2026-09-02']);
near(r.days[0].mph, 140 / 12, 'day 1 m/h'); near(r.days[0].cum, 140 / 12, 'day 1 cumulative');
near(r.days[1].mph, 20, 'day 2 m/h'); near(r.days[1].cum, 220 / 16, 'day 2 cumulative = whole range');
near(r.T.lastDay.mph, 20, 'latest day');

// ── one compressor on two drills: fuel follows each drill's share of its hours ──
r = run({
  assigns: [as('d1', '2026-09-01', 'A', 'CP-21', 1, 10), as('d2', '2026-09-01', 'B', 'CP-21', 1, 10)],
  readings: [rd('c1', '2026-09-01', 'A', 0, 6), rd('c1', '2026-09-01', 'B', 6, 8)], fuel: [fl('c1', '2026-09-01', 800)] });
near(r.rows[0].cfu, 600, 'DR-101 had 6 of 8 compressor hours'); near(r.rows[1].cfu, 200, 'DR-102 had 2 of 8'); near(r.T.cfu, 800, 'nothing lost or double counted');

// ── metres missing: hours and fuel still count, per-hour and L per m do not ──
r = run({
  assigns: [as('d1', '2026-09-01', 'A', 'CP-21', 10, 100), as('d1', '2026-09-02', 'A', 'CP-21', null, null)],
  readings: [rd('d1', '2026-09-01', 'A', 0, 10), rd('d1', '2026-09-02', 'A', 10, 20)], fuel: [fl('d1', '2026-09-01', 400)] });
assert.deepStrictEqual([r.T.deploys, r.T.entered, r.T.dh, r.T.m], [2, 1, 20, 100]);
near(r.T.mph, 10, 'm/h uses only the 10 hours that have metres'); assert.strictEqual(r.T.lpm, null, 'no L per m while a deployment lacks metres');
assert.strictEqual(r.days[1].m, null, 'a day with nothing entered is a gap, not zero');
assert.strictEqual(r.days[1].mph, null);

// ── edges: no metres hours -> null not NaN; unmatched compressor kept by typed name; broken meter and empty range ──
r = run({ assigns: [as('d1', '2026-09-01', 'A', 'CP-99', 1, 5)], readings: [rd('d1', '2026-09-01', 'A', 50, 40)] });   // closing below opening: skipped
assert.strictEqual(r.rows[0].mph, null); assert.strictEqual(r.rows[0].dlph, null); assert.deepStrictEqual(r.rows[0].comps, ['CP-99']); assert.strictEqual(r.rows[0].ch, 0);
assert.deepStrictEqual(run({}).rows, []); assert.strictEqual(run({}).T.mph, null);
r = run({ assigns: [as('d1', '2026-09-01', 'A', '', 1, 5), as('d1', '2026-09-01', 'A', '', 1, 5)], readings: [rd('d1', '2026-09-01', 'A', 0, 6)] });
assert.strictEqual(r.rows[0].dh, 6, 'the same drill and shift listed twice counts its hours once');

// ── compressor refills that carry a different vehicle_id still land on the compressor with that vehicle_name ──
r = run({ assigns: [as('d1', '2026-09-01', 'A', 'CP-21', 1, 10), as('d1', '2026-09-02', 'A', 'CP-77', 1, 10)],
  readings: [rd('d1', '2026-09-01', 'A', 0, 6), rd('c1', '2026-09-01', 'A', 0, 6)],
  fuel: [{ vehicle_id: 'other-id', vehicle_name: ' cp-21 ', refill_date: '2026-09-01', litres_filled: 300 }] });
near(r.T.cfu, 300, 'refill matched to CP-21 by name'); assert.deepStrictEqual(r.unmatched, ['CP-77'], 'a compressor number with no unit is reported');
assert.deepStrictEqual([r.T.deploys, r.T.hd], [2, 1], 'one of two deployments has hours');
console.log('drilling-report: name match ok');

// ── compressor not among the units at all: its typed number still finds fuel by vehicle_name; hours stay 0 ──
r = run({ assigns: [as('d1', '2026-09-01', 'A', 'DRILL COMPRESSOR NO:-01', 1, 10)], readings: [rd('d1', '2026-09-01', 'A', 0, 6)],
  fuel: [{ vehicle_id: 'zz', vehicle_name: 'DRILL COMPRESSOR NO:-01', refill_date: '2026-09-01', litres_filled: 279 }] });
near(r.T.cfu, 279, 'fuel found by the typed compressor number'); near(r.T.ch, 0, 'no hours without a unit'); assert.strictEqual(r.T.clph, null);
// ── a unit known by another name (alias) is matched ──
r = drillRollup({ units: [{ id: 'd1', name: 'DR-1', kind: 'drill' }, { id: 'c9', name: 'CP-9', aliases: ['DRILL COMPRESSOR NO:-01'], kind: 'comp' }], from: '2026-09-01', to: '2026-09-30',
  assigns: [as('d1', '2026-09-01', 'A', 'drill compressor no:-01', 1, 10)], readings: [rd('c9', '2026-09-01', 'A', 0, 5)], fuel: [] });
near(r.T.ch, 5, 'matched through the alias'); assert.deepStrictEqual(r.rows[0].comps, ['CP-9']);
// ── a repeated refill entry is counted once ──
r = run({ assigns: [as('d1', '2026-09-01', 'A', '', 1, 10)], readings: [rd('d1', '2026-09-01', 'A', 0, 6)],
  fuel: [{ vehicle_id: 'd1', refill_date: '2026-09-04', litres_filled: 186, hmr_reading: 26813.5 }, { vehicle_id: 'd1', refill_date: '2026-09-04', litres_filled: 186, hmr_reading: 26813.5 },
         { vehicle_id: 'd1', refill_date: '2026-09-05', litres_filled: 186, hmr_reading: 26820 }] });
near(r.T.dfu, 372, 'the double entry on the 4th counts once, the 5th is a real refill');

// ── no compressor unit, but its refills carry a vehicle_id that the shift readings also use: hours and fuel both count ──
r = run({ assigns: [as('d1', '2026-09-01', 'A', 'DRILL COMPRESSOR NO:-01', 1, 10)], readings: [rd('d1', '2026-09-01', 'A', 0, 6), rd('c7', '2026-09-01', 'A', 0, 8)],
  fuel: [{ vehicle_id: 'c7', vehicle_name: 'DRILL COMPRESSOR NO:-01', refill_date: '2026-09-01', litres_filled: 200 }] });
near(r.T.ch, 8, 'hours through the fuel log id'); near(r.T.cfu, 200, 'fuel'); near(r.T.clph, 25, 'L/h'); assert.deepStrictEqual(r.unmatched, [], 'nothing left unmatched');
console.log('drilling-report: ok');
