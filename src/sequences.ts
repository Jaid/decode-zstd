import {buildFseTable, readFseTable, ReverseBits} from './entropy/main.ts'
import type {FseTable} from './entropy/main.ts'
import {Reader, Output} from './buffers.ts'
import {invalid} from './errors.ts'

const literalBits = [...Array<number>(16).fill(0), 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
const matchBits = [...Array<number>(32).fill(0), 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

function baselines(bits: number[], first: number): number[] {
  return bits.map(count => {
    const base = first
    first += 2 ** count
    return base
  })
}

const literalBase = baselines(literalBits, 0)
const matchBase = baselines(matchBits, 3)

const literalDefault = buildFseTable([
  4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1,
], 6)
const offsetDefault = buildFseTable([
  1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1,
], 5)
const matchDefault = buildFseTable([
  1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
], 6)

/** Each sequence alphabet has independent, frame-local repeat-table state. */
class Alphabet {
  private previous?: FseTable

  constructor(private readonly predefined: FseTable, private readonly maxSymbol: number, private readonly maxLog: number) {}

  read(reader: Reader, mode: number): FseTable {
    let table: FseTable
    switch (mode) {
      case 0:
        table = this.predefined
        break
      case 1: {
        const symbol = reader.uint(1)
        if (symbol > this.maxSymbol) invalid('Sequence RLE symbol exceeds its alphabet.')
        table = {tableLog: 0, symbols: Uint8Array.of(symbol), bits: Uint8Array.of(0), base: Uint16Array.of(0)}
        break
      }
      case 2: {
        const parsed = readFseTable(reader.data, reader.position, this.maxSymbol, this.maxLog)
        reader.position = parsed.next
        table = parsed.table
        break
      }
      default:
        if (!this.previous) invalid('Sequence repeat mode has no previous table in this frame.')
        table = this.previous
    }
    this.previous = table
    return table
  }
}

/** Decodes interleaved sequence states and retains the three repeat offsets across blocks. */
export class Sequences {
  private readonly literals = new Alphabet(literalDefault, 35, 9)
  private readonly offsets = new Alphabet(offsetDefault, 31, 8)
  private readonly matches = new Alphabet(matchDefault, 52, 9)
  private repeated = [1, 4, 8]

  private offset(value: number, literalLength: number): number {
    if (value > 3) {
      const offset = value - 3
      this.repeated = [offset, this.repeated[0], this.repeated[1]]
      return offset
    }
    const index = value - 1 + (literalLength === 0 ? 1 : 0)
    const offset = index === 3 ? this.repeated[0] - 1 : this.repeated[index]
    if (offset === 0) invalid('Repeat offset resolves to zero.')
    if (index !== 0) {
      if (index >= 2) this.repeated[2] = this.repeated[1]
      this.repeated[1] = this.repeated[0]
      this.repeated[0] = offset
    }
    return offset
  }

  decode(reader: Reader, literals: Uint8Array, output: Output, frameStart: number, window: number, blockLimit: number): void {
    const blockStart = output.length
    let count = reader.uint(1)
    if (count === 255) count = reader.uint(2) + 0x7f00
    else if (count >= 128) count = (count - 128) * 256 + reader.uint(1)
    if (count === 0) {
      reader.finish()
      output.append(literals)
      return
    }
    if (count * 3 + literals.length > blockLimit) invalid('Sequences cannot fit in the decoded block.')
    const modes = reader.uint(1)
    if (modes & 3) invalid('Reserved sequence mode bits are set.')
    const ll = this.literals.read(reader, modes >>> 6)
    const of = this.offsets.read(reader, (modes >>> 4) & 3)
    const ml = this.matches.read(reader, (modes >>> 2) & 3)
    const bits = new ReverseBits(reader.take(reader.remaining))
    let ls = bits.read(ll.tableLog)
    let os = bits.read(of.tableLog)
    let ms = bits.read(ml.tableLog)
    let literalPosition = 0
    for (let sequence = 0; sequence < count; sequence++) {
      const lc = ll.symbols[ls]
      const oc = of.symbols[os]
      const mc = ml.symbols[ms]
      const value = 2 ** oc + bits.read(oc)
      const matchLength = matchBase[mc] + bits.read(matchBits[mc])
      const literalLength = literalBase[lc] + bits.read(literalBits[lc])
      if (literalPosition + literalLength > literals.length) invalid('Sequence reads beyond the literals section.')
      if (output.length - blockStart + matchLength + literals.length - literalPosition > blockLimit) {
        invalid('Decoded sequences exceed the block or frame size.')
      }
      output.append(literals.subarray(literalPosition, literalPosition + literalLength))
      literalPosition += literalLength
      const offset = this.offset(value, literalLength)
      if (offset > window || offset > output.length - frameStart) invalid('Match offset is outside the frame history or window.')
      output.match(offset, matchLength)
      if (sequence + 1 < count) {
        ls = ll.base[ls] + bits.read(ll.bits[ls])
        ms = ml.base[ms] + bits.read(ml.bits[ms])
        os = of.base[os] + bits.read(of.bits[os])
      }
    }
    bits.finish()
    output.append(literals.subarray(literalPosition))
  }
}

export {literalBits, matchBits, literalBase, matchBase}
