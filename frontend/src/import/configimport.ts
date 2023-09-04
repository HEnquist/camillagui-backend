import {Config, Devices, Pipeline, PipelineStep} from "../camilladsp/config"
import {cloneDeep, isArray, isEqual, isObject} from "lodash"
import {isComplexObject} from "../utilities/common"

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
  /**
   * Contains the elements of {@link config} that are marked for import.
   * Top level arrays (like pipeline) contain nulls for elements, which are not imported.
   */
  private readonly toImport: any
  readonly configToImport: any

  constructor(config: any, toImport: any = {}) {
    this.config = config
    this.toImport = toImport
    this.configToImport = this.createConfigToImport()
  }

  createConfigToImport(): any {
    const config = cloneDeep(this.toImport)
    for (const property in config) {
      const value = config[property]
      if (isArray(value))
        config[property] = value.filter(item => item !== null)
    }
    if ('pipeline' in config) {
      const pipeline = config['pipeline'] as Pipeline
      for (const step of pipeline) {
        switch (step.type) {
          case "Mixer": this.importElement(config, 'mixers', step.name); break
          case "Processor": this.importElement(config, 'processors', step.name); break
          case "Filter": step.names.forEach(name => this.importElement(config, 'filters', name)); break
        }
      }
    }
    return config
  }

  isAnythingImported(): boolean {
    return this.isWholeConfigImported() !== false
  }

  isWholeConfigImported(): boolean | "partially" {
    if (isEqual(this.config, this.configToImport))
      return true
    else if (isEqual(this.configToImport, {}))
      return false
    else
      return "partially"
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
    else if (name in this.configToImport)
      return 'partially'
    else
      return false
  }

  toggleSecondLevelElement(parent: string, name: string, action: 'import' | 'remove'): Import {
    const toImport = cloneDeep(this.toImport)
    if (action === 'import')
      this.importElement(toImport, parent, name)
    else
      this.removeElement(toImport, parent, name)
    return new Import(this.config, toImport)
  }

  private importElement(target: any, parent: string, name: string) {
    if (!(parent in target)) {
      if (isArray(this.config[parent]))
        target[parent] = new Array(this.config[parent].length).fill(null)
      else if (isObject(this.config[parent]))
        target[parent] = {}
    }
    target[parent][name] = cloneDeep(this.config[parent][name])
  }

  private removeElement(target: any, parent: string, name: string) {
    if (isArray(target[parent])) {
      //keep null instead of element, so it can be mapped to the corresponding element in the original config
      target[parent][name] = null
      if (target[parent].every((item: any) => item === null))
        delete target[parent]
    } else if (isObject(target[parent])) {
      delete target[parent][name]
      if (isEqual(target[parent], {}))
        delete target[parent]
    }
  }

  isSecondLevelElementImported(parent: string, name: string): boolean {
    if (parent in this.toImport)
      return isEqual(this.config[parent][name], this.toImport[parent][name])
    else
      return !this.isSecondLevelElementEditable(parent, name)
  }

  isSecondLevelElementEditable(parent: string, name: string): boolean {
    if (!('pipeline' in this.toImport) || !['filters', 'mixers', 'processors'].includes(parent))
      return true
    const pipelineToImport = this.toImport['pipeline'] as Array<PipelineStep | null>
    return !pipelineToImport.some(step => {
      if (step === null)
        return false
      switch (parent) {
        case 'mixers': return step.type === 'Mixer' && step.name === name
        case 'processors': return step.type === 'Processor' && step.name === name
        case 'filters': return step.type === 'Filter' && step.names.includes(name)
        default: throw new Error(`Unknown pipeline step type: ${step.type}`)
      }
    })
  }
}

export function mergeTopLevelObjectsAndAppendTopLevelArrays(object: any, toImport: any) {
  const copyFrom = cloneDeep(toImport)
  Object.entries(copyFrom).forEach(([key, value]) => {
    if (key in object && isComplexObject(value)) {
      if (isArray(value))
        (object[key] as any[]).push(...value)
      else if (isObject(value))
        object[key] = {...object[key], ...copyFrom[key]}
    } else
      object[key] = value
  })
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