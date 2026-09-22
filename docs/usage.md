```typescript
import decodeZstd from 'decode-zstd'

const raw = decodeZstd(buffer)
```

`buffer` is a `Uint8Array` (including a Node/Bun `Buffer`) or `ArrayBuffer`. The result is a new `Uint8Array`.

# API

`decodeZstd` is available as both a default and named export.

```typescript
import decodeZstd, {ZstdError} from 'decode-zstd'
import type {DecodeZstdOptions, ZstdErrorCode} from 'decode-zstd'

const raw = decodeZstd(compressed, {
  maxOutputSize: 64 * 1024 * 1024,
})
```

- **Input:** `Uint8Array` or `ArrayBuffer`. Node/Bun `Buffer` works because it is a `Uint8Array`. Byte-offset views are respected. Other typed arrays and `DataView` are intentionally not accepted.
- **Output:** a new exact-length `Uint8Array` containing the concatenated decoded bytes. It neither shares memory with nor modifies the input.
- **`maxOutputSize`:** a nonnegative safe integer limiting total decoded bytes across all frames. The default is `2 ** 30` (1 073 741 824 bytes). Zero permits only empty output.
- **Framing:** input must contain at least one complete standard or skippable frame. Concatenated frames are decoded in order and skippable frames produce no output.
- **Integrity:** content checksums are verified whenever present.

The call is synchronous and retains the full result. `maxOutputSize` is an output budget, not a peak-memory limit. Buffer growth and final trimming may temporarily hold additional copies alongside compressed input and block scratch space. Choose a suitably small budget for untrusted input and use a Worker when decoding should not block a UI thread.

# Errors

Malformed or unsupported compressed data throws `ZstdError`, whose `code` is one of:

| Code | Meaning |
| --- | --- |
| `INVALID_DATA` | Invalid framing, truncated data, invalid entropy tables/bitstreams, bad match history or a size mismatch. |
| `UNSUPPORTED_DICTIONARY` | A nonzero dictionary ID was requested. |
| `OUTPUT_LIMIT` | The output budget, safe-integer size range or a catchable allocation limit was exceeded. |
| `CHECKSUM_MISMATCH` | The stored frame checksum disagrees with decoded content. |

Messages are diagnostic, not a stable parsing interface. Entropy failures preserve their underlying error as `cause`. Incorrect API argument types throw `TypeError`; invalid `maxOutputSize` values throw `RangeError`.
