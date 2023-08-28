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

export function asFormattedText(object: any): string {
  return asFormattedLines(object).join("\n")
}

function asFormattedLines(object: any): string[] {
  return Object.entries(object)
      .flatMap(([key, value]) => {
        if (isArray(value) && value.every(item => typeof item === 'number'))
          return [key + '=' + value.join(',')]
        else if (isComplexObject(value))
          return [key].concat(asFormattedLines(value).map(v => "  " + v))
        else if (isArray(object))
          return [(value as any).toString()]
        else
          return [`${key}=${value}`]
      })
}