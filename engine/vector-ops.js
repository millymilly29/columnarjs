/**
 * COLUMNARJS // Vector Operations
 * Vectorized aggregation functions operating on TypedArrays.
 *
 * All functions take raw TypedArrays (or Uint32Array + pool for strings)
 * and a nullMask (Uint8Array where 0 = valid, 1 = null).
 * This enables JIT vectorization (SIMD) by the V8 engine.
 */

'use strict';

/**
 * Sum of a numeric column, excluding nulls.
 * @param {Float64Array|Int32Array} buf
 * @param {Uint8Array} nullMask
 * @param {number} rowCount
 * @returns {number}
 */
function vecSum(buf, nullMask, rowCount) {
  let sum = 0;
  for (let i = 0; i < rowCount; i++) {
    if (!nullMask[i]) sum += buf[i];
  }
  return sum;
}

/**
 * Count of non-null values in a column.
 * @param {Uint8Array} nullMask
 * @param {number} rowCount
 * @returns {number}
 */
function vecCount(nullMask, rowCount) {
  let count = 0;
  for (let i = 0; i < rowCount; i++) {
    if (!nullMask[i]) count++;
  }
  return count;
}

/**
 * Minimum of a numeric column.
 * @param {Float64Array|Int32Array} buf
 * @param {Uint8Array} nullMask
 * @param {number} rowCount
 * @returns {number}
 */
function vecMin(buf, nullMask, rowCount) {
  let min = Infinity;
  for (let i = 0; i < rowCount; i++) {
    if (!nullMask[i] && buf[i] < min) min = buf[i];
  }
  return min === Infinity ? null : min;
}

/**
 * Maximum of a numeric column.
 * @param {Float64Array|Int32Array} buf
 * @param {Uint8Array} nullMask
 * @param {number} rowCount
 * @returns {number}
 */
function vecMax(buf, nullMask, rowCount) {
  let max = -Infinity;
  for (let i = 0; i < rowCount; i++) {
    if (!nullMask[i] && buf[i] > max) max = buf[i];
  }
  return max === -Infinity ? null : max;
}

/**
 * Average of a numeric column.
 * @param {Float64Array|Int32Array} buf
 * @param {Uint8Array} nullMask
 * @param {number} rowCount
 * @returns {number|null}
 */
function vecAvg(buf, nullMask, rowCount) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < rowCount; i++) {
    if (!nullMask[i]) {
      sum += buf[i];
      count++;
    }
  }
  return count === 0 ? null : sum / count;
}

/**
 * Vectorized WHERE clause: builds a boolean bitmask for a single condition.
 * Returns Uint8Array where 1 = row passes filter.
 * @param {TypedArray} buf
 * @param {Uint8Array} nullMask
 * @param {number} rowCount
 * @param {string} op  '='|'!='|'>'|'>='|'<'|'<='|'LIKE'
 * @param {*} value
 * @param {string[]|null} pool  string pool for STRING columns
 * @returns {Uint8Array}
 */
function vecFilter(buf, nullMask, rowCount, op, value, pool) {
  const mask = new Uint8Array(rowCount);
  for (let i = 0; i < rowCount; i++) {
    if (nullMask[i]) { mask[i] = 0; continue; }
    const raw = pool ? pool[buf[i]] : buf[i];
    switch (op) {
      case '=':  case '==': mask[i] = raw == value ? 1 : 0; break;
      case '!=': case '<>': mask[i] = raw != value ? 1 : 0; break;
      case '>':             mask[i] = raw >  value ? 1 : 0; break;
      case '>=':            mask[i] = raw >= value ? 1 : 0; break;
      case '<':             mask[i] = raw <  value ? 1 : 0; break;
      case '<=':            mask[i] = raw <= value ? 1 : 0; break;
      case 'LIKE':          mask[i] = String(raw).toLowerCase().includes(String(value).toLowerCase()) ? 1 : 0; break;
      default: mask[i] = 1;
    }
  }
  return mask;
}

/**
 * AND two filter masks together, in-place (modifies maskA).
 * @param {Uint8Array} maskA
 * @param {Uint8Array} maskB
 */
function maskAnd(maskA, maskB) {
  for (let i = 0; i < maskA.length; i++) {
    maskA[i] = maskA[i] & maskB[i];
  }
}

/**
 * OR two filter masks together, producing a new mask.
 * @param {Uint8Array} maskA
 * @param {Uint8Array} maskB
 * @returns {Uint8Array}
 */
function maskOr(maskA, maskB) {
  const out = new Uint8Array(maskA.length);
  for (let i = 0; i < maskA.length; i++) {
    out[i] = (maskA[i] | maskB[i]) & 1;
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { vecSum, vecCount, vecMin, vecMax, vecAvg, vecFilter, maskAnd, maskOr };
}
