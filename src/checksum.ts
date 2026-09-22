// XXH64 with seed zero, as specified for Zstandard frame checksums.
const mask = (1n << 64n) - 1n
const p1 = 0x9e3779b185ebca87n
const p2 = 0xc2b2ae3d27d4eb4fn
const p3 = 0x165667b19e3779f9n
const p4 = 0x85ebca77c2b2ae63n
const p5 = 0x27d4eb2f165667c5n

function rotate(value: bigint, count: bigint): bigint {
  return ((value << count) | (value >> (64n - count))) & mask
}

function round(accumulator: bigint, value: bigint): bigint {
  return (rotate((accumulator + value * p2) & mask, 31n) * p1) & mask
}

function merge(accumulator: bigint, value: bigint): bigint {
  return ((accumulator ^ round(0n, value)) * p1 + p4) & mask
}

/** Returns the low 32 bits of XXH64 without platform-specific hashing APIs. */
export function checksum(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let position = 0
  let hash: bigint
  if (data.length >= 32) {
    let a = (p1 + p2) & mask
    let b = p2
    let c = 0n
    let d = (-p1) & mask
    do {
      a = round(a, view.getBigUint64(position, true))
      b = round(b, view.getBigUint64(position + 8, true))
      c = round(c, view.getBigUint64(position + 16, true))
      d = round(d, view.getBigUint64(position + 24, true))
      position += 32
    } while (position <= data.length - 32)
    hash = (rotate(a, 1n) + rotate(b, 7n) + rotate(c, 12n) + rotate(d, 18n)) & mask
    for (const lane of [a, b, c, d]) hash = merge(hash, lane)
  } else {
    hash = p5
  }
  hash = (hash + BigInt(data.length)) & mask
  while (position <= data.length - 8) {
    hash ^= round(0n, view.getBigUint64(position, true))
    hash = (rotate(hash, 27n) * p1 + p4) & mask
    position += 8
  }
  if (position <= data.length - 4) {
    hash ^= BigInt(view.getUint32(position, true)) * p1 & mask
    hash = (rotate(hash, 23n) * p2 + p3) & mask
    position += 4
  }
  while (position < data.length) {
    hash ^= BigInt(data[position++]) * p5 & mask
    hash = rotate(hash, 11n) * p1 & mask
  }
  hash ^= hash >> 33n
  hash = hash * p2 & mask
  hash ^= hash >> 29n
  hash = hash * p3 & mask
  hash ^= hash >> 32n
  return Number(hash & 0xffffffffn)
}
