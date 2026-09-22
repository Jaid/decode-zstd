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
