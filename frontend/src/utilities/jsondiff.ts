import {createPatch, applyPatch} from 'rfc6902'
import {Pointer} from 'rfc6902/pointer'
import {cloneDeep} from "lodash"


export function jsonDiff(json1: any, json2: any) : string {
  const json1copy = cloneDeep(json1)
  return createPatch(json1copy, json2)
      .map(op => {
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
      }).join('<br/>')
}

function diffEntry(path: string[], oldValue: string, newValue: string): string {
  return `${path.join(' > ')}: ${oldValue} => ${newValue}`
}

function valueAt(json: any, path: string[]): any {
  if (json === undefined) {
    return
  }
  return path.length === 0 ?
      valueAsString(json)
      : valueAt(json[path[0]], path.slice(1))
}

function valueAsString(json: any): string {
  if (Array.isArray(json)) {
    const array = json as any[]
    return "[" + array.map(item => valueAsString(item)).join() + "]"
  } else if (json !== null && typeof json === 'object')
    return "{"
        + Object.getOwnPropertyNames(json)
            .map(property => property + ":" + valueAsString(json[property]))
            .join()
        + "}"
  else
    return json
}