import {Devices, Filters, Mixers, Pipeline, Processors} from "../camilladsp/config"


export interface ImportedConfig {
  devices?: Devices
  filters?: Filters
  mixers?: Mixers
  processors?: Processors
  pipeline?: Pipeline
  title?: string | null
  description?: string | null
}

const topLevelElementOrder = ['title', 'description', 'devices', 'filters', 'mixers', 'processors', 'pipeline']
export function topLevelComparator(element1: string, element2: string): number {
  let index1 = topLevelElementOrder.indexOf(element1)
  let index2 = topLevelElementOrder.indexOf(element2)
  return index1 - index2
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