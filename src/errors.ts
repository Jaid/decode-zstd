export type ZstdErrorCode = 'INVALID_DATA' | 'UNSUPPORTED_DICTIONARY' | 'OUTPUT_LIMIT' | 'CHECKSUM_MISMATCH'

/** A malformed frame, unsupported dictionary or resource-limit failure. */
export class ZstdError extends Error {
  override readonly name = 'ZstdError'

  constructor(readonly code: ZstdErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export function invalid(message: string): never {
  throw new ZstdError('INVALID_DATA', message)
}

export function outputLimit(message: string): never {
  throw new ZstdError('OUTPUT_LIMIT', message)
}
