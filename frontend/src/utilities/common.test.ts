import { asFormattedText, modifiedCopyOf, withoutEmptyProperties, numberValue, setNumberValue, setBoolValue } from "./common"

test('modifiedCopyOf', () => {
  const object = { a: 1, b: 2 }
  const copy = modifiedCopyOf(object, copy => copy.b = 3)
  expect(object).toEqual({ a: 1, b: 2 })
  expect(copy).toEqual({ a: 1, b: 3 })
})

test('withoutEmptyProperties', () => {
  const object = {
    value: "a",
    nullValue: null,
    undefinedValue: undefined,
    array: [1],
    emptyArray: [],
    object: { a: 1 },
    emptyObject: {},
    nested: {
      value: 1,
      nullValue: null,
      undefinedValue: undefined,
      array: [1],
      emptyArray: [],
      object: { a: 1 },
      emptyObject: {},
    }
  }
  expect(withoutEmptyProperties(object)).toEqual({
    value: "a",
    array: [1],
    object: { a: 1 },
    nested: {
      value: 1,
      array: [1],
      object: { a: 1 },
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
        d: { e: 5, f: 6 },
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
      asFormattedText({ a: 0, b: 1 }, 2)
    ).toEqual(
      'a=0\n' +
      'b=1'
    )
  })

  test('truncates after nth line', () => {
    expect(
      asFormattedText({ a: 0, b: 1 }, 1)
    ).toEqual(
      'a=0\n' +
      '...'
    )
  })

  test('numberValue returns undefined, if property is absent', () => {
    const shortcut = {
      name: "dummy",
      range_from: -5,
      range_to: 5,
      step: 0.5,
      type: "number",
      config_elements: [
        {
          path: ['a'],
        }
      ]
    }
    expect(numberValue({}, shortcut)).toBe(undefined)
  })

  test('numberValue returns undefined, if parent property is absent', () => {
    const shortcut = {
      name: "dummy",
      range_from: -5,
      range_to: 5,
      step: 0.5,
      type: "number",
      config_elements: [
        {
          path: ['a', 'b'],
        }
      ]
    }
    expect(numberValue({}, shortcut)).toBe(undefined)
  })

  test('numberValue for simple object', () => {
    const shortcut = {
      name: "dummy",
      range_from: -5,
      range_to: 5,
      step: 0.5,
      type: "number",
      config_elements: [
        {
          path: ['a'],
        }
      ]
    }
    expect(numberValue({ a: 1 }, shortcut)).toBe(1)
  })

  test('numberValue for complex object', () => {
    const shortcut = {
      name: "dummy",
      range_from: -5,
      range_to: 5,
      step: 0.5,
      type: "number",
      config_elements: [
        {
          path: ['a', 'b'],
        }
      ]
    }
    expect(numberValue({ a: { b: 2 } }, shortcut)).toBe(2)
  })

  test('numberValue with reverse', () => {
    const shortcut = {
      name: "dummy",
      range_from: 0,
      range_to: 10,
      step: 0.5,
      type: "number",
      config_elements: [
        {
          path: ['a'],
          reverse: true,
        }
      ]
    }
    expect(numberValue({ a: 1 }, shortcut)).toBe(9)
  })

  test('setNumberValue for simple object', () => {
    let object = { a: 1 }
    setNumberValue(object, ['a'], 2)
    expect(object.a).toBe(2)
  })

  test('setNumberValue for complex object', () => {
    let object = { a: { b: 1 } }
    setNumberValue(object, ['a', 'b'], 2)
    expect(object.a.b).toBe(2)
  })

  test('setNumberValue for wrong type', () => {
    let object = { a: "string" }
    setNumberValue(object, ['a'], 2)
    expect(object.a).toBe("string")
  })

  test('setBoolValue for simple object', () => {
    let object = { a: true }
    setBoolValue(object, ['a'], false)
    expect(object.a).toBe(false)
  })

  test('setBoolValue for complex object', () => {
    let object = { a: { b: false } }
    setBoolValue(object, ['a', 'b'], true)
    expect(object.a.b).toBe(true)
  })

  test('setBoolValue for wrong type', () => {
    let object = { a: 5 }
    setBoolValue(object, ['a'], false)
    expect(object.a).toBe(5)
  })
})
