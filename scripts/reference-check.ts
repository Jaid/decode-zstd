import {deepStrictEqual} from 'node:assert'
import decodeZstd, {ZstdError} from '../src/main.ts'
import {fixtureCases, fixtureName, sample} from '../test/helpers.ts'
import {random} from '../test/entropy/helpers.ts'

let rng = random(0x752db324)
const kinds = ['text', 'random', 'rle', 'mixed', 'skewed', 'alphabet']
const trials = Number(Bun.env.TRIALS ?? 300)
for (let trial = 0; trial < trials; trial++) {
  const length = trial % 25 === 0 ? 2000000 + rng() % 1000000 : rng() % 250000
  const data = sample(kinds[trial % kinds.length], length, rng())
  const level = [-5, 1, 3, 6, 9, 15, 19, 22][trial % 8]
  const args = ['zstd', '-q', '--ultra', level < 0 ? `--fast=${-level}` : `-${level}`, '--stdout']
  if (trial % 2) args.push(`--stream-size=${length}`)
  if (trial % 3) args.push('--no-check')
  if (trial % 11 === 0) args.push('--long=27')
  else if (trial % 7 === 0) args.push('--zstd=wlog=10')
  const result = Bun.spawnSync(args, {stdin: data, stdout: 'pipe', stderr: 'pipe'})
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
  try {
    deepStrictEqual(decodeZstd(result.stdout, {maxOutputSize: length}), data)
  } catch (error) {
    await Bun.write('temp/reference-failure.zst', result.stdout)
    console.error({trial, length, level, args})
    throw error
  }
}
console.log(`Matched ${trials} reference CLI round trips, including small windows and long-distance mode.`)

const fixtures: Uint8Array[] = []
for (const fixture of fixtureCases) {
  fixtures.push(new Uint8Array(await Bun.file(`test/fixtures/${fixtureName(fixture)}-known.zst`).arrayBuffer()))
}
rng = random(0x74cc2159)
let accepted = 0
let strictRejections = 0
let largeWindows = 0
const rejections = new Map<string, number>()
const mutations = Number(Bun.env.MUTATIONS ?? 10000)
for (let trial = 0; trial < mutations; trial++) {
  const original = fixtures[trial % fixtures.length]
  const data = original.slice()
  for (let i = 0; i <= trial % 3; i++) data[rng() % data.length] ^= 1 << (rng() % 8)
  // Limit the native oracle as well as this decoder; malformed frames can advertise huge output.
  let native: Uint8Array | undefined
  const oracle = Bun.spawnSync(['zstd', '-dq', '-M2MB', '--stdout'], {stdin: data, stdout: 'pipe', stderr: 'pipe', timeout: 5000})
  if (oracle.exitCode === 0 && oracle.stdout.length <= 2000000) native = oracle.stdout
  let ours: Uint8Array | undefined
  let rejection = ''
  try { ours = decodeZstd(data, {maxOutputSize: 2000000}) } catch (error) {
    if (!(error instanceof ZstdError)) throw error
    rejection = error.message
  }
  if (ours && !native && new TextDecoder().decode(oracle.stderr).includes('memory') && !(data[4] & 32)) {
    // This decoder supports the entire descriptor range without allocating the window.
    // Native Zstandard caps windowLog at 31. Reducing only that bound is safe here:
    // both the actual output and all possible match distances are limited to 2 MB.
    const bounded = data.slice()
    bounded[5] = 0x58
    const retried = Bun.spawnSync(['zstd', '-dq', '-M8MB', '--stdout'], {stdin: bounded, stdout: 'pipe', stderr: 'pipe', timeout: 5000})
    if (retried.exitCode === 0) {
      native = retried.stdout
      largeWindows++
    }
  }
  if (ours) {
    if (!native) {
      await Bun.write('temp/mutation-failure.zst', data)
      throw new Error(`Native rejected an accepted mutation at trial ${trial}.`)
    }
    deepStrictEqual(ours, new Uint8Array(native))
    accepted++
  } else if (native) {
    // Keep any acceptance differences visible and fail at the end for investigation.
    strictRejections++
    rejections.set(rejection, (rejections.get(rejection) ?? 0) + 1)
    await Bun.write('temp/strict-rejection.zst', data)
  }
}
console.log(`Checked ${mutations} deterministic frame mutations: ${accepted} accepted with identical output, ${strictRejections} additional strict rejections.`)
if (strictRejections) console.log('Inspect temp/strict-rejection.zst before interpreting the acceptance difference as a defect.')

console.log({largeWindows, additionalRejections: Object.fromEntries(rejections)})
if (strictRejections) throw new Error('Investigate the additional strict rejections above.')
