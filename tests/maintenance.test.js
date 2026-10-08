// Run: node tests/maintenance.test.js
// Pulls the pure Maintenance rules (mt:pure) and the breakdown classifier (fleet:pure) out of index.html and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const block = n => { const m = html.match(new RegExp(`// ${n}:pure:start([\\s\\S]*?)// ${n}:pure:end`)); assert(m, `${n}:pure markers not found`); return m[1]; };
const { mtMs, mtLoc, mtAccLevel, mtState } = new Function(block('fleet') + block('mt') + '; return { mtMs, mtLoc, mtAccLevel, mtState };')();

// timestamps: an offset is honoured, a bare string is UTC
assert.strictEqual(mtMs('2026-10-09T12:00:00+05:30'), Date.parse('2026-10-09T06:30:00Z'));
assert.strictEqual(mtMs('2026-10-09T06:30:00'), Date.parse('2026-10-09T06:30:00Z'));

// location: never 0,0, never half a position; accuracy is kept as given
assert.strictEqual(mtLoc(null), null);
assert.strictEqual(mtLoc({ latitude: 0, longitude: 0, accuracy: 5 }), null);
assert.strictEqual(mtLoc({ latitude: 23.7, longitude: null, accuracy: 5 }), null);
assert.strictEqual(mtLoc({ latitude: 95, longitude: 86, accuracy: 5 }), null);
assert.deepStrictEqual(mtLoc({ latitude: 23.7, longitude: 86.4, accuracy: 8.4 }), { lat: 23.7, lng: 86.4, acc: 8.4 });
assert.strictEqual(mtLoc({ latitude: 23.7, longitude: 86.4 }).acc, null);
assert.deepStrictEqual([8, 25, 26, 100, 101, null].map(mtAccLevel), ['good', 'good', 'rough', 'rough', 'poor', 'rough']);

// state
const NOW = Date.parse('2026-10-09T12:00:00+05:30'), min = m => new Date(NOW - m * 60000).toISOString();
const item = (id, label, active, extra) => ({ _id: id, _label: label, _source: 'vehicle', _type: 'tipper', is_active: active, ...extra });
const log = (id, action, ago, extra) => ({ _id: `${id}-${action}-${ago}`, entity_id: id, action, timestamp: min(ago), performed_by_name: 'Ramesh', shift_id: 'B_2026-10-09', ...extra });
const items = [
  item('a', 'Truck #34', false), item('b', 'EX-04', false), item('c', 'Truck #8', false),
  item('d', 'Truck #11', true), item('e', 'Truck #50', true), item('f', 'Truck #60', false),
];
const logs = [
  log('a', 'DEACTIVATED', 400, { reason: 'Tyre' }),                                                    // down 400 min, no location, old enough to be "no location"
  log('b', 'DEACTIVATED', 3 * 1440, { reason: 'Hydraulic' }), log('b', 'ACTIVATED', 2 * 1440),          // earlier breakdown, 3 days ago
  log('b', 'DEACTIVATED', 1, { reason: 'Hydraulic', location: { latitude: 23.7, longitude: 86.4, accuracy: 20 } }), // just now, with a fix
  log('c', 'DEACTIVATED', 1, { reason: 'Others', notes: 'service due' }),                              // off duty
  log('d', 'DEACTIVATED', 300, { reason: 'Brake', notes: '' }), log('d', 'ACTIVATED', 120),             // fixed 2 h ago
  log('e', 'DEACTIVATED', 3000, { reason: 'Engine' }), log('e', 'ACTIVATED', 2900),                     // fixed more than 24 h ago
  log('f', 'DEACTIVATED', 1, { reason: 'Engine', location: { latitude: 0, longitude: 0, accuracy: 3 } }), // 0,0 is no fix
];
const st = mtState(items, logs, NOW);
assert.deepStrictEqual(st.down.map(u => u.name), ['Truck #34', 'EX-04', 'Truck #60']);                   // longest down first; off duty is not down
assert.deepStrictEqual(st.off.map(u => u.name), ['Truck #8']);
const [a, b, f] = st.down;
assert.strictEqual(a.loc, null); assert.strictEqual(a.gpsWait, false);                                  // no fix after 2 min = "no location"
assert.strictEqual(b.gpsWait, false); assert.strictEqual(b.loc.acc, 20); assert.strictEqual(b.repeat, 2); assert.strictEqual(a.repeat, 1); // 3 days ago + now = 2nd in 7 days
assert.strictEqual(f.loc, null); assert.strictEqual(f.gpsWait, true);                                   // 1 min old, no usable fix yet = waiting
assert.strictEqual(a.shift, 'B'); assert.strictEqual(a.by, 'Ramesh');
assert.deepStrictEqual(st.fixed.map(x => x.name), ['Truck #11']);                                        // only the last 24 h
console.log('maintenance tests passed');
