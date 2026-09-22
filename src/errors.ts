export type ZstdErrorCode = 'CHECKSUM_MISMATCH' | 'INVALID_DATA' | 'OUTPUT_LIMIT' | 'UNSUPPORTED_DICTIONARY'

export function invalid(message: string): never {
  throw new ZstdError('INVALID_DATA', message)
}

export function outputLimit(message: string): never {
  throw new ZstdError('OUTPUT_LIMIT', message)
}

/** A malformed frame, unsupported dictionary or resource-limit failure. */
export class ZstdError extends Error {
  override readonly name = 'ZstdError'

  constructor(readonly code: ZstdErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
  }
}
