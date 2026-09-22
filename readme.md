<center><a href="https://npmjs.com/package/decode-zstd"><img src="https://shieldcn.dev/npm/v/decode-zstd.svg?variant=secondary&logo=npm&label=latest+version" alt="Latest version on npm"/></a> <a href="https://github.com/Jaid/decode-zstd/raw/HEAD/license.txt"><img src="https://shieldcn.dev/github/license/Jaid/decode-zstd.svg?variant=secondary" alt="License"/></a></center>

# decode-zstd

A small, synchronous Zstandard decompressor written entirely in TypeScript/JavaScript.

## Installation

```sh
npm install decode-zstd
```

No runtime dependencies, WebAssembly, native bindings, subprocesses or platform decompression APIs. The production ESM bundle is approximately 13 kb before transport compression.

```typescript
import decodeZstd from 'decode-zstd'

const compressed = new Uint8Array(await Bun.file('example.zst').arrayBuffer())
const raw = decodeZstd(compressed)
```

The decoder runs on current Bun, Node.js and browsers. `bun run build` emits a standalone JavaScript ESM package with TypeScript declarations under `dist/decode-zstd/production/`.

## API

```typescript
import decodeZstd, {ZstdError} from 'decode-zstd'
import type {DecodeZstdOptions, ZstdErrorCode} from 'decode-zstd'

const raw: Uint8Array = decodeZstd(compressed, {
  maxOutputSize: 64 * 1024 * 1024,
})
```

`decodeZstd` is available as both a default and a named export.

- **Input:** `Uint8Array` or `ArrayBuffer`. Node/Bun `Buffer` works because it is a `Uint8Array`. Byte-offset views are respected. Other typed arrays and `DataView` are intentionally not accepted; explicitly create a byte view if needed.
- **Output:** a new `Uint8Array` containing the concatenated decoded bytes. It neither shares memory with nor modifies the input. Its backing buffer has exactly the returned length.
- **`maxOutputSize`:** a nonnegative safe integer limiting total decoded bytes across all frames. The default is `2 ** 30` (1 073 741 824 bytes). Zero allows only empty output. Known content sizes are checked before output allocation; unknown sizes are checked as output grows.
- **Framing:** input must contain at least one complete standard or skippable frame. Concatenated frames are decoded in order and skippable frames produce no output. Empty input, truncation and trailing junk are errors. An actual empty Zstandard frame or a skippable-only input returns an empty array.
- **Integrity:** content checksums are verified whenever present. There is no option to bypass them.

The call is synchronous and retains the full result. `maxOutputSize` is an output budget, **not a peak-memory limit**: buffer growth and final trimming may temporarily hold additional copies, alongside the compressed input and block scratch space. Advertised windows do not cause large up-front allocations. Practical maximum output still depends on the JavaScript engine’s typed-array limits and available memory. Choose a suitably small budget for untrusted input and use a Worker if decoding should not block a UI thread.

### Errors

Malformed or unsupported compressed data throws `ZstdError`, whose `code` is one of:

| Code | Meaning |
| --- | --- |
| `INVALID_DATA` | Invalid framing, truncated data, invalid entropy tables/bitstreams, bad match history or a size mismatch. |
| `UNSUPPORTED_DICTIONARY` | A nonzero dictionary ID was requested. |
| `OUTPUT_LIMIT` | The output budget, safe-integer size range or a catchable allocation limit was exceeded. |
| `CHECKSUM_MISMATCH` | The stored frame checksum disagrees with decoded content. |

Messages are diagnostic, not a stable parsing interface. Entropy failures preserve their underlying error as `cause`. Incorrect API argument types throw `TypeError`; invalid `maxOutputSize` values throw `RangeError`. An engine-level fatal out-of-memory condition cannot be reliably converted into an exception.

```typescript
try {
  const raw = decodeZstd(compressed, {maxOutputSize: 10_000_000})
  console.log(raw.byteLength)
} catch (error) {
  if (error instanceof ZstdError) console.error(error.code, error.message)
  else throw error
}
```

## Format support

- Standard Zstandard frames, optional/unknown content sizes, every frame-header size encoding and all 16 skippable magic values.
- Raw, run-length encoded and compressed blocks, including multi-block history.
- Raw/RLE literals, Huffman literals with raw or FSE-compressed weights, one/four streams and treeless table reuse.
- Predefined, RLE, compressed and repeated FSE sequence tables, all standard literal/match length codes and offset codes 0–31.
- Repeat offsets, overlapping matches and frame-local state reset.
- XXH64 content checksums with seed zero, using the required low 32 bits.
- Block, window, sequence, entropy and exact-consumption validation, plus the published decompressor errata regressions.

**Intentionally out of scope:** streaming and custom dictionaries. Nonzero dictionary IDs are rejected explicitly. An omitted/zero ID does not prove that a frame is dictionary-free; this decoder always starts without a dictionary and cannot automatically identify an unannounced external dictionary. Legacy Zstandard versions and the nonstandard magicless API format are not supported.

Checksums detect accidental corruption, not malicious modification or authenticity. Frames without a checksum can be structurally valid despite corrupted content. Validation and differential testing are substantial, but are not a formal security audit.

## Development

```sh
bun install --frozen-lockfile
bun run lint
bun test
bun run build
```

- `lint` runs strict TypeScript checks, including a separate browser-only compilation without Node/Bun ambient types.
- `test` uses checked-in fixtures and requires no native Zstandard, browser, network or optional dependencies. Coverage is written to `out/test/coverage/`.
- `build` produces a minified browser-compatible ESM package and declarations under `dist/decode-zstd/production/`.

Additional reference validation:

```sh
bun run test:browser
bun run test:reference
bun scripts/entropy/check-reference.ts
```

`test:browser` needs Chromium or Google Chrome. Set `CHROMIUM` to an alternative executable path. The headless test uses `--no-sandbox` for isolated development containers; that is not a production browser security recommendation.

`test:reference` needs the `zstd` CLI. It runs 300 deterministic native-encoder round trips and 10 000 corrupted-frame comparisons by default; override `TRIALS` and `MUTATIONS` to change the corpus size. The reference CLI, not Bun’s zlib wrapper, is used to judge complete-frame validity. Two unusually large-window mutations in the default corpus need only their advertised window bound reduced for the reference CLI, which has a smaller supported window range; the decoded output is still compared byte for byte.

See [frame fixture provenance](test/fixtures/README.md), [entropy fixture provenance](test/entropy/fixtures/readme.md) and [internal entropy implementation notes](docs/entropy.md). Native C fixture generators and reference programs are development tools only and are never included in the decoder’s runtime path.

## References and notices

Implementation follows the [Zstandard compression format](https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md), including the [decompressor errata](https://github.com/facebook/zstd/blob/dev/doc/decompressor_errata.md) and [permissiveness notes](https://github.com/facebook/zstd/blob/dev/doc/decompressor_permissive.md). Runtime code is implemented locally; there is no dependency on another JavaScript Zstandard decoder.

Upstream golden fixtures and transcribed format tables are attributed in [third-party notices](docs/third-party-notices.md). The project itself is MIT licensed.
