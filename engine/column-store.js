/**
 * COLUMNARJS // Column Store
 * Core columnar data structure.
 *
 * ARCHITECTURE:
 *   Traditional row store: [{id:1, revenue:42.5, ...}, {id:2, revenue:91.0, ...}]
 *   Columnar store:        { id: Int32Array([1,2,...]), revenue: Float64Array([42.5,91.0,...]) }
 *
 * WHY THIS IS FASTER:
 *   1. Cache locality  — summing revenue reads 512 contiguous floats per cache line,
 *      not scattered across row objects in the heap.
 *   2. No boxing       — TypedArrays hold raw numeric data; JS Arrays box every number.
 *   3. JIT-vectorizable — V8 can emit SIMD instructions for tight typed loops.
 *   4. Predicate pushdown — a WHERE on `category` touches only that column's bytes.
 */

'use strict';

const { TYPES, inferType, createBuffer, coerce } = require('./type-system.js');

const INITIAL_CAPACITY = 1024;
const GROWTH_FACTOR   = 2;

class ColumnStore {
  constructor() {
    /** @type {Map<string, { type: string, buf: TypedArray, nullMask: Uint8Array, pool: string[]|null, poolIndex: Map|null, capacity: number }>} */
    this._cols = new Map();
    this._rowCount = 0;
    this._capacity = INITIAL_CAPACITY;
  }

  // ─── Schema ───────────────────────────────────────────────────────────────

  /**
   * Infer and register schema from a sample array of row objects.
   * Must be called before insert() or together with insertBatch().
   */
  _initSchema(rows) {
    if (rows.length === 0) return;
    const keys = Object.keys(rows[0]);
    for (const key of keys) {
      if (this._cols.has(key)) continue;
      const values = rows.map(r => r[key]);
      const type   = inferType(values);
      this._cols.set(key, {
        type,
        buf:       createBuffer(type, this._capacity),
        nullMask:  new Uint8Array(this._capacity),
        pool:      type === TYPES.STRING ? [] : null,
        poolIndex: type === TYPES.STRING ? new Map() : null,
        capacity:  this._capacity,
      });
    }
  }

  /**
   * Register a column with an explicit type. Useful when schema is known upfront.
   * @param {string} name
   * @param {string} type  TYPES.*
   */
  defineColumn(name, type) {
    if (this._cols.has(name)) throw new Error(`Column "${name}" already defined.`);
    this._cols.set(name, {
      type,
      buf:       createBuffer(type, this._capacity),
      nullMask:  new Uint8Array(this._capacity),
      pool:      type === TYPES.STRING ? [] : null,
      poolIndex: type === TYPES.STRING ? new Map() : null,
      capacity:  this._capacity,
    });
  }

  /**
   * Returns the current schema as an array of { name, type }.
   */
  schema() {
    return [...this._cols.entries()].map(([name, col]) => ({ name, type: col.type }));
  }

  // ─── Insert ───────────────────────────────────────────────────────────────

  /**
   * Insert a batch of row objects. Infers schema from first batch if not defined.
   * @param {Object[]} rows
   */
  insertBatch(rows) {
    if (rows.length === 0) return;
    if (this._cols.size === 0) this._initSchema(rows);

    // Grow buffers if needed
    const needed = this._rowCount + rows.length;
    if (needed > this._capacity) this._grow(needed);

    for (const row of rows) {
      const i = this._rowCount;
      for (const [name, col] of this._cols) {
        const raw = row[name];
        if (raw === null || raw === undefined || raw === '') {
          col.nullMask[i] = 1;
          continue;
        }
        col.nullMask[i] = 0;
        const val = coerce(raw, col.type);
        if (col.type === TYPES.STRING) {
          let idx = col.poolIndex.get(val);
          if (idx === undefined) {
            idx = col.pool.length;
            col.pool.push(val);
            col.poolIndex.set(val, idx);
          }
          col.buf[i] = idx;
        } else {
          col.buf[i] = val;
        }
      }
      this._rowCount++;
    }
  }

  /**
   * Insert a single row.
   * @param {Object} row
   */
  insert(row) {
    this.insertBatch([row]);
  }

  // ─── Buffer management ─────────────────────────────────────────────────────

  _grow(minCapacity) {
    let cap = this._capacity;
    while (cap < minCapacity) cap = cap * GROWTH_FACTOR;
    this._capacity = cap;

    for (const col of this._cols.values()) {
      const oldBuf  = col.buf;
      const oldMask = col.nullMask;
      col.buf       = createBuffer(col.type, cap);
      col.nullMask  = new Uint8Array(cap);
      col.buf.set(oldBuf.subarray(0, this._rowCount));
      col.nullMask.set(oldMask.subarray(0, this._rowCount));
      col.capacity = cap;
    }
  }

  // ─── Internal column access ────────────────────────────────────────────────

  /**
   * Get raw column internals for a given name.
   * @param {string} name
   * @returns {{ type, buf, nullMask, pool, rowCount }}
   */
  _getCol(name) {
    const col = this._cols.get(name);
    if (!col) throw new Error(`Column "${name}" not found. Available: ${[...this._cols.keys()].join(', ')}`);
    return { ...col, rowCount: this._rowCount };
  }

  /**
   * Decode the value at row index i for column name, respecting string pool.
   */
  _decodeAt(name, i) {
    const col = this._cols.get(name);
    if (!col) return undefined;
    if (col.nullMask[i]) return null;
    if (col.type === TYPES.STRING) return col.pool[col.buf[i]];
    if (col.type === TYPES.BOOL)   return col.buf[i] === 1;
    return col.buf[i];
  }

  // ─── Public properties ─────────────────────────────────────────────────────

  get rowCount() { return this._rowCount; }

  get columnNames() { return [...this._cols.keys()]; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ColumnStore, TYPES };
}
