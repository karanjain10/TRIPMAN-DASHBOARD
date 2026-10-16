// Run: node tests/compliance-compressor.test.js
// A drill machine's paired compressor gets its own Compliance row (the server has no separate deployment for it).
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ src-comp:pure:start([\s\S]*?)\/\/ src-comp:pure:end/);
assert(m, 'src-comp:pure markers not found in index.html');
const { srcWithCompressors } = new Function(m[1] + '; return { srcWithCompressors };')();

const drill = { _id: 'a1', equipment_type: 'drill_machine', vehicle_id: 'D2', truck_number: 'DRILL NO:-02', shift: 'A', date: '2026-10-05', driver_id: 'p9', driver_name: 'Ramchandra', compressor_unit_id: 'C2', compressor_number: 'DRILL COMPRESSOR NO:-02' };
const tipper = { _id: 't1', equipment_type: 'tipper', vehicle_id: 'T1', truck_number: '66' };
const noPair = { _id: 'a2', equipment_type: 'drill_machine', vehicle_id: 'D3', compressor_unit_id: null };

const out = srcWithCompressors([drill, tipper, noPair]);
assert.strictEqual(out.length, 4);                       // drill, its compressor, tipper, unpaired drill
const c = out[1];
assert.strictEqual(c.equipment_type, 'drill_compressor');
assert.strictEqual(c.vehicle_id, 'C2');                  // matches the compressor reading's vehicle_id
assert.strictEqual(c.truck_number, 'DRILL COMPRESSOR NO:-02');
assert.strictEqual(c.driver_id, 'p9');                   // same operator, as the server uses for the compressor reading
assert.strictEqual(c.shift, 'A'); assert.strictEqual(c.date, '2026-10-05');
assert.notStrictEqual(c._id, drill._id);
assert.strictEqual(out[0], drill);                       // the drill row itself is untouched
console.log('compliance-compressor: all passed');
