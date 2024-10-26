import {createPatch} from 'rfc6902'
import {cloneDeep} from "lodash"


export function jsonDiff(json1: any, json2: any) : string {
  const converted1 = cloneDeep(json1)
  const converted2 = cloneDeep(json2)
  convertArraysToObjects(converted1)
  convertArraysToObjects(converted2)
  return createPatch(converted1, converted2)
      .map(op => {
        const path = op.path.slice(1).split('/')
        // special chars / and ~ are escaped by rfc6902, unescape to get back original names
        for (let n = 0; n < path.length; n++) {
          path[n] = path[n].replace(/~1/g, '/').replace(/~0/g, '~')
        }
        switch (op.op) {
          case "add": return diffEntry(path, "*added*", valueAsString(op.value))
          case "remove": return diffEntry(path, "*removed*", valueAt(json1, path))
          case "replace": return diffEntry(path, valueAt(json1, path), valueAsString(op.value))
        }
        return ""
      }).join('<br/>')
}

/**
 * Recursively converts all array property values to objects.
 * This is necessary because the rfc6902 library reports a change for the whole array
 * instead of individual array elements.
 * @param object
 */
function convertArraysToObjects(object: any) {
  if (object !== null) {
  Object.getOwnPropertyNames(object)
      .forEach(property => {
        const value = object[property]
        if (Array.isArray(value))
          object[property] = {...value} // convert Array to Object
        if (typeof value === 'object')
          convertArraysToObjects(value)
      })
    }
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