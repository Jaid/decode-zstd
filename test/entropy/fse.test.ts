import {expect, test} from 'bun:test'
import {buildFseTable, readFseTable} from '../../src/entropy/main.ts'
import predefined from './fixtures/predefined.json'
import reference from './fixtures/reference.json'
import {hex, normalized, random} from './helpers.ts'

for (const fixture of predefined) {
  test(`FSE matches specification Appendix A: ${fixture.name}`, () => {
    const table = buildFseTable(fixture.counts, fixture.tableLog)
    expect([...table.symbols]).toEqual(fixture.symbols)
    expect([...table.bits]).toEqual(fixture.bits)
    expect([...table.base]).toEqual(fixture.base)
  })
}

for (const [index, fixture] of reference.fse.entries()) {
  test(`FSE matches upstream v1.5.7 normalized header and every table row: ${index}`, () => {
    const data = hex(fixture.header)
    const {table, next} = readFseTable(data, 0, fixture.counts.length - 1, fixture.tableLog)
    expect(next).toBe(data.length)
    expect(table).toEqual(buildFseTable(fixture.counts, fixture.tableLog))
    expect([...table.symbols]).toEqual(fixture.symbols)
    expect([...table.bits]).toEqual(fixture.bits)
    expect([...table.base]).toEqual(fixture.base)
    expect(normalized(fixture.counts, fixture.tableLog).data).toEqual(data)
    for (let end = 0; end < data.length; end++) {
      expect(() => readFseTable(data.subarray(0, end), 0, 255, 9)).toThrow()
    }
  })
}

test('FSE supports tiny, single-symbol and entirely low-probability synthetic tables', () => {
  for (let log = 0; log <= 16; log++) {
    const size = 2 ** log
    const table = buildFseTable([0, size], log)
    expect(table.symbols.every(symbol => symbol === 1)).toBe(true)
    expect(table.bits.every(bits => bits === 0)).toBe(true)
    expect(table.base.every((base, state) => base === state)).toBe(true)
    if (log > 8) continue
    const low = buildFseTable(Array(size).fill(-1), log)
    expect([...low.symbols]).toEqual(Array.from({length: size}, (_, i) => size - i - 1))
    expect(low.bits.every(bits => bits === log)).toBe(true)
    expect(low.base.every(base => base === 0)).toBe(true)
  }
  expect([...buildFseTable([1, 1], 1).symbols]).toEqual([0, 1])
  expect([...buildFseTable([1, -1, 6], 3).symbols]).toEqual([0, 2, 2, 2, 2, 2, 2, 1])
})

test('FSE spreading preserves counts and each symbol covers the entire next-state space', () => {
  const rng = random()
  for (let log = 0; log <= 9; log++) {
    const size = 2 ** log
    for (let trial = 0; trial < 20; trial++) {
      const counts = Array<number>(Math.min(16, size)).fill(0)
      for (let i = 0; i < size; i++) counts[rng() % counts.length]++
      for (let i = 0; i < counts.length; i++) if (counts[i] === 1 && rng() % 2) counts[i] = -1
      const table = buildFseTable(counts, log)
      for (let symbol = 0; symbol < counts.length; symbol++) {
        const coverage = new Uint8Array(size)
        let frequency = 0
        for (let state = 0; state < size; state++) {
          if (table.symbols[state] !== symbol) continue
          frequency++
          const end = table.base[state] + 2 ** table.bits[state]
          expect(end).toBeLessThanOrEqual(size)
          for (let next = table.base[state]; next < end; next++) coverage[next]++
        }
        expect(frequency).toBe(Math.abs(counts[symbol]))
        expect(coverage.every(value => value === (frequency ? 1 : 0))).toBe(true)
      }
    }
  }
})

test('FSE skips repeated zeros, includes symbol 255 and rounds next past unused padding', () => {
  const counts = [1, ...Array<number>(254).fill(0), 31]
  const {data, bits} = normalized(counts, 5)
  const wrapped = Uint8Array.of(99, ...data, 123)
  for (let bit = bits; bit < data.length * 8; bit++) wrapped[data.length] |= 2 ** (bit % 8)
  const result = readFseTable(wrapped, 1, 255, 5)
  expect(result.next).toBe(1 + data.length)
  expect(result.table).toEqual(buildFseTable(counts, 5))
  expect(() => readFseTable(wrapped, 1, 254, 5)).toThrow(/maximum symbol/)
})

test('FSE rejects invalid parameters, counts, symbol bounds, singleton wire tables and truncation', () => {
  for (const counts of [[], [1], [33], [-2, 34], [1.5, 30.5], [NaN], [Infinity], Array(257).fill(0)]) {
    expect(() => buildFseTable(counts, 5)).toThrow()
  }
  for (const log of [-1, 17, 1.5, NaN, Infinity]) expect(() => buildFseTable([1], log)).toThrow(RangeError)
  const data = normalized([16, 16], 5).data
  for (const offset of [-1, 0.5, NaN, data.length + 1]) expect(() => readFseTable(data, offset, 1, 5)).toThrow(RangeError)
  for (const symbol of [-1, 256, 1.5, NaN]) expect(() => readFseTable(data, 0, symbol, 5)).toThrow(RangeError)
  for (const log of [4, 17, 5.5, NaN]) expect(() => readFseTable(data, 0, 1, log)).toThrow(RangeError)
  expect(() => readFseTable(Uint8Array.of(1), 0, 255, 5)).toThrow(/exceeds maximum/)
  expect(() => readFseTable(data, 0, 0, 5)).toThrow(/maximum symbol/)
  expect(() => readFseTable(normalized([32], 5).data, 0, 255, 5)).toThrow(/at least two/)
  expect(() => readFseTable(Uint8Array.of(0), 0, 255, 5)).toThrow(/Truncated/)
  expect(() => readFseTable(new Uint8Array(), 0, 255, 5)).toThrow(/Truncated/)
})
