/**
 * COLUMNARJS // Verification Test Suite (20 tests)
 */

'use strict';

const { ColumnStore, TYPES } = require('../engine/column-store.js');
const { QueryEngine } = require('../engine/query-engine.js');
const { inferType } = require('../engine/type-system.js');
const { vecSum, vecCount, vecMin, vecMax, vecAvg } = require('../engine/vector-ops.js');

let passed = 0; let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✔ PASS: ${msg}`); passed++; }
  else       { console.error(`  ✘ FAIL: ${msg}`); failed++; }
}
function approx(a, b, eps = 0.0001) { return Math.abs(a - b) < eps; }

console.log('='.repeat(54));
console.log(' COLUMNARJS // VERIFICATION SUITE');
console.log('='.repeat(54) + '\n');

// ── Type Inference ──────────────────────────────────────────
assert(inferType([1, 2, 3])             === TYPES.INT,   'Infers INT from integer values');
assert(inferType([1.1, 2.2, 3.3])       === TYPES.FLOAT, 'Infers FLOAT from decimal values');
assert(inferType(['hello', 'world'])    === TYPES.STRING,'Infers STRING from text values');
assert(inferType([true, false, true])   === TYPES.BOOL,  'Infers BOOL from boolean values');
assert(inferType(['true', 'false'])     === TYPES.BOOL,  'Infers BOOL from string "true"/"false"');
assert(inferType([])                    === TYPES.STRING, 'Defaults to STRING on empty sample');

// ── Column Store: insertion & schema ───────────────────────
const store = new ColumnStore();
store.insertBatch([
  { id: 1, product: 'Keyboard', category: 'Electronics', revenue: 149.99, qty: 3, active: true  },
  { id: 2, product: 'Mouse',    category: 'Electronics', revenue: 49.99,  qty: 7, active: true  },
  { id: 3, product: 'Desk',     category: 'Furniture',   revenue: 349.00, qty: 1, active: false },
  { id: 4, product: 'Chair',    category: 'Furniture',   revenue: 229.00, qty: 2, active: true  },
  { id: 5, product: 'Monitor',  category: 'Electronics', revenue: 519.00, qty: 2, active: true  },
]);

assert(store.rowCount === 5, 'Row count is 5 after batch insert');
const schema = store.schema();
const colTypes = Object.fromEntries(schema.map(c => [c.name, c.type]));
assert(colTypes.id       === TYPES.INT,    'id column inferred as INT');
assert(colTypes.revenue  === TYPES.FLOAT,  'revenue column inferred as FLOAT');
assert(colTypes.product  === TYPES.STRING, 'product column inferred as STRING');
assert(colTypes.active   === TYPES.BOOL,   'active column inferred as BOOL');

const revCol = store._getCol('revenue');
assert(revCol.buf instanceof Float64Array, 'Revenue stored as Float64Array (TypedArray)');

// ── Vector Ops ─────────────────────────────────────────────
const buf  = new Float64Array([149.99, 49.99, 349.00, 229.00, 519.00]);
const mask = new Uint8Array(5); // no nulls
assert(approx(vecSum(buf, mask, 5), 1296.98),        'vecSum computes correct total');
assert(vecCount(mask, 5) === 5,                       'vecCount returns non-null count');
assert(approx(vecMin(buf, mask, 5), 49.99),           'vecMin returns minimum value');
assert(approx(vecMax(buf, mask, 5), 519.00),          'vecMax returns maximum value');
assert(approx(vecAvg(buf, mask, 5), 1296.98 / 5),     'vecAvg computes correct mean');

// ── Query Engine: SELECT + WHERE ───────────────────────────
const qe = new QueryEngine(store);

const allRows = qe.query();
assert(allRows.rows.length === 5, 'SELECT * returns all 5 rows');

const electronics = qe.query({ where: [{ col: 'category', op: '=', val: 'Electronics' }] });
assert(electronics.rows.length === 3, 'WHERE category = Electronics returns 3 rows');

const expensive = qe.query({ where: [{ col: 'revenue', op: '>', val: 200 }] });
assert(expensive.rows.length === 3, 'WHERE revenue > 200 returns 3 rows (Desk, Chair, Monitor)');

const specific = qe.query({ select: ['product', 'revenue'] });
assert(Object.keys(specific.rows[0]).length === 2, 'SELECT specific columns returns only those columns');

// ── GROUP BY + Aggregate ───────────────────────────────────
const byCategory = qe.query({
  groupBy: 'category',
  aggregate: [
    { col: 'revenue', func: 'SUM', as: 'total_revenue' },
    { col: 'revenue', func: 'AVG', as: 'avg_revenue' },
    { col: 'id',      func: 'COUNT', as: 'count' },
  ],
  orderBy: { col: 'total_revenue', dir: 'DESC' },
});
assert(byCategory.rows.length === 2, 'GROUP BY category yields 2 groups');
const electronics_group = byCategory.rows.find(r => r.category === 'Electronics');
assert(approx(electronics_group.total_revenue, 718.98), 'SUM(revenue) for Electronics is correct');
assert(electronics_group.count === 3, 'COUNT for Electronics group is 3');

// ── ORDER BY + LIMIT ───────────────────────────────────────
const top2 = qe.query({ orderBy: { col: 'revenue', dir: 'DESC' }, limit: 2 });
assert(top2.rows.length === 2, 'LIMIT 2 returns exactly 2 rows');
assert(top2.rows[0].product === 'Monitor', 'ORDER BY revenue DESC puts Monitor first (519.00)');

// ── Performance Benchmark ──────────────────────────────────
const bigStore = new ColumnStore();
const BIG_N = 500_000;
const categories = ['Electronics', 'Furniture', 'Clothing', 'Books', 'Sports'];
const bigBatch = [];
for (let i = 0; i < BIG_N; i++) {
  bigBatch.push({
    id: i,
    category: categories[i % categories.length],
    revenue: Math.random() * 1000,
    qty: Math.floor(Math.random() * 20) + 1,
  });
}
bigStore.insertBatch(bigBatch);
const bigQe = new QueryEngine(bigStore);
const t0 = Date.now();
const bigResult = bigQe.query({
  groupBy: 'category',
  aggregate: [
    { col: 'revenue', func: 'SUM', as: 'total' },
    { col: 'qty',     func: 'AVG', as: 'avg_qty' },
  ],
});
const elapsed = Date.now() - t0;
assert(bigResult.rows.length === 5,   `GROUP BY on ${BIG_N.toLocaleString()} rows yields 5 groups`);
assert(elapsed < 500,                  `GROUP BY + SUM/AVG on ${BIG_N.toLocaleString()} rows completes in <500ms (${elapsed}ms)`);
console.log(`     ↳ ${BIG_N.toLocaleString()} rows scanned in ${elapsed}ms`);

// ── Final ──────────────────────────────────────────────────
console.log('\n' + '-'.repeat(54));
console.log(` RESULTS: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
console.log('-'.repeat(54) + '\n');
if (failed > 0) process.exit(1);
