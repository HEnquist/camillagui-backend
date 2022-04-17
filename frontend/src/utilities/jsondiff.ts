import {diff} from 'json-diff'


export function jsonDiff(json1: any, json2: any) : string {
  return jsonDiffAsLines(diff(json1, json2))
}

const newValuePropertyName = '__new'
const oldValuePropertyName = '__old'
const addedPropertySuffix = '__added'
const deletedPropertySuffix = '__deleted'
const separator = "<br/>"

function jsonDiffAsLines(diff: any, path: string[] = []): string {
  return [
    addedPropertyDiffs(diff, path),
    newAndOldValueDiff(diff, path),
    deletedPropertyDiffs(diff, path),
    getChildrenDiffs(diff, path)
  ].join('')
}

function addedPropertyDiffs(diff: any, path: string[]): string {
  return Object.getOwnPropertyNames(diff)
      .filter(property => property.endsWith(addedPropertySuffix))
      .map(property => {
        const propertyName = property.replace(addedPropertySuffix, '')
        const newPath = path.concat(propertyName)
        return diffEntry(newPath, diff[property], 'undefined')
      })
      .join('')
}

function diffEntry(path: string[], newValue: string, oldValue: string): string {
  return `${path.join(' > ')}: ${oldValue} => ${newValue}${separator}`
}

function newAndOldValueDiff(diff: any, path: string[]) {
  const newValue = diff[newValuePropertyName]
  const oldValue = diff[oldValuePropertyName]
  return newValue === undefined || oldValue === undefined ? "" : diffEntry(path, newValue, oldValue)
}


function deletedPropertyDiffs(diff: any, path: string[]): string {
  return Object.getOwnPropertyNames(diff)
      .filter(property => property.endsWith(deletedPropertySuffix))
      .map(property => {
        const propertyName = property.replace(deletedPropertySuffix, '')
        const newPath = path.concat(propertyName)
        return diffEntry(newPath, 'undefined', diff[property])
      })
      .join('')
}

function getChildrenDiffs(diff: any, path: string[]) {
  return Object.getOwnPropertyNames(diff)
      .filter(property =>
          property !== newValuePropertyName
          && property !== oldValuePropertyName
          && !property.endsWith(addedPropertySuffix)
          && !property.endsWith(deletedPropertySuffix))
      .map(property => jsonDiffAsLines(diff[property], path.concat(property)))
      .join('')
}