import {Config} from "../camilladsp/config"

/** Cannot be named File, because that is already a built-in type */
export interface CFile {
  name: string,
  lastModified: string
}

export function loadFiles(type: "config" | "coeff"): Promise<CFile[]> {
  return fetch(`/api/stored${type}s`)
      .then(response => {
        if (response.ok) return response.json()
        else throw Error(response.statusText)
      })
      .then(json => {
        const files = json as CFile[]
        files.forEach(file =>
            file.lastModified = new Date(1000 * parseFloat(file.lastModified)).toDateString()
        )
        return files
      })
}

export function loadFilenames(type: "config" | "coeff"): Promise<string[]> {
  return loadFiles(type)
      .then(files => fileNamesOf(files))
}

export function fileNamesOf(files: CFile[]): string[] {
  return files.map(f => f.name)
}

export function loadConfigJson(name: string, onNotOk: (reason: string) => void = () => {}): Promise<Config> {
  return fetch(`/api/getconfigfile?name=${encodeURIComponent(name)}`)
      .then(response => {
        if (response.ok)
          return response.json()
        else
          response.text().then(reason => onNotOk(reason))
      })
}

export function loadDefaultConfigJson(): Promise<Response> {
  return fetch(`/api/getdefaultconfigfile`)
}

export function loadActiveConfig(): Promise<{ configFileName: string, config: Config }> {
  return fetch("/api/getactiveconfigfile")
      .then(response => {
        if (!response.ok) {
          throw Error(response.statusText)
        }
        return response.json()
      })
}