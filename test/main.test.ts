import type {ZstdErrorCode} from '../src/main.ts'

import {expect, test} from 'bun:test'

import {checksum} from '../src/checksum.ts'
import decodeZstd, {decodeZstd as namedDecode, ZstdError} from '../src/main.ts'
import {rawWeights} from './entropy/helpers.ts'
import {block, bytes, compressed, concat, fixtureCases, fixtureName, frame, hex, le, rawLiterals, reverse, rleSequences, sample, text} from './helpers.ts'

function rejects(data: Uint8Array, code: ZstdErrorCode = 'INVALID_DATA'): void {
  let error: unknown
  try {
    decodeZstd(data, {maxOutputSize: 2_000_000})
  } catch (error_) {
    error = error_
  }
  expect(error).toBeInstanceOf(ZstdError)
  expect((error as ZstdError).code).toBe(code)
}
for (const fixture of fixtureCases) {
  for (const known of [false, true]) {
    test(`Reference frame: ${fixtureName(fixture)}, ${known ? 'known' : 'unknown'} size`, async () => {
      const data = new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/${fixtureName(fixture)}-${known ? 'known' : 'unknown'}.zst`).arrayBuffer())
      expect(decodeZstd(data)).toEqual(sample(fixture.kind, fixture.length))
    })
  }
}
for (const [file, expected] of [
  ['block-128k', new Uint8Array(131_068)],
  ['empty-block', bytes()],
  ['rle-first-block', new Uint8Array(1_048_576)],
  ['zeroSeq_2B', text('Hello World!\n')],
] as const) {
  test(`Upstream golden regression: ${file}`, async () => {
    const data = new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/golden/${file}.zst`).arrayBuffer())
    expect(decodeZstd(data)).toEqual(expected)
  })
}
test('Default/named API, Uint8Array subviews, Buffer, ArrayBuffer and output ownership', () => {
  expect(namedDecode).toBe(decodeZstd)
  const data = frame(block(0, text('hello')))
  const wrapped = concat(bytes(255), data, bytes(255))
  const input = wrapped.subarray(1, -1)
  const snapshot = [...input]
  const result = decodeZstd(input)
  expect(result).toEqual(text('hello'))
  expect(result.buffer.byteLength).toBe(5)
  result.fill(0)
  expect([...input]).toEqual(snapshot)
  expect(decodeZstd(Buffer.from(data))).toEqual(text('hello'))
  expect(decodeZstd(new Uint8Array(data).buffer)).toEqual(text('hello'))
  // @ts-expect-error Invalid input is checked at runtime as well.
  expect(() => decodeZstd('invalid')).toThrow(TypeError)
  // @ts-expect-error Only byte views are accepted.
  expect(() => decodeZstd(new DataView(data.buffer))).toThrow(TypeError)
  // @ts-expect-error Options must be an object.
  expect(() => decodeZstd(data, null)).toThrow(TypeError)
})
test('All skippable magic values, empty frames, concatenation and trailing junk', () => {
  let data = frame(block(0, text('a')))
  for (let magic = 0x18_4D_2A_50; magic <= 0x18_4D_2A_5F; magic++) {
    const skip = concat(le(magic, 4), le(3, 4), bytes(1, 2, 3))
    expect(decodeZstd(skip, {maxOutputSize: 0})).toEqual(bytes())
    data = concat(data, skip, frame(block(0, text('b'))))
  }
  expect(decodeZstd(data)).toEqual(text(`a${'b'.repeat(16)}`))
  expect(decodeZstd(hex('28b52ffd2000010000'))).toEqual(bytes())
  expect(decodeZstd(hex('28b52ffd20001500000000'))).toEqual(bytes())
  rejects(concat(data, bytes(0)))
  rejects(hex('502a4d18ffffffff'))
  rejects(bytes())
  rejects(hex('27b52ffd0000000000'))
})
test('Frame headers: all size widths, dictionary widths, ignored unused bit and reserved bit', () => {
  for (const [flag, size, decodedSize] of [[0, 1, 3], [1, 2, 259], [2, 4, 3], [3, 8, 3]]) {
    for (let dict = 0; dict <= 3; dict++) {
      const content = new Uint8Array(decodedSize).fill(7)
      const header = concat(hex('28b52ffd'), bytes(flag * 64 + 32 + 16 + dict), le(0, dict === 3 ? 4 : dict), le(decodedSize - (size === 2 ? 256 : 0), size))
      expect(decodeZstd(concat(header, block(0, content)))).toEqual(content)
      if (!dict) {
        continue
      }
      header[5] = 1
      rejects(concat(header, block(0, content)), 'UNSUPPORTED_DICTIONARY')
    }
  }
  rejects(hex('28b52ffd2800010000'))
  rejects(hex('28b52ffde0ffffffffffffffff010000'), 'OUTPUT_LIMIT')
  const data = concat(hex('28b52ffd2004'), block(0, text('abc')))
  rejects(data)
  data[5] = 2
  rejects(data)
})
test('Output limits apply before advertised allocations and across frames', () => {
  const data = frame(block(1, bytes(65), true, 131_072))
  expect(() => decodeZstd(data, {maxOutputSize: 131_071})).toThrow(ZstdError)
  expect(decodeZstd(data, {maxOutputSize: 131_072})).toEqual(new Uint8Array(131_072).fill(65))
  const raw = frame(block(0, bytes(65)))
  expect(() => decodeZstd(concat(raw, raw), {maxOutputSize: 1})).toThrow(/maxOutputSize/)
  expect(() => decodeZstd(concat(hex('28b52ffd2001'), block(0, bytes(1))), {maxOutputSize: 0})).toThrow(/maxOutputSize/)
  expect(decodeZstd(frame(block(0, bytes())), {maxOutputSize: 0})).toEqual(bytes())
  for (const maxOutputSize of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => decodeZstd(raw, {maxOutputSize})).toThrow(RangeError)
  }
  rejects(frame(block(0, new Uint8Array(131_073))))
  rejects(frame(block(1, bytes(0), true, 131_073)))
  rejects(frame(block(3, bytes())))
  rejects(concat(hex('28b52ffd0000'), block(0, new Uint8Array(1025))))
})
test('Raw and RLE literals in every size format, including empty and zero-sequence two-byte forms', () => {
  for (const format of [0, 1, 2, 3]) {
    for (const rle of [false, true]) {
      const literals = rawLiterals(rle ? bytes(65) : text('AAAAAA'), format, rle ? 6 : undefined)
      for (const count of [bytes(0), bytes(128, 0)]) {
        expect(decodeZstd(frame(compressed(literals, count)))).toEqual(text('AAAAAA'))
      }
    }
  }
  expect(decodeZstd(frame(compressed(rawLiterals(bytes(7), 0, 0))))).toEqual(bytes())
  rejects(frame(compressed(rawLiterals(bytes()), bytes(0, 0))))
  rejects(frame(compressed(rawLiterals(bytes(), 3, 131_073))))
})
function huffmanLiterals(symbols: Array<number>, format: number, treeless = false): Uint8Array {
  const weights = treeless ? bytes() : rawWeights([...Array.from({length: 65}, () => 0), 1])
  const segment = Math.ceil(symbols.length / 4)
  const streams = format === 0 ? [reverse(symbols.map(symbol => [symbol - 65, 1]))] : Array.from({length: 4}, (_, i) => reverse(symbols.slice(i * segment, (i + 1) * segment).map(symbol => [symbol - 65, 1])))
  const jump = format === 0 ? bytes() : concat(...streams.slice(0, 3).map(stream => le(stream.length, 2)))
  const payload = concat(weights, jump, ...streams)
  const bits = format < 2 ? 10 : format === 2 ? 14 : 18
  return concat(le((treeless ? 3 : 2) + format * 4 + symbols.length * 16 + payload.length * 2 ** (bits + 4), format < 2 ? 3 : format + 2), payload)
}
test('Every Huffman literals size format, single/four streams and treeless reuse across raw/RLE/zero-sequence blocks', () => {
  for (let format = 0; format < 4; format++) {
    const content = text('ABBAABABB')
    const first = compressed(huffmanLiterals([...content], format), bytes(0), false)
    const last = compressed(huffmanLiterals([...content], format, true))
    expect(decodeZstd(frame(first, block(0, text('!'), false), block(1, bytes(33), false, 2), compressed(rawLiterals(text('!')), bytes(0), false), last)))
      .toEqual(concat(content, text('!!!!'), content))
    rejects(frame(last))
    rejects(concat(frame(compressed(huffmanLiterals([...content], format))), frame(last)))
  }
  rejects(frame(compressed(huffmanLiterals([65, 66, 65, 66, 65], 1))))
})
test('RLE sequence alphabets, all repeat-offset rules and overlapping matches', () => {
  // Native-compatible hand-built sequences. Distinct seed bytes make each repeat offset observable.
  let expected = text('abcdefghijklmnop')
  const blocks: Array<Uint8Array> = [block(0, expected, false)]
  let repeated = [1, 4, 8]
  for (const [value, literals] of [[1, 'Q'], [2, 'R'], [3, 'S'], [1, ''], [2, ''], [7, ''], [3, ''], [1, 'T']] as const) {
    const code = Math.floor(Math.log2(value))
    blocks.push(compressed(rawLiterals(text(literals)), rleSequences(literals.length, code, 0, [[value - 2 ** code, code]]), false))
    const index = value - 1 + (literals.length === 0 ? 1 : 0)
    let offset: number
    if (value > 3 || index === 3) {
      offset = value > 3 ? value - 3 : repeated[0] - 1
      repeated = [offset, repeated[0], repeated[1]]
    } else {
      offset = repeated[index]
      repeated.splice(index, 1)
      repeated.unshift(offset)
    }
    const out = [...expected, ...text(literals)]
    for (let i = 0; i < 3; i++) {
      out.push(out[out.length - offset])
    }
    expected = bytes(...out)
  }
  blocks.push(block(0, bytes()))
  expect(decodeZstd(frame(...blocks))).toEqual(expected)
  const long = rleSequences(1, 0, 52, [[1000, 16]])
  expect(decodeZstd(frame(compressed(rawLiterals(text('a')), long)))).toEqual(new Uint8Array(66_540).fill(97))
  rejects(frame(compressed(rawLiterals(bytes()), rleSequences(0, 1, 0, [[1, 1]]))))
  rejects(frame(compressed(rawLiterals(bytes()), rleSequences(0, 0, 0, []))))
  rejects(frame(compressed(rawLiterals(text('a')), rleSequences(2, 0, 0, []))))
  rejects(frame(compressed(rawLiterals(text('a')), rleSequences(1, 31, 0, [[0xFF_FF_FF_FF >>> 1, 31]]))))
})
test('Repeat FSE tables survive raw/RLE/zero-sequence blocks but never cross frames', () => {
  const first = compressed(rawLiterals(text('a')), rleSequences(1, 0, 0, []), false)
  const repeated = compressed(rawLiterals(text('b')), bytes(1, 0xFC, 1))
  expect(decodeZstd(frame(first, block(0, text('!'), false), block(1, bytes(33), false, 2), compressed(rawLiterals(bytes()), bytes(128, 0), false), repeated)))
    .toEqual(text('aaaa!!!bbbb'))
  rejects(frame(repeated))
  rejects(concat(frame(compressed(rawLiterals(text('a')), rleSequences(1, 0, 0, []))), frame(repeated)))
})
test('One-, two- and three-byte sequence counts and long zero-bit RLE state tails', () => {
  for (const [count, header] of [[1, bytes(1)], [256, bytes(129, 0)], [32_512, bytes(255, 0, 0)]] as const) {
    const seq = rleSequences(0, 0, 0, [], header)
    const data = frame(block(0, new Uint8Array(8).fill(65), false), compressed(rawLiterals(bytes()), seq))
    expect(decodeZstd(data)).toEqual(new Uint8Array(8 + count * 3).fill(65))
  }
  rejects(frame(compressed(rawLiterals(bytes()), bytes(255, 255, 255, 0x54, 0, 0, 0, 1))))
})
test('Sequence modes and stream boundaries reject corruption', () => {
  for (const modes of [1, 2, 3, 255]) {
    rejects(frame(compressed(rawLiterals(text('a')), bytes(1, modes, 1))))
  }
  for (const symbols of [[36, 0, 0], [1, 32, 0], [1, 0, 53]]) {
    rejects(frame(compressed(rawLiterals(text('a')), bytes(1, 0x54, ...symbols, 1))))
  }
  for (const stream of [bytes(), bytes(0), bytes(3)]) {
    rejects(frame(compressed(rawLiterals(text('a')), concat(bytes(1, 0x54, 1, 0, 0), stream))))
  }
  const data = frame(compressed(rawLiterals(text('a')), rleSequences(1, 0, 52, [[65_535, 16]])))
  rejects(data)
  const first = block(0, new Uint8Array(1024).fill(65), false)
  const match = compressed(rawLiterals(text('B')), rleSequences(1, 10, 0, [[4, 10]]))
  rejects(concat(hex('28b52ffd0000'), first, match)) // Offset 1025 exceeds a 1024-byte window.
  const equalWindow = compressed(rawLiterals(bytes()), rleSequences(0, 10, 0, [[3, 10]]))
  expect(decodeZstd(concat(hex('28b52ffd0000'), first, equalWindow)).length).toBe(1027)
})
test('Checksums are frame-local, mandatory when flagged and verified for empty/raw/RLE output', () => {
  const frames: Array<Uint8Array> = []
  for (const length of [0, 1, 3, 4, 7, 8, 15, 31, 32, 33, 255, 256]) {
    const content = new Uint8Array(length).fill(65)
    const data = concat(hex('28b52ffd0438'), block(1, bytes(65), true, length), le(checksum(content), 4))
    expect(decodeZstd(data)).toEqual(content)
    frames.push(data.slice())
    data[data.length - 1] ^= 1
    rejects(data, 'CHECKSUM_MISMATCH')
  }
  expect(decodeZstd(concat(...frames)).length).toBe(645)
  expect(checksum(bytes())).toBe(0x51_D8_E9_99)
  expect(checksum(text('a'))).toBe(0xA9_8C_6E_5B)
})
test('Every truncation of a representative checked frame fails without modifying input', async () => {
  const data = new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/skewed-1000-3-known.zst`).arrayBuffer())
  const snapshot = [...data]
  for (let end = 0; end < data.length; end++) {
    rejects(data.subarray(0, end))
  }
  expect([...data]).toEqual(snapshot)
})
