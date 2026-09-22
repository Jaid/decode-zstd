Implementation follows the [Zstandard compression format](https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md), including the upstream decompressor errata and permissiveness notes. Runtime code is implemented locally; there is no dependency on another JavaScript Zstandard decoder.

Upstream golden fixtures and transcribed format tables are attributed in [third-party notices](docs/third-party-notices.md). The project itself is MIT licensed.
