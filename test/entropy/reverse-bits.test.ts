import type {Field} from './helpers.ts'

import {expect, test} from 'bun:test'

import {ReverseBits} from '../../src/entropy/main.ts'
import {random, reverse} from './helpers.ts'

test('Marker-only streams and all eight marker positions', () => {
  for (let position = 0; position < 8; position++) {
    const reader = new ReverseBits(Uint8Array.of(2 ** (position + 1) - 1))
    expect(reader.remaining).toBe(position)
    expect(reader.read(position)).toBe(2 ** position - 1)
    expect(reader.read(0)).toBe(0)
    reader.finish()
  }
})
test('Unsigned 32-bit reads, unaligned fields and byte-offset views', () => {
  const fields: Array<Field> = [[5, 3], [0xFF_FF_FF_FF, 32], [0x80_00_00_00, 32], [0, 0], [0x12_34_56_78, 32], [511, 9]]
  const encoded = reverse(fields)
  const padded = Uint8Array.of(99, ...encoded, 99)
  const reader = new ReverseBits(padded.subarray(1, -1))
  for (const [value, count] of fields) {
    expect(reader.read(count)).toBe(value)
  }
  reader.finish()
})
test('Bitstream reads match independently packed random fields', () => {
  const rng = random()
  for (let trial = 0; trial < 100; trial++) {
    const fields: Array<Field> = Array.from({length: 50}, () => {
      const count = rng() % 33
      return [rng() % 2 ** count, count]
    })
    const reader = new ReverseBits(reverse(fields))
    for (const [value, count] of fields) {
      expect(reader.read(count)).toBe(value)
    }
    reader.finish()
  }
})
test('Malformed markers, unavailable bits and invalid counts throw without consuming', () => {
  for (const data of [new Uint8Array, Uint8Array.of(0), Uint8Array.of(1, 0)]) {
    expect(() => new ReverseBits(data)).toThrow(/marker/)
  }
  const reader = new ReverseBits(Uint8Array.of(3))
  expect(() => reader.finish()).toThrow(/unconsumed/)
  for (const count of [-1, 33, NaN, Infinity, 1.5]) {
    expect(() => reader.read(count)).toThrow(RangeError)
  }
  expect(() => reader.read(2)).toThrow(/Truncated/)
  expect(reader.remaining).toBe(1)
  expect(reader.read(1)).toBe(1)
  reader.finish()
  expect(() => reader.read(1)).toThrow(/Truncated/)
  expect(reader.read(0)).toBe(0)
})
test('Bit positions exceed both signed and unsigned 32-bit ranges without wrapping', () => {
  // The allocation is sparse: only the final five bytes are touched.
  const data = new Uint8Array(2 ** 29 + 5)
  data.set([255, 255, 255, 255, 1], data.length - 5)
  const reader = new ReverseBits(data)
  expect(reader.remaining).toBe(2 ** 32 + 32)
  expect(reader.read(32)).toBe(0xFF_FF_FF_FF)
  expect(reader.remaining).toBe(2 ** 32)
  expect(reader.read(32)).toBe(0)
  expect(reader.remaining).toBe(2 ** 32 - 32)
})
