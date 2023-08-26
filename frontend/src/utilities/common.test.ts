import {modifiedCopyOf, withoutEmptyProperties} from "./common"
import {isArray} from "lodash";

test('modifiedCopyOf', () => {
  const object = {a: 1, b: 2}
  const copy = modifiedCopyOf(object, copy => copy.b = 3)
  expect(object).toEqual({a: 1, b: 2})
  expect(copy).toEqual({a: 1, b: 3})
})

test('withoutEmptyProperties', () => {
  const object = {
    value: "a",
    nullValue: null,
    undefinedValue: undefined,
    array: [1],
    emptyArray: [],
    object: {a: 1},
    emptyObject: {},
    nested: {
      value: 1,
      nullValue: null,
      undefinedValue: undefined,
      array: [1],
      emptyArray: [],
      object: {a: 1},
      emptyObject: {},
    }
  }
  expect(withoutEmptyProperties(object)).toEqual({
    value: "a",
    array: [1],
    object: {a: 1},
    nested: {
      value: 1,
      array: [1],
      object: {a: 1},
    },
  })
})