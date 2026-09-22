import {reverse} from './entropy/helpers.ts'
import type {Field} from './entropy/helpers.ts'

export const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
export const text = (value: string): Uint8Array => new TextEncoder().encode(value)
export const hex = (value: string): Uint8Array => Uint8Array.fromHex(value.replaceAll(/\s/g, ''))
export function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let position = 0
  for (const part of parts) {
    result.set(part, position)
    position += part.length
  }
  return result
}
export function le(value: number, size: number): Uint8Array {
  return Uint8Array.from({length: size}, (_, i) => Math.floor(value / 2 ** (8 * i)) % 256)
}
export function block(type: number, payload: Uint8Array, last = true, size = payload.length): Uint8Array {
  return concat(le(size * 8 + type * 2 + +last, 3), payload)
}
export function frame(...blocks: Uint8Array[]): Uint8Array {
  return concat(hex('28b52ffd0038'), ...blocks)
}
export function rawLiterals(data: Uint8Array, format = data.length < 32 ? 0 : 3, rleSize?: number): Uint8Array {
  const size = rleSize ?? data.length
  const rle = rleSize === undefined ? 0 : 1
  const header = format === 0 || format === 2 ? bytes(size * 8 + rle) : le(size * 16 + format * 4 + rle, format === 1 ? 2 : 3)
  return concat(header, data)
}
export function rleSequences(literalCode: number, offsetCode: number, matchCode: number, fields: Field[], count = bytes(1)): Uint8Array {
  return concat(count, bytes(0x54, literalCode, offsetCode, matchCode), reverse(fields))
}
export function compressed(literals: Uint8Array, sequences = bytes(0), last = true): Uint8Array {
  return block(2, concat(literals, sequences), last)
}

/** Deterministic inputs shared by fixture generation, native checks and browser checks. */
export function sample(kind: string, length: number, seed = 0x12345678): Uint8Array {
  const result = new Uint8Array(length)
  const phrase = text('The Zstandard format combines LZ77 matches, Huffman literals and finite-state entropy.\n')
  const random = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed >>> 0
  }
  for (let i = 0; i < length; i++) {
    const r = random()
    switch (kind) {
      case 'random': result[i] = r & 255; break
      case 'rle': result[i] = 97; break
      case 'text': result[i] = phrase[i % phrase.length]; break
      case 'skewed': result[i] = r % 100 < 85 ? 32 : (r >>> 8) & 255; break
      case 'alphabet': result[i] = 65 + r % 6; break
      case 'mixed': result[i] = i % 16000 < 4000 ? r & 255 : phrase[i % phrase.length]; break
      default: throw new Error(`Unknown sample kind ${kind}.`)
    }
  }
  return result
}

export const fixtureCases = [
  {kind: 'text', length: 0, level: 3},
  {kind: 'random', length: 255, level: 1},
  {kind: 'text', length: 256, level: 3},
  {kind: 'text', length: 65791, level: 9},
  {kind: 'text', length: 65792, level: 19},
  {kind: 'rle', length: 400000, level: 3},
  {kind: 'skewed', length: 1000, level: 3},
  {kind: 'alphabet', length: 1000, level: 19},
  {kind: 'alphabet', length: 30000, level: 9},
  {kind: 'skewed', length: 200000, level: 19},
  {kind: 'mixed', length: 300000, level: 3},
  {kind: 'alphabet', length: 300000, level: 1},
  {kind: 'text', length: 1500000, level: 22},
]
export const fixtureName = (fixture: typeof fixtureCases[number]): string => `${fixture.kind}-${fixture.length}-${fixture.level}`
export {reverse}
export type {Field}
