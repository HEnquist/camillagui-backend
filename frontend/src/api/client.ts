/**
 * The client for the backend's API. Its types are generated from the backend's spec,
 * `rust/openapi.json`, into `schema.ts` by `npm run generate-api`, so tsc checks the path, the
 * parameters, the body and the response of every call against what the backend has.
 */
import createClient from "openapi-fetch"
import type { components, paths } from "./schema"

export type Schemas = components["schemas"]

/** The query parameters of a GET endpoint, for the event streams that build their own URL. */
export type QueryOf<Path extends keyof paths> = paths[Path] extends {
  get: { parameters: { query: infer Query } }
}
  ? Query
  : never

export const api = createClient<paths>({
  // The client makes a Request, which outside a browser, as in the tests, needs a full URL.
  baseUrl: globalThis.location?.origin,
  // Looked up on each call, not once when the client is made, so that the demo backend, which
  // replaces fetch, is the one used.
  fetch: (request) => globalThis.fetch(request),
})
