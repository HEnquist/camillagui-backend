import cloneDeep from "lodash/cloneDeep"
import isEqual from "lodash/isEqual"
import {isArray, isObject} from "lodash"

export interface Update<T> {
  (value: T): void
}

export function modifiedCopyOf<T>(object: T, modification: (copy: T) => void): T {
  const copy = cloneDeep(object)
  modification(copy)
  return copy
}

export function withoutEmptyProperties(object: any): any {
  return modifiedCopyOf(object, removeEmptyProperties)
}

function removeEmptyProperties(object: any): any {
  Object.entries(object).forEach(([key, value]: [string, any]) => {
    if (value === null || value === undefined || isEqual(value, []) || isEqual(value, {}))
      delete object[key]
    else if (isComplexObject(value))
      removeEmptyProperties(value)
  })
}

export function isComplexObject(item: any): boolean {
  return item !== null && item !== undefined && (isArray(item) || isObject(item))
}