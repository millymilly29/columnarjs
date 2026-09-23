#!/usr/bin/env node
/**
 * COLUMNARJS // CLI
 * Usage:
 *   node cli.js demo          — run synthetic e-commerce demo
 *   node cli.js bench         — benchmark 1M row aggregation vs Array.reduce
 *   node cli.js csv <file>    — load a CSV file and enter query REPL
 */

'use strict';

const { ColumnStore } = require('./engine/column-store.js');
const { QueryEngine }  = require('./engine/query-engine.js');
const fs   = require('fs');
const path = require('path');

const cmd = process.argv[2] || 'demo';

// ── Benchmark helper ─────────────────────────────────────────────────────────
function timer(label, fn) {
  const t0 = Date.now();
  const result = fn();
  const ms = Date.now() - t0;
  console.log(`  ${label.padEnd(40)} ${String(ms + 'ms').padStart(8)}`);
  return result;
}

// ── DEMO ─────────────────────────────────────────────────────────────────────
if (cmd === 'demo') {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  COLUMNARJS  //  E-Commerce Analytics Demo       ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const ROWS = 200_000;
  const cats = ['Electronics', 'Furniture', 'Clothing', 'Books', 'Sports'];
  const regions = ['EMEA', 'APAC', 'AMER'];
  const prods = ['Keyboard', 'Desk', 'T-Shirt', 'Novel', 'Helmet',
                 'Monitor', 'Chair', 'Sneakers', 'Textbook', 'Bike'];

  process.stdout.write(`  Generating ${ROWS.toLocaleString()} synthetic rows... `);
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push({
      id:       i + 1,
      product:  prods[i % prods.length],
      category: cats[i % cats.length],
      region:   regions[i % regions.length],
      revenue:  Math.round(Math.random() * 99900 + 100) / 100,
      qty:      Math.floor(Math.random() * 50) + 1,
    });
  }
  console.log('done.\n');

  const store = new ColumnStore();
  timer('insertBatch(200,000 rows)', () => store.insertBatch(rows));

  const qe = new QueryEngine(store);
  console.log('');

  // Q1
  const q1 = timer('GROUP BY category — SUM(revenue), AVG(qty), COUNT', () =>
    qe.query({
      groupBy: 'category',
      aggregate: [
        { col: 'revenue', func: 'SUM',   as: 'total_revenue' },
        { col: 'qty',     func: 'AVG',   as: 'avg_qty' },
        { col: 'id',      func: 'COUNT', as: 'orders' },
      ],
      orderBy: { col: 'total_revenue', dir: 'DESC' },
    })
  );
  console.log('');
  console.log('  Category breakdown:');
  for (const r of q1.rows) {
    console.log(`    ${r.category.padEnd(14)} $${r.total_revenue.toFixed(2).padStart(12)}   avg qty: ${r.avg_qty.toFixed(1).padStart(5)}   orders: ${r.orders}`);
  }

  // Q2
  console.log('');
  const q2 = timer('WHERE revenue > 500 AND region = EMEA — top 5 by revenue', () =>
    qe.query({
      where: [
        { col: 'revenue', op: '>', val: 500 },
        { col: 'region',  op: '=', val: 'EMEA' },
      ],
      orderBy: { col: 'revenue', dir: 'DESC' },
      limit: 5,
    })
  );
  console.log('');
  console.log('  Top 5 EMEA orders > $500:');
  for (const r of q2.rows) {
    console.log(`    #${String(r.id).padStart(6)}  ${r.product.padEnd(12)}  $${r.revenue.toFixed(2)}`);
  }

  console.log('\n  Rows scanned:', ROWS.toLocaleString());
  console.log('  Schema:', store.schema().map(c => `${c.name}:${c.type}`).join(', '));
  console.log('');
}

// ── BENCH ────────────────────────────────────────────────────────────────────
else if (cmd === 'bench') {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  COLUMNARJS  //  Benchmark: Columnar vs Row      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const N_VALUES = [100_000, 500_000, 1_000_000];

  for (const N of N_VALUES) {
    console.log(`  ── ${N.toLocaleString()} rows ──────────────────────────`);

    // Build columnar store
    const store = new ColumnStore();
    const rows = [];
    for (let i = 0; i < N; i++) {
      rows.push({ id: i, revenue: Math.random() * 1000, qty: Math.floor(Math.random() * 20) + 1 });
    }
    store.insertBatch(rows);
    const qe = new QueryEngine(store);

    // Columnar SUM
    const colTime = timer('  Columnar SUM(revenue)', () => qe.agg('SUM', 'revenue'));

    // Row-scan SUM (standard JS Array.reduce)
    const rowTime = timer('  Row-scan Array.reduce', () =>
      rows.reduce((acc, r) => acc + r.revenue, 0)
    );

    // Raw TypedArray loop (theoretical max)
    const revBuf = store._getCol('revenue').buf;
    timer('  Raw Float64Array loop  ', () => {
      let s = 0; for (let i = 0; i < N; i++) s += revBuf[i]; return s;
    });

    console.log('');
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────
else if (cmd === 'csv') {
  const file = process.argv[3];
  if (!file) { console.error('Usage: node cli.js csv <path>'); process.exit(1); }

  const text = fs.readFileSync(path.resolve(file), 'utf8');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i]?.trim() ?? null; });
    return row;
  });

  const store = new ColumnStore();
  store.insertBatch(rows);
  const qe = new QueryEngine(store);

  console.log(`\nLoaded ${rows.length.toLocaleString()} rows.`);
  console.log('Schema:', store.schema().map(c => `${c.name}:${c.type}`).join(', '));
  console.log('\nRun qe.query({ ... }) to query. Schema above.\n');
  console.log('Example: node -e "const {ColumnStore}=require(\'./engine/column-store\'); ..."');
}

else {
  console.log('Usage: node cli.js [demo|bench|csv <file>]');
}
