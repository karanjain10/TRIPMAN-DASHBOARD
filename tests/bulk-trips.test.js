// Run: node tests/bulk-trips.test.js
// Pulls the pure bulk-trip parser out of index.html (between the trips-bulk:pure markers) and checks it.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ trips-bulk:pure:start([\s\S]*?)\/\/ trips-bulk:pure:end/);
assert(m, 'trips-bulk:pure markers not found in index.html');
const { tbParse, tbDate, tbTemplateFiles } = new Function(m[1] + '; return { tbParse, tbDate, tbTemplateFiles };')();

const H = ['Truck', 'Date', 'Shift', 'Material', 'Trips', 'Times'];
const NOW = Date.parse('2026-10-08T12:00:00+05:30');
const one = row => tbParse([H, row], NOW).groups[0];

// dates in the formats people type
assert.strictEqual(tbDate('2026-10-07'), '2026-10-07');
assert.strictEqual(tbDate('07/10/2026'), '2026-10-07');
assert.strictEqual(tbDate('7-10-2026'), '2026-10-07');
assert.strictEqual(tbDate('2026-02-30'), null);

// C shift with a count: spread across 22:00-06:00, small hours land on the NEXT calendar day, gaps >= 7 min
let g = one(['MH40-1', '2026-10-07', 'c', 'coal', '12', '']);
assert.deepStrictEqual(g.errors, []);
assert.strictEqual(g.stamps.length, 12);
assert(g.estimated);
assert(g.stamps[0].startsWith('2026-10-07T22:') && g.stamps[11].startsWith('2026-10-08T0') && g.stamps[0].endsWith('+05:30'));
for (let i = 1; i < 12; i++) assert(Date.parse(g.stamps[i]) - Date.parse(g.stamps[i - 1]) >= 7 * 60000);
assert.strictEqual(g.material, 'Coal');

// explicit times, given out of order, C shift crossing midnight
g = one(['T2', '2026-10-07', 'C', 'Soft OB', '', '00:30, 22:15, 23:05']);
assert.deepStrictEqual(g.errors, []);
assert.deepStrictEqual(g.stamps, ['2026-10-07T22:15:00+05:30', '2026-10-07T23:05:00+05:30', '2026-10-08T00:30:00+05:30']);
assert(!g.estimated);

// A shift stays on the same day; max count fits exactly, one more does not
assert.deepStrictEqual(one(['T', '2026-10-07', 'A', 'Coal', '68', '']).errors, []);
assert(/will not fit/.test(one(['T', '2026-10-07', 'A', 'Coal', '69', '']).errors[0]));

// bad rows say why
assert(/outside Shift A/.test(one(['T', '2026-10-07', 'A', 'Coal', '', '13:59, 14:30']).errors[0]));   // 14:00+ is B
assert(/less than 7 min/.test(one(['T', '2026-10-07', 'A', 'Coal', '', '08:00, 08:06']).errors[0]));
assert(/Duplicate/.test(one(['T', '2026-10-07', 'A', 'Coal', '', '08:00, 08:00']).errors[0]));
assert(/Trips says 3/.test(one(['T', '2026-10-07', 'A', 'Coal', '3', '08:00, 09:00']).errors[0]));
assert(/Material/.test(one(['T', '2026-10-07', 'A', 'Sand', '2', '']).errors[0]));
assert(/Shift must/.test(one(['T', '2026-10-07', 'D', 'Coal', '2', '']).errors[0]));
assert(/Date/.test(one(['T', 'yesterday', 'A', 'Coal', '2', '']).errors[0]));
assert(/Times must be/.test(one(['T', '2026-10-07', 'A', 'Coal', '', '8 am']).errors[0]));
assert(/Give a Trips/.test(one(['T', '2026-10-07', 'A', 'Coal', '', '']).errors[0]));
assert(/future/.test(one(['T', '2026-10-08', 'B', 'Coal', '', '21:00']).errors[0]));   // now is 12:00 on the 8th

// same truck+date+shift twice is rejected (it would double count); a different shift is fine
const two = tbParse([H, ['T', '2026-10-07', 'A', 'Coal', '2', ''], ['t', '2026-10-07', 'A', 'Coal', '2', ''], ['T', '2026-10-07', 'B', 'Coal', '2', '']], NOW).groups;
assert.deepStrictEqual(two.map(x => x.errors.length > 0), [false, true, false]);

// file-level problems stop the upload; blank rows skipped; row numbers match the sheet
assert.strictEqual(tbParse([], NOW).error, 'The file is empty.');
assert(/Missing column: material/.test(tbParse([['Truck', 'Date', 'Shift', 'Trips']], NOW).error));
assert(/Trips column, a Times column/.test(tbParse([['Truck', 'Date', 'Shift', 'Material']], NOW).error));
const sk = tbParse([H, [], ['T', '2026-10-07', 'A', 'Coal', '2', '']], NOW).groups;
assert.strictEqual(sk.length, 1);
assert.strictEqual(sk[0].rowNo, 3);

// "Truck Number" works as the header too
assert.deepStrictEqual(tbParse([['Truck Number', 'Date', 'Shift', 'Material', 'Trips'], ['T-5', '2026-10-07', 'A', 'Coal', '3']], NOW).groups[0].errors, []);

// Excel template: dropdowns, trip-count check, and a Times formula under Excel's 8192-char limit
const files = tbTemplateFiles(['T-1', 'A&B']);
const sheet = files['xl/worksheets/sheet1.xml'];
const formula = sheet.match(/<f t="shared" ref="F2[^>]*>([^<]*)<\/f>/)[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
assert(formula.length < 8192, 'Times formula too long for Excel: ' + formula.length);
assert(/type="list"[^>]*sqref="A2:A301"[^>]*><formula1>Lists!\$A\$2:\$A\$3</.test(sheet));        // trucks come from the Lists sheet
assert(sheet.includes('<formula1>&quot;A,B,C&quot;</formula1>') && sheet.includes('Coal,Soft OB,Hard OB,Rehandling'));
assert(/type="whole"[^>]*sqref="E2:E301"/.test(sheet));
assert(files['xl/worksheets/sheet2.xml'].includes('A&amp;B'));                                       // truck names are XML-escaped

console.log('bulk-trips: all passed');
