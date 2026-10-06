// Run: node tests/fuel-efficiency.test.js
// Pulls the pure Fuel Reports efficiency functions out of index.html (between the fuel:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ fuel:pure:start([\s\S]*?)\/\/ fuel:pure:end/);
assert(m, 'fuel:pure markers not found in index.html');
const { fuelRefillRates, fuelMetric, fuelAggregate, fuelUnitSpread, fuelDaily, fuelCards, fuelTypeLabel } =
  new Function(m[1] + '; return { fuelRefillRates, fuelMetric, fuelAggregate, fuelUnitSpread, fuelDaily, fuelCards, fuelTypeLabel };')();

const rec = (v, type, ts, litres, hmr, kmr, extra = {}) => ({ vehicle_id: v, vehicle_name: v, vehicle_type: type, created_at: ts, litres_filled: litres, hmr_reading: hmr, kmr_reading: kmr, ...extra });
const day = (d, h = '10') => `2026-09-${String(d).padStart(2, '0')}T${h}:00:00`;

// ── per-refill rate: litres put in at this refill / meter gap since the previous refill of the same vehicle ──
let rs = [rec('D1', 'dozer', day(1), 200, 1000, null), rec('D1', 'dozer', day(2), 180, 1010, null), rec('D1', 'dozer', day(3), 190, 1020, null)];
fuelRefillRates(rs);
assert.strictEqual(rs[0].efficiency, null);                                   // first refill: no previous one to measure from
assert.strictEqual(rs[1].efficiency, 18);                                     // 180 L over 10 h
assert.strictEqual(rs[1].hmr_diff, 10); assert.strictEqual(rs[1]._eff_unit, 'L/hr');
assert.strictEqual(rs[2].efficiency, 19);
// input order does not matter, vehicles do not mix
rs = [rec('D1', 'dozer', day(2), 180, 1010, null), rec('E1', 'excavator', day(1), 300, 500, null), rec('D1', 'dozer', day(1), 200, 1000, null), rec('E1', 'excavator', day(2), 300, 510, null)];
fuelRefillRates(rs);
assert.deepStrictEqual(rs.map(r => r.efficiency), [18, null, null, 30]);
// light vehicles have no engine hours: km per litre from the odometer
rs = [rec('L1', 'lmv', day(1), 20, null, 1000), rec('L1', 'lmv', day(2), 20, null, 1180)];
fuelRefillRates(rs);
assert.strictEqual(rs[1].efficiency, 9); assert.strictEqual(rs[1]._eff_unit, 'km/L'); assert.strictEqual(rs[1].hmr_diff, null);
// tippers: L/hr is the main figure, km per litre is kept alongside
rs = [rec('T1', 'tipper', day(1), 100, 100, 1000), rec('T1', 'tipper', day(2), 150, 112, 1250)];
fuelRefillRates(rs);
assert.strictEqual(rs[1].efficiency, 150 / 12); assert.strictEqual(rs[1]._kpl, 250 / 150);
// refills that cannot be measured are left out, not averaged in
rs = [rec('D1', 'dozer', day(1), 200, 1000, null), rec('D1', 'dozer', day(1, '10:30'.replace(':30', '')), 3, 1000.2, null)];
fuelRefillRates(rs); assert.strictEqual(rs[1].efficiency, null);              // 3 L top-up: under 5 L
rs = [rec('D1', 'dozer', day(1), 200, 1000, null), rec('D1', 'dozer', day(2), 200, 1000.3, null)];
fuelRefillRates(rs); assert.strictEqual(rs[1].efficiency, null);              // 0.3 h between refills: too short to trust
rs = [rec('D1', 'dozer', day(1), 200, 1000, null), rec('D1', 'dozer', day(2), 200, 1050, null)];
fuelRefillRates(rs); assert.strictEqual(rs[1].efficiency, null);              // 50 h: a missed refill in between
rs = [rec('D1', 'dozer', day(1), 200, 1000, null), rec('D1', 'dozer', day(2), 200, 990, null)];
fuelRefillRates(rs); assert.strictEqual(rs[1].efficiency, null); assert.strictEqual(rs[1].hmr_diff, null); // meter went backwards
// an absurd rate (a 300 L top-up after 1.1 h = 273 L/h) is dropped against its own type's median; the shown hmr_diff stays honest
const exc = []; for (let i = 0; i < 8; i++) exc.push(rec('E1', 'excavator', day(i + 1), 300, 100 + i * 10, null));
exc.push(rec('E1', 'excavator', day(9), 300, 171.1, null));
fuelRefillRates(exc);
assert.strictEqual(exc[8].efficiency, null); assert.strictEqual(exc[8].hmr_diff, 1.1);
assert.strictEqual(exc[3].efficiency, 30);
// the refill before the chosen date range is passed in as context and gives the first refill in range its previous one
rs = [rec('D1', 'dozer', '2026-08-30T10:00:00', 190, 1000, null), rec('D1', 'dozer', day(1), 180, 1010, null)];
fuelRefillRates(rs); assert.strictEqual(rs[1].efficiency, 18);

// ── totals: litres over hours, not an average of ratios ──
assert.strictEqual(fuelMetric('lmv'), 'kpl'); assert.strictEqual(fuelMetric('tipper'), 'lph'); assert.strictEqual(fuelMetric('dozer'), 'lph');
// 100 L over 10 h (10 L/h) and 10 L over 1 h (10 L/h) and 90 L over 3 h (30 L/h): ratio mean = 16.7, litres over hours = 200/14
const agg = [{ _lph: 10, _h: 10, litres_filled: 100 }, { _lph: 10, _h: 1, litres_filled: 10 }, { _lph: 30, _h: 3, litres_filled: 90 }, { _lph: null, _h: null, litres_filled: 500 }];
assert.strictEqual(fuelAggregate(agg, 'lph'), 200 / 14);
assert.strictEqual(fuelAggregate([{ _lph: null, litres_filled: 5 }], 'lph'), null);
assert.strictEqual(fuelAggregate([{ _kpl: 9, _k: 180, litres_filled: 20 }, { _kpl: 11, _k: 220, litres_filled: 20 }], 'kpl'), 10);
// spread across units: only units with 3+ usable refills count
const u = (v, n, lph) => Array.from({ length: n }, () => ({ vehicle_id: v, vehicle_name: v, _lph: lph, _h: 10, litres_filled: lph * 10 }));
assert.deepStrictEqual(fuelUnitSpread([...u('A', 3, 17), ...u('B', 5, 19), ...u('C', 2, 40)], 'lph'), { min: 17, max: 19, units: 2 });
assert.strictEqual(fuelUnitSpread(u('C', 2, 40), 'lph'), null);
// one point per day, litres over hours for that day
assert.deepStrictEqual(fuelDaily([{ created_at: day(2), _lph: 10, _h: 10, litres_filled: 100 }, { created_at: day(1), _lph: 20, _h: 5, litres_filled: 100 }, { created_at: day(2, '15'), _lph: 30, _h: 10, litres_filled: 300 }, { created_at: day(3), _lph: null, litres_filled: 50 }], 'lph'),
  [{ date: '2026-09-01', value: 20 }, { date: '2026-09-02', value: 20 }, { date: '2026-09-03', value: null }]);

// ── the two cards that change with the Vehicle Type dropdown ──
assert.strictEqual(fuelTypeLabel('excavator'), 'Excavators'); assert.strictEqual(fuelTypeLabel('lmv'), 'LMVs'); assert.strictEqual(fuelTypeLabel('drill_equipment'), 'Drill Equipment'); assert.strictEqual(fuelTypeLabel('crane'), 'Cranes');
const mk = (type, v, lph, n) => Array.from({ length: n }, () => ({ vehicle_type: type, vehicle_id: v, vehicle_name: v, _lph: lph, _h: 10, _kpl: 0.5, _k: lph * 5, litres_filled: lph * 10 }));
// All: unchanged from today, Excavators and Tippers
let c = fuelCards([...mk('excavator', 'E1', 30, 4), ...mk('tipper', 'T1', 12, 4), ...mk('dozer', 'D1', 18, 4)], '');
assert.deepStrictEqual([c.c3.label, c.c3.value, c.c3.unit, c.c4.label, c.c4.value, c.c4.unit], ['Avg Efficiency (Excavators)', '30.00', 'L/hr', 'Avg Efficiency (Tippers)', '12.00', 'L/hr']);
// a type: its own efficiency, and the spread across its units
c = fuelCards([...mk('dozer', 'D1', 17, 3), ...mk('dozer', 'D2', 19, 3)], 'dozer');
assert.deepStrictEqual([c.c3.label, c.c3.value, c.c3.unit, c.c4.label, c.c4.value], ['Avg Efficiency (Dozers)', '18.00', 'L/hr', 'Spread Across Units', '17.0 – 19.0']);
assert.strictEqual(c.c4.unit, 'L/hr · 2 units with 3+ refills');
// tippers: the second card is distance per litre
c = fuelCards(mk('tipper', 'T1', 12, 4), 'tipper');
assert.deepStrictEqual([c.c4.label, c.c4.value, c.c4.unit], ['Avg Distance (Tippers)', '0.50', 'km per litre']);
// light vehicles: km/L
c = fuelCards([{ vehicle_type: 'lmv', vehicle_id: 'L1', vehicle_name: 'L1', _kpl: 9, _k: 180, litres_filled: 20 }], 'lmv');
assert.deepStrictEqual([c.c3.label, c.c3.value, c.c3.unit], ['Avg Efficiency (LMVs)', '9.00', 'km/L']);
// nothing measurable: a dash and the reason, never a made-up number
c = fuelCards([{ vehicle_type: 'diesel_tanker', vehicle_id: 'X', vehicle_name: 'X', _lph: null, litres_filled: 50 }], 'diesel_tanker');
assert.deepStrictEqual([c.c3.value, c.c3.unit, c.c4.value, c.c4.unit], ['—', 'not enough usable refills with meter readings', '—', 'needs 3 refills per unit']);
c = fuelCards([], '');
assert.deepStrictEqual([c.c3.value, c.c4.value], ['—', '—']);

console.log('fuel-efficiency: all checks passed');
