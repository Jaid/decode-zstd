/// <reference lib="dom" />
import decodeZstd, {ZstdError} from '../src/main.ts'
import {checkEntropy} from './entropy/browser-check.ts'
import {concat, fixtureCases, sample} from '../test/helpers.ts'

export function checkBrowser(fixtures: string[]): void {
  try {
    checkEntropy()
    let total = 0
    const parts: Uint8Array[] = []
    for (const [index, encoded] of fixtures.entries()) {
      const data = Uint8Array.fromHex(encoded)
      const fixture = fixtureCases[Math.floor(index / 2)]
      const expected = sample(fixture.kind, fixture.length)
      const output = decodeZstd(data)
      if (output.length !== expected.length || output.some((byte, i) => byte !== expected[i])) {
        throw new Error(`Frame fixture ${index} produced incorrect bytes.`)
      }
      parts.push(data)
      total += output.length
      data[data.length - 1] ^= 1
      let rejected = false
      try { decodeZstd(data) } catch (error) { rejected = error instanceof ZstdError }
      if (!rejected) throw new Error('Accepted a corrupted checksum.')
      // Keep the concatenation corpus pristine.
      data[data.length - 1] ^= 1
    }
    if (decodeZstd(concat(...parts)).length !== total) throw new Error('Concatenation length mismatch.')
    document.body.textContent = `Passed ${fixtures.length} full-frame vectors, checksums, concatenation and all entropy reference vectors.`
    document.body.dataset.result = 'passed'
  } catch (error) {
    document.body.textContent = String(error)
    document.body.dataset.result = 'failed'
  }
}
