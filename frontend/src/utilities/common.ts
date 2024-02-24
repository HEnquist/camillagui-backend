import cloneDeep from "lodash/cloneDeep"
import isEqual from "lodash/isEqual"
import { isArray, isObject } from "lodash"

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

export function asFormattedText(object: any, truncateAt: number): string {
  const lines = asFormattedLines(object)
  if (lines.length > truncateAt) {
    lines.splice(truncateAt)
    lines.push('...')
  }
  return lines.join("\n")
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

export function numberValue(object: any, path: string[]): number | undefined {
  if (object === undefined || object === null)
      return undefined
  let value = object
  for (const property of path) {
    value = value[property]
    if (value === undefined || value === null)
      return undefined
  }
  return value
}

export function setNumberValue(object: any, path: string[], value: number) {
  let subObject = object
  for (const property of path.slice(0, path.length - 1)) {
    subObject = subObject[property]
    if (subObject === undefined)
      return undefined
  }
  subObject[path[path.length - 1]] = value
}
