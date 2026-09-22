import {expect, test} from 'bun:test'
import decodeZstd, {ZstdError} from '../src/main.ts'
import {literalBase, literalBits, matchBase, matchBits} from '../src/sequences.ts'
import {block, bytes, compressed, concat, frame, hex, le, rawLiterals, rleSequences} from './helpers.ts'
import {random} from './entropy/helpers.ts'

// Explicit baselines independently transcribed from the format tables.
test('Every literal/match length code and its extra-bit range executes correctly', () => {
  expect(literalBase).toEqual([...Array.from({length: 16}, (_, i) => i), 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536])
  expect(matchBase).toEqual([...Array.from({length: 32}, (_, i) => i + 3), 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539])
  for (const literal of [true, false]) {
    const bits = literal ? literalBits : matchBits
    const bases = literal ? literalBase : matchBase
    for (let code = 0; code < bits.length; code++) {
      for (const extra of [0, 2 ** bits[code] - 1]) {
        const length = bases[code] + extra
        const literalLength = literal ? length : 1
        const matchLength = literal ? 3 : length
        const sequence = rleSequences(literal ? code : 1, 0, literal ? 0 : code, [[extra, bits[code]]])
        const data = frame(block(0, bytes(65, 65, 65, 65), false), compressed(rawLiterals(bytes(65), 3, literalLength), sequence))
        if (literalLength + matchLength > 131072) expect(() => decodeZstd(data)).toThrow(ZstdError)
        else expect(decodeZstd(data)).toEqual(new Uint8Array(4 + literalLength + matchLength).fill(65))
      }
    }
  }
})

test('Unsigned offset fields, window mantissas and frame history isolation', () => {
  const first = frame(block(0, bytes(65, 65, 65, 65)))
  const last = frame(compressed(rawLiterals(bytes()), rleSequences(0, 0, 0, [])))
  expect(() => decodeZstd(concat(first, last))).toThrow(/history/)
  const window = 1024 + 7 * 128
  const data = concat(hex('28b52ffd0007'), block(1, bytes(65), false, window), compressed(rawLiterals(bytes()), rleSequences(0, 10, 0, [[window + 3 - 1024, 10]])))
  expect(decodeZstd(data)).toEqual(new Uint8Array(window + 3).fill(65))
  // The maximum window descriptor is legal without allocating that advertised window.
  expect(decodeZstd(concat(hex('28b52ffd00ff'), block(0, bytes(65))))).toEqual(bytes(65))
  for (const code of [29, 30, 31]) {
    const data = frame(block(0, bytes(65), false), compressed(rawLiterals(bytes()), rleSequences(0, code, 0, [[2 ** code - 1, code]])))
    expect(() => decodeZstd(data)).toThrow(/history/)
  }
  // Four-byte dictionary IDs are unsigned, not negative.
  try { decodeZstd(concat(hex('28b52ffd230000008000'), block(0, bytes()))) } catch (error) {
    expect((error as ZstdError).code).toBe('UNSUPPORTED_DICTIONARY')
    expect((error as Error).message).toContain('2147483648')
  }
})

test('Historical malformed frames are not accepted permissively', () => {
  for (const data of [
    '28b52ffd000055000072800104207e1f02aa00', // Truncated initial Huffman FSE states.
    '28b52ffd0000450000080002002f430bae', // Zero repeat offset.
  ]) expect(() => decodeZstd(hex(data))).toThrow(ZstdError)
  // An 8-byte content size just above the default budget is rejected before allocation.
  expect(() => decodeZstd(concat(hex('28b52ffde0'), le(2 ** 30 + 1, 8), block(0, bytes())))).toThrow(/maxOutputSize/)
})

test('Deterministic malformed full-frame sweep stays within limits and uses typed errors', async () => {
  const original = await Bun.file(`${import.meta.dir}/fixtures/skewed-1000-3-known.zst`).bytes()
  const expected = decodeZstd(original)
  const rng = random(0x3820ab73)
  for (let trial = 0; trial < 5000; trial++) {
    const data = trial % 2 ? original.slice() : concat(hex('28b52ffd'), Uint8Array.from({length: rng() % 80}, () => rng() % 256))
    if (trial % 2) data[rng() % data.length] ^= 1 << (rng() % 8)
    let output: Uint8Array | undefined
    try { output = decodeZstd(data, {maxOutputSize: 65536}) } catch (error) {
      expect(error).toBeInstanceOf(ZstdError)
      expect((error as Error).message.length).toBeGreaterThan(0)
    }
    if (output) {
      expect(output.length).toBeLessThanOrEqual(65536)
      if (trial % 2) expect(output).toEqual(expected)
    }
  }
})
