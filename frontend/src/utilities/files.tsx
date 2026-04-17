import { Config } from "../camilladsp/config"

export type ValidationIssue = [string[], string, "error" | "warning"]

export interface FileInfo {
  name: string
  lastModified: number
  formattedDate: string
  size: number
  title: string | null | undefined
  description: string | null | undefined
  version: number | null | undefined
  valid: boolean | undefined
  errors: ValidationIssue[] | null | undefined
}

export function loadFiles(type: "config" | "coeff"): Promise<FileInfo[]> {
  return fetch(`/api/stored${type}s`)
    .then(
      (response) => {
        if (response.ok) return response.json()
        else throw Error(response.statusText)
      },
      (err) => {
        console.log("Failed to fetch", err)
        throw Error(err)
      },
    )
    .then(
      (json) => {
        const files = json as FileInfo[]
        files.forEach((file) => (file.formattedDate = new Date(1000 * file.lastModified).toDateString()))
        return files
      },
      (err) => {
        console.log("Failed to get file list", err)
        return []
      },
    )
}

export function loadFilenames(type: "config" | "coeff"): Promise<string[]> {
  return loadFiles(type).then(
    (files) => fileNamesOf(files),
    () => [],
  )
}

export function fileNamesOf(files: FileInfo[]): string[] {
  return files.map((f) => f.name)
}

export function loadConfigJson(name: string, onNotOk: (reason: string) => void = () => {}): Promise<Config> {
  return fetch(`/api/getconfigfile?name=${encodeURIComponent(name)}`).then(async (response) => {
    if (response.ok) return response.json()
    const reason = await response.text()
    onNotOk(reason)
    throw new Error(reason)
  })
}

export function loadMigratedConfigJson(name: string, onNotOk: (reason: string) => void = () => {}): Promise<Config> {
  return fetch(`/api/getconfigfile?name=${encodeURIComponent(name)}&migrate=TRUE`).then(async (response) => {
    if (response.ok) return response.json()
    const reason = await response.text()
    onNotOk(reason)
    throw new Error(reason)
  })
}

export function loadDefaultConfigJson(): Promise<Response> {
  return fetch(`/api/getdefaultconfigfile`)
}

export function loadStartupConfig(): Promise<{
  configFileName: string | null
  config: Config
  source: string
}> {
  return fetch("/api/getstartconfig").then((response) => {
    if (!response.ok) {
      throw Error(response.statusText)
    }
    return response.json()
  })
}

export function loadActiveConfigFilename(): Promise<{
  configFileName: string | null
}> {
  return fetch("/api/getactiveconfigfilename").then((response) => {
    if (!response.ok) {
      throw Error(response.statusText)
    }
    return response.json()
  })
}

export function download(filename: string, blob: Blob) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.hidden = true
  document.body.appendChild(a)
  a.innerHTML = "abcdefg"
  a.click()
}

export async function downloadFromUrl(filename: string, url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(await response.text())
  }
  download(filename, await response.blob())
}

export async function doUpload(
  type: "config" | "coeff",
  files: FileList,
  onSuccess: (filesnames: string[]) => void,
  onError: (message: string) => void,
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
      body: formData,
    })
    onSuccess(uploadedFiles)
  } catch (e) {
    const err = e as Error
    onError(err.message)
  }
}

export function issueSeverity(issue: ValidationIssue): "error" | "warning" {
  return issue[2]
}

export function hasWarningIssues(errors: ValidationIssue[] | null | undefined): boolean {
  return !!errors && errors.some((issue) => issueSeverity(issue) === "warning")
}

export function fileStatusDesc(errors: ValidationIssue[] | null | undefined): string {
  const hasIssues = errors !== null && errors !== undefined && errors.length > 0
  if (!hasIssues) {
    return "Config is valid."
  }

  const warningIssues = errors!.filter((issue) => issueSeverity(issue) === "warning")
  const errorIssues = errors!.filter((issue) => issueSeverity(issue) === "error")

  const formatIssues = (title: string, issues: ValidationIssue[]) => {
    let desc = title
    for (const issue of issues) {
      let path = issue[0].join("/")
      if (path) {
        path = path + " : "
      }
      desc = desc + "<br>" + path + issue[1]
    }
    return desc
  }

  if (errorIssues.length > 0 && warningIssues.length > 0) {
    return `${formatIssues("Errors:", errorIssues)}<br><br>${formatIssues("Warnings:", warningIssues)}`
  }
  if (errorIssues.length > 0) {
    return formatIssues("Errors:", errorIssues)
  }
  return formatIssues("Warnings:", warningIssues)
}
