// Run: node tests/fleet-summary.test.js
// Pulls the pure Fleet Summary functions out of index.html (between the fleet:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ fleet:pure:start([\s\S]*?)\/\/ fleet:pure:end/);
assert(m, 'fleet:pure markers not found in index.html');
const { fleetClassify, fleetPairLogs, fleetInferSwitches, fleetEvents, fleetRollup, fleetFileName } =
  new Function(m[1] + '; return { fleetClassify, fleetPairLogs, fleetInferSwitches, fleetEvents, fleetRollup, fleetFileName };')();

// ── reasons: structured ones win; "Others" is read from the note; idle / returned / transferred is not a breakdown ──
const c = (reason, notes) => fleetClassify(reason, notes);
assert.deepStrictEqual(c('Tyre', ''), { offDuty: false, cause: 'Tyre' });
assert.deepStrictEqual(c('Bucket', null), { offDuty: false, cause: 'Bucket / track' });
const note = (n, cause) => assert.deepStrictEqual(c('Others', n), { offDuty: false, cause }, n);
note('LOW PICKUP', 'Engine'); note('AD BLUE', 'Engine'); note('GEAR HANG', 'Transmission'); note('Clutch', 'Transmission');
note('DIESEL PIPE LEAKAGE', 'Leakage'); note('PRESSURE LICK', 'Leakage'); note('PRESSURE DOWN', 'Hydraulic');
note('HAND BREAK', 'Brakes'); note('PAD BROKEN', 'Brakes'); note('PATTA BROKEN', 'Suspension'); note('PATTA BREAK', 'Suspension');
note('TRACK CHAIN LINK BREAK', 'Bucket / track'); note('LOW COOLANT', 'Cooling'); note('STEERING OIL LOW', 'Steering');
note('ACCIDENT FROM TATA 3  DOOR GLASS BREAK', 'Accident'); note('OVERTURNED', 'Accident'); note('A/C NO WORK', 'Electrical');
note('HYVA BODY REAR BRACKET BROKEN', 'Body'); note('TYRE TOUCH TO PRESSURE TANK', 'Tyre');
note('HUB BOLT LOOSE', 'Tyre'); note('BALANCE ROD', 'Suspension');
note('THE MECHANIC CALLED FOR THE VEHICLE.', 'Other'); note('', 'Other'); note(null, 'Other');
assert.deepStrictEqual(c('Other', 'x'), { offDuty: false, cause: 'Other' });
['IDEL', 'Idle', 'Other site', 'RETURN TO BHARAT JAIN', 'RETURN', 'TRANSFER TO ANOTHER SITE', 'TRIAL', '15000 HRS ANNUAL SERVICE', 'NO LIST', 'UNKNOWN']
  .forEach(n => assert.strictEqual(c('Others', n).offDuty, true, n));

// ── status logs: a DEACTIVATED up to the next ACTIVATED is one event, slotted by the log's own shift_id ──
const log = (id, action, ts, extra = {}) => ({ entity_id: id, entity_name: id, entity_type: 'vehicle', action, timestamp: ts, shift_id: 'B_2026-09-10', ...extra });
let ev = fleetPairLogs([
  log('T34', 'ACTIVATED', '2026-09-10T08:00:00'),                                          // no deactivation before it: ignored
  log('T34', 'DEACTIVATED', '2026-09-10T09:00:00', { reason: 'Tyre', shift_id: 'B_2026-09-10' }),
  log('T34', 'ACTIVATED', '2026-09-10T12:30:00'),
]);
assert.strictEqual(ev.length, 1);
assert.deepStrictEqual([ev[0].id, ev[0].date, ev[0].shift, ev[0].cause, ev[0].reported, ev[0].hours], ['T34', '2026-09-10', 'B', 'Tyre', true, 3.5]);
assert.strictEqual(ev[0].openNow, false);
// two deactivations in a row: the first never closed; the last one is still open
ev = fleetPairLogs([log('T1', 'DEACTIVATED', '2026-09-10T01:00:00', { reason: 'Engine' }), log('T1', 'DEACTIVATED', '2026-09-11T01:00:00', { reason: 'Tyre', shift_id: 'C_2026-09-11' })]);
assert.deepStrictEqual(ev.map(e => [e.cause, e.hours, e.openNow]), [['Engine', null, true], ['Tyre', null, true]]);
// entities do not mix, notes are classified, entries come back oldest first
ev = fleetPairLogs([log('A', 'DEACTIVATED', '2026-09-12T01:00:00', { reason: 'Others', notes: 'IDEL' }), log('B', 'DEACTIVATED', '2026-09-10T01:00:00', { reason: 'Others', notes: 'GEAR' }), log('B', 'ACTIVATED', '2026-09-10T03:00:00')]);
assert.deepStrictEqual(ev.map(e => [e.id, e.cause, e.offDuty, e.hours]), [['B', 'Transmission', false, 2], ['A', 'Off duty', true, null]]);

// ── unreported breakdowns: a driver leaves a truck for another one in the same shift ──
const trip = (v, d, ts, extra = {}) => ({ vehicle_id: v, driver_id: d, timestamp: `2026-09-10T${ts}`, mining_date: '2026-09-10', shift: 'A', ...extra });
// the user's rule: ran 34, then a different tipper: 34 broke down, 35 did not
let inf = fleetInferSwitches([trip('T34', 'D1', '06:10:00'), trip('T34', 'D1', '06:40:00'), trip('T35', 'D1', '07:30:00'), trip('T35', 'D1', '08:00:00')]);
assert.strictEqual(inf.length, 1);
assert.deepStrictEqual([inf[0].id, inf[0].toId, inf[0].date, inf[0].shift, inf[0].reported, inf[0].cause], ['T34', 'T35', '2026-09-10', 'A', false, 'Not reported']);
assert.strictEqual(inf[0].atMs, Date.parse('2026-09-10T06:40:00'));                        // last trip on the old truck
// three trucks: the first two were left behind, the last one is where the driver ended up
inf = fleetInferSwitches([trip('A', 'D1', '06:00:00'), trip('B', 'D1', '07:00:00'), trip('C', 'D1', '08:00:00')]);
assert.deepStrictEqual(inf.map(e => e.id), ['A', 'B']);
// 34 -> 35 -> 34: the driver came back, so we cannot say which truck stopped: nothing counted
assert.strictEqual(fleetInferSwitches([trip('T34', 'D1', '06:00:00'), trip('T35', 'D1', '07:00:00'), trip('T34', 'D1', '08:00:00')]).length, 0);
// another driver ran 34 after the switch: it was still running, the driver was just moved
assert.strictEqual(fleetInferSwitches([trip('T34', 'D1', '06:00:00'), trip('T35', 'D1', '07:00:00'), trip('T34', 'D2', '08:00:00')]).length, 0);
// ...but another driver's trips on 34 BEFORE the switch do not clear it
assert.strictEqual(fleetInferSwitches([trip('T34', 'D2', '05:30:00'), trip('T34', 'D1', '06:00:00'), trip('T35', 'D1', '07:00:00')]).length, 1);
// one truck all shift, trips with no driver or no mining date, and different shifts: nothing
assert.strictEqual(fleetInferSwitches([trip('T34', 'D1', '06:00:00'), trip('T34', 'D1', '07:00:00')]).length, 0);
assert.strictEqual(fleetInferSwitches([trip('T34', '', '06:00:00'), trip('T35', '', '07:00:00')]).length, 0);
assert.strictEqual(fleetInferSwitches([trip('T34', 'D1', '06:00:00', { mining_date: null }), trip('T35', 'D1', '07:00:00', { mining_date: null })]).length, 0);
assert.strictEqual(fleetInferSwitches([trip('T34', 'D1', '06:00:00'), trip('T35', 'D1', '15:00:00', { shift: 'B' })]).length, 0);

// ── merging: a reported event in the same truck + shift hides the inferred one (even if it was an idle entry) ──
const rep = fleetPairLogs([log('T34', 'DEACTIVATED', '2026-09-10T09:00:00', { reason: 'Others', notes: 'IDEL', shift_id: 'A_2026-09-10' })]);
inf = fleetInferSwitches([trip('T34', 'D1', '06:00:00'), trip('T35', 'D1', '07:00:00'), trip('T40', 'D2', '06:00:00'), trip('T41', 'D2', '07:00:00')]);
assert.deepStrictEqual(fleetEvents(rep, inf, '2026-09-01', '2026-09-30').map(e => [e.id, e.reported]), [['T34', true], ['T40', false]]);
// only events whose slot date is in range
assert.strictEqual(fleetEvents(rep, inf, '2026-09-11', '2026-09-30').length, 0);

// ── rollup ──
const units = [{ id: 'T34', name: '34', kind: 'tipper' }, { id: 'T35', name: '35', kind: 'tipper' }, { id: 'T99', name: '99', kind: 'tipper' }, { id: 'E1', name: 'EX-01', kind: 'excavator' }];
const trips = [trip('T34', 'D1', '06:00:00', { machine_id: 'E1' }), trip('T34', 'D1', '06:30:00', { machine_id: 'E1' }), trip('T35', 'D1', '07:00:00', { machine_id: 'E1' })];
const fuel = [{ vehicle_id: 'T34', litres_filled: 100, refill_date: '2026-09-10' }, { vehicle_id: 'T34', litres_filled: 50, refill_date: '2026-09-30' }, { vehicle_id: 'T34', litres_filled: 999, refill_date: '2026-10-02' }, { vehicle_id: 'E1', litres_filled: 300, refill_date: '2026-09-10' }];
const rd = (id, shift, ho, hc, ko, kc, date = '2026-09-10') => ({ vehicle_id: id, date, shift, readings: { HMR: { opening_value: ho, closing_value: hc }, KMR: { opening_value: ko, closing_value: kc } } });
const readings = [rd('T34', 'A', 100, 105, 1000, 1080), rd('T34', 'B', 105, 107.5, 1080, 1100), rd('T34', 'C', 107.5, null, 1100, null), rd('E1', 'A', 500, 506, null, null)];
const events = fleetEvents(fleetPairLogs([
  log('T34', 'DEACTIVATED', '2026-09-10T09:00:00', { reason: 'Tyre', shift_id: 'A_2026-09-10' }), log('T34', 'ACTIVATED', '2026-09-10T11:00:00'),
  log('T99', 'DEACTIVATED', '2026-09-12T09:00:00', { reason: 'Others', notes: 'RETURN', shift_id: 'A_2026-09-12' }),
  log('E1', 'DEACTIVATED', '2026-09-13T09:00:00', { reason: 'Hydraulic', shift_id: 'A_2026-09-13', entity_type: 'machine' }),
]), fleetInferSwitches(trips), '2026-09-01', '2026-09-30');
const r = fleetRollup({ units, trips, fuel, readings, events, from: '2026-09-01', to: '2026-09-30', cumPerTrip: 10 });
const t34 = r.tipper.units.find(u => u.id === 'T34');
assert.deepStrictEqual([t34.trips, t34.fuelL, t34.hours, t34.kms, t34.bd, t34.reported, t34.inferred, t34.downtimeH], [2, 150, 7.5, 100, 1, 1, 0, 2]); // partial C shift skipped, Oct fuel left out
assert.deepStrictEqual(t34.causes, { Tyre: 1 });
const t35 = r.tipper.units.find(u => u.id === 'T35');
assert.deepStrictEqual([t35.trips, t35.bd, t35.reported, t35.inferred], [1, 0, 0, 0]);       // T35 was the one the driver ended up on
assert.strictEqual(r.tipper.units.some(u => u.id === 'T99' && u.bd > 0), false);              // idle/returned is not a breakdown
const t99 = r.tipper.units.find(u => u.id === 'T99');
assert.strictEqual(t99.offDuty, 1);                                                          // but it is shown as off duty, so it is "active"
const e1 = r.excavator.units[0];
assert.deepStrictEqual([e1.trips, e1.fuelL, e1.hours, e1.kms, e1.bd, e1.causes], [3, 300, 6, 0, 1, { Hydraulic: 1 }]); // excavator trips follow machine_id
assert.deepStrictEqual([r.tipper.totals.trips, r.tipper.totals.fuelL, r.tipper.totals.bd, r.tipper.totals.unitsWithBd, r.tipper.totals.units], [3, 150, 1, 1, 3]);
assert.strictEqual(r.offDuty, 1);
assert.deepStrictEqual(r.tipper.totals.byDay['2026-09-10'], { reported: 1, inferred: 0 });
// a unit with nothing in the range is left out
const quiet = fleetRollup({ units: [...units, { id: 'T1', name: '1', kind: 'tipper' }], trips, fuel, readings, events, from: '2026-09-01', to: '2026-09-30', cumPerTrip: 10 });
assert.strictEqual(quiet.tipper.units.some(u => u.id === 'T1'), false);
// the inferred breakdown shows up as inferred and counts once
const sw = fleetEvents([], fleetInferSwitches([trip('T34', 'D1', '06:00:00'), trip('T35', 'D1', '07:00:00')]), '2026-09-01', '2026-09-30');
const r2 = fleetRollup({ units, trips: [trip('T34', 'D1', '06:00:00'), trip('T35', 'D1', '07:00:00')], fuel: [], readings: [], events: sw, from: '2026-09-01', to: '2026-09-30', cumPerTrip: 10 });
assert.deepStrictEqual([r2.tipper.totals.bd, r2.tipper.totals.inferred, r2.tipper.totals.reported, r2.inferred], [1, 1, 0, 1]);
assert.deepStrictEqual(r2.tipper.totals.causes, { 'Not reported': 1 });


// ── efficiency: trips per hour, km per trip, fuel factor (diesel issued / (trips x m3 per trip), as on the Daily Operations report) ──
// T34 ran 2 trips in shift A (5 h, 80 km); shift B had 2.5 h and 20 km but no trips; shift C is partial. Only trips in a shift whose
// meter reading is complete go against the hours and kms, so a half-recorded shift cannot inflate the rate.
assert.strictEqual(t34.tripsPerHour, 2 / 7.5);
assert.strictEqual(t34.kmPerTrip, 100 / 2);
assert.strictEqual(t34.fuelFactor, 150 / (2 * 10));                                          // all fuel in the range over all trips
assert.deepStrictEqual([t35.tripsPerHour, t35.kmPerTrip, t35.fuelFactor], [null, null, 0]); // no readings: no rate; no fuel: factor 0
assert.deepStrictEqual([r.tipper.totals.tripsPerHour, r.tipper.totals.kmPerTrip, r.tipper.totals.fuelFactor], [2 / 7.5, 50, 150 / (3 * 10)]);
assert.strictEqual(e1.tripsPerHour, 3 / 6);                                                  // excavators get the same rates (trips follow machine_id)
// a trip on a shift with a partial reading is left out of the rate
const partialTrips = [...trips, trip('T34', 'D1', '23:00:00', { shift: 'C', machine_id: 'E1' })];  // shift C: opening only
const rp = fleetRollup({ units, trips: partialTrips, fuel, readings, events, from: '2026-09-01', to: '2026-09-30', cumPerTrip: 10 });
assert.strictEqual(rp.tipper.units.find(u => u.id === 'T34').tripsPerHour, 2 / 7.5);
assert.strictEqual(rp.tipper.units.find(u => u.id === 'T34').fuelFactor, 150 / (3 * 10));    // but it counts for fuel per m3
// nothing run: no rate rather than a divide-by-zero
const idle = fleetRollup({ units, trips: [], fuel: [], readings: [], events: [], from: '2026-09-01', to: '2026-09-30', cumPerTrip: 10 });
assert.deepStrictEqual([idle.tipper.totals.tripsPerHour, idle.tipper.totals.kmPerTrip, idle.tipper.totals.fuelFactor], [null, null, null]);

// ── the name a saved PDF gets (the browser uses the page title) ──
assert.strictEqual(fleetFileName(null, null, '2026-09-01', '2026-09-30'), 'Tripman_FleetSummary_2026-09-01_to_2026-09-30');
assert.strictEqual(fleetFileName(null, null, '2026-09-10', '2026-09-10'), 'Tripman_FleetSummary_2026-09-10');
assert.strictEqual(fleetFileName('tipper', '47', '2026-09-01', '2026-09-30'), 'Tripman_Tipper-47_2026-09-01_to_2026-09-30');
assert.strictEqual(fleetFileName('excavator', 'EX-07', '2026-09-01', '2026-09-30'), 'Tripman_Excavator-EX-07_2026-09-01_to_2026-09-30');
assert.strictEqual(fleetFileName('tipper', 'MH 31/FE 4739', '2026-09-10', '2026-09-10'), 'Tripman_Tipper-MH-31-FE-4739_2026-09-10');

console.log('fleet-summary: all checks passed');
