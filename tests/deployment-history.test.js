// Run: node tests/deployment-history.test.js
// Pulls the pure Deployment History helpers out of index.html (between the dephist:pure markers) and checks them.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ dephist:pure:start([\s\S]*?)\/\/ dephist:pure:end/);
assert(m, 'dephist:pure markers not found in index.html');
const { DEP_GENERIC_TYPES, depGenericTypesToFetch, depGenericRow, depWhoIndex, depMergeRows, depApplyWho } =
  new Function(m[1] + '; return { DEP_GENERIC_TYPES, depGenericTypesToFetch, depGenericRow, depWhoIndex, depMergeRows, depApplyWho };')();

// ── which equipment types need their own request ──
// The server's deployable list (drill compressors ride on a drill machine record and are never deployed alone).
assert.deepStrictEqual([...DEP_GENERIC_TYPES].sort(), ['diesel_tanker', 'dozer', 'drill_machine', 'grader', 'lmv', 'loader', 'water_tanker']);
const others = [{ vehicle_type: 'dozer' }, { vehicle_type: 'dozer' }, { vehicle_type: 'drill_machine' }, { vehicle_type: 'drill_compressor' }, { vehicle_type: 'generator' }, { vehicle_type: 'loader' }];
assert.deepStrictEqual(depGenericTypesToFetch(others, ''), ['dozer', 'drill_machine', 'loader']);     // only types that have units, and are deployable
assert.deepStrictEqual(depGenericTypesToFetch(others, 'dozer'), ['dozer']);                          // a type chosen in the dropdown
assert.deepStrictEqual(depGenericTypesToFetch(others, 'excavator'), []);                             // tippers and excavators already come with the summary
assert.deepStrictEqual(depGenericTypesToFetch(others, 'tipper'), []);
assert.deepStrictEqual(depGenericTypesToFetch(others, 'grader'), []);                                // chosen type has no units

// ── an equipment-assignments record shaped like a deployments/summary row ──
const rec = { _id: 'a1', unit_id: 'u1', equipment_type: 'dozer', date: '2026-09-26', shift: 'C', person_id: 'p1', person_name: 'Arjun', location: 'SOFT DUMPING', created_at: '2026-09-26T22:03:00+05:30', compressor_number: null, assigned_by: null, assigned_by_name: null };
let row = depGenericRow(rec, 'DZ 04', { date: '2026-09-26', shift: 'C' });
assert.deepStrictEqual([row._id, row.truck_number, row.equipment_type, row.driver_name, row.location, row.status, row.deployed_since, row.vehicle_id, row.material, row.distance_km],
  ['a1', 'DZ 04', 'dozer', 'Arjun', 'SOFT DUMPING', 'active', '2026-09-26T22:03:00+05:30', 'u1', null, null]);
assert.strictEqual(depGenericRow(rec, 'DZ 04', { date: '2026-09-26', shift: 'B' }).status, 'completed');   // not the running shift
assert.strictEqual(depGenericRow(rec, 'DZ 04', { date: '2026-09-27', shift: 'C' }).status, 'completed');   // an earlier day
assert.strictEqual(depGenericRow({ ...rec, unit_id: 'u9' }, null, { date: '', shift: '' }).truck_number, null);
assert.strictEqual(depGenericRow({ ...rec, compressor_number: 'COMP-1' }, 'D1', {}).compressor_number, 'COMP-1');

// ── merging: the server may or may not already send these rows ──
const sum = [{ _id: 't1', equipment_type: 'tipper' }, { _id: 'a1', equipment_type: 'dozer', from: 'summary' }];
assert.deepStrictEqual(depMergeRows(sum, [row, { ...row, _id: 'a2' }]).map(r => r._id), ['t1', 'a1', 'a2']);
assert.strictEqual(depMergeRows(sum, [row]).find(r => r._id === 'a1').from, 'summary');                    // the server's row wins, no duplicate
assert.deepStrictEqual(depMergeRows(sum, []), sum);

// ── who deployed ──
const name = c => ({ LI006: 'Ishwardas Bhendarkar', COAL015: 'Anil Sitaram Yadav' })[c] || null;
const who = depWhoIndex({
  tippers: [{ _id: 't1', assigned_by: 'LI006', assigned_by_name: 'Ishwar Bhendarkar', created_by_name: 'Ishwar B', updated_by_name: 'Hemanta Kumar Nayak', updated_at: '2026-09-26T10:00:00+05:30', version: 2 },
            { _id: 't2', assigned_by: 'ZZ9', assigned_by_name: 'Zed Person', version: 1 },
            { _id: 't3', assigned_by_name: 'Unknown' },
            { _id: 't4' }],
  excavators: [{ _id: 'e1', assigned_by: 'COAL015', edited_by_name: 'Satish Kumar', edited_at: '2026-09-26T11:00:00+05:30', version: 3 }, { _id: 'e2', assigned_by: 'QQ1', version: 1 }],
  generic: [{ _id: 'a1', assigned_by: null, assigned_by_name: null }, { _id: 'a2', assigned_by: 'LI006', assigned_by_name: null }, { _id: 'a3', assigned_by: 'X', assigned_by_name: 'Typed Name' }]
}, name);
assert.deepStrictEqual([who.t1.by, who.t1.code, who.t1.editedBy, who.t1.version], ['Ishwardas Bhendarkar', 'LI006', 'Hemanta Kumar Nayak', 2]);  // the worker list gives one spelling
assert.strictEqual(who.t2.by, 'Zed Person');                    // code not in the worker list: the server's resolved name
assert.strictEqual(who.t3.by, null);                            // "Unknown" is not a name
assert.strictEqual(who.t4.by, null);
assert.deepStrictEqual([who.e1.by, who.e1.editedBy, who.e1.version], ['Anil Sitaram Yadav', 'Satish Kumar', 3]);
assert.strictEqual(who.e2.by, 'QQ1');                           // a code with no name at all is still better than nothing
assert.strictEqual(who.a1.by, null);                            // dozers and drills saved so far carry no deployer
assert.strictEqual(who.a2.by, 'Ishwardas Bhendarkar'); assert.strictEqual(who.a3.by, 'Typed Name');

// ── attach it to rows ──
const rows = [{ _id: 't1' }, { _id: 'a1' }, { _id: 'zz' }];
depApplyWho(rows, who);
assert.deepStrictEqual([rows[0].deployed_by, rows[0].deployed_by_code, rows[0].last_edited_by, rows[0].version], ['Ishwardas Bhendarkar', 'LI006', 'Hemanta Kumar Nayak', 2]);
assert.strictEqual(rows[1].deployed_by, ''); assert.strictEqual(rows[2].deployed_by, '');                  // '' sorts and searches cleanly; the table shows "Not recorded"
depApplyWho([{ _id: 'x', edited_by_name: 'From Server', version: 4 }], who);                                // nothing known about x: keep what the server sent
const keep = [{ _id: 'x', edited_by_name: 'From Server', version: 4 }]; depApplyWho(keep, who);
assert.deepStrictEqual([keep[0].last_edited_by, keep[0].version], ['From Server', 4]);

console.log('deployment-history: all checks passed');
