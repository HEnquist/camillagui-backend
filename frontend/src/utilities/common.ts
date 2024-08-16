import cloneDeep from "lodash/cloneDeep"
import isEqual from "lodash/isEqual"
import { isArray, isObject } from "lodash"
import { Shortcut } from "../guiconfig"

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

export function numberValue(object: any, shortcut: Shortcut): number | undefined {
  if (object === undefined || object === null)
    return undefined
  const element = shortcut.config_elements[0]
  let value = object
  for (const property of element.path) {
    value = value[property]
    if (value === undefined || value === null)
      return undefined
  }
  if (typeof value !== "number")
    return undefined
  if (element.reverse) {
    const range_from = shortcut.range_from ? shortcut.range_from : -10
    const range_to = shortcut.range_to ? shortcut.range_to : 10
    let range = range_from - range_to
    let fraction = (value - range_from) / range
    value = range_to - fraction * range
  }
  return value
}

export function boolValue(object: any, shortcut: Shortcut): boolean | undefined {
  if (object === undefined || object === null)
    return undefined
  const element = shortcut.config_elements[0]
  let value = object
  for (const property of element.path) {
    value = value[property]
    if (value === undefined || value === null)
      return undefined
  }
  if (typeof value !== "boolean")
    return undefined
  if (element.reverse) {
    value = !value
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
  if (path[path.length - 1] in subObject && typeof subObject[path[path.length - 1]] === "number") {
    subObject[path[path.length - 1]] = value
  }
}

export function setNumberValues(object: any, shortcut: Shortcut, value: number) {
  for (const element of shortcut.config_elements) {
    console.log(element)
    const path = element.path
    let elementValue = value
    if (element.reverse) {
      const range_from = shortcut.range_from ? shortcut.range_from : -10
      const range_to = shortcut.range_to ? shortcut.range_to : 10
      let range = range_from - range_to
      let fraction = (value - range_from) / range
      elementValue = range_to - fraction * range
    }
    console.log(value, elementValue)
    setNumberValue(object, path, elementValue)
  }
}

export function setBoolValue(object: any, path: string[], value: boolean) {
  let subObject = object
  for (const property of path.slice(0, path.length - 1)) {
    subObject = subObject[property]
    if (subObject === undefined)
      return undefined
  }
  if (path[path.length - 1] in subObject && typeof subObject[path[path.length - 1]] === "boolean") {
    subObject[path[path.length - 1]] = value
  }
}

export function setBoolValues(object: any, shortcut: Shortcut, value: boolean) {
  for (const element of shortcut.config_elements) {
    console.log(element)
    const path = element.path
    let elementValue = value
    if (element.reverse) {
      elementValue = !elementValue
    }
    console.log(value, elementValue)
    setBoolValue(object, path, elementValue)
  }
}
