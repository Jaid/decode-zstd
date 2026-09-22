# Frame fixtures

The 26 top-level `.zst` files were generated with the upstream Zstandard CLI v1.5.7. Their uncompressed input is regenerated deterministically by `sample()` and `fixtureCases` in `test/helpers.ts`, so no large decoded data files are needed. Every fixture includes a checksum. Each scenario is stored with both known and unknown frame content sizes.

The corpus includes empty data, incompressible bytes, repeated text, RLE-heavy data, skewed bytes, small alphabets and mixed random/text data. Compression levels range from 1 through 22. Several inputs cross block boundaries and exercise FSE/Huffman table reuse, repeat offsets and cross-block matches.

Regenerate from the repository root with an installed `zstd` CLI:

```sh
bun scripts/generate-fixtures.ts
bun test
```

Generated compressed bytes may differ between encoder versions. The expected decoded bytes remain deterministic.

## Upstream golden regressions

The files in `golden/` are copied unchanged from `facebook/zstd`, `tests/golden-decompression/`, at revision `01b7154f1172432f8abe9b3bb9909e14a1176b7d`. They cover:

- `block-128k.zst`: a compressed block exactly 131 072 bytes long, producing 131 068 zero bytes.
- `empty-block.zst`: a compressed block with zero literals and zero sequences.
- `rle-first-block.zst`: a frame beginning with RLE blocks, producing 1 048 576 zero bytes.
- `zeroSeq_2B.zst`: zero sequences using the legal but unusual two-byte count representation.

See [upstream license](../../docs/licenses/zstandard.txt) and [third-party notices](../../docs/third-party-notices.md). The CLI and upstream checkout are not needed to run the normal tests.
