/**
 * Filter evaluation for the plots.
 *
 * This used to be a round trip to the backend, which evaluated the transfer
 * function in numpy and returned five 1000 point curves. It now runs in the
 * browser, which is almost always the faster machine of the two, and needs no
 * network at all except for Conv filters that read coefficients from a file.
 */
import { blankNoisyPhase, magnitudeDb, multiplyInto, phaseDegrees, unitCurve } from "./complex"
import { convComplexGain } from "./conv"
import { complexGain } from "./filters"
import { FilterEvalError, num, numList, Params } from "./params"
import { calcGroupDelay } from "./unwrap"
import { ChartContent, FilterOption } from "../../utilities/chart"
import { Config, Filter } from "../config"

export { FilterEvalError } from "./params"

const NPOINTS = 1000

/**
 * A log spaced frequency vector.
 *
 * The step is the span divided by the number of points rather than by one
 * less, so the last point falls just short of `maxval`. That is what the DSP's
 * own plots do, and `eval.test.ts` pins it.
 */
export function logspace(minval: number, maxval: number, npoints: number): Float64Array {
  const logmin = Math.log10(minval)
  const logmax = Math.log10(maxval)
  const perstep = (logmax - logmin) / npoints
  const values = new Float64Array(npoints)
  for (let n = 0; n < npoints; n++) values[n] = Math.pow(10.0, logmin + n * perstep)
  return values
}

export interface EvalOptions {
  /** Plot title. */
  name?: string
  samplerate: number
  /** Capture channel count, used to resolve $channels$ in coefficient paths. */
  channels: number
  /** Volume to evaluate a Loudness filter at. */
  volume?: number
  npoints?: number
}

/** What the backend knows about a Conv filter's coefficient file. */
interface ConvCoefficients {
  options: FilterOption[]
  // whichever width the backend judged lossless for the source file
  coefficients: Float32Array | Float64Array
}

/**
 * Coefficients keyed on the request that produced them.
 *
 * Dragging a control anywhere in a pipeline step re-evaluates every filter in
 * it, so without this a neighbouring Conv would be refetched on every frame.
 *
 * Bounded by how much memory the entries take rather than by how many there
 * are, because their sizes differ by orders of magnitude: a Values filter is a
 * handful of bytes and a room correction is megabytes. Counting entries would
 * be both too loose, eight long impulse responses being hundreds of megabytes,
 * and too tight, a pipeline step with a dozen short ones evicting itself on
 * every pass.
 */
const COEFF_CACHE_BYTES = 64 * 1024 * 1024

interface CacheEntry {
  coefficients: Promise<ConvCoefficients>
  /** Filled in when the fetch resolves, since the size is unknown until then. */
  bytes: number
}

const coeffCache = new Map<string, CacheEntry>()

/**
 * How many of the oldest entries have to go for the rest to fit in the budget,
 * given their sizes in least recently used order.
 *
 * The newest is never one of them. It is the response to whatever is being
 * plotted right now, so dropping it would mean fetching it again immediately,
 * and a single file larger than the whole budget would never be cached at all.
 */
export function entriesToEvict(sizes: number[], budget: number): number {
  let total = sizes.reduce((sum, bytes) => sum + bytes, 0)
  let evicted = 0
  while (total > budget && evicted < sizes.length - 1) {
    total -= sizes[evicted]
    evicted++
  }
  return evicted
}

function pruneCoefficientCache(): void {
  const sizes = [...coeffCache.values()].map((entry) => entry.bytes)
  const evicted = entriesToEvict(sizes, COEFF_CACHE_BYTES)
  const keys = [...coeffCache.keys()]
  for (let n = 0; n < evicted; n++) coeffCache.delete(keys[n])
}

function cacheKey(filterconf: Filter, samplerate: number, channels: number): string {
  return JSON.stringify([filterconf.parameters, samplerate, channels])
}

/**
 * Drop the cached coefficients.
 *
 * The cache is keyed on the filter parameters, so it cannot see a coefficient
 * file being replaced under a name it already holds. Call this whenever the
 * files on the backend change: after an upload, a delete or a rename.
 */
export function clearCoefficientCache(): void {
  coeffCache.clear()
}

/**
 * Unpack the reply from `/api/convcoeffs`.
 *
 * Not JSON. A million taps as decimal text is 21.8 MB, 390 ms for the backend
 * to format and 37 ms here to parse; as raw floats it is 8.4 MB or less, 19 ms
 * to write, and free to read, because the array below is a view over the bytes
 * rather than a copy of them. The backend is often the slowest machine in the
 * system, so that is where it matters most.
 *
 * The frame is a little endian uint32 length, a JSON header of that length,
 * padding to the next multiple of 8, and then the samples. The padding is what
 * makes the view possible, since Float64Array needs a byte offset it can divide
 * by 8. The header carries the samplerate and channel options, and the width of
 * the samples: the backend sends float32 when the source file holds no more
 * than that, which is every format except F64_LE, S32_LE and TEXT, so the usual
 * coefficient file crosses the wire at half the size and loses nothing.
 */
function unframeCoefficients(buffer: ArrayBuffer): ConvCoefficients {
  const headerLength = new DataView(buffer).getUint32(0, true)
  const header = new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))
  const { options, format } = JSON.parse(header) as { options: FilterOption[]; format: string }
  const start = 4 + headerLength + ((8 - ((4 + headerLength) % 8)) % 8)
  const coefficients = format === "float32" ? new Float32Array(buffer, start) : new Float64Array(buffer, start)
  return { options, coefficients }
}

/**
 * Read the coefficients of a file backed Conv filter from the backend. The
 * backend resolves the path, applies the $samplerate$ and $channels$ tokens
 * and decodes the samples; it does no DSP.
 */
async function fetchConvCoefficients(
  filterconf: Filter,
  samplerate: number,
  channels: number,
): Promise<ConvCoefficients> {
  const key = cacheKey(filterconf, samplerate, channels)
  const cached = coeffCache.get(key)
  if (cached !== undefined) {
    // re-insert, so the entries fall out of the Map in least recently used
    // order rather than in the order they were first fetched
    coeffCache.delete(key)
    coeffCache.set(key, cached)
    return cached.coefficients
  }

  const pending = (async () => {
    const response = await fetch("/api/convcoeffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: filterconf, samplerate, channels }),
    })
    if (!response.ok) throw new FilterEvalError(await response.text())
    return unframeCoefficients(await response.arrayBuffer())
  })()
  const entry: CacheEntry = { coefficients: pending, bytes: 0 }
  pending.then(
    (resolved) => {
      entry.bytes = resolved.coefficients.byteLength
      pruneCoefficientCache()
    },
    // a failed fetch must not be remembered, or the filter can never plot again
    () => coeffCache.delete(key),
  )

  coeffCache.set(key, entry)
  return pending
}

/**
 * The impulse response of a Conv filter, and the coefficient file options that
 * came with it. Only Raw and Wav reach the backend; Dummy and Values are built
 * here.
 */
async function convCoefficients(filterconf: Filter, samplerate: number, channels: number): Promise<ConvCoefficients> {
  const params = (filterconf.parameters ?? {}) as Params
  const subtype = params.type
  if (subtype === "Raw" || subtype === "Wav") return fetchConvCoefficients(filterconf, samplerate, channels)
  if (subtype === "Dummy") {
    const coefficients = new Float64Array(num(params, "length"))
    coefficients[0] = 1.0
    return { options: [], coefficients }
  }
  if (subtype === "Values") return { options: [], coefficients: Float64Array.from(numList(params, "values")) }
  // a Conv with no parameters at all is a single unity coefficient, which is
  // what CamillaDSP falls back to
  if (subtype === undefined) return { options: [], coefficients: Float64Array.from([1.0]) }
  throw new FilterEvalError(`Unknown Conv subtype ${String(subtype)}`)
}

/** Evaluate one filter, for the plot in the filters tab. */
export async function evalFilter(filterconf: Filter, options: EvalOptions): Promise<ChartContent> {
  const { samplerate, channels } = options
  const volume = options.volume ?? 0.0
  const npoints = options.npoints ?? NPOINTS
  const name = options.name ?? `unnamed ${filterconf.type}`
  const freq = logspace(1.0, (samplerate * 0.95) / 2.0, npoints)

  const result: ChartContent = {
    name,
    samplerate,
    channels,
    options: [],
    f: Array.from(freq),
    time: [],
  }

  let curve
  if (filterconf.type === "Conv") {
    const conv = await convCoefficients(filterconf, samplerate, channels)
    // Convolution is the one type with an impulse response to show, and its
    // bulk delay is removed so the phase plot stays readable.
    curve = convComplexGain(conv.coefficients, samplerate, freq, true)
    result.options = conv.options
    result.impulse = conv.coefficients
    result.time = Float64Array.from(conv.coefficients, (_, n) => n / samplerate)
  } else {
    curve = complexGain(filterconf, samplerate, volume, freq)
  }

  const magnitude = magnitudeDb(curve)
  const phase = phaseDegrees(curve)
  // only an FIR has a stopband full of nulls for the plot grid to alias
  if (filterconf.type === "Conv") blankNoisyPhase(magnitude, phase)
  const groupdelay = calcGroupDelay(result.f, phase)
  result.magnitude = magnitude
  result.phase = phase
  result.f_groupdelay = groupdelay.freq
  result.groupdelay = groupdelay.groupdelay
  return result
}

/**
 * The samplerate and channel options of a whole filter step: the ones every
 * Conv in the step can offer.
 */
export function intersectFilterOptions(
  perFilter: FilterOption[][],
  defaultSamplerate: number,
  defaultChannels: number,
): FilterOption[] {
  const pairsOf = (options: FilterOption[]) =>
    new Set(options.map((o) => `${o.samplerate ?? defaultSamplerate}/${o.channels ?? defaultChannels}`))
  const perFilterPairs = perFilter.map(pairsOf)
  if (perFilterPairs.length === 0) return []
  const shared = [...perFilterPairs[0]].filter((pair) => perFilterPairs.every((pairs) => pairs.has(pair)))
  return shared
    .map((pair) => {
      const [samplerate, channels] = pair.split("/").map(Number)
      return {
        name: `${samplerate} Hz - ${channels} Channels`,
        samplerate,
        channels,
      }
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Evaluate a whole filter step, for the plot in the pipeline tab. */
export async function evalFilterStep(config: Config, stepIndex: number, options: EvalOptions): Promise<ChartContent> {
  const { samplerate, channels } = options
  const volume = options.volume ?? 0.0
  const npoints = options.npoints ?? NPOINTS
  const name = options.name ?? `Filterstep ${stepIndex}`
  const freq = logspace(10.0, (samplerate * 0.95) / 2.0, npoints)

  const step = config.pipeline?.[stepIndex]
  const names = step !== undefined && step.type === "Filter" ? step.names : []

  const total = unitCurve(npoints)
  const convOptions: FilterOption[][] = []
  let hasConv = false
  for (const filterName of names) {
    const filterconf = config.filters?.[filterName]
    if (filterconf === undefined) throw new FilterEvalError(`Unknown filter ${filterName}`)
    if (filterconf.type === "Conv") {
      hasConv = true
      const conv = await convCoefficients(filterconf, samplerate, channels)
      // the bulk delay of a Conv is part of the step's response, so unlike the
      // single filter plot it is not removed here
      multiplyInto(total, convComplexGain(conv.coefficients, samplerate, freq))
      const subtype = (filterconf.parameters ?? {}).type
      if (subtype === "Raw" || subtype === "Wav") convOptions.push(conv.options)
    } else {
      multiplyInto(total, complexGain(filterconf, samplerate, volume, freq))
    }
  }

  const magnitude = magnitudeDb(total)
  const phase = phaseDegrees(total)
  if (hasConv) blankNoisyPhase(magnitude, phase)
  const groupdelay = calcGroupDelay(freq, phase)
  return {
    name,
    samplerate,
    channels,
    options: intersectFilterOptions(convOptions, samplerate, channels),
    f: Array.from(freq),
    time: [],
    magnitude,
    phase,
    f_groupdelay: groupdelay.freq,
    groupdelay: groupdelay.groupdelay,
  }
}
