import {Config, EMPTY, Filters, FilterStep} from "../camilladsp/config"
import {Update} from "../utilities/common"

export async function importCdspYamlFilters(
    files: FileList,
    updateConfig: (update: Update<Config>) => void,
    updateFilterStep: (update: Update<FilterStep>) => void
) {
  const filters = await yamlFiltersAsJsonFilters(fileContent(files))
  addFiltersToConfig(filters, updateConfig, updateFilterStep)
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
    return JSON.parse(text)
  }
  throw new Error("Could extract filters from file")
}

function addFiltersToConfig(filters: Filters, updateConfig: (update: Update<Config>) => void, updateFilterStep: (update: Update<FilterStep>) => void) {
  updateConfig(config => Object.assign(config.filters, filters))
  updateFilterStep(step => {
    const filterNames = Object.keys(filters)
    const newFilterNames = filterNames.filter(name => !step.names.includes(name))
    step.names = step.names.filter(n => n !== EMPTY).concat(newFilterNames)
  })
}

export async function importEqApoFilters(
    files: FileList,
    updateConfig: (update: Update<Config>) => void,
    updateFilterStep: (update: Update<FilterStep>) => void
) {
  const text = await fileContent(files)
  const filters = eqApoFiltersToJson(text)
  addFiltersToConfig(filters, updateConfig, updateFilterStep)
}

export function eqApoFiltersToJson(filtersAsText: string): Filters {
  const lines = filtersAsText.split("\n")
  const individualFilters = lines.map(line => eqApoFilterToJson(line))
  const filters = {}
  individualFilters.forEach(filter => Object.assign(filters, filter))
  return filters
}

function eqApoFilterToJson(filterLine: string): Filters | undefined {
  return parseGain(filterLine) || parseLowshelf(filterLine) || parseHighshelf(filterLine) || parsePeaking(filterLine)
}

const PreampPattern = new RegExp("Preamp: (.*) dB")
const LowshelfPattern = new RegExp("(.*): ON LSC Fc (.*) Hz Gain (.*) dB Q (.*)")
const HighshelfPattern = new RegExp("(.*): ON HSC Fc (.*) Hz Gain (.*) dB Q (.*)")
const PeakingPattern = new RegExp("(.*): ON PK Fc (.*) Hz Gain (.*) dB Q (.*)")

function parseGain(filterLine: string): Filters | undefined {
  const gainMatch = filterLine.match(PreampPattern)
  if (gainMatch) {
    const gain = parseFloat(gainMatch[1])
    const name = `Gain${gain}`
    const filter: Filters = {}
    filter[name] = {
      type: 'Gain',
      description: null,
      parameters: {gain: gain, scale: 'dB', inverted: false}
    }
    return filter
  }
  return undefined
}

function parseLowshelf(filterLine: string): Filters | undefined {
  const lowshelfMatch = filterLine.match(LowshelfPattern)
  if (!lowshelfMatch)
    return undefined
  const name = lowshelfMatch[1]
  const filter: Filters = {}
  filter[name] = {
    type: 'Biquad',
    description: null,
    parameters: {
      type: 'Lowshelf',
      freq: parseFloat(lowshelfMatch[2]),
      gain: parseFloat(lowshelfMatch[3]),
      q: parseFloat(lowshelfMatch[4])
    }
  }
  return filter
}

function parseHighshelf(filterLine: string): Filters | undefined {
  const highshelfMatch = filterLine.match(HighshelfPattern)
  if (!highshelfMatch)
    return undefined
  const name = highshelfMatch[1]
  const filter: Filters = {}
  filter[name] = {
    type: 'Biquad',
    description: null,
    parameters: {
      type: 'Highshelf',
      freq: parseFloat(highshelfMatch[2]),
      gain: parseFloat(highshelfMatch[3]),
      q: parseFloat(highshelfMatch[4])
    }
  }
  return filter
}

function parsePeaking(filterLine: string): Filters | undefined {
  const highshelfMatch = filterLine.match(PeakingPattern)
  if (!highshelfMatch)
    return undefined
  const name = highshelfMatch[1]
  const filter: Filters = {}
  filter[name] = {
    type: 'Biquad',
    description: null,
    parameters: {
      type: 'Peaking',
      freq: parseFloat(highshelfMatch[2]),
      gain: parseFloat(highshelfMatch[3]),
      q: parseFloat(highshelfMatch[4])
    }
  }
  return filter
}