// Run: node tests/bulk-upload.test.js
// Pulls the pure bulk-upload functions out of index.html (between the bulk:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ bulk:pure:start([\s\S]*?)\/\/ bulk:pure:end/);
assert(m, 'bulk:pure markers not found in index.html');
const { bulkParseLocal, bulkClassifyLocal, bulkLocalKey, BULK_MAX_ROWS } =
  new Function(m[1] + '; return { bulkParseLocal, bulkClassifyLocal, bulkLocalKey, BULK_MAX_ROWS };')();

const H = ['Equipment Type*', 'Number Plate*', 'Vehicle Number', 'Model', 'Fuel Tank Capacity', 'Water Tank Capacity', 'Diesel Tanker Capacity', 'Is Active (TRUE/FALSE)'];

// good row, case/spaces in type are forgiven, empty rows skipped, numbers and booleans coerced
let p = bulkParseLocal('others', [H, ['Water Tanker', 'mh40 ab 1', null, 'Tata', 500, 8000, null, 'FALSE'], [null, '', null], ['dozer', 'MH40 ZZ 2']]);
assert.strictEqual(p.rows.length, 2);
assert.deepStrictEqual([p.rows[0].fields.vehicle_type, p.rows[0].fields.water_tank_capacity, p.rows[0].fields.is_active], ['water_tanker', 8000, false]);
assert.strictEqual(p.rows[1].row_no, 4);                                                // row numbers match the spreadsheet

// headers matched loosely, a missing required column stops the whole file
assert.strictEqual(bulkParseLocal('others', [['type', 'plate'], ['dozer', 'X']]).rows, undefined);
assert(/missing required column/.test(bulkParseLocal('others', [['Number Plate*'], ['X']]).error));
assert.strictEqual(bulkParseLocal('others', []).error, 'The file is empty.');

// bad cells become row errors, not exceptions
p = bulkParseLocal('others', [H, ['bulldozer', 'A'], ['dozer', ''], ['dozer', 'B', null, null, -5], ['dozer', 'C', null, null, null, null, null, 'maybe']]);
assert.deepStrictEqual(p.rows.map(r => !!r.error), [true, true, true, true]);
assert(/must be one of/.test(p.rows[0].error)); assert(/Missing required field: Number Plate/.test(p.rows[1].error));
assert(/positive number/.test(p.rows[2].error)); assert(/TRUE or FALSE/.test(p.rows[3].error));

// duplicates: against the database and inside the file, spaces and case ignored
p = bulkParseLocal('others', [H, ['dozer', 'MH40 AB 1'], ['dozer', 'mh40ab1'], ['grader', 'MH40 AB 1'], ['dozer', 'NEW 1']]);
let c = bulkClassifyLocal('others', p.rows, new Set([bulkLocalKey('others', { vehicle_type: 'dozer', number_plate: 'NEW1' })]));
assert.deepStrictEqual(c.map(e => e.status), ['valid', 'duplicate', 'valid', 'duplicate']);
assert.strictEqual(c[0].body.number_plate, 'MH40 AB 1'); assert.strictEqual(c[0].body.is_active, true); assert.strictEqual(c[0].body.fuel_tank_capacity, 0);

// people: same person id is fine under a different equipment type
const PH = ['Equipment Type*', 'Name*', 'Person ID*', 'License Number'];
p = bulkParseLocal('people', [PH, ['dozer', '  Anil   Pawar ', 'DZ OP1', 'OL-1'], ['grader', 'Anil Pawar', 'DZ-OP1'], ['dozer', 'Dup', 'dzop1']]);
c = bulkClassifyLocal('people', p.rows, new Set());
assert.deepStrictEqual(c.map(e => e.status), ['valid', 'valid', 'duplicate']);
assert.strictEqual(c[0].body.name, 'Anil Pawar'); assert.strictEqual(c[1].body.license_number, null);

// row cap
const many = [H]; for (let i = 0; i <= BULK_MAX_ROWS; i++) many.push(['dozer', 'P' + i]);
assert(/Too many rows/.test(bulkParseLocal('others', many).error));
console.log('bulk-upload: ok');
