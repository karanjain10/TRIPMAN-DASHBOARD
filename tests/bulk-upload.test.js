// Run: node tests/bulk-upload.test.js
// Pulls the pure bulk-upload functions out of index.html (between the bulk:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ bulk:pure:start([\s\S]*?)\/\/ bulk:pure:end/);
assert(m, 'bulk:pure markers not found in index.html');
const { bulkSpec, bulkParseLocal, bulkClassifyLocal, bulkLocalKey, BULK_MAX_ROWS, BULK_OTHER_TYPES } =
  new Function(m[1] + '; return { bulkSpec, bulkParseLocal, bulkClassifyLocal, bulkLocalKey, BULK_MAX_ROWS, BULK_OTHER_TYPES };')();

// each type's template carries only that type's fields (same as the app's add-unit form)
const heads = (k, t) => bulkSpec(k, t).cols.map(c => c[0]);
assert(heads('others', 'dozer').every(h => !/Water|Diesel/.test(h)));
assert(heads('others', 'water_tanker').includes('Water Tank Capacity (L)') && !heads('others', 'water_tanker').some(h => /Diesel/.test(h)));
assert(heads('others', 'diesel_tanker').includes('Diesel Tanker Capacity (L)') && !heads('others', 'diesel_tanker').some(h => /Water/.test(h)));
assert(BULK_OTHER_TYPES.every(t => !heads('others', t).includes('Equipment Type*')));        // the type is the template, not a column
assert.strictEqual(new Set(BULK_OTHER_TYPES.map(t => bulkSpec('others', t).file)).size, 9);   // nine different files
for (const t of BULK_OTHER_TYPES) { const s = bulkSpec('others', t); assert.strictEqual(s.example.length, s.cols.length, t); }
assert.strictEqual(bulkSpec('people', 'lmv').file, 'lmv_drivers_bulk_template.xlsx');
assert.strictEqual(bulkSpec('people', 'dozer').file, 'dozer_operators_bulk_template.xlsx');
assert(heads('others', 'generator')[0] === 'Number Plate' && heads('others', 'generator').includes('Vehicle Number*'));   // generator: no plate needed

const H = heads('others', 'dozer');
// good rows; empty rows skipped; numbers and booleans coerced; row numbers match the spreadsheet
let p = bulkParseLocal('others', 'dozer', [H, ['mh40 ab 1', 'CAT', 'DZ-1', 300, 'FALSE'], [null, '', null], ['MH40 ZZ 2']]);
assert.strictEqual(p.rows.length, 2);
assert.deepStrictEqual([p.rows[0].fields.vehicle_type, p.rows[0].fields.fuel_tank_capacity, p.rows[0].fields.is_active], ['dozer', 300, false]);
assert.strictEqual(p.rows[1].row_no, 4);

// headers matched loosely; a missing required column stops the file
assert.strictEqual(bulkParseLocal('others', 'dozer', [['NUMBER PLATE*', 'fuel_tank_capacity'], ['X', 5]]).rows.length, 1);
assert(/missing required column/.test(bulkParseLocal('others', 'dozer', [['Model'], ['X']]).error));
assert.strictEqual(bulkParseLocal('others', 'dozer', []).error, 'The file is empty.');

// a dozer sheet has no water tank column, so one in the file is ignored rather than saved
p = bulkParseLocal('others', 'dozer', [[...H, 'Water Tank Capacity (L)'], ['A', null, null, null, null, 9000]]);
assert.strictEqual(bulkClassifyLocal('others', p.rows, new Set())[0].body.water_tank_capacity, undefined);
p = bulkParseLocal('others', 'water_tanker', [heads('others', 'water_tanker'), ['W1', null, null, 500, 8000]]);
assert.strictEqual(bulkClassifyLocal('others', p.rows, new Set())[0].body.water_tank_capacity, 8000);

// bad cells become row errors
p = bulkParseLocal('others', 'dozer', [H, ['', 'M'], ['B', null, null, -5], ['C', null, null, null, 'maybe']]);
assert.deepStrictEqual(p.rows.map(r => !!r.error), [true, true, true]);
assert(/Missing required field: Number Plate/.test(p.rows[0].error)); assert(/positive number/.test(p.rows[1].error)); assert(/TRUE or FALSE/.test(p.rows[2].error));

// duplicates: against the database and inside the file, spaces and case ignored
p = bulkParseLocal('others', 'dozer', [H, ['MH40 AB 1'], ['mh40ab1'], ['NEW 1']]);
let c = bulkClassifyLocal('others', p.rows, new Set([bulkLocalKey('others', { vehicle_type: 'dozer', number_plate: 'NEW1' })]));
assert.deepStrictEqual(c.map(e => e.status), ['valid', 'duplicate', 'duplicate']);
assert.strictEqual(c[0].body.number_plate, 'MH40 AB 1'); assert.strictEqual(c[0].body.is_active, true); assert.strictEqual(c[0].body.fuel_tank_capacity, 0);

// generators: plate optional (saved as N/A like the app), told apart by vehicle number
const GH = heads('others', 'generator');
p = bulkParseLocal('others', 'generator', [GH, [null, 'Cummins', 'GN-1'], [null, 'Cummins', 'GN-2'], [null, 'Cummins', 'gn-1'], ['P', 'X']]);
c = bulkClassifyLocal('others', p.rows, new Set());
assert.deepStrictEqual(c.map(e => e.status), ['valid', 'valid', 'duplicate', 'error']);
assert.strictEqual(c[0].body.number_plate, 'N/A');

// people: spaces/case ignored in the id; the type comes from the chosen template
const PH = heads('people', 'dozer');
p = bulkParseLocal('people', 'dozer', [PH, ['  Anil   Pawar ', 'DZ OP1', 'OL-1'], ['Dup', 'dzop1']]);
c = bulkClassifyLocal('people', p.rows, new Set());
assert.deepStrictEqual(c.map(e => e.status), ['valid', 'duplicate']);
assert.strictEqual(c[0].body.name, 'Anil Pawar'); assert.strictEqual(c[0].body.equipment_type, 'dozer');

// row cap
const many = [H]; for (let i = 0; i <= BULK_MAX_ROWS; i++) many.push(['P' + i]);
assert(/Too many rows/.test(bulkParseLocal('others', 'dozer', many).error));
console.log('bulk-upload: ok');
