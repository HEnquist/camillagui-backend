import { api, errorBodyMessage, errorMessage, responseErrorMessage, Schemas } from "../api/client"
import type { paths } from "../api/schema"
import { completeConfig, Config } from "../camilladsp/config"

export type ValidationIssue = Schemas["ValidationIssue"]

export type FileInfo = Schemas["FileInfo"] & { formattedDate: string }

export type StoredFileType = Schemas["FileKind"]

/** The files in a folder, none if they cannot be listed. */
export async function loadFiles(type: StoredFileType): Promise<FileInfo[]> {
  try {
    const { data, error, response } = await api.GET("/api/files/{kind}", { params: { path: { kind: type } } })
    if (data)
      return data.map((file) => ({ ...file, formattedDate: new Date(1000 * file.last_modified).toDateString() }))
    console.log("Failed to get file list", errorMessage(error, response))
  } catch (err) {
    console.log("Failed to fetch", err)
  }
  return []
}

export function loadFilenames(type: StoredFileType): Promise<string[]> {
  return loadFiles(type).then(
    (files) => fileNamesOf(files),
    () => [],
  )
}

export function fileNamesOf(files: FileInfo[]): string[] {
  return files.map((f) => f.name)
}

async function loadConfigFile(name: string, migrate: boolean, onNotOk: (reason: string) => void): Promise<Config> {
  const { data, error, response } = await api.GET("/api/getconfigfile", { params: { query: { name, migrate } } })
  if (data) return completeConfig(data)
  const reason = errorMessage(error, response)
  onNotOk(reason)
  throw new Error(reason)
}

export function loadConfigJson(name: string, onNotOk: (reason: string) => void = () => {}): Promise<Config> {
  return loadConfigFile(name, false, onNotOk)
}

export function loadMigratedConfigJson(name: string, onNotOk: (reason: string) => void = () => {}): Promise<Config> {
  return loadConfigFile(name, true, onNotOk)
}

export async function loadDefaultConfigJson(): Promise<Config> {
  const { data, error, response } = await api.GET("/api/getdefaultconfigfile")
  if (data) return completeConfig(data)
  throw new Error(errorMessage(error, response))
}

export async function loadStartupConfig(): Promise<{
  config_file_name: string | null
  config: Config
  source: Schemas["ConfigSource"]
}> {
  const { data, error, response } = await api.GET("/api/getstartconfig")
  if (data) return { ...data, config: completeConfig(data.config) }
  throw new Error(errorMessage(error, response))
}

export async function loadActiveConfigFilename(): Promise<Schemas["ActiveConfigFile"]> {
  const { data, response } = await api.GET("/api/getactiveconfigfilename")
  if (data) return data
  throw new Error(`${response.status} ${response.statusText}`)
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
    throw new Error(await responseErrorMessage(response))
  }
  download(filename, await response.blob())
}

export async function doUpload(
  type: StoredFileType,
  files: FileList,
  onSuccess: (filesnames: string[]) => void,
  onError: (message: string) => void,
) {
  const formData = new FormData()
  const uploadedFiles: string[] = []
  for (const file of Array.from(files)) {
    uploadedFiles.push(file.name)
    formData.append("files", file, file.name)
  }
  try {
    const { error, response } = await api.POST("/api/files/{kind}/upload", {
      params: { path: { kind: type } },
      // The spec gives binary data as strings, so the files go in through the serializer.
      body: { files: [] },
      bodySerializer: () => formData,
    })
    if (response.ok) onSuccess(uploadedFiles)
    else onError(errorMessage(error, response))
  } catch (e) {
    const err = e as Error
    onError(err.message)
  }
}

export async function deleteFiles(type: StoredFileType, names: string[]): Promise<void> {
  const { error, response } = await api.POST("/api/files/{kind}/delete", {
    params: { path: { kind: type } },
    body: { names },
  })
  if (!response.ok) throw new Error(errorMessage(error, response))
}

export async function renameFile(type: StoredFileType, source: string, target: string): Promise<void> {
  const { error, response } = await api.POST("/api/files/{kind}/rename", {
    params: { path: { kind: type } },
    body: { source, target },
  })
  if (!response.ok) throw new Error(errorMessage(error, response))
}

type ZipForm = paths["/api/files/{kind}/zip"]["post"]["requestBody"]["content"]["application/x-www-form-urlencoded"]

/** The hidden frame that zip downloads are posted into. */
let zipFrame: HTMLIFrameElement | undefined

/**
 * Download some of the files in a folder as `<type>s.zip`. It is a form posted into a hidden
 * frame, so that the browser saves the zip as it arrives rather than holding all of it first. The
 * backend checks the files before it starts the zip, and a refusal loads its error into the frame,
 * which is passed on to `onError`. A download that starts is the browser's to show.
 */
export function downloadAsZip(type: StoredFileType, names: string[], onError: (message: string) => void) {
  if (!zipFrame) {
    zipFrame = document.createElement("iframe")
    zipFrame.name = "zip-download"
    zipFrame.hidden = true
    document.body.appendChild(zipFrame)
  }
  const frame = zipFrame
  // An earlier error must not be taken for one about this download.
  frame.contentDocument?.body?.replaceChildren()
  frame.onload = () => {
    const page = frame.contentDocument
    // Browsers show a JSON body in a <pre>, with or without more around it.
    const text = (page?.querySelector("pre") ?? page?.body)?.textContent?.trim()
    if (text) onError(errorBodyMessage(text) ?? "The download failed")
  }
  const fields: ZipForm = { names }
  const form = document.createElement("form")
  form.method = "post"
  form.action = `/api/files/${type}/zip`
  form.target = frame.name
  form.hidden = true
  for (const name of fields.names) {
    const input = document.createElement("input")
    input.type = "hidden"
    input.name = "names"
    input.value = name
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

export function issueSeverity(issue: ValidationIssue): Schemas["Severity"] {
  return issue.severity
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
      let path = issue.path.join("/")
      if (path) {
        path = path + " : "
      }
      desc = desc + "<br>" + path + issue.message
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
