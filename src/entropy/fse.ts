import {readBitsAt} from './bits/readBitsAt.ts'
import {integer} from './validation.ts'

/** Maps each FSE state to a symbol and a transition of base[state] + read(bits[state]). */
export interface FseTable {
  tableLog: number
  symbols: Uint8Array
  bits: Uint8Array
  base: Uint16Array
}

/** Builds an FSE table from normalized counts, where -1 occupies one low-probability state. */
export function buildFseTable(counts: readonly number[], tableLog: number): FseTable {
  // A 16-bit baseline can represent at most 2^16 states.
  integer(tableLog, 0, 16, 'FSE table log')
  integer(counts.length, 1, 256, 'FSE symbol count')
  const size = 2 ** tableLog
  let sum = 0
  for (const count of counts) {
    integer(count, -1, size, 'FSE normalized count')
    sum += count === -1 ? 1 : count
  }
  if (sum !== size) {
    throw new Error(`FSE normalized counts sum to ${sum}, expected ${size}.`)
  }

  const symbols = new Uint8Array(size)
  const bits = new Uint8Array(size)
  const base = new Uint16Array(size)
  const nextState = new Uint32Array(counts.length)
  let high = size - 1
  for (let symbol = 0; symbol < counts.length; symbol++) {
    const count = counts[symbol]
    nextState[symbol] = count === -1 ? 1 : count
    if (count === -1) symbols[high--] = symbol
  }

  // Wire tables have log ≥ 5. Sequential spreading also supports tiny synthetic/RLE tables.
  const step = size < 16 ? 1 : size / 2 + size / 8 + 3
  let position = 0
  for (let symbol = 0; symbol < counts.length; symbol++) {
    for (let i = 0; i < counts[symbol]; i++) {
      symbols[position] = symbol
      do {
        position = (position + step) % size
      } while (position > high)
    }
  }
  for (let state = 0; state < size; state++) {
    const next = nextState[symbols[state]]++
    const count = tableLog - Math.floor(Math.log2(next))
    bits[state] = count
    base[state] = next * 2 ** count - size
  }
  return {tableLog, symbols, bits, base}
}

/** Parses a forward normalized-count header and skips the unused bits of its final byte. */
export function readFseTable(
  data: Uint8Array,
  offset: number,
  maxSymbol: number,
  maxTableLog: number,
): {table: FseTable; next: number} {
  integer(offset, 0, data.length, 'FSE byte offset')
  integer(maxSymbol, 0, 255, 'FSE maximum symbol')
  integer(maxTableLog, 5, 16, 'FSE maximum table log')
  let position = offset * 8
  const read = (count: number): number => {
    if (position + count > data.length * 8) {
      throw new Error('Truncated FSE normalized-count header.')
    }
    const value = readBitsAt(data, position, count)
    position += count
    return value
  }
  const tableLog = read(4) + 5
  if (tableLog > maxTableLog) {
    throw new Error(`FSE table log ${tableLog} exceeds maximum ${maxTableLog}.`)
  }
  let remaining = 2 ** tableLog
  let present = 0
  const counts: number[] = []
  while (remaining > 0) {
    if (counts.length > maxSymbol) {
      throw new Error(`FSE normalized counts exceed maximum symbol ${maxSymbol}.`)
    }
    // Small values use one fewer bit. Read that prefix first to avoid speculative overreads.
    const width = Math.floor(Math.log2(remaining + 1)) + 1
    const half = 2 ** (width - 1)
    const threshold = 2 ** width - 2 - remaining
    let value = read(width - 1)
    if (value >= threshold) {
      value += read(1) * half
      if (value >= half) value -= threshold
    }
    const count = value - 1
    counts.push(count)
    remaining -= Math.abs(count)
    if (count !== 0) {
      present++
    } else {
      let repeat: number
      do {
        repeat = read(2)
        // A nonzero symbol must still follow the zero run.
        if (counts.length + repeat > maxSymbol) {
          throw new Error(`FSE zero run exceeds maximum symbol ${maxSymbol}.`)
        }
        for (let i = 0; i < repeat; i++) counts.push(0)
      } while (repeat === 3)
    }
  }
  if (remaining !== 0 || present < 2) {
    throw new Error('Invalid FSE distribution: expected a normalized sum and at least two symbols.')
  }
  return {table: buildFseTable(counts, tableLog), next: Math.ceil(position / 8)}
}
