# columnarjs

<p align="left">
  <img src="https://img.shields.io/badge/language-JavaScript-080806?style=flat-square&labelColor=161616" alt="Language">
  <img src="https://img.shields.io/badge/license-MIT-080806?style=flat-square&labelColor=161616" alt="License">
  <img src="https://img.shields.io/badge/tests-28%2F28-080806?style=flat-square&labelColor=161616" alt="Tests">
  <img src="https://img.shields.io/badge/dependencies-zero-080806?style=flat-square&labelColor=161616" alt="Zero Dependencies">
  <a href="https://millymilly29.github.io"><img src="https://img.shields.io/badge/portfolio-millymilly29.github.io-080806?style=flat-square&labelColor=161616" alt="Portfolio"></a>
</p>

In-process columnar analytics engine for Node.js and the browser. Stores data in `Float64Array` / `Int32Array` / `Uint8Array` buffers for cache-local vectorized aggregation — no WASM, no backend, no dependencies.

---

### Why columnar

Traditional JS stores rows as objects: `[{id:1, revenue:42}, {id:2, revenue:91}]`. Every aggregation touches every field of every row, scattering reads across heap memory.

Columnar storage keeps each field contiguous: `revenue → Float64Array([42, 91, ...])`. Summing one million revenue values reads a single contiguous memory region — V8 JIT-compiles this to SIMD instructions.

---

### Benchmarks

| Operation | Rows | Time |
| :--- | :---: | :---: |
| INSERT batch | 1,000,000 | 420ms |
| SUM(revenue) | 1,000,000 | 4ms |
| GROUP BY + SUM + AVG | 500,000 | 55ms |
| WHERE + ORDER BY + LIMIT | 500,000 | 18ms |
| Row-scan Array.reduce | 1,000,000 | 7ms |

---

### Quick Start

```js
const { ColumnStore } = require('./engine/column-store');
const { QueryEngine }  = require('./engine/query-engine');

const store = new ColumnStore();
store.insertBatch([
  { product: 'Keyboard', category: 'Electronics', revenue: 149.99, qty: 3 },
  { product: 'Desk',     category: 'Furniture',   revenue: 349.00, qty: 1 },
  { product: 'Monitor',  category: 'Electronics', revenue: 519.00, qty: 2 },
]);

const qe = new QueryEngine(store);

// GROUP BY with multiple aggregates
const result = qe.query({
  groupBy: 'category',
  aggregate: [
    { col: 'revenue', func: 'SUM',   as: 'total' },
    { col: 'revenue', func: 'AVG',   as: 'avg'   },
    { col: 'qty',     func: 'COUNT', as: 'orders' },
  ],
  orderBy: { col: 'total', dir: 'DESC' },
});
// → [{ category: 'Electronics', total: 668.99, avg: 334.495, orders: 2 },
//    { category: 'Furniture',   total: 349.00, avg: 349.00,  orders: 1 }]
```

---

### API

```
ColumnStore
  .insertBatch(rows[])     Insert array of row objects. Schema inferred on first call.
  .insert(row)             Insert single row.
  .defineColumn(name,type) Explicit schema definition (INT|FLOAT|STRING|BOOL).
  .schema()                Returns [{ name, type }].
  .rowCount                Number of rows stored.

QueryEngine(store)
  .query(opts)             Execute query. Returns { rows, duration, rowsScanned, rowsReturned }.
  .agg(func, col)          Fast scalar aggregate over entire column.

Query Options
  select     string[]      Columns to return (default: all)
  where      Condition[]   [{ col, op, val, logic? }] — op: = != > >= < <= LIKE
  groupBy    string        Column name to group by
  aggregate  AggSpec[]     [{ col, func, as }] — SUM AVG COUNT MIN MAX
  having     Condition     Post-aggregation filter
  orderBy    { col, dir }  ASC | DESC
  limit      number
```

---

### Run

```bash
node cli.js demo    # 200,000-row e-commerce analytics demo
node cli.js bench   # columnar vs row-scan benchmark at 100K / 500K / 1M rows
node tests/columnar.test.js  # 28-point verification suite
```

---

### Contact

[millymilly29.github.io](https://millymilly29.github.io) · [@therealfullmetal](https://t.me/therealfullmetal) · [millyrock2900@gmail.com](mailto:millyrock2900@gmail.com)
