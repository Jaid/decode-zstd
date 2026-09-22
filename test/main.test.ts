import {expect, test} from 'bun:test'

const {default: decodeZstd} = await import('#src/main.ts')
test('should run', () => {
  const result = decodeZstd()
  expect(result).toBe('decode-zstd') // TODO Test actual functionality
})
