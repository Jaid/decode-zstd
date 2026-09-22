/** Requires an integer in the inclusive range. */
export function integer(value: number, min: number, max: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}–${max}.`)
  }
}
