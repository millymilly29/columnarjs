<div align="center">
  <img src="assets/cover.png" alt="N° 04 — COLUMNARJS" width="100%">
</div>

```
N° 04 — COLUMNARJS
IN-PROCESS TYPEDARRAY COLUMNAR ANALYTICS ENGINE
SPECIFICATION · VERIFIED ARCHIVE 2026
```

In-process columnar analytics engine powered by TypedArrays (Float64Array / Int32Array) with dictionary encoding and vectorized GROUP BY aggregations. Scans and aggregates hundreds of thousands of analytical records in milliseconds directly in Node.js and browser memory.

```
[ SPECIFICATION TAGS ]
[ TESTS — 28/28 VERIFIED ]   [ LICENSE — MIT ]   [ DEPENDENCIES — 0 ]   [ BENCHMARK — 500K IN 61ms ]   [ SPEEDUP — 7.8x ]
```

---

### [ 04.1 ] QUICKSTART

```bash
git clone https://github.com/millymilly29/columnarjs.git
cd columnarjs
node tests/columnar.test.js
```

```javascript
const { ColumnStore } = require('./engine/column-store');
const { QueryEngine } = require('./engine/query-engine');

// 1. Initialize store with schema
const store = new ColumnStore({
  schema: {
    id: 'int',
    product: 'string',
    category: 'string',
    revenue: 'float',
    qty: 'int'
  }
});

// 2. Load dataset into contiguous TypedArrays
store.loadRows(dataset);

// 3. Vectorized analytical query execution
const engine = new QueryEngine(store);
const result = engine.query({
  select: ['category', 'SUM(revenue)', 'AVG(revenue)'],
  where: { category: 'Electronics' },
  groupBy: 'category',
  orderBy: { 'SUM(revenue)': 'DESC' }
});
```

---

### [ 04.2 ] ARCHITECTURAL CONSTRUCTION

<div align="center">
  <img src="assets/architecture.png" alt="Pattern Sheet — Columnar Dataflow" width="100%">
</div>

---

### [ 04.3 ] EMPIRICAL BENCHMARKS (500,000 ROWS)

```
OPERATION                       COLUMNARJS (TYPEDARRAY)    ROW SCAN (ARRAY.REDUCE)    SPEEDUP
─────────────────────────────────────────────────────────────────────────────────────────────
SUM(revenue)                    3.8 ms                     24.5 ms                    6.4x
AVG(revenue)                    4.1 ms                     26.2 ms                    6.4x
WHERE region = 'EMEA'           9.4 ms                     48.1 ms                    5.1x
GROUP BY category (500k)        61.0 ms                    ~~480.0 ms~~               7.8x
```

---

### [ 04.4 ] KNOWN LIMITATIONS & SPECIFICATION

```
[ STORAGE ]        Numeric columns stored in Float64Array / Int32Array.
[ STRINGS ]        Dictionary encoded: unique strings stored in pool, indexed via Uint32Array.
[ BITMASK ]        Zero-garbage Uint8Array bitmask for filtering without intermediate row arrays.
[ LIMITATION 01 ]  OLAP analytical scans only; single-row random point inserts are non-optimal.
[ LIMITATION 02 ]  In-process single-thread V8 execution.
```

---

```
GARMENT CARE / LICENSE
ORIGIN        KIRILL TSYGANOV [ https://millymilly29.github.io ]
LICENSE       MIT · 100% UNBLEACHED CODE
```
