// Run: node tests/manage-site.test.js
// Pulls the pure Manage site functions out of index.html (between the ms:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ ms:pure:start([\s\S]*?)\/\/ ms:pure:end/);
assert(m, 'ms:pure markers not found in index.html');
const { MS_TYPES, msReasons, msUnit, msPerson, msCounts, msTotals, msDeactBody, msReactBody } =
  new Function(m[1] + '; return { MS_TYPES, msReasons, msUnit, msPerson, msCounts, msTotals, msDeactBody, msReactBody };')();

// 11 types: tipper + excavator + the nine others; people wording matches the app
assert.strictEqual(MS_TYPES.length, 11);
assert.deepStrictEqual(MS_TYPES.filter(t => t.people === 'Drivers').map(t => t.key), ['tipper', 'lmv', 'water_tanker', 'diesel_tanker']);
assert(MS_TYPES.every(t => t.bulk.length === 2));

// reasons: tipper and excavator have their own list, everything else the default
assert.deepStrictEqual(msReasons('tipper').slice(0, 2), ['Tyre', 'Engine']);
assert(msReasons('excavator').includes('Bucket'));
assert(msReasons('dozer').includes('Accident') && msReasons('dozer').includes('Scheduled Maintenance'));

// unit rows: each collection has its own fields; inactive units show why
let u = msUnit('tipper', { _id: 'a', vehicle_number: '23', number_plate: 'MH40 AB 1234', model: 'Tata 2518', capacity_m3: 18, fuel_tank_capacity: 300, is_active: true });
assert.deepStrictEqual([u.title, u.active, u.why], ['23', true, '']);
assert.strictEqual(u.sub, 'MH40 AB 1234 · Tata 2518 · Capacity 18 m³ · Fuel tank 300');
u = msUnit('excavator', { _id: 'b', machine_id: 'EX-5', machine_number: '5', bucket_capacity_m3: 1.2, is_active: false, deactivation_reason: 'Engine', expected_return_date: '2026-10-09', deactivation_notes: 'oil leak' });
assert.strictEqual(u.title, 'EX-5 (No. 5)'); assert.strictEqual(u.active, false); assert.strictEqual(u.why, 'Engine · back 2026-10-09 · oil leak');
u = msUnit('water_tanker', { _id: 'c', number_plate: 'MH40 W 1', water_tank_capacity: 8000 });
assert.strictEqual(u.active, true); assert.strictEqual(u.sub, 'Water tank 8000');           // no flag in the record means active
assert.strictEqual(msPerson({ _id: 'p', name: 'Anil', person_id: 'DZ-1', is_active: false }).sub, 'DZ-1');
assert.strictEqual(msPerson({ _id: 'p', name: 'Sam', driver_id: 'DRV9' }).sub, 'DRV9');

assert.deepStrictEqual(msCounts([{ active: true }, { active: false }, { active: true }]), { total: 3, active: 2, inactive: 1 });

// site-wide KPIs add up every type; empty types count as zero
const A = { active: true }, I = { active: false };
assert.deepStrictEqual(msTotals([[A, I], [A], []], [[A, A, I], [], [I]]),
  { equipment: { total: 3, active: 2, inactive: 1 }, manpower: { total: 4, active: 2, inactive: 2 } });
assert.deepStrictEqual(msTotals([[]], [[]]).manpower, { total: 0, active: 0, inactive: 0 });

// status change bodies: reason is mandatory, notes capped, reactivation clears the old reason
const who = { id: 'w1', name: 'Admin' };
assert.throws(() => msDeactBody({ reason: '' }, who), /reason/i);
let b = msDeactBody({ reason: 'Tyre', date: '', notes: ' x'.repeat(200) }, who);
assert.strictEqual(b.is_active, false); assert.strictEqual(b.expected_return_date, null);
assert.strictEqual(b.deactivation_notes.length, 300);                                      // 400 chars in, trimmed and capped at 300 assert.strictEqual(b.performed_by_name, 'Admin');
assert.deepStrictEqual(msReactBody(who), { is_active: true, deactivation_reason: null, expected_return_date: null, deactivation_notes: null, performed_by: 'w1', performed_by_name: 'Admin' });
console.log('manage-site: ok');
