# Internal entropy decoder

Internal Zstandard FSE and Huffman primitives in pure TypeScript. ESM, zero runtime dependencies and no Bun-specific, Node-specific, native or WebAssembly runtime code. Runs on Bun and current browsers through a TypeScript-aware bundler, or as the built browser ESM file.

This is **not a complete Zstandard decoder**. The caller owns frame/block parsing, literals headers, sequence decoding/execution, dictionary handling, repeat-table selection and checksums.

## Quick start

```typescript
import {decodeHuffman, readHuffmanTable} from '../src/entropy/main.ts'

// Explicit weights [4, 3, 2, 0, 1], implicit weight 1, then one Huffman stream.
const data = Uint8Array.of(0x84, 0x43, 0x20, 0x10, 0x01, 0x0d)
const {table, next} = readHuffmanTable(data)
const literals = decodeHuffman(data.subarray(next), 4, table, false)
// Uint8Array [0, 1, 4, 5]
```

These implementation details live in `src/entropy/` and are bundled into the public decoder. They are not separate package exports or a supported public API. No runtime dependencies are required.

## Internal API

`next` is an **absolute byte offset in the supplied view**, not a consumed-byte count and not an offset in its underlying `ArrayBuffer`.

### `FseTable`

```typescript
interface FseTable {
  tableLog: number
  symbols: Uint8Array
  bits: Uint8Array
  base: Uint16Array
}
```

All arrays have `2 ** tableLog` entries, indexed by state. The current symbol is `symbols[state]`. A transition is:

```typescript
state = table.base[state] + reverseBits.read(table.bits[state])
```

A zero-bit transition is valid and still updates the state. The caller decides when transitions are needed; for example, the last Zstandard sequence does not update its FSE states.

### `buildFseTable(counts, tableLog): FseTable`

```typescript
function buildFseTable(counts: readonly number[], tableLog: number): FseTable
```

- Accepts 1–256 counts indexed by symbol. Each count must be `-1` or a nonnegative integer. Zero means absent; `-1` occupies one specially placed low-probability state.
- Requires `sum(abs(count)) === 2 ** tableLog`.
- Supports logs 0–16. The upper bound is the capacity of the `Uint16Array` baselines. Zstandard wire tables use much smaller, context-specific limits.
- Supports one-symbol/RLE, all-`-1` and tiny synthetic tables. Logs below 4 use sequential spreading because the standard spread step is not coprime to every tiny table size. Such logs cannot occur in normalized-count wire headers.
- Returns newly allocated arrays and does not modify `counts`.

For a symbol-42 RLE table:

```typescript
import {buildFseTable} from '../src/entropy/main.ts'

const counts = Array<number>(43).fill(0)
counts[42] = 1
const table = buildFseTable(counts, 0)
// One state: symbol 42, zero bits and baseline 0.
```

### `readFseTable(data, offset, maxSymbol, maxTableLog)`

```typescript
function readFseTable(
  data: Uint8Array,
  offset: number,
  maxSymbol: number,
  maxTableLog: number,
): {table: FseTable; next: number}
```

Reads the forward, little-endian normalized-count description, including variable-width counts, low-probability counts and repeated zero runs. `maxSymbol` is inclusive, in 0–255. `maxTableLog` is in 5–16; the encoded log is the low nibble plus 5.

Unlike the general builder, a wire description requires at least two present symbols. RLE is represented by the main decoder’s separate mode, not a one-symbol normalized-count header.

The caller supplies the context limits: Huffman weights use maximum symbol 11 and log 6; sequence tables use their applicable code ranges and log limits. Header parsing stops when the normalized probability sum is complete and rounds `next` to the following byte. Unused bits in the last header byte are ignored, **not required to be zero**.

For a predefined distribution, call `buildFseTable` instead of `readFseTable`.

### `ReverseBits`

```typescript
class ReverseBits {
  constructor(data: Uint8Array)
  read(count: number): number
  get remaining(): number
  finish(): void
}
```

Pass exactly one bounded reverse bitstream. The highest set bit of its last byte is the end marker. That bit and any higher zero padding are excluded from the payload. Empty input and a zero final byte are invalid.

`read` accepts an integer from 0 through 32, reads fields backward while preserving the little-endian value within each field and returns an unsigned `number`. In particular, reading 32 one-bits returns `4294967295`, not `-1`. Zero-bit reads return zero even at the end. Invalid or unavailable reads throw without consuming anything.

`remaining` counts unread payload bits. `finish()` requires exactly zero remaining bits and may be called repeatedly. It does not discard padding or unused data. Bit offsets use ordinary number arithmetic, including beyond 2³¹ and 2³² bits.

```typescript
import {ReverseBits} from '../src/entropy/main.ts'

const bits = new ReverseBits(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 1))
const unsigned = bits.read(32) // 4294967295
bits.finish()
```

### `HuffmanTable`

```typescript
interface HuffmanTable {
  tableLog: number
  symbols: Uint8Array
  bits: Uint8Array
}
```

A canonical, full-lookahead decoding table. `tableLog` is the maximum code length, in 1–11. Arrays have `2 ** tableLog` entries. The index is a high-bit-first `tableLog`-bit lookahead; `symbols[index]` gives the literal and `bits[index]` its actual code length. Shorter codes occupy consecutive replicated entries.

Use tables returned by `readHuffmanTable`. They can be cached and reused for treeless literals. Treat table objects and their typed arrays as immutable; arbitrary forged or mutated tables are not a supported input. Decoding checks dimensions and encountered code lengths, but does not rebuild and revalidate a caller-supplied tree.

### `readHuffmanTable(data, offset = 0)`

```typescript
function readHuffmanTable(data: Uint8Array, offset?: number): {table: HuffmanTable; next: number}
```

Supports both representations:

- Raw weights: high nibble first, up to 128 explicit weights. The unused low nibble of an odd-length representation is ignored.
- FSE-compressed weights: a byte-bounded header and two interleaved states, up to 255 explicit weights. Both initial states must be fully present. The first state emits even-indexed weights and the second emits odd-indexed weights.

Compressed weights end when a state transition needs **more** bits than remain, not merely when no bits remain. Zero-bit transitions continue, and the other state emits its last symbol. A partial terminal transition is allowed; truncated initial states are not. This special terminal rule never makes public `ReverseBits.read` permissive.

The last weight is implicit. Construction validates its power-of-two contribution, a complete canonical tree, a positive even number of weight-one symbols and a maximum depth of 11. Absent symbols are represented by weight zero. Two-symbol trees and all 256 literal symbols are supported.

### `decodeHuffman(data, outputSize, table, fourStreams)`

```typescript
function decodeHuffman(
  data: Uint8Array,
  outputSize: number,
  table: HuffmanTable,
  fourStreams: boolean,
): Uint8Array
```

Pass **only the compressed stream payload**, excluding the literals header and Huffman tree description. Supply the regenerated literals size from the enclosing header.

- `fourStreams === false`: `data` is one reverse bitstream.
- `fourStreams === true`: `data` starts with the six-byte jump table, followed by four reverse bitstreams. The first three sizes are unsigned little-endian 16-bit byte lengths; the fourth occupies the exact remainder. Every stream needs at least its end-marker byte.
- The first three output segments each have `Math.ceil(outputSize / 4)` bytes. The fourth gets the remainder. Negative fourth-segment sizes are rejected.
- Each stream must produce its exact assigned symbol count and consume every payload bit. Lookahead may internally pad missing low bits with zeros, but consuming a code always requires its full actual length.
- `outputSize` must be a nonnegative safe integer. Impossible sizes are rejected before output allocation. The library does not impose the main decoder’s block/window size policy.
- Empty output is supported with marker-only streams. This low-level function does not enforce additional enclosing literals-header restrictions on empty or very small blocks.

The returned array is newly allocated. Input buffers are never modified or retained by table construction. `ReverseBits` retains its input view; do not mutate that view while reading it.

## Errors and integration boundaries

Malformed entropy data throws `Error` with a descriptive message. Invalid numeric arguments throw `RangeError`. There is no custom error subclass or stable machine-readable error-code contract; a caller can wrap failures in its own `ZstdError`.

The decoder is synchronous. Give parsers a view bounded to the enclosing section so they cannot read into unrelated bytes. In particular, `decodeHuffman` must receive the exact stream extent: passing the remaining frame is incorrect. The compressed-weight parser additionally bounds its own FSE payload using the weight-header length.

This library validates entropy structure, not the integrity of the complete frame. A bit mutation can still describe another valid stream. Frame checksums, resource limits and all framing/sequence rules remain the caller’s responsibility.

## Validation and development

```sh
bun test
bun run lint
bun run build
bun run test:browser
```

`lint` performs strict TypeScript checks and an additional browser-only check with no Bun/Node ambient types. The build targets browser ESM. `test:browser` runs the checked-in reference corpus in headless Chromium; set `CHROMIUM` to an alternate Chromium executable if needed. Its launch flags are intended for an isolated development/test container, not an application browser security policy.

The normal tests do not need native Zstandard, Chromium, external reference files or network access. They include:

- Every row of the specification’s three predefined FSE tables.
- Upstream Zstandard 1.5.7-generated normalized headers, tables and Huffman streams in both layouts.
- Small/degenerate FSE tables, zero runs, unused header padding and all 256 symbols.
- Strict initial-state truncation, partial terminal transitions, both terminal-state orders, zero-bit tails and the 255-weight limit.
- Unsigned 32-bit reads, bit positions beyond 2³², tree validity, output counts and malformed jump tables/end markers.
- Deterministic property tests and 5000 malformed-input/mutation cases.

See [fixture provenance and regeneration](../test/entropy/fixtures/readme.md). Native tools are used only for optional fixture generation and differential development checks, never by the library or ordinary tests.

## Reference notes

Implementation follows the supplied Zstandard compression-format specification and was cross-checked against the educational decoder and upstream v1.5.7. It intentionally does not reproduce the historical acceptance of truncated initial Huffman-weight FSE states described in `decompressor_permissive.md`.

The supplied specification has an illustrative typo: its canonical assignments give `E = 0000` and `F = 0001`, but its purported `ABEF` bytes `10 0d` actually encode `ABFE`. `01 0d` encodes `ABEF`. Tests preserve the canonical assignments and record both outcomes.

References: [Zstandard format](https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md), [educational decoder](https://github.com/facebook/zstd/tree/dev/doc/educational_decoder) and [permissiveness notes](https://github.com/facebook/zstd/blob/dev/doc/decompressor_permissive.md).
