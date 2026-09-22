/** Reads an already bounds-checked little-endian field without truncating offsets to 32 bits. */
export function readBitsAt(data: Uint8Array, position: number, count: number): number {
  let byte = Math.floor(position / 8)
  let shift = position % 8
  let result = 0
  let factor = 1
  while (count > 0) {
    const take = Math.min(8 - shift, count)
    result += ((data[byte++] >>> shift) & (2 ** take - 1)) * factor
    factor *= 2 ** take
    count -= take
    shift = 0
  }
  return result
}
