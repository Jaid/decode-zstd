import {deepStrictEqual, strictEqual} from 'node:assert'
import {buildFseTable, decodeHuffman, readFseTable, readHuffmanTable} from '../../src/entropy/main.ts'
import type Reference from '../../test/entropy/fixtures/reference.json'

const file = Bun.argv[2] ?? 'test/entropy/fixtures/reference.json'
const reference = await Bun.file(file).json() as typeof Reference
for (const fixture of reference.huffman) {
  const header = Uint8Array.fromHex(fixture.header)
  const {table, next} = readHuffmanTable(header)
  strictEqual(next, header.length)
  const expected = Uint8Array.fromHex(fixture.decoded)
  deepStrictEqual(decodeHuffman(Uint8Array.fromHex(fixture.one), expected.length, table, false), expected)
  deepStrictEqual(decodeHuffman(Uint8Array.fromHex(fixture.four), expected.length, table, true), expected)
}
for (const fixture of reference.fse) {
  const header = Uint8Array.fromHex(fixture.header)
  const {table, next} = readFseTable(header, 0, 255, 9)
  strictEqual(next, header.length)
  deepStrictEqual(table, buildFseTable(fixture.counts, fixture.tableLog))
  deepStrictEqual([...table.symbols], fixture.symbols)
  deepStrictEqual([...table.bits], fixture.bits)
  deepStrictEqual([...table.base], fixture.base)
}
console.log(`Matched ${reference.huffman.length} Huffman trees, both stream layouts and ${reference.fse.length} FSE tables against ${reference.source}.`)
