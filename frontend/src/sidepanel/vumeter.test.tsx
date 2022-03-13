import {levelAsPercent} from './vumeter'

test('levelAsPercent', () => {
  expect(levelAsPercent(-50)).toEqual(0)
  expect(levelAsPercent(0)).toEqual(100*5/6)
  expect(levelAsPercent(10)).toEqual(100)
})