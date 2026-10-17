/**
 * The client for the backend's API. Its types are generated from the backend's spec,
 * `api/openapi.json`, into `schema.ts` by `npm run generate-api`, so tsc checks the path, the
 * parameters, the body and the response of every call against what the backend has.
 */
import createClient from "openapi-fetch"
import type { components, paths } from "./schema"

export type Schemas = components["schemas"]

/**
 * The message of a failed call. The backend sends every error as an `ErrorBody`, so the status
 * is only a fallback, for an error that did not come from the backend.
 */
export function errorMessage(error: Schemas["ErrorBody"] | undefined, response: Response): string {
  return error?.message ?? `${response.status} ${response.statusText}`
}

/** The message of an `ErrorBody` given as text, `undefined` for any other text. */
export function errorBodyMessage(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as Partial<Schemas["ErrorBody"]>
    if (typeof body.message === "string") return body.message
  } catch {
    // Not JSON, so not from the backend.
  }
  return undefined
}

/** The message of a failed call that is not made through `api`. */
export async function responseErrorMessage(response: Response): Promise<string> {
  const text = await response.text()
  return errorBodyMessage(text) ?? (text || `${response.status} ${response.statusText}`)
}

export const api = createClient<paths>({
  // The client makes a Request, which outside a browser, as in the tests, needs a full URL.
  baseUrl: globalThis.location?.origin,
  // Looked up on each call, not once when the client is made, so that the demo backend, which
  // replaces fetch, is the one used.
  fetch: (request) => globalThis.fetch(request),
})
