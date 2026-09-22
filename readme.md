<center><a href="https://npmjs.com/package/decode-zstd"><img src="https://shieldcn.dev/npm/v/decode-zstd.svg?variant=secondary&logo=npm&label=latest+version" alt="Latest version on npm"/></a> <a href="https://github.com/Jaid/decode-zstd/raw/HEAD/license.txt"><img src="https://shieldcn.dev/github/license/Jaid/decode-zstd.svg?variant=secondary" alt="License"/></a></center>

# decode-zstd

small, dependency-free JavaScript Zstandard decompressor

## intro

No runtime dependencies, WebAssembly, native bindings, subprocesses or platform decompression APIs. The decoder runs on current Bun, Node.js and browsers. The aggressive production ESM bundle is approximately 13 kb before transport compression.

## features

- Standard Zstandard frames, optional and unknown content sizes, every frame-header size encoding and all 16 skippable magic values.
- Raw, run-length encoded and compressed blocks, including multi-block history.
- Raw/RLE literals, Huffman literals with raw or FSE-compressed weights, one/four streams and treeless table reuse.
- Predefined, RLE, compressed and repeated FSE sequence tables, all standard literal/match length codes and offset codes 0–31.
- Repeat offsets, overlapping matches and frame-local state reset.
- XXH64 content checksums with seed zero, using the required low 32 bits.
- Block, window, sequence, entropy and exact-consumption validation, plus published decompressor errata regressions.

Streaming and custom dictionaries are intentionally out of scope. Nonzero dictionary IDs are rejected explicitly. Legacy Zstandard versions and the nonstandard magicless API format are not supported.

Checksums detect accidental corruption, not malicious modification or authenticity. Validation and differential testing are substantial, but are not a formal security audit.

## installation

<a href="https://npmjs.com/package/decode-zstd"><img src="https://shieldcn.dev/badge/npm-decode--zstd-C23039.svg?variant=secondary&logo=npm" alt="decode-zstd on npm"/></a>

```sh
npm install --save decode-zstd
```

## usage

```typescript
import decodeZstd from 'decode-zstd'

const raw = decodeZstd(buffer)
```

`buffer` is a `Uint8Array` (including a Node/Bun `Buffer`) or `ArrayBuffer`. The result is a new `Uint8Array`.

### API

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

### Errors

Malformed or unsupported compressed data throws `ZstdError`, whose `code` is one of:

| Code | Meaning |
| --- | --- |
| `INVALID_DATA` | Invalid framing, truncated data, invalid entropy tables/bitstreams, bad match history or a size mismatch. |
| `UNSUPPORTED_DICTIONARY` | A nonzero dictionary ID was requested. |
| `OUTPUT_LIMIT` | The output budget, safe-integer size range or a catchable allocation limit was exceeded. |
| `CHECKSUM_MISMATCH` | The stored frame checksum disagrees with decoded content. |

Messages are diagnostic, not a stable parsing interface. Entropy failures preserve their underlying error as `cause`. Incorrect API argument types throw `TypeError`; invalid `maxOutputSize` values throw `RangeError`.

## legal

Implementation follows the [Zstandard compression format](https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md), including the upstream decompressor errata and permissiveness notes. Runtime code is implemented locally; there is no dependency on another JavaScript Zstandard decoder.

Upstream golden fixtures and transcribed format tables are attributed in [third-party notices](docs/third-party-notices.md). The project itself is MIT licensed.

## development

Additional reference validation:

```sh
bun run build
bun run test:browser
bun run test:reference
bun scripts/entropy/check-reference.ts
```

`test:browser` runs the decoder in a current Chromium-family browser. `test:reference` requires the `zstd` CLI and runs 300 deterministic native-encoder round trips plus 10 000 corrupted-frame comparisons by default; override `TRIALS` and `MUTATIONS` to change the corpus size.

`bun run build` produces the aggressive browser-compatible ESM package and declarations under `dist/decode-zstd/production/`.

See [frame fixture provenance](test/fixtures/README.md), [entropy fixture provenance](test/entropy/fixtures/readme.md), [entropy implementation notes](docs/entropy.md) and [third-party notices](docs/third-party-notices.md). Native C fixture generators and reference programs are development tools only and are never included in the decoder runtime.

### setting up

```sh
git clone git@github.com:Jaid/decode-zstd.git
cd decode-zstd
bun install
```

### linting

```sh
bun run lint
```

### testing

```sh
bun run test
```

## license

[MIT License](https://github.com/Jaid/decode-zstd/raw/HEAD/license.txt)<br>
Copyright © 2026, Jaid \<jaid.jsx@gmail.com> (https://github.com/jaid)

<!--
readme generated with tldw v9.7.0 from ./docs and ./docs/tldw
github.com/Jaid/tldw
-->
