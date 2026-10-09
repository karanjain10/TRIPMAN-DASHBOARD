// Run: node tests/worker-departments.test.js
// Pulls the pure department grouping (wp:pure) out of index.html and checks it.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const m = html.match(/\/\/ wp:pure:start([\s\S]*?)\/\/ wp:pure:end/);
assert(m, 'wp:pure markers not found in index.html');
const { wpDeptList, wpGroups, wpSameDepts } = new Function(m[1] + '; return { wpDeptList, wpGroups, wpSameDepts };')();
const D = [['maintenance', 'Maintenance'], ['hr', 'HR'], ['production', 'Production'], ['fuel', 'Fuel']];
const w = (n, departments) => ({ _id: n, name: n, departments });

// missing or odd values read as no departments
assert.deepStrictEqual([wpDeptList({}), wpDeptList({ departments: null }), wpDeptList({ departments: ['hr'] })], [[], [], ['hr']]);

// grouped in menu order; a worker sits under their FIRST department in that order, not the order they were stored in
const g = wpGroups([w('a', ['fuel', 'maintenance']), w('b', []), w('c', ['hr']), w('d'), w('e', ['maintenance'])], D);
assert.deepStrictEqual(g.map(x => x.key), ['maintenance', 'hr', '']);
assert.deepStrictEqual(g[0].workers.map(x => x.name), ['a', 'e']);
assert.deepStrictEqual(g[2].workers.map(x => x.name), ['b', 'd']);
assert.strictEqual(g[2].label, 'No department');
// every worker appears exactly once
assert.strictEqual(g.reduce((n, x) => n + x.workers.length, 0), 5);
// an unknown department value does not hide the worker
assert.deepStrictEqual(wpGroups([w('z', ['legal'])], D).map(x => x.key), ['']);
// empty groups are dropped
assert.deepStrictEqual(wpGroups([], D), []);

assert(wpSameDepts(['hr', 'fuel'], ['fuel', 'hr']) && !wpSameDepts(['hr'], ['hr', 'fuel']) && wpSameDepts([], []));
console.log('worker-departments: all checks passed');
