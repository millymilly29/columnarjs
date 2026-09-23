/**
 * COLUMNARJS // Query Engine
 * SQL-like query execution over columnar stores.
 *
 * Supported operations:
 *   select     string[]          columns to return (default: all)
 *   where      Condition[]       filter rows before aggregation
 *   groupBy    string            column name to group by
 *   aggregate  AggSpec[]         { col, func, as } — SUM/AVG/COUNT/MIN/MAX
 *   having     Condition         post-aggregation filter
 *   orderBy    { col, dir }      'ASC' | 'DESC'
 *   limit      number
 *
 * WHERE Condition: { col, op, val, logic? }
 *   op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE'
 *   logic: 'AND' (default) | 'OR'
 */

'use strict';

const { ColumnStore } = require('./column-store.js');
const { vecSum, vecCount, vecMin, vecMax, vecAvg, vecFilter, maskAnd, maskOr } = require('./vector-ops.js');
const { TYPES } = require('./type-system.js');

class QueryEngine {
  /**
   * @param {ColumnStore} store
   */
  constructor(store) {
    this._store = store;
  }

  /**
   * Execute a query and return result rows as plain objects.
   * @param {Object} opts
   * @returns {{ rows: Object[], duration: number, rowsScanned: number, rowsReturned: number }}
   */
  query(opts = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const store = this._store;
    const n = store.rowCount;

    // ── 1. Build row bitmask from WHERE conditions ──────────────────────────
    let rowMask = new Uint8Array(n).fill(1); // all rows pass by default

    if (opts.where && opts.where.length > 0) {
      for (const cond of opts.where) {
        const { col: colName, op, val, logic = 'AND' } = cond;
        const colData = store._getCol(colName);
        const condMask = vecFilter(
          colData.buf, colData.nullMask, n, op, val,
          colData.type === TYPES.STRING ? colData.pool : null
        );
        if (logic === 'OR') {
          rowMask = maskOr(rowMask, condMask);
        } else {
          maskAnd(rowMask, condMask);
        }
      }
    }

    // ── 2. Collect matching row indices ────────────────────────────────────
    const matchingIndices = [];
    for (let i = 0; i < n; i++) {
      if (rowMask[i]) matchingIndices.push(i);
    }

    // ── 3. GROUP BY + AGGREGATE ────────────────────────────────────────────
    if (opts.groupBy && opts.aggregate && opts.aggregate.length > 0) {
      const groupColData = store._getCol(opts.groupBy);
      const groups = new Map(); // groupKey -> { indices[] }

      for (const i of matchingIndices) {
        const key = store._decodeAt(opts.groupBy, i);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }

      let aggRows = [];
      for (const [key, indices] of groups) {
        const row = { [opts.groupBy]: key };
        for (const spec of opts.aggregate) {
          const colData = store._getCol(spec.col);
          const subBuf  = new Float64Array(indices.length);
          const subMask = new Uint8Array(indices.length);
          for (let j = 0; j < indices.length; j++) {
            subBuf[j]  = colData.buf[indices[j]];
            subMask[j] = colData.nullMask[indices[j]];
          }
          const alias = spec.as || `${spec.func}(${spec.col})`;
          switch (spec.func.toUpperCase()) {
            case 'SUM':   row[alias] = vecSum(subBuf, subMask, indices.length); break;
            case 'AVG':   row[alias] = vecAvg(subBuf, subMask, indices.length); break;
            case 'COUNT': row[alias] = indices.length; break;
            case 'MIN':   row[alias] = vecMin(subBuf, subMask, indices.length); break;
            case 'MAX':   row[alias] = vecMax(subBuf, subMask, indices.length); break;
            default: throw new Error(`Unknown aggregate function: ${spec.func}`);
          }
        }
        aggRows.push(row);
      }

      // HAVING filter
      if (opts.having) {
        const { col: hCol, op: hOp, val: hVal } = opts.having;
        aggRows = aggRows.filter(r => {
          const v = r[hCol];
          switch (hOp) {
            case '>':  return v >  hVal;
            case '>=': return v >= hVal;
            case '<':  return v <  hVal;
            case '<=': return v <= hVal;
            case '=':  case '==': return v == hVal;
            case '!=': case '<>': return v != hVal;
            default: return true;
          }
        });
      }

      // ORDER BY
      if (opts.orderBy) {
        const { col: oCol, dir = 'ASC' } = opts.orderBy;
        aggRows.sort((a, b) => dir === 'DESC' ? b[oCol] - a[oCol] : a[oCol] - b[oCol]);
      }

      // LIMIT
      const limited = opts.limit ? aggRows.slice(0, opts.limit) : aggRows;

      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return {
        rows: limited,
        duration: t1 - t0,
        rowsScanned: n,
        rowsReturned: limited.length,
      };
    }

    // ── 4. Plain SELECT (no GROUP BY) ─────────────────────────────────────
    const selectCols = opts.select && opts.select.length > 0
      ? opts.select
      : store.columnNames;

    // ORDER BY on raw rows
    if (opts.orderBy) {
      const { col: oCol, dir = 'ASC' } = opts.orderBy;
      const colData = store._getCol(oCol);
      matchingIndices.sort((a, b) => {
        const va = colData.pool ? colData.pool[colData.buf[a]] : colData.buf[a];
        const vb = colData.pool ? colData.pool[colData.buf[b]] : colData.buf[b];
        return dir === 'DESC' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
      });
    }

    // LIMIT
    const take = opts.limit ? matchingIndices.slice(0, opts.limit) : matchingIndices;

    // Materialise rows
    const rows = take.map(i => {
      const row = {};
      for (const name of selectCols) {
        row[name] = store._decodeAt(name, i);
      }
      return row;
    });

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      rows,
      duration: t1 - t0,
      rowsScanned: n,
      rowsReturned: rows.length,
    };
  }

  /**
   * Shortcut: aggregate an entire column (no grouping).
   * @param {string} func  SUM|AVG|COUNT|MIN|MAX
   * @param {string} colName
   * @returns {number}
   */
  agg(func, colName) {
    const store = this._store;
    const n = store.rowCount;
    if (func.toUpperCase() === 'COUNT') {
      return n;
    }
    const col = store._getCol(colName);
    switch (func.toUpperCase()) {
      case 'SUM':   return vecSum(col.buf, col.nullMask, n);
      case 'AVG':   return vecAvg(col.buf, col.nullMask, n);
      case 'MIN':   return vecMin(col.buf, col.nullMask, n);
      case 'MAX':   return vecMax(col.buf, col.nullMask, n);
      default: throw new Error(`Unknown function: ${func}`);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QueryEngine };
}
