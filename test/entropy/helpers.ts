export type Field = readonly [value: number, bits: number]

/** Packs independent little-endian fields, lowest bit first. */
export function forward(fields: readonly Field[]): {data: Uint8Array; bits: number} {
  const bits = fields.reduce((sum, field) => sum + field[1], 0)
  const data = new Uint8Array(Math.ceil(bits / 8))
  let position = 0
  for (const [value, count] of fields) {
    for (let bit = 0; bit < count; bit++, position++) {
      if (Math.floor(value / 2 ** bit) % 2) data[Math.floor(position / 8)] |= 2 ** (position % 8)
    }
  }
  return {data, bits}
}

/** Packs fields in reverse-read order and adds the mandatory end marker. */
export function reverse(fields: readonly Field[]): Uint8Array {
  return forward([...fields.toReversed(), [1, 1]]).data
}

/** Encodes normalized counts independently of the library’s parser. */
export function normalized(counts: readonly number[], tableLog: number): {data: Uint8Array; bits: number} {
  const fields: Field[] = [[tableLog - 5, 4]]
  let remaining = 2 ** tableLog
  for (let symbol = 0; remaining > 0; symbol++) {
    const count = counts[symbol]
    if (count === undefined) throw new Error('Invalid test distribution.')
    const width = Math.floor(Math.log2(remaining + 1)) + 1
    const threshold = 2 ** width - 2 - remaining
    const value = count + 1
    fields.push(value < threshold ? [value, width - 1]
      : [value < 2 ** (width - 1) ? value : value + threshold, width])
    remaining -= Math.abs(count)
    if (count === 0) {
      let zeros = 0
      while (counts[symbol + 1] === 0) {
        symbol++
        zeros++
      }
      while (zeros >= 3) {
        fields.push([3, 2])
        zeros -= 3
      }
      fields.push([zeros, 2])
    }
  }
  return forward(fields)
}

export function rawWeights(weights: readonly number[]): Uint8Array {
  const data = new Uint8Array(1 + Math.ceil(weights.length / 2))
  data[0] = 127 + weights.length
  for (let i = 0; i < weights.length; i++) data[1 + Math.floor(i / 2)] |= weights[i] * (i % 2 ? 1 : 16)
  return data
}

export function hex(value: string): Uint8Array {
  return Uint8Array.fromHex(value)
}

export function random(seed = 0xabcdef01): () => number {
  return () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed >>> 0
  }
}
