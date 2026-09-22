import {buildFseTable, decodeHuffman, readFseTable, readHuffmanTable, ReverseBits} from '../../src/entropy/main.ts'
import reference from '../../test/entropy/fixtures/reference.json'

function equal(actual: ArrayLike<number>, expected: ArrayLike<number>): void {
  if (actual.length !== expected.length) throw new Error('Length mismatch.')
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) throw new Error(`Value mismatch at ${i}.`)
  }
}

export function checkEntropy(): void {
  for (const fixture of reference.huffman) {
    const header = Uint8Array.fromHex(fixture.header)
    const {table, next} = readHuffmanTable(header)
    if (next !== header.length) throw new Error('Huffman header length mismatch.')
    const expected = Uint8Array.fromHex(fixture.decoded)
    equal(decodeHuffman(Uint8Array.fromHex(fixture.one), expected.length, table, false), expected)
    equal(decodeHuffman(Uint8Array.fromHex(fixture.four), expected.length, table, true), expected)
  }
  for (const fixture of reference.fse) {
    const data = Uint8Array.fromHex(fixture.header)
    const {table, next} = readFseTable(data, 0, 255, 9)
    if (next !== data.length) throw new Error('FSE header length mismatch.')
    equal(table.symbols, fixture.symbols)
    equal(table.bits, fixture.bits)
    equal(table.base, fixture.base)
    equal(buildFseTable(fixture.counts, fixture.tableLog).symbols, table.symbols)
  }
  const reader = new ReverseBits(Uint8Array.of(255, 255, 255, 255, 1))
  if (reader.read(32) !== 0xffffffff) throw new Error('Unsigned 32-bit read mismatch.')
  reader.finish()
  let rejected = false
  try { readHuffmanTable(Uint8Array.fromHex('04207e1f02')) } catch { rejected = true }
  if (!rejected) throw new Error('Accepted truncated FSE initial states.')
}
