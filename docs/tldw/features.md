- Standard Zstandard frames, optional and unknown content sizes, every frame-header size encoding and all 16 skippable magic values.
- Raw, run-length encoded and compressed blocks, including multi-block history.
- Raw/RLE literals, Huffman literals with raw or FSE-compressed weights, one/four streams and treeless table reuse.
- Predefined, RLE, compressed and repeated FSE sequence tables, all standard literal/match length codes and offset codes 0–31.
- Repeat offsets, overlapping matches and frame-local state reset.
- XXH64 content checksums with seed zero, using the required low 32 bits.
- Block, window, sequence, entropy and exact-consumption validation, plus published decompressor errata regressions.

Streaming and custom dictionaries are intentionally out of scope. Nonzero dictionary IDs are rejected explicitly. Legacy Zstandard versions and the nonstandard magicless API format are not supported.
