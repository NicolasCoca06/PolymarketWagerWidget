export function stringifyResult(value: unknown) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  )
}
