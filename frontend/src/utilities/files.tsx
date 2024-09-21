import {Config} from "../camilladsp/config"

export interface FileInfo {
  name: string,
  lastModified: number,
  formattedDate: string,
  size: number,
  title: string|null|undefined,
  description: string|null|undefined,
}

export function loadFiles(type: "config" | "coeff"): Promise<FileInfo[]> {
  return fetch(`/api/stored${type}s`)
      .then(response => {
        if (response.ok) return response.json()
        else throw Error(response.statusText)
      },
      err => {
        console.log("Failed to fetch", err)
        throw Error(err)
      })
      .then(json => {
        const files = json as FileInfo[]
        files.forEach(file =>
            file.formattedDate = new Date(1000 * file.lastModified).toDateString()
        )
        return files
      },
      err => {
        console.log("Failed to get file list", err)
        return []
      })
}

export function loadFilenames(type: "config" | "coeff"): Promise<string[]> {
  return loadFiles(type)
      .then(files => fileNamesOf(files), _ => [])
}

export function fileNamesOf(files: FileInfo[]): string[] {
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

export function download(filename: string, blob: any) {
  let a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.hidden = true
  document.body.appendChild(a)
  a.innerHTML = "abcdefg"
  a.click()
}

export async function doUpload(
    type: 'config' | 'coeff',
    files: FileList,
    onSuccess: (filesnames: string[]) => void,
    onError: (message: string) => void
) {
  const formData = new FormData()
  const uploadedFiles: string[] = []
  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    uploadedFiles.push(file.name)
    formData.append("file" + index, file, file.name)
  }
  try {
    await fetch(`/api/upload${type}s`, {
      method: "POST",
      body: formData
    })
    onSuccess(uploadedFiles)
  } catch (e) {
    let err = e as Error
    onError(err.message)
  }
}