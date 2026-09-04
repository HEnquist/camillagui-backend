/**
 * Narrowing helpers for filter parameters.
 *
 * `Filter.parameters` is an untyped bag of `FilterParameterValue`, so the
 * evaluator has to narrow every value it reads. A missing key and an explicit
 * null both mean "not set": the schemas declare optional parameters as
 * `default: null`, so a config that has been through the validator carries
 * nulls where the user left a parameter out.
 */
import { FilterParameterValue, PeqBand } from "../config"

export type Params = { [name: string]: FilterParameterValue }

export class FilterEvalError extends Error {}

function present(params: Params, key: string): boolean {
  const value = params[key]
  return value !== undefined && value !== null
}

/** A required number. */
export function num(params: Params, key: string): number {
  const value = params[key]
  if (typeof value !== "number") throw new FilterEvalError(`Missing or invalid parameter '${key}'`)
  return value
}

/** An optional number, `undefined` when not set. */
export function optNum(params: Params, key: string): number | undefined {
  if (!present(params, key)) return undefined
  return num(params, key)
}

/** An optional number, falling back to the DSP default when not set. */
export function numOr(params: Params, key: string, fallback: number): number {
  return optNum(params, key) ?? fallback
}

/**
 * An optional number where zero is not a usable value either, so it falls back
 * to the default as well. GraphicEqualizer's frequency limits work this way:
 * the DSP rejects zero, and it must not reach log2.
 */
export function positiveNumOr(params: Params, key: string, fallback: number): number {
  const value = optNum(params, key)
  return value ? value : fallback
}

/** An optional boolean. Anything not explicitly true counts as false. */
export function flag(params: Params, key: string): boolean {
  return params[key] === true
}

export function optStr(params: Params, key: string): string | undefined {
  if (!present(params, key)) return undefined
  const value = params[key]
  if (typeof value !== "string") throw new FilterEvalError(`Invalid parameter '${key}'`)
  return value
}

/** A list of numbers. An absent or empty list falls back to the given default. */
export function numListOr(params: Params, key: string, fallback: number[]): number[] {
  const value = params[key]
  if (!Array.isArray(value) || value.length === 0) return fallback
  if (value.some((entry) => typeof entry !== "number"))
    throw new FilterEvalError(`Invalid parameter '${key}', expected a list of numbers`)
  return value as number[]
}

export function numList(params: Params, key: string): number[] {
  const value = params[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number"))
    throw new FilterEvalError(`Missing or invalid parameter '${key}', expected a list of numbers`)
  return value as number[]
}

export function peqBands(params: Params, key: string): PeqBand[] {
  const value = params[key]
  if (!Array.isArray(value)) throw new FilterEvalError(`Missing or invalid parameter '${key}'`)
  return value as PeqBand[]
}
