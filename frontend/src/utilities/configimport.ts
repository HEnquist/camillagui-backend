import {Config, Filters} from "../camilladsp/config"
import {Update} from "./common"


//TODO adapt this for the importtab
export async function importCdspYamlFilters(
    files: FileList,
    updateConfig: (update: Update<Config>) => void
) {
  const filters = await yamlFiltersAsJsonFilters(fileContent(files))
  addFiltersToConfig(filters, updateConfig)
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

async function yamlFiltersAsJsonFilters(fileContent: Promise<string>): Promise<Filters> {
  const text = await fileContent
  const response = await fetch("/api/ymltojson", {method: "POST", body: text})
  if (response.ok) {
    const text = await response.text()
    const jsonConfig = JSON.parse(text) as Config
    return jsonConfig.filters
  }
  throw new Error("Could extract filters from file")
}

function addFiltersToConfig(filters: Filters, updateConfig: (update: Update<Config>) => void) {
  updateConfig(config => Object.assign(config.filters, filters))
}