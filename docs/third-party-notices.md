# Third-party notices

## Zstandard reference material

The runtime decoder is a local TypeScript implementation of the Zstandard format, not a port or dependency on a third-party JavaScript decoder. The implementation was checked against the upstream educational C decoder and native Zstandard.

The four binary golden fixtures under `test/fixtures/golden/` are copied unchanged from `facebook/zstd` revision `01b7154f1172432f8abe9b3bb9909e14a1176b7d`. The other frame and entropy fixtures were generated using Zstandard v1.5.7 from deterministic inputs. The upstream BSD license is preserved verbatim in [licenses/zstandard.txt](licenses/zstandard.txt).

Default FSE distributions, length-code mappings and `test/entropy/fixtures/predefined.json` are transcriptions of format constants and tables. Their representation was changed to TypeScript/JSON; this is not a verbatim redistribution of the specification. The specification’s Huffman example byte ordering issue is documented in [entropy.md](entropy.md).

The supplied compression-format specification is version 0.4.5, dated 2026-05-14. Its notice is preserved here:

> Copyright (c) Meta Platforms, Inc. and affiliates.
>
> Permission is granted to copy and distribute this document for any purpose and without charge, including translations into other languages and incorporation into compilations, provided that the copyright notice and this notice are preserved, and that any substantive changes or deletions from the original are clearly marked. Distribution of this document is unlimited.

The project’s original code is distributed under the MIT license.
