/**
 * Filter evaluation for the plots.
 *
 * This used to be a round trip to the backend, which evaluated the transfer
 * function in numpy and returned five 1000 point curves. It now runs in the
 * browser, which is almost always the faster machine of the two, and needs no
 * network at all except for Conv filters that read coefficients from a file.
 */
import { magnitudeDb, multiplyInto, phaseDegrees, unitCurve } from "./complex"
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
 * own plots do, and the golden fixture pins it.
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
  coefficients: number[]
}

/**
 * Coefficients keyed on the request that produced them.
 *
 * Dragging a control anywhere in a pipeline step re-evaluates every filter in
 * it, so without this a neighbouring Conv would be refetched on every frame.
 * The entries are large, up to a few megabytes for a long impulse response, so
 * only the most recent few are kept.
 */
const COEFF_CACHE_SIZE = 8
const coeffCache = new Map<string, Promise<ConvCoefficients>>()

function cacheKey(filterconf: Filter, samplerate: number, channels: number): string {
  return JSON.stringify([filterconf.parameters, samplerate, channels])
}

/** Drop the cached coefficients. Exported for tests. */
export function clearCoefficientCache(): void {
  coeffCache.clear()
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
  if (cached !== undefined) return cached

  const pending = (async () => {
    const response = await fetch("/api/convcoeffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: filterconf, samplerate, channels }),
    })
    if (!response.ok) throw new FilterEvalError(await response.text())
    return (await response.json()) as ConvCoefficients
  })()
  // a failed fetch must not be remembered, or the filter can never plot again
  pending.catch(() => coeffCache.delete(key))

  coeffCache.set(key, pending)
  while (coeffCache.size > COEFF_CACHE_SIZE) {
    const oldest = coeffCache.keys().next()
    if (oldest.done) break
    coeffCache.delete(oldest.value)
  }
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
    const coefficients = new Array<number>(num(params, "length")).fill(0.0)
    coefficients[0] = 1.0
    return { options: [], coefficients }
  }
  if (subtype === "Values") return { options: [], coefficients: numList(params, "values") }
  // a Conv with no parameters at all is a single unity coefficient, which is
  // what CamillaDSP falls back to
  if (subtype === undefined) return { options: [], coefficients: [1.0] }
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
    result.time = conv.coefficients.map((_, n) => n / samplerate)
  } else {
    curve = complexGain(filterconf, samplerate, volume, freq)
  }

  const magnitude = magnitudeDb(curve)
  const phase = phaseDegrees(curve)
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
  for (const filterName of names) {
    const filterconf = config.filters?.[filterName]
    if (filterconf === undefined) throw new FilterEvalError(`Unknown filter ${filterName}`)
    if (filterconf.type === "Conv") {
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
