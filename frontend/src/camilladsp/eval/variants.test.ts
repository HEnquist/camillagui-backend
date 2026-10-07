/**
 * Every kind of filter config CamillaDSP accepts must evaluate.
 *
 * The filter types live in camilladsp-schema, in Rust, while the evaluator
 * lives here. `fixtures/variants.json` holds a case for every filter type,
 * subtype and optional parameter, and the backend's `rust/src/filter_variants.rs`
 * fails when camilladsp-schema gains one the fixture does not cover, so a new
 * filter parameter has to show up here, and this test fails if the evaluator
 * does not handle it.
 *
 * Each variant appears twice, as the user writes it and again as the backend
 * sends it, with every optional parameter filled in, mostly as explicit nulls.
 *
 * This checks that the evaluator copes, not what it computes. The numbers are
 * covered by properties.test.ts.
 */
import { describe, expect, it } from "vitest"
import { LooseFilter } from "../config"
import variants from "./fixtures/variants.json"
import { evalFilter } from "./index"

const cases = variants.variants as unknown as { id: string; filter: LooseFilter }[]

describe("every schema valid filter evaluates", () => {
  it.each(cases.map((variant) => [variant.id, variant] as const))("%s", async (_id, variant) => {
    const result = await evalFilter(variant.filter, {
      name: variant.id,
      samplerate: 48000,
      channels: 2,
      volume: variants.volume,
      npoints: 64,
    })
    expect(result.magnitude!.length).toBe(64)
    expect(result.phase!.length).toBe(64)
    // one value per plot point, not one per midpoint between two of them
    expect(result.groupdelay!.length).toBe(64)
    expect(result.magnitude!.every(Number.isFinite), "magnitude is finite everywhere").toBe(true)
    expect(result.phase!.every(Number.isFinite), "phase is finite everywhere").toBe(true)
    expect(result.groupdelay!.every(Number.isFinite), "group delay is finite everywhere").toBe(true)
  })
})
