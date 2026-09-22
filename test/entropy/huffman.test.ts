import type {HuffmanTable} from '../../src/entropy/main.ts'
import type {Field} from './helpers.ts'

import {expect, test} from 'bun:test'

import {buildFseTable, decodeHuffman, readHuffmanTable} from '../../src/entropy/main.ts'
import reference from './fixtures/reference.json'
import {hex, normalized, random, rawWeights, reverse} from './helpers.ts'

function compressedWeights(counts: Array<number>, statesAndTransitions: ReadonlyArray<Field>, log = 5): Uint8Array {
  const data = Uint8Array.of(...normalized(counts, log).data, ...reverse(statesAndTransitions))
  return Uint8Array.of(data.length, ...data)
}
function encodeHuffman(symbols: ReadonlyArray<number>, table: HuffmanTable): Uint8Array {
  return reverse(symbols.map(symbol => {
    const index = table.symbols.indexOf(symbol)
    if (index === -1) {
      throw new Error('Test symbol absent from table.')
    }
    const bits = table.bits[index]
    return [index / 2 ** (table.tableLog - bits), bits]
  }))
}
function fourStreams(streams: Array<Uint8Array>): Uint8Array {
  const sizes = streams.slice(0, 3).flatMap(stream => [stream.length % 256, Math.floor(stream.length / 256)])
  return Uint8Array.of(...sizes, ...streams.flatMap(stream => [...stream]))
}
for (const [index, fixture] of reference.huffman.entries()) {
  test(`Huffman matches upstream v1.5.7 one/four-stream vectors: ${index}`, () => {
    const header = hex(fixture.header)
    const {table, next} = readHuffmanTable(header)
    expect(next).toBe(header.length)
    const expected = hex(fixture.decoded)
    expect(decodeHuffman(hex(fixture.one), expected.length, table, false)).toEqual(expected)
    expect(decodeHuffman(hex(fixture.four), expected.length, table, true)).toEqual(expected)
    for (let end = 0; end < header.length; end++) {
      expect(() => readHuffmanTable(header.subarray(0, end))).toThrow()
    }
    for (const four of [false, true]) {
      const encoded = hex(four ? fixture.four : fixture.one)
      expect(() => decodeHuffman(encoded, expected.length - 1, table, four)).toThrow()
      expect(() => decodeHuffman(encoded, expected.length + 1, table, four)).toThrow()
      expect(() => decodeHuffman(Uint8Array.of(...encoded, 0), expected.length, table, four)).toThrow()
    }
  })
}
test('Canonical codes match the specification; its ABEF byte example swaps E and F', () => {
  const weights = [...Array.from({length: 65}, () => 0), 4, 3, 2, 0, 1]
  const {table} = readHuffmanTable(rawWeights(weights))
  expect(table.tableLog).toBe(4)
  expect([...table.symbols]).toEqual([69, 70, 67, 67, 66, 66, 66, 66, ...Array.from({length: 8}, () => 65)])
  expect([...table.bits]).toEqual([4, 4, 3, 3, 2, 2, 2, 2, ...Array.from({length: 8}, () => 1)])
  // The supplied specification accidentally swaps E/F in its encoded-byte example.
  expect(decodeHuffman(hex('100d'), 4, table, false)).toEqual((new TextEncoder).encode('ABFE'))
  expect(decodeHuffman(hex('010d'), 4, table, false)).toEqual((new TextEncoder).encode('ABEF'))
})
test('Huffman near-end lookahead is padded, but missing code bits are not', () => {
  const {table} = readHuffmanTable(rawWeights([4, 3, 2, 0, 1]))
  for (const symbol of [0, 1, 2, 4, 5]) {
    const encoded = encodeHuffman([symbol], table)
    expect(decodeHuffman(encoded, 1, table, false)).toEqual(Uint8Array.of(symbol))
  }
  expect(() => decodeHuffman(Uint8Array.of(2), 1, table, false)).toThrow(/Truncated/)
  expect(() => decodeHuffman(Uint8Array.of(1), 1, table, false)).toThrow(/Truncated/)
  expect(() => decodeHuffman(Uint8Array.of(7), 1, table, false)).toThrow(/unconsumed/)
})
test('Raw Huffman headers honor offsets, high nibbles and unused low-nibble padding', () => {
  const wrapped = hex('aa801fbb')
  const {table, next} = readHuffmanTable(wrapped, 1)
  expect(next).toBe(3)
  expect(table).toEqual(readHuffmanTable(hex('8010')).table)
  expect(table.tableLog).toBe(1)
  expect([...table.symbols]).toEqual([0, 1])
  const implicit = readHuffmanTable(rawWeights([1, 1])).table
  expect(implicit.tableLog).toBe(2)
  expect([...implicit.symbols]).toEqual([0, 1, 2, 2])
  const last128 = readHuffmanTable(rawWeights([...Array.from({length: 127}, () => 0), 1])).table
  expect([...last128.symbols]).toEqual([127, 128])
})
test('FSE weights require two complete initial states and terminate on overflow, not equality', () => {
  const counts = [16, 16]
  const table = buildFseTable(counts, 5)
  const one = table.symbols.indexOf(1)
  // With no transition bits, two final symbols are still emitted.
  const encoded = compressedWeights(counts, [[one, 5], [one, 5]])
  expect(readHuffmanTable(encoded).table).toEqual(readHuffmanTable(rawWeights([1, 1])).table)
  for (let available = 0; available < 10; available++) {
    const truncated = compressedWeights(counts, [[0, available]])
    expect(() => readHuffmanTable(truncated)).toThrow(/Truncated reverse/)
  }
  // The permissiveness document's pre-v1.5.7 truncated-state frame, isolated to its tree.
  expect(() => readHuffmanTable(hex('04207e1f02'))).toThrow(/Truncated reverse/)
  // A full transition reaching exactly zero bits must not terminate early.
  const prev = table.symbols.findIndex((symbol, state) => symbol === 1
    && one >= table.base[state] && one < table.base[state] + 2 ** table.bits[state])
  const three = compressedWeights(counts, [[prev, 5], [one, 5], [one - table.base[prev], table.bits[prev]]])
  expect(readHuffmanTable(three).table).toEqual(readHuffmanTable(rawWeights([1, 1, 1])).table)
})
test('FSE weights continue through zero-bit transitions and handle either terminal state', () => {
  const counts = [1, 31]
  const fse = buildFseTable(counts, 5)
  let valid = 0
  let odd = 0
  let even = 0
  for (let first = 0; first < 32; first++) {
    for (let second = 0; second < 32; second++) {
      const states = [first, second]
      const weights: Array<number> = []
      let zeroBits = 0
      for (let turn = 0; ; turn = 1 - turn) {
        const state = states[turn]
        weights.push(fse.symbols[state])
        if (fse.bits[state] > 0) {
          weights.push(fse.symbols[states[1 - turn]])
          break
        }
        zeroBits++
        states[turn] = fse.base[state]
      }
      if (zeroBits < 2) {
        continue
      }
      let expected: HuffmanTable
      try {
        expected = readHuffmanTable(rawWeights(weights)).table
      } catch {
        continue
      }
      const actual = readHuffmanTable(compressedWeights(counts, [[first, 5], [second, 5]])).table
      expect(actual).toEqual(expected)
      valid++
      if (weights.length % 2) {
        odd++
      } else {
        even++
      }
    }
  }
  expect(valid).toBeGreaterThan(100)
  expect(odd).toBeGreaterThan(0)
  expect(even).toBeGreaterThan(0)
})
test('FSE terminal transitions may contain fewer bits than the state requires', () => {
  const counts = [16, 8, 8]
  const table = buildFseTable(counts, 5)
  const first = table.symbols.findIndex((symbol, state) => symbol === 1 && table.bits[state] === 2)
  const second = table.symbols.indexOf(1)
  for (const partial of [0, 1]) {
    const encoded = compressedWeights(counts, [[first, 5], [second, 5], [partial, 1]])
    expect(readHuffmanTable(encoded).table).toEqual(readHuffmanTable(rawWeights([1, 1])).table)
  }
})
test('FSE weight streams enforce 255 explicit weights and log/symbol limits', () => {
  const counts = [16, 16]
  const table = buildFseTable(counts, 5)
  const one = table.symbols.indexOf(1)
  const fields: Array<Field> = [[one, 5], [one, 5], ...Array.from({length: 254}, (): Field => [0, 1])]
  expect(() => readHuffmanTable(compressedWeights(counts, fields))).toThrow(/more than 255/)
  const tooHigh = normalized([64, 64], 7).data
  expect(() => readHuffmanTable(Uint8Array.of(tooHigh.length + 1, ...tooHigh, 1))).toThrow(/table log/)
  const invalidSymbol = normalized([16, ...Array.from({length: 11}, () => 0), 16], 5).data
  expect(() => readHuffmanTable(Uint8Array.of(invalidSymbol.length + 2, ...invalidSymbol, 0, 4))).toThrow(/maximum symbol/)
})
test('Huffman supports maximum depth 11 and rejects invalid canonical trees', () => {
  const valid = [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const {table} = readHuffmanTable(rawWeights(valid))
  expect(table.tableLog).toBe(11)
  const symbols = Array.from({length: 12}, (_, i) => i)
  expect(decodeHuffman(encodeHuffman(symbols, table), 12, table, false)).toEqual(Uint8Array.from(symbols))
  for (const weights of [[0], [2], [2, 2, 1], [12], [...valid, 11]]) {
    expect(() => readHuffmanTable(rawWeights(weights))).toThrow(/Huffman/)
  }
  for (const data of [hex('00'), hex('0100'), hex('0210'), hex('ff'), hex('841122'), hex('022010')]) {
    expect(() => readHuffmanTable(data)).toThrow()
  }
  for (const offset of [-1, 0.5, 3, NaN]) {
    expect(() => readHuffmanTable(hex('8010'), offset)).toThrow(RangeError)
  }
  expect(() => readHuffmanTable(hex('8010'), 2)).toThrow(/header/)
})
test('Four streams validate individual sizes, exact output partitions and every end marker', () => {
  const {table} = readHuffmanTable(rawWeights([4, 3, 2, 0, 1]))
  const rng = random()
  for (const size of [0, 3, 4, 6, 7, 8, 9, 10, 11, 12, 257, 1025]) {
    const output = Array.from({length: size}, () => [0, 1, 2, 4, 5][rng() % 5])
    const segment = Math.ceil(size / 4)
    const streams = Array.from({length: 4}, (_, i) => encodeHuffman(output.slice(i * segment, (i + 1) * segment), table))
    const data = fourStreams(streams)
    expect(decodeHuffman(data, size, table, true)).toEqual(Uint8Array.from(output))
    for (let end = 6, i = 0; i < 4; i++) {
      end += streams[i].length
      const mutated = [...data]
      mutated[end - 1] = 0
      expect(() => decodeHuffman(Uint8Array.from(mutated), size, table, true)).toThrow(/marker/)
    }
  }
  const data = fourStreams([0, 1, 2, 5].map(symbol => encodeHuffman([symbol], table)))
  for (const size of [1, 2, 5]) {
    expect(() => decodeHuffman(data, size, table, true)).toThrow(/negative fourth/)
  }
  for (const bytes of [data.subarray(0, 9), hex('00000100010001010101'), hex('ffff0100010001010101'), hex('01000100020001010101')]) {
    expect(() => decodeHuffman(bytes, 4, table, true)).toThrow(/jump table/)
  }
  // A correct combined output size cannot hide incorrect per-stream output counts.
  const wrongPartitions = fourStreams([[0, 0], [1], [2], []].map(symbols => encodeHuffman(symbols, table)))
  expect(() => decodeHuffman(wrongPartitions, 4, table, true)).toThrow(/unconsumed/)
})
test('Huffman rejects invalid sizes and tables; zero output still validates its stream', () => {
  const {table} = readHuffmanTable(hex('8010'))
  expect(decodeHuffman(hex('01'), 0, table, false)).toEqual(new Uint8Array)
  for (const data of [new Uint8Array, hex('00'), hex('02')]) {
    expect(() => decodeHuffman(data, 0, table, false)).toThrow()
  }
  for (const size of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => decodeHuffman(hex('01'), size, table, false)).toThrow(RangeError)
  }
  expect(() => decodeHuffman(hex('01'), 1000, table, false)).toThrow(/output size/)
  expect(() => decodeHuffman(hex('01'), 0, {
    ...table,
    tableLog: 0,
  }, false)).toThrow(RangeError)
  expect(() => decodeHuffman(hex('01'), 0, {
    ...table,
    bits: new Uint8Array,
  }, false)).toThrow(/dimensions/)
  for (const bits of [Uint8Array.of(0, 1), Uint8Array.of(2, 1)]) {
    expect(() => decodeHuffman(hex('02'), 1, {
      ...table,
      bits,
    }, false)).toThrow(/code length/)
  }
})
test('Exactly 255 FSE weights can describe the full 256-symbol alphabet', () => {
  const counts = [1, 31]
  const table = buildFseTable(counts, 5)
  const terminal = table.symbols.findIndex((symbol, state) => symbol === 1 && table.bits[state] > 0)
  const states = [terminal, terminal]
  const transitions: Array<Field> = []
  // Invert the state transitions to encode 255 weight-one symbols.
  for (let i = 252; i >= 0; i--) {
    const next = states[i % 2]
    const state = table.symbols.findIndex((symbol, state) => symbol === 1
      && next >= table.base[state] && next < table.base[state] + 2 ** table.bits[state])
    expect(state).toBeGreaterThanOrEqual(0)
    transitions.unshift([next - table.base[state], table.bits[state]])
    states[i % 2] = state
  }
  const encoded = compressedWeights(counts, [[states[0], 5], [states[1], 5], ...transitions])
  const huffman = readHuffmanTable(encoded).table
  expect(huffman.tableLog).toBe(8)
  expect([...huffman.symbols]).toEqual(Array.from({length: 256}, (_, i) => i))
  expect(huffman.bits.every(bits => bits === 8)).toBe(true)
  const payload = encodeHuffman([0, 128, 255], huffman)
  expect(decodeHuffman(payload, 3, huffman, false)).toEqual(Uint8Array.of(0, 128, 255))
})
