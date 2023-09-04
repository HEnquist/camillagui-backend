import {asFormattedText, modifiedCopyOf, withoutEmptyProperties} from "./common"

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

describe('asFormattedText', () => {

  test('format object with arrays and child objects', () => {
    expect(asFormattedText(
        {
          a: 0,
          b: ['1', '2'],
          c: [3, 4],
          d: {e: 5, f: 6},
        },
        Infinity
    )).toEqual(
        'a=0\n' +
        'b\n' +
        '  1\n' +
        '  2\n' +
        'c=3,4\n' +
        'd\n' +
        '  e=5\n' +
        '  f=6'
    )
  })

  test('does not truncate on nth line', () => {
    expect(
        asFormattedText({a:0, b:1}, 2)
    ).toEqual(
        'a=0\n' +
        'b=1'
    )
  })

  test('truncates after nth line', () => {
    expect(
        asFormattedText({a:0, b:1}, 1)
    ).toEqual(
        'a=0\n' +
        '...'
    )
  })
})