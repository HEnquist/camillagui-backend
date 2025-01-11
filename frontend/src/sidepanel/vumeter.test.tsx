import {expect, test} from 'vitest'
import { levelAsPercent } from './vumeter'

test('levelAsPercent', () => {
  // Very low level gives 0%
  expect(levelAsPercent(-200)).toBeCloseTo(0, 0)
  // -60dB gives ~25%
  expect(levelAsPercent(-60)).toBeCloseTo(25, 0)
  // -18 dB gives ~50%
  expect(levelAsPercent(-18)).toBeCloseTo(50, 0)
  // 0 dB gives ~81%
  expect(levelAsPercent(0)).toBeCloseTo(81, 0)
  // Very high level gives 100%
  expect(levelAsPercent(100)).toBeCloseTo(100, 0)
})