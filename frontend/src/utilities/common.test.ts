import {numberValue, setNumberValue} from "./common"

test('numberValue returns undefined, if property is absent', () => {
  expect(numberValue({}, ['a'])).toBe(undefined)
})

test('numberValue returns undefined, if parent property is absent', () => {
  expect(numberValue({}, ['a', 'b'])).toBe(undefined)
})

test('numberValue for simple object', () => {
  expect(numberValue({a: 1}, ['a'])).toBe(1)
})

test('numberValue for complex object', () => {
  expect(numberValue({a: {b: 2}}, ['a', 'b'])).toBe(2)
})

test('setNumberValue for simple object', () => {
  let object = {a: 1}
  setNumberValue(object, ['a'], 2)
  expect(object.a).toBe(2)
})

test('setNumberValue for complex object', () => {
  let object = {a: {b: 1}}
  setNumberValue(object, ['a', 'b'], 2)
  expect(object.a.b).toBe(2)
})