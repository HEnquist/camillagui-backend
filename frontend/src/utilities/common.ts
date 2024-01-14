import cloneDeep from "lodash/cloneDeep"

export interface Update<T> {
  (value: T): void
}

export function modifiedCopyOf<T>(object: T, modification: (copy: T) => void): T {
  const copy = cloneDeep(object)
  modification(copy)
  return copy
}

export function numberValue(object: any, path: string[]): number | undefined {
  let value = object
  for (const property of path) {
    value = value[property]
    if (value === undefined)
      return undefined
  }
  return value
}

export function setNumberValue(object: any, path: string[], value: number) {
  let subObject = object
  for (const property of path.slice(0, path.length-1)) {
    subObject = subObject[property]
    if (subObject === undefined)
      return undefined
  }
  subObject[path[path.length-1]] = value
}