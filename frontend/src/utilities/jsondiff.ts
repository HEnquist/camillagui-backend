import { cloneDeep } from "lodash"
import { createPatch, applyPatch } from "rfc6902"
import { Pointer } from "rfc6902/pointer"
import { stringify } from "yaml"

export function jsonUndoDiff(json1: any, json2: any): string {
  const json1copy = cloneDeep(json1)
  return createPatch(json1copy, json2)
    .map((op) => {
      const path = Pointer.fromJSON(op.path).tokens.slice(1)
      switch (op.op) {
        case "add": {
          applyPatch(json1copy, [op])
          return diffEntry(path, "*added*", valueAsString(op.value))
        }
        case "remove": {
          const value = valueAt(json1copy, path)
          applyPatch(json1copy, [op])
          return diffEntry(path, "*removed*", value)
        }
        case "replace": {
          const value = valueAt(json1copy, path)
          applyPatch(json1copy, [op])
          return diffEntry(path, value, valueAsString(op.value))
        }
      }
      return ""
    })
    .join("<br/>")
}

function diffEntry(path: string[], oldValue: string, newValue: string): string {
  return `${path.join(" > ")}: ${oldValue} => ${newValue}`
}

export type DiffAction = "add" | "remove" | "replace"

export interface DiffRow {
  action: DiffAction
  path: string[]
  before: any
  after: any
}

// return true if the value is null, undefined, an emtpy string, array or object
function isNullish(value: any): boolean {
  if (value === null || value === undefined || value === "") return true
  else if (Array.isArray(value)) return value.length === 0
  else if (typeof value === "object") return Object.getOwnPropertyNames(value).length === 0
  else return false
}

export function jsonDiff(json1: any, json2: any): DiffRow[] {
  const json1copy = cloneDeep(json1)
  const ops = createPatch(json1copy, json2)
  const rows = []
  for (const op of ops) {
    const path = Pointer.fromJSON(op.path).tokens.slice(1)
    let row
    switch (op.op) {
      case "add": {
        applyPatch(json1copy, [op])
        row = {
          action: "add" as DiffAction,
          path: path,
          before: null,
          after: op.value,
        }
        break
      }
      case "remove": {
        const value = rawValueAt(json1copy, path)
        applyPatch(json1copy, [op])
        row = {
          action: "remove" as DiffAction,
          path: path,
          before: value,
          after: null,
        }
        break
      }
      case "replace": {
        const value = rawValueAt(json1copy, path)
        applyPatch(json1copy, [op])
        row = {
          action: "replace" as DiffAction,
          path: path,
          before: value,
          after: op.value,
        }
      }
    }
    // add to array unless both before and after values are null, empty objects or empty arrays
    if (row && (!isNullish(row.before) || !isNullish(row.after))) {
      rows.push(row)
    }
  }
  // sort the array on the path property before returning
  rows.sort((a, b) => {
    const pathA = a.path.slice(0, -1).join("///")
    const pathB = b.path.slice(0, -1).join("///")
    return pathA.localeCompare(pathB)
  })
  // stringify before and after values
  rows.forEach((row) => {
    if (row.before !== null) row.before = stringify(row.before)
    if (row.after !== null) row.after = stringify(row.after)
  })
  return rows
}

function rawValueAt(json: any, path: string[]): any {
  if (json === undefined) {
    return
  }
  return path.length === 0 ? json : rawValueAt(json[path[0]], path.slice(1))
}

function valueAt(json: any, path: string[]): any {
  if (json === undefined) {
    return
  }
  return path.length === 0 ? valueAsString(json) : valueAt(json[path[0]], path.slice(1))
}

function valueAsString(json: any): string {
  if (Array.isArray(json)) {
    const array = json as any[]
    return "[" + array.map((item) => valueAsString(item)).join() + "]"
  } else if (json !== null && typeof json === "object")
    return (
      "{" +
      Object.getOwnPropertyNames(json)
        .map((property) => property + ":" + valueAsString(json[property]))
        .join() +
      "}"
    )
  else return json
}
