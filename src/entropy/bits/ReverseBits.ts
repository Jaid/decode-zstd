import {integer} from '../validation.ts'
import {readBitsAt} from './readBitsAt.ts'

/** Reads Zstandard bit fields backward, excluding the final one-bit marker and its zero padding. */
export class ReverseBits {
  protected readonly data: Uint8Array
  protected position: number

  constructor(data: Uint8Array) {
    const last = data.at(-1)
    if (last === undefined || last === 0) {
      throw new Error('Reverse bitstream is empty or missing its end marker.')
    }
    this.data = data
    this.position = (data.length - 1) * 8 + Math.floor(Math.log2(last))
  }

  /** Returns the number of unread payload bits. */
  get remaining(): number {
    return this.position
  }

  /** Requires exact consumption of the payload. */
  finish(): void {
    if (this.position !== 0) {
      throw new Error(`Reverse bitstream has ${this.position} unconsumed bits.`)
    }
  }

  /** Reads zero through 32 bits as an unsigned number, without reversing bits within a field. */
  read(count: number): number {
    integer(count, 0, 32, 'Bit count')
    if (count > this.position) {
      throw new Error(`Truncated reverse bitstream: need ${count} bits, have ${this.position}.`)
    }
    this.position -= count
    return readBitsAt(this.data, this.position, count)
  }
}
