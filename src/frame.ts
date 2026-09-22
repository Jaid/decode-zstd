import type {Output} from './buffers.ts'
import type {HuffmanTable} from './entropy/main.ts'

import {Reader} from './buffers.ts'
import {checksum} from './checksum.ts'
import {decodeHuffman, readHuffmanTable} from './entropy/main.ts'
import {invalid, outputLimit, ZstdError} from './errors.ts'
import {Sequences} from './sequences.ts'

/** One frame owns its Huffman/FSE tables, repeat offsets and history boundary. */
export class Frame {
  private huffman?: HuffmanTable
  private readonly sequences = new Sequences

  decode(reader: Reader, output: Output): void {
    const frameStart = output.length
    const descriptor = reader.uint(1)
    if (descriptor & 8) {
      invalid('Reserved frame header bit is set.')
    }
    const single = (descriptor & 32) !== 0
    let window = 0
    if (!single) {
      const descriptor = reader.uint(1)
      const base = 2 ** (10 + (descriptor >>> 3))
      window = base + base / 8 * (descriptor & 7)
    }
    const dictionaryFlag = descriptor & 3
    const dictionary = reader.uint(dictionaryFlag === 3 ? 4 : dictionaryFlag)
    if (dictionary !== 0) {
      throw new ZstdError('UNSUPPORTED_DICTIONARY', `Dictionary ${dictionary} is required; dictionaries are not supported.`)
    }
    const sizeFlag = descriptor >>> 6
    const sizeBytes = sizeFlag === 0 ? (single ? 1 : 0) : 2 ** sizeFlag
    const contentSize = sizeBytes === 0 ? undefined : reader.uint(sizeBytes) + (sizeBytes === 2 ? 256 : 0)
    if (contentSize !== undefined && contentSize > output.limit - output.length) {
      outputLimit('Declared frame content size exceeds the remaining maxOutputSize budget.')
    }
    if (single) {
      window = contentSize!
    }
    const blockMax = Math.min(window, 131_072)
    let last = false
    while (!last) {
      const header = reader.uint(3)
      last = (header & 1) !== 0
      const type = header >>> 1 & 3
      const size = header >>> 3
      if (type === 3) {
        invalid('Reserved block type.')
      }
      // The format errata explicitly admits an empty compressed block in an empty frame.
      if (size > blockMax && !(type === 2 && window === 0 && size === 2)) {
        invalid('Block size exceeds the frame’s block maximum.')
      }
      const remaining = contentSize === undefined ? blockMax : contentSize - (output.length - frameStart)
      const limit = Math.min(blockMax, remaining)
      if (type < 2) {
        if (size > limit) {
          invalid('Block exceeds the declared frame content size.')
        }
        if (type === 0) {
          output.append(reader.take(size))
        } else {
          output.repeat(reader.uint(1), size)
        }
      } else {
        const block = new Reader(reader.take(size))
        const literals = this.literals(block, limit)
        this.sequences.decode(block, literals, output, frameStart, window, limit)
      }
    }
    if (contentSize !== undefined && output.length - frameStart !== contentSize) {
      invalid('Decoded frame content size does not match its header.')
    }
    if (descriptor & 4) {
      const expected = reader.uint(4)
      if (checksum(output.data.subarray(frameStart, output.length)) !== expected) {
        throw new ZstdError('CHECKSUM_MISMATCH', 'Zstandard frame checksum does not match the decoded content.')
      }
    }
  }

  private literals(reader: Reader, limit: number): Uint8Array {
    const first = reader.uint(1)
    const type = first & 3
    const format = first >>> 2 & 3
    let size: number
    if (type < 2) {
      size = format % 2 === 0 ? first >>> 3 : (first >>> 4) + reader.uint(format === 1 ? 1 : 2) * 16
      if (size > limit) {
        invalid('Regenerated literals exceed the block or frame size.')
      }
      if (type === 0) {
        return reader.take(size)
      }
      return new Uint8Array(size).fill(reader.uint(1))
    }
    const headerBytes = format < 2 ? 3 : format + 2
    const fieldBits = format < 2 ? 10 : format === 2 ? 14 : 18
    const header = first + reader.uint(headerBytes - 1) * 256
    size = Math.floor(header / 16) % 2 ** fieldBits
    const compressedSize = Math.floor(header / 2 ** (4 + fieldBits))
    if (size > limit) {
      invalid('Regenerated literals exceed the block or frame size.')
    }
    if (format !== 0 && size < 6) {
      invalid('Four-stream literals require at least six decoded bytes.')
    }
    const payload = reader.take(compressedSize)
    let start = 0
    if (type === 2) {
      const parsed = readHuffmanTable(payload)
      this.huffman = parsed.table
      start = parsed.next
    }
    if (!this.huffman) {
      invalid('Treeless literals have no previous Huffman table in this frame.')
    }
    return decodeHuffman(payload.subarray(start), size, this.huffman, format !== 0)
  }
}
