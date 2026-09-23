/**
 * COLUMNARJS // Type System
 * Data type inference, coercion, and typed buffer management.
 */

const TYPES = {
  INT:    'INT',
  FLOAT:  'FLOAT',
  STRING: 'STRING',
  BOOL:   'BOOL',
};

/**
 * Infer column type from a sample of values.
 * Samples up to 256 non-null values for speed.
 */
function inferType(values) {
  const sample = [];
  for (let i = 0; i < values.length && sample.length < 256; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && v !== '') sample.push(v);
  }
  if (sample.length === 0) return TYPES.STRING;

  if (sample.every(v => v === true || v === false || v === 'true' || v === 'false' || v === 1 || v === 0)) {
    return TYPES.BOOL;
  }
  if (sample.every(v => {
    const n = Number(v);
    return !isNaN(n) && Number.isInteger(n) && String(v).indexOf('.') === -1;
  })) {
    return TYPES.INT;
  }
  if (sample.every(v => !isNaN(Number(v)) && String(v).trim() !== '')) {
    return TYPES.FLOAT;
  }
  return TYPES.STRING;
}

/**
 * Create a typed array buffer appropriate for the given type.
 * Numerics use TypedArrays for cache-locality and JIT vectorization.
 * Strings use Uint32Array of pool indices + a string intern pool.
 * Booleans use Uint8Array.
 */
function createBuffer(type, capacity) {
  switch (type) {
    case TYPES.INT:    return new Int32Array(capacity);
    case TYPES.FLOAT:  return new Float64Array(capacity);
    case TYPES.BOOL:   return new Uint8Array(capacity);
    case TYPES.STRING: return new Uint32Array(capacity); // indices into string pool
    default: throw new Error(`Unknown type: ${type}`);
  }
}

/**
 * Coerce a raw value into the canonical JS form for a given type.
 */
function coerce(value, type) {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case TYPES.INT:    return Math.trunc(Number(value));
    case TYPES.FLOAT:  return Number(value);
    case TYPES.BOOL:   return value === true || value === 'true' || value === 1 ? 1 : 0;
    case TYPES.STRING: return String(value);
    default: return value;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TYPES, inferType, createBuffer, coerce };
}
