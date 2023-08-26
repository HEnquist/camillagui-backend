import {Config, Devices} from "../camilladsp/config"
import {cloneDeep, isArray, isEqual, isObject, pullAt} from "lodash"

/**
 * Like {@link Config}, except all properties are optional and all properties in {@link Config#devices} are optional.
 */
export type ImportedConfig = Omit<Partial<Config>, 'devices'> & { devices?: Partial<Devices> }

const topLevelElementOrder = ['title', 'description', 'devices', 'filters', 'mixers', 'processors', 'pipeline']
export function topLevelComparator(element1: string, element2: string): number {
  let index1 = topLevelElementOrder.indexOf(element1)
  let index2 = topLevelElementOrder.indexOf(element2)
  return index1 - index2
}

export class Import {

  private readonly config: any
  toImport: any

  constructor(config: any, toImport: any = {}) {
    this.config = config
    this.toImport = toImport
  }

  toggleTopLevelElement(name: string, action: 'import' | 'remove'): Import {
    const toImport = cloneDeep(this.toImport)
    if (action === 'import')
      toImport[name] = cloneDeep(this.config[name])
    else
      delete toImport[name]
    return new Import(this.config, toImport)
  }

  isTopLevelElementImported(name: string): boolean | 'partially' {
    if (isEqual(this.config[name], this.toImport[name]))
      return true
    else if (name in this.toImport)
      return 'partially'
    else
      return false
  }
  
  toggleSecondLevelElement(parent: string, name: string, action: 'import' | 'remove'): Import {
    const toImport = cloneDeep(this.toImport)
    if (action === 'import') {
      if (!(parent in toImport)) {
        if (isArray(this.config[parent]))
          toImport[parent] = []
        else if (isObject(this.config[parent]))
          toImport[parent] = {}
      }
      toImport[parent][name] = cloneDeep(this.config[parent][name])
    } else {
      if (isArray(toImport[parent]))
        pullAt(toImport[parent], parseInt(name, 10))
      else if (isObject(toImport[parent]))
        delete toImport[parent][name]
      if (isEqual(toImport[parent], {}) || isEqual(toImport[parent], []))
        delete toImport[parent]
    }
    console.log(this.toImport, undefined, 2)
    return new Import(this.config, toImport)
  }

  isSecondLevelElementImported(parent: string, name: string): boolean {
    if (!(parent in this.toImport))
      return false
    if (isArray(this.toImport[parent])) {
      return new Set(this.toImport[parent]).has(this.config[parent][name])
    } else
      return isEqual(this.config[parent][name], this.toImport[parent][name])
  }
}

export async function importedYamlConfigAsJson(files: FileList): Promise<ImportedConfig> {
  const content = await fileContent(files)
  const response = await fetch("/api/ymltojson", {method: "POST", body: content})
  if (response.ok) {
    const text = await response.text()
    return JSON.parse(text) as ImportedConfig
  }
  throw new Error("Could extract filters from file")
}

function fileContent(files: FileList): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = function (e) {
      const content = e.target?.result
      if (typeof content === 'string')
        resolve(content)
      else
        reject("Could not extract text from file")
    }
    reader.readAsText(files[0])
  })
}

export async function importedEqApoConfigAsJson(files: FileList): Promise<ImportedConfig> {
  const content = await fileContent(files)
  const response = await fetch("/api/eqapotojson", {method: "POST", body: content})
  if (response.ok) {
    const text = await response.text()
    return JSON.parse(text) as ImportedConfig
  }
  throw new Error("Could extract filters from file")
}

export async function importedConvolverConfigAsJson(files: FileList): Promise<ImportedConfig> {
  const content = await fileContent(files)
  const response = await fetch("/api/convolvertojson", {method: "POST", body: content})
  if (response.ok) {
    const text = await response.text()
    return JSON.parse(text) as ImportedConfig
  }
  throw new Error("Could extract filters from file")
}