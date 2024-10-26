import {createPatch, applyPatch} from 'rfc6902'
import {cloneDeep} from "lodash"


export function jsonDiff(json1: any, json2: any) : string {
  const json1copy = cloneDeep(json1)
  return createPatch(json1copy, json2)
      .map(op => {
        console.log(op)
        const path = op.path.slice(1).split('/')
        // special chars / and ~ are escaped by rfc6902, unescape to get back original names
        for (let n = 0; n < path.length; n++) {
          path[n] = path[n].replace(/~1/g, '/').replace(/~0/g, '~')
        }
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