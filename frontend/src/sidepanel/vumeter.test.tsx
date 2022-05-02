import {levelAsPercent} from './vumeter'
import {minVolume} from "./volumebox"

test('levelAsPercent', () => {
  expect(levelAsPercent(minVolume)).toEqual(0)
  expect(levelAsPercent(0)).toEqual(100*minVolume/(minVolume-10))
  expect(levelAsPercent(10)).toEqual(100)
})