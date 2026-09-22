import {fixtureCases, fixtureName, sample} from '../test/helpers.ts'

for (const fixture of fixtureCases) {
  const data = sample(fixture.kind, fixture.length)
  for (const known of [false, true]) {
    const args = ['zstd', '-q', '--ultra', `-${fixture.level}`, '--stdout', '--check']
    if (known) args.push(`--stream-size=${data.length}`)
    const result = Bun.spawnSync(args, {stdin: data, stdout: 'pipe', stderr: 'pipe'})
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
    await Bun.write(`test/fixtures/${fixtureName(fixture)}-${known ? 'known' : 'unknown'}.zst`, result.stdout)
  }
}
console.log('Generated 26 deterministic Zstandard frame fixtures.')
