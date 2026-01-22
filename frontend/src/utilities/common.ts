import { isArray, isObject } from "lodash"
import cloneDeep from "lodash/cloneDeep"
import isEqual from "lodash/isEqual"
import { ConfigElement, Shortcut } from "../guiconfig"

export interface Update<T> {
  (value: T): void
}

export function modifiedCopyOf<T>(object: T, modification: (copy: T) => void): T {
  const copy = cloneDeep(object)
  modification(copy)
  return copy
}

export function withoutEmptyProperties(object: Record<string, unknown>): Record<string, unknown> {
  return modifiedCopyOf(object, removeEmptyProperties)
}

function removeEmptyProperties(object: Record<string, unknown>): void {
  Object.entries(object).forEach(([key, value]: [string, unknown]) => {
    if (value === null || value === undefined || isEqual(value, []) || isEqual(value, {})) delete object[key]
    else if (isComplexObject(value)) removeEmptyProperties(value as Record<string, unknown>)
  })
}

export function isComplexObject(item: unknown): boolean {
  return item !== null && item !== undefined && (isArray(item) || isObject(item))
}

export function asFormattedText(object: Record<string, unknown>, truncateAt: number): string {
  const lines = asFormattedLines(object)
  if (lines.length > truncateAt) {
    lines.splice(truncateAt)
    lines.push("...")
  }
  return lines.join("\n")
}

function asFormattedLines(object: Record<string, unknown>): string[] {
  return Object.entries(object).flatMap(([key, value]) => {
    if (isArray(value) && value.every((item) => typeof item === "number"))
      return [key + "=" + (value as number[]).join(",")]
    else if (isComplexObject(value))
      return [key].concat(asFormattedLines(value as Record<string, unknown>).map((v) => "  " + v))
    else if (isArray(object)) return [String(value)]
    else return [`${key}=${value}`]
  })
}

export function numberValue(object: unknown, shortcut: Shortcut, element: ConfigElement): number | undefined {
  if (object === undefined || object === null) return undefined

  let value: unknown = object
  for (const property of element.path) {
    if (typeof value !== "object" || value === null) return undefined
    value = (value as Record<string, unknown>)[property]
    if (value === undefined || value === null) return undefined
  }
  if (typeof value !== "number") return undefined
  if (element.reverse) {
    const range_from = shortcut.range_from!
    const range_to = shortcut.range_to!
    const range = range_from - range_to
    const fraction = (value - range_from) / range
    value = range_to - fraction * range
  }
  return typeof value === "number" ? value : undefined
}

export function numberValues(object: unknown, shortcut: Shortcut): (number | undefined)[] {
  if (object === undefined || object === null) return [undefined]

  const values: (number | undefined)[] = []
  for (const element of shortcut.config_elements) {
    values.push(numberValue(object, shortcut, element))
  }
  return values
}

export function boolValue(object: unknown, shortcut: Shortcut, element: ConfigElement): boolean | undefined {
  if (object === undefined || object === null) return undefined

  let value: unknown = object
  for (const property of element.path) {
    if (typeof value !== "object" || value === null) return undefined
    value = (value as Record<string, unknown>)[property]
    if (value === undefined || value === null) return undefined
  }
  if (typeof value !== "boolean") return undefined
  if (element.reverse) {
    value = !value
  }
  return typeof value === "boolean" ? value : undefined
}

export function boolValues(object: unknown, shortcut: Shortcut): (boolean | undefined)[] {
  if (object === undefined || object === null) return [undefined]

  const values: (boolean | undefined)[] = []
  for (const element of shortcut.config_elements) {
    values.push(boolValue(object, shortcut, element))
  }
  return values
}

export function setNumberValue(object: unknown, path: string[], value: number): void {
  if (typeof object !== "object" || object === null) return
  let subObject: unknown = object
  for (const property of path.slice(0, path.length - 1)) {
    if (typeof subObject !== "object" || subObject === null) return
    subObject = (subObject as Record<string, unknown>)[property]
    if (subObject === undefined) return
  }
  const lastProperty = path[path.length - 1]
  if (typeof subObject === "object" && subObject !== null) {
    const obj = subObject as Record<string, unknown>
    if (lastProperty in obj && typeof obj[lastProperty] === "number") {
      obj[lastProperty] = value
    }
  }
}

export function setNumberValues(object: unknown, shortcut: Shortcut, value: number): void {
  for (const element of shortcut.config_elements) {
    console.log(element)
    const path = element.path
    let elementValue = value
    if (element.reverse) {
      const range_from = shortcut.range_from!
      const range_to = shortcut.range_to!
      const range = range_from - range_to
      const fraction = (value - range_from) / range
      elementValue = range_to - fraction * range
    }
    console.log(value, elementValue)
    setNumberValue(object, path, elementValue)
  }
}

export function setBoolValue(object: unknown, path: string[], value: boolean): void {
  if (typeof object !== "object" || object === null) return
  let subObject: unknown = object
  for (const property of path.slice(0, path.length - 1)) {
    if (typeof subObject !== "object" || subObject === null) return
    subObject = (subObject as Record<string, unknown>)[property]
    if (subObject === undefined) return
  }
  const lastProperty = path[path.length - 1]
  if (typeof subObject === "object" && subObject !== null) {
    const obj = subObject as Record<string, unknown>
    if (lastProperty in obj && typeof obj[lastProperty] === "boolean") {
      obj[lastProperty] = value
    }
  }
}

export function setBoolValues(object: unknown, shortcut: Shortcut, value: boolean): void {
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
