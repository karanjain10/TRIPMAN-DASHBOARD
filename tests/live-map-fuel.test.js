// Run: node tests/live-map-fuel.test.js
// Pulls the Live Map fuel pin helpers out of index.html (between the lmfuel:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ lmfuel:pure:start([\s\S]*?)\/\/ lmfuel:pure:end/);
assert(m, 'lmfuel:pure markers not found in index.html');
const { lmExtractLatLng, lmFuelPin, lmFuelInRange } = new Function(m[1] + '; return { lmExtractLatLng, lmFuelPin, lmFuelInRange };')();

const log = (extra = {}) => ({ _id: 'f1', vehicle_id: 'v1', vehicle_name: 'EX-03', vehicle_type: 'excavator', litres_filled: 312, logged_by: 'SVP318', created_at: '2026-09-26T20:45:28+05:30',
  location: { latitude: 21.3441617, longitude: 78.9694683, accuracy: 6.8 }, ...extra });

// ── coordinates: a fuel log keeps them in location {latitude, longitude, accuracy} ──
assert.deepStrictEqual(lmExtractLatLng({ location: { latitude: 21.3, longitude: 78.9 } }), { lat: 21.3, lng: 78.9 });
assert.deepStrictEqual(lmExtractLatLng({ lat: 1, lng: 2 }), { lat: 1, lng: 2 });
assert.strictEqual(lmExtractLatLng({ location: { latitude: '21.3', longitude: 78.9 } }), null);   // strings are not coordinates
assert.strictEqual(lmExtractLatLng(null), null);

// ── one map pin per fuel log ──
let pin = lmFuelPin(log());
assert.deepStrictEqual([pin.lat, pin.lng], [21.3441617, 78.9694683]);
['Fuel Log', 'EX-03', 'Excavator', '312', 'SVP318', '±7 m'].forEach(t => assert(pin.html.includes(t), t));
// the log has no coordinates (older logs, or the phone gave no fix): no pin
assert.strictEqual(lmFuelPin(log({ location: null })), null);
assert.strictEqual(lmFuelPin(log({ location: undefined })), null);
assert.strictEqual(lmFuelPin(log({ location: {} })), null);
// the name comes from the log itself: vehicle_id is a machine id for excavators and dozers, which is no use on a popup
pin = lmFuelPin(log({ vehicle_name: '', remarks: 'Drill 1' }));
assert(pin.html.includes('Drill 1'));
pin = lmFuelPin(log({ vehicle_name: null, remarks: null }));
assert(pin.html.includes('—') && !pin.html.includes('v1'));
// a type with an underscore reads normally; missing pieces show a dash, not "undefined"
assert(lmFuelPin(log({ vehicle_type: 'drill_machine' })).html.includes('Drill Machine'));
pin = lmFuelPin(log({ litres_filled: null, logged_by: null, location: { latitude: 1, longitude: 2 } }));
assert(!pin.html.includes('undefined') && !pin.html.includes('null') && !pin.html.includes('NaN'));
// names are data, not markup
assert(!lmFuelPin(log({ vehicle_name: '<img src=x onerror=alert(1)>' })).html.includes('<img'));

// ── the server returns every log whatever dates are asked for, so the map filters by date itself ──
const d = (id, refill_date, created_at) => ({ _id: id, refill_date, created_at });
const set = [d('a', '2026-09-21', '2026-09-21T23:50:00+05:30'), d('b', '2026-09-22', '2026-09-22T06:10:00+05:30'), d('c', '2026-09-26', '2026-09-26T20:45:00+05:30'), d('e', '2026-09-27', '2026-09-27T01:00:00+05:30'), d('f', undefined, '2026-09-24T10:00:00+05:30')];
assert.deepStrictEqual(lmFuelInRange(set, '2026-09-22', '2026-09-26').map(x => x._id), ['b', 'c', 'f']);   // both ends inclusive; no refill_date falls back to created_at
assert.deepStrictEqual(lmFuelInRange(set, '2026-09-26', '2026-09-26').map(x => x._id), ['c']);
assert.deepStrictEqual(lmFuelInRange(set, '', '').map(x => x._id), ['a', 'b', 'c', 'e', 'f']);                // no dates chosen: everything
assert.deepStrictEqual(lmFuelInRange([], '2026-09-22', '2026-09-26'), []);

console.log('live-map-fuel: all checks passed');
