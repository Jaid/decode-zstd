# Usage

```typescript
import decodeZstd from 'decode-zstd'

const raw = decodeZstd(buffer)
```

`buffer` is a `Uint8Array` (including a Node/Bun `Buffer`) or `ArrayBuffer`. The result is a new `Uint8Array`.

```typescript
const raw = decodeZstd(buffer, {maxOutputSize: 10_000_000})
```

Concatenated frames and skippable frames are handled automatically. Checksums are always verified when present. Streaming and dictionaries are not supported.

See [the README](../README.md) for the full API, resource limits and error codes. Build a source checkout with `bun run build` before importing its package name.
