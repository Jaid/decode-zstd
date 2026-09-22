import {expect, test} from 'bun:test'

import {decodeHuffman, readFseTable, readHuffmanTable} from '../../src/entropy/main.ts'
import reference from './fixtures/reference.json'
import {hex, random} from './helpers.ts'

test('Seeded malformed-input sweeps terminate with bounded tables or meaningful errors', () => {
  const rng = random(0x82_34_56_78)
  const {table: reusable} = readHuffmanTable(hex('84432010'))
  for (let trial = 0; trial < 5000; trial++) {
    let data: Uint8Array
    if (trial % 2 === 0) {
      data = hex(reference.huffman[trial % reference.huffman.length].header)
      data[rng() % data.length] ^= 1 << rng() % 8
    } else {
      data = Uint8Array.from({length: rng() % 65}, () => rng() % 256)
    }
    try {
      const {table, next} = readHuffmanTable(data)
      expect(next).toBeGreaterThan(0)
      expect(next).toBeLessThanOrEqual(data.length)
      expect(table.tableLog).toBeGreaterThanOrEqual(1)
      expect(table.tableLog).toBeLessThanOrEqual(11)
      const lengths = new Map<number, number>
      for (let i = 0; i < table.symbols.length;) {
        const symbol = table.symbols[i]
        const bits = table.bits[i]
        expect(lengths.has(symbol)).toBe(false)
        lengths.set(symbol, bits)
        const width = 2 ** (table.tableLog - bits)
        expect(i % width).toBe(0)
        for (let end = i + width; i < end; i++) {
          expect(table.symbols[i]).toBe(symbol)
          expect(table.bits[i]).toBe(bits)
        }
      }
    } catch (error) {
      // Failed assertions must not masquerade as acceptable decoder rejections.
      if (!Error.isError(error) || error.name !== 'Error' && error.name !== 'RangeError') {
        throw error
      }
      expect(error.message).toMatch(/FSE|Huffman|bitstream/)
    }
    try {
      const {table, next} = readFseTable(data, 0, 255, 9)
      expect(next).toBeGreaterThan(0)
      expect(next).toBeLessThanOrEqual(data.length)
      expect(table.symbols.length).toBe(2 ** table.tableLog)
      expect(table.bits.every((bits, state) => table.base[state] + 2 ** bits <= table.symbols.length)).toBe(true)
    } catch (error) {
      if (!Error.isError(error) || error.name !== 'Error' && error.name !== 'RangeError') {
        throw error
      }
      expect(error.message).toMatch(/FSE/)
    }
    const size = rng() % 24
    try {
      expect(decodeHuffman(data, size, reusable, !!(trial % 2)).length).toBe(size)
    } catch (error) {
      if (!Error.isError(error) || error.name !== 'Error' && error.name !== 'RangeError') {
        throw error
      }
      expect(error.message).toMatch(/Huffman|bitstream/)
    }
  }
})
