export function sortedAlphabetically(array: string[]): string[] {
  array.sort((a, b) => a.localeCompare(b))
  return array
}

export function moveItem<T>(array: T[], fromIndex: number, toIndex: number) {
  const removed = array.splice(fromIndex, 1)
  array.splice(toIndex, 0, ...removed)
}

export function moveItemUp<T>(array: T[], index: number) {
  moveItem(array, index, index - 1)
}

export function moveItemDown<T>(array: T[], index: number) {
  moveItem(array, index, index + 1)
}

export function toMap<T extends string>(array: T[]): { [key: string]: T } {
  const map: { [key: string]: T } = {}
  array.forEach(value => map[value] = value)
  return map
}