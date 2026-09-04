/**
 * Every filter config the schemas allow must evaluate.
 *
 * The schemas live in the backend, in Python, while the evaluator lives here.
 * `camillagui-backend/tools/dump_filter_variants.py` exports one config per
 * schema variant so that the two stay coupled: a new filter parameter shows up
 * here as a new variant, and this test fails if the evaluator does not handle
 * it. The backend's `test_eval_validated_configs.py` fails if the export is
 * stale, so neither side can drift on its own.
 *
 * Each variant appears twice, as the user writes it and again after the
 * validator has filled in the schema defaults, which is where optional
 * parameters turn into explicit nulls.
 *
 * This checks that the evaluator copes, not what it computes. The numbers are
 * covered by properties.test.ts.
 */
import { describe, expect, it } from "vitest"
import { Filter } from "../config"
import variants from "./fixtures/variants.json"
import { evalFilter } from "./index"

const cases = variants.variants as unknown as { id: string; filter: Filter }[]

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
