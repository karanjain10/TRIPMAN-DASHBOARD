// Run: node tests/edit-both-readings.test.js
// Pulls srcOverridePayload (and srcAddReading) out of index.html and checks the Edit Reading form's request body.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ src-edit:pure:start([\s\S]*?)\/\/ src-edit:pure:end/);
assert(m, 'src-edit:pure markers not found in index.html');
const { srcOverridePayload } = new Function(m[1] + '; return { srcOverridePayload };')();

// truck 66's B shift: opening AND closing HMR changed -> both go in ONE body (the server checks them as a pair)
const row = { hmr_opening_value: 10623.55, hmr_closing_value: 10625.5, kmr_opening_value: 101782, kmr_closing_value: 101858.9 };
let p = srcOverridePayload(row, { hmrOpen: '10630.9', hmrClose: '10637.7', kmrOpen: '101782', kmrClose: '101858.9' }, true, 'stale opening');
assert.deepStrictEqual(p, { override_reason: 'stale opening', readings: { HMR: { opening_value: 10630.9, closing_value: 10637.7 } } });

// untouched and blank fields are not sent
p = srcOverridePayload(row, { hmrOpen: '10623.55', hmrClose: '10640', kmrOpen: '', kmrClose: '' }, true, 'r');
assert.deepStrictEqual(p.readings, { HMR: { closing_value: 10640 } });

// non-tipper: KMR fields are ignored even if present
p = srcOverridePayload(row, { hmrOpen: '10630.9', hmrClose: '', kmrOpen: '5', kmrClose: '6' }, false, 'r');
assert.deepStrictEqual(p.readings, { HMR: { opening_value: 10630.9 } });

// nothing changed -> empty readings
assert.deepStrictEqual(srcOverridePayload(row, { hmrOpen: '10623.55', hmrClose: '10625.5', kmrOpen: '', kmrClose: '' }, true, 'r').readings, {});

console.log('edit-both-readings: all passed');
