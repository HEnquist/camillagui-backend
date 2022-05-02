import cloneDeep from "lodash/cloneDeep"

export interface Update<T> {
  (value: T): void
}

export function modifiedCopyOf<T>(object: T, modification: (copy: T) => void): T {
  const copy = cloneDeep(object)
  modification(copy)
  return copy
}