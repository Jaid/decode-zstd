import {ReverseBits} from './ReverseBits.ts'
import {readBitsAt} from './readBitsAt.ts'

/** Provides private-to-the-library Huffman lookahead while keeping all actual reads strict. */
export class HuffmanBits extends ReverseBits {
  /** Pads missing low bits with zeros without consuming or inventing payload bits. */
  peekPadded(count: number): number {
    const available = Math.min(count, this.position)
    return readBitsAt(this.data, this.position - available, available) * 2 ** (count - available)
  }
}
