import {invalid, outputLimit, ZstdError} from './errors.ts'

/** A byte-aligned cursor over an exact frame or block view. */
export class Reader {
  position = 0

  constructor(readonly data: Uint8Array) {}

  get remaining(): number {
    return this.data.length - this.position
  }

  finish(): void {
    if (this.remaining !== 0) {
      invalid('Unexpected trailing bytes in a compressed block.')
    }
  }

  take(size: number): Uint8Array {
    if (size > this.remaining) {
      invalid('Truncated Zstandard input.')
    }
    const start = this.position
    this.position += size
    return this.data.subarray(start, this.position)
  }

  uint(size: number): number {
    const bytes = this.take(size)
    let value = 0
    for (let i = size - 1; i >= 0; i--) {
      value = value * 256 + bytes[i]
    }
    if (!Number.isSafeInteger(value)) {
      outputLimit('Frame content size exceeds JavaScript’s safe integer range.')
    }
    return value
  }
}

/** Geometrically grown output shared by concatenated frames, never shared with the input. */
export class Output {
  data: Uint8Array = new Uint8Array(0)
  length = 0

  constructor(readonly limit: number) {}

  append(bytes: Uint8Array): void {
    this.reserve(bytes.length)
    this.data.set(bytes, this.length)
    this.length += bytes.length
  }

  finish(): Uint8Array {
    // Do not retain unused growth capacity in the returned buffer.
    try {
      return this.data.length === this.length ? this.data : this.data.slice(0, this.length)
    } catch (error) {
      throw new ZstdError('OUTPUT_LIMIT', 'Unable to allocate the final output buffer.', {cause: error})
    }
  }

  /** Copies an LZ match using exponential expansion, including overlapping source ranges. */
  match(offset: number, size: number): void {
    this.reserve(size)
    let copied = 0
    let available = offset
    while (copied < size) {
      const count = Math.min(available, size - copied)
      this.data.set(this.data.subarray(this.length - offset, this.length - offset + count), this.length + copied)
      copied += count
      available += count
    }
    this.length += size
  }

  repeat(byte: number, size: number): void {
    this.reserve(size)
    this.data.fill(byte, this.length, this.length + size)
    this.length += size
  }

  reserve(size: number): void {
    const needed = this.length + size
    if (needed > this.limit) {
      outputLimit(`Decoded data exceeds maxOutputSize (${this.limit} bytes).`)
    }
    if (needed <= this.data.length) {
      return
    }
    const capacity = Math.min(this.limit, Math.max(needed, Math.max(1024, this.data.length * 2)))
    try {
      const grown = new Uint8Array(capacity)
      grown.set(this.data.subarray(0, this.length))
      this.data = grown
    } catch (error) {
      throw new ZstdError('OUTPUT_LIMIT', 'Unable to allocate the decoded output buffer.', {cause: error})
    }
  }
}
