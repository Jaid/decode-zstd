import {HuffmanBits} from './bits/HuffmanBits.ts'
import {ReverseBits} from './bits/ReverseBits.ts'
import {readFseTable} from './fse.ts'
import {integer} from './validation.ts'

/** Maps a tableLog-bit, high-bit-first lookahead to a symbol and its actual code length. */
export interface HuffmanTable {
  bits: Uint8Array
  symbols: Uint8Array
  tableLog: number
}

/** Reads raw nibble or FSE-compressed Huffman weights, including the implicit last symbol. */
export function readHuffmanTable(data: Uint8Array, offset = 0): {
  next: number
  table: HuffmanTable
} {
  integer(offset, 0, data.length, 'Huffman byte offset')
  if (offset === data.length) {
    throw new Error('Missing Huffman tree header.')
  }
  const header = data[offset++]
  let weights: Array<number>
  let next: number
  if (header >= 128) {
    const count = header - 127
    next = offset + Math.ceil(count / 2)
    if (next > data.length) {
      throw new Error('Truncated raw Huffman weights.')
    }
    weights = []
    for (let i = 0; i < count; i++) {
      const byte = data[offset + Math.floor(i / 2)]
      weights.push(i % 2 === 0 ? byte >>> 4 : byte & 15)
    }
  } else {
    next = offset + header
    if (header === 0 || next > data.length) {
      throw new Error('Invalid or truncated FSE Huffman weights.')
    }
    weights = readWeights(data.subarray(offset, next))
  }
  return {
    table: buildHuffmanTable(weights),
    next,
  }
}

/** Decodes exactly outputSize bytes from one stream or a six-byte jump table and four streams. */
export function decodeHuffman(data: Uint8Array, outputSize: number, table: HuffmanTable, fourStreams: boolean): Uint8Array {
  integer(outputSize, 0, Number.MAX_SAFE_INTEGER, 'Huffman output size')
  integer(table.tableLog, 1, 11, 'Huffman table log')
  const size = 2 ** table.tableLog
  if (!(table.symbols instanceof Uint8Array) || !(table.bits instanceof Uint8Array)
    || table.symbols.length !== size || table.bits.length !== size) {
    throw new Error('Invalid Huffman decoding table dimensions.')
  }
  // Every output symbol needs at least one bit. Check before allocating untrusted sizes.
  if (outputSize > data.length * 8) {
    throw new Error('Huffman output size exceeds available encoded bits.')
  }
  if (!fourStreams) {
    const output = new Uint8Array(outputSize)
    decodeStream(data, output, 0, outputSize, table)
    return output
  }
  if (data.length < 10) {
    throw new Error('Truncated Huffman jump table or four-stream payload.')
  }
  const segmentSize = Math.ceil(outputSize / 4)
  if (segmentSize * 3 > outputSize) {
    throw new Error('Huffman output size gives a negative fourth segment.')
  }
  const ends = [6]
  for (let i = 0; i < 3; i++) {
    const length = data[i * 2] + data[i * 2 + 1] * 256
    if (length === 0) {
      throw new Error('Huffman jump table contains an empty stream.')
    }
    ends.push(ends[i] + length)
  }
  if (ends[3] >= data.length) {
    throw new Error('Huffman jump table leaves no fourth stream or exceeds input.')
  }
  ends.push(data.length)
  const output = new Uint8Array(outputSize)
  for (let i = 0; i < 4; i++) {
    decodeStream(data.subarray(ends[i], ends[i + 1]), output, i * segmentSize, i === 3 ? outputSize : (i + 1) * segmentSize, table)
  }
  return output
}

/** Decodes the two alternating FSE states, including zero-bit transitions at the end. */
function readWeights(data: Uint8Array): Array<number> {
  const {table, next} = readFseTable(data, 0, 11, 6)
  const reader = new ReverseBits(data.subarray(next))
  // Unlike the terminal transition, both initial states must be fully present.
  const states = [reader.read(table.tableLog), reader.read(table.tableLog)]
  const weights: Array<number> = []
  const append = (state: number): void => {
    if (weights.length === 255) {
      throw new Error('FSE decoded more than 255 Huffman weights.')
    }
    weights.push(table.symbols[state])
  }
  for (let turn = 0; ; turn = 1 - turn) {
    const state = states[turn]
    append(state)
    const count = table.bits[state]
    if (count > reader.remaining) {
      // The overflowing update ends the stream; its new state is never used.
      // The other state still holds one final symbol. Partial terminal bits are legal.
      reader.read(reader.remaining)
      append(states[1 - turn])
      reader.finish()
      return weights
    }
    states[turn] = table.base[state] + reader.read(count)
  }
}
/** Completes the implicit last weight and constructs Zstandard’s canonical prefix table. */
function buildHuffmanTable(weights: Array<number>): HuffmanTable {
  let total = 0
  for (const weight of weights) {
    if (weight > 11) {
      throw new Error(`Huffman weight ${weight} exceeds 11.`)
    }
    if (weight !== 0) {
      total += 2 ** (weight - 1)
    }
  }
  if (total === 0) {
    throw new Error('Huffman weights contain no present symbols.')
  }
  const tableLog = Math.floor(Math.log2(total)) + 1
  if (tableLog > 11) {
    throw new Error('Huffman tree depth exceeds 11.')
  }
  const size = 2 ** tableLog
  const rest = size - total
  if ((rest & rest - 1) !== 0) {
    throw new Error('Huffman implicit last weight does not complete a power of two.')
  }
  weights.push(Math.log2(rest) + 1)
  const ranks = new Uint16Array(tableLog + 1)
  for (const weight of weights) {
    ranks[weight]++
  }
  if (ranks[1] < 2 || ranks[1] % 2 !== 0) {
    throw new Error('Invalid Huffman tree: weight 1 must occur a positive even number of times.')
  }
  const starts = new Uint16Array(tableLog + 1)
  let start = 0
  for (let weight = 1; weight <= tableLog; weight++) {
    starts[weight] = start
    start += ranks[weight] * 2 ** (weight - 1)
  }
  const symbols = new Uint8Array(size)
  const bits = new Uint8Array(size)
  for (const [symbol, weight] of weights.entries()) {
    if (weight === 0) {
      continue
    }
    const start = starts[weight]
    const end = start + 2 ** (weight - 1)
    symbols.fill(symbol, start, end)
    bits.fill(tableLog + 1 - weight, start, end)
    starts[weight] = end
  }
  return {
    tableLog,
    symbols,
    bits,
  }
}
function decodeStream(data: Uint8Array, output: Uint8Array, start: number, end: number, table: HuffmanTable): void {
  const reader = new HuffmanBits(data)
  for (let i = start; i < end; i++) {
    const index = reader.peekPadded(table.tableLog)
    const count = table.bits[index]
    if (count < 1 || count > table.tableLog) {
      throw new Error('Invalid Huffman table code length.')
    }
    reader.read(count)
    output[i] = table.symbols[index]
  }
  reader.finish()
}
