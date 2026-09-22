import {Output, Reader} from './buffers.ts'
import {invalid, ZstdError} from './errors.ts'
import {Frame} from './frame.ts'

export {ZstdError} from './errors.ts'
export type {ZstdErrorCode} from './errors.ts'

export interface DecodeZstdOptions {
  /** Maximum total decoded bytes across all concatenated frames. Defaults to 2 ** 30. */
  maxOutputSize?: number
}

/** Decodes complete standard/skippable Zstandard frames, verifying any content checksums. */
export default function decodeZstd(input: ArrayBuffer | Uint8Array, options: DecodeZstdOptions = {}): Uint8Array {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
    throw new TypeError('Expected a Uint8Array or ArrayBuffer containing Zstandard frames.')
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Expected an options object.')
  }
  const limit = options.maxOutputSize === undefined ? 2 ** 30 : options.maxOutputSize
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('maxOutputSize must be a nonnegative safe integer.')
  }
  const reader = new Reader(input instanceof Uint8Array ? input : new Uint8Array(input))
  const output = new Output(limit)
  try {
    if (reader.remaining === 0) {
      invalid('Expected at least one Zstandard or skippable frame.')
    }
    while (reader.remaining !== 0) {
      const magic = reader.uint(4)
      if (magic >= 0x18_4D_2A_50 && magic <= 0x18_4D_2A_5F) {
        reader.take(reader.uint(4))
      } else if (magic === 0xFD_2F_B5_28) {
        (new Frame).decode(reader, output)
      } else {
        invalid('Invalid Zstandard frame magic number.')
      }
    }
    return output.finish()
  } catch (error) {
    if (error instanceof ZstdError) {
      throw error
    }
    throw new ZstdError('INVALID_DATA', Error.isError(error) ? error.message : 'Invalid Zstandard data.', {cause: error})
  }
}

export {decodeZstd}
