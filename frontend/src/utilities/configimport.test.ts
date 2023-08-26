import {Import} from "./configimport"

describe('toggleTopLevelElement', () => {

  test('import primitive', () => {
    const toImport = new Import({a: 0}).toggleTopLevelElement('a', 'import').configToImport()
    expect(toImport).toEqual({a: 0})
  })

  test('import primitive into non-empty object', () => {
    const toImport = new Import({a: 0}, {b: 1}).toggleTopLevelElement('a', 'import').configToImport()
    expect(toImport).toEqual({a: 0, b: 1})
  })

  test('import object', () => {
    const toImport = new Import({a: {b: {}}}).toggleTopLevelElement('a', 'import').configToImport()
    expect(toImport).toEqual({a: {b: {}}})
  })

  test('imported objects are cloned deep', () => {
    const original = {a: {b: {}}}
    const toImport = new Import(original).toggleTopLevelElement('a', 'import').configToImport()
    expect(toImport.a).not.toBe(original.a)
    expect(toImport.a.b).not.toBe(original.a.b)
  })

  test('import array', () => {
    const toImport = new Import({a: [{}]}).toggleTopLevelElement('a', 'import').configToImport()
    expect(toImport).toEqual({a: [{}]})
  })

  test('imported arrays are cloned deep', () => {
    const original = {a: [{}]}
    const toImport = new Import(original).toggleTopLevelElement('a', 'import').configToImport()
    expect(toImport.a).not.toBe(original.a)
    expect(toImport.a[0]).not.toBe(original.a[0])
  })

  test('remove element', () => {
    const toImport = new Import({a: 0}).toggleTopLevelElement('a', 'remove').configToImport()
    expect(toImport).toEqual({})
  })
})

describe('isTopLevelElementImported', () => {

  test('is imported', () => {
    expect(new Import({a: 0}, {a: 0}).isTopLevelElementImported('a')).toBe(true)
  })

  test('missing element is not imported', () => {
    expect(new Import({a: 0}).isTopLevelElementImported('a')).toBe(false)
  })

  test('differing element is partially imported', () => {
    expect(new Import({a: 0}, {a: 1}).isTopLevelElementImported('a')).toBe('partially')
  })

})

describe('toggleSecondLevelElement', () => {

  test('import primitive into object', () => {
    const toImport = new Import(
        {a: {b: 0}},
        {a: {}}
    ).toggleSecondLevelElement('a', 'b', 'import').configToImport()
    expect(toImport).toEqual(
        {a: {b: 0}}
    )
  })

  test('import primitive into array', () => {
    const toImport = new Import(
        {a: [0]},
        {a: []}
    ).toggleSecondLevelElement('a', '0', 'import').configToImport()
    expect(toImport).toEqual(
        {a: [0]}
    )
  })

  test('import object', () => {
    const toImport =
        new Import(
            {a: {b: {}}},
            {a: {}}
        ).toggleSecondLevelElement('a', 'b', 'import').configToImport()
    expect(toImport).toEqual(
        {a: {b: {}}}
    )
  })

  test('import object and create missing parent', () => {
    const toImport = new Import(
        {a: {b: {}}}
    ).toggleSecondLevelElement('a', 'b', 'import').configToImport()
    expect(toImport).toEqual(
        {a: {b: {}}}
    )
  })

  test('imported objects are cloned deep', () => {
    const original = {a: {b: {}}}
    const toImport = new Import(original).toggleSecondLevelElement('a', 'b', 'import').configToImport()
    expect(toImport.a.b).not.toBe(original.a.b)
  })

  test('import array', () => {
    const toImport = new Import(
        {a: [{}]},
        {a: []}
    ).toggleSecondLevelElement('a', '0', 'import').configToImport()
    expect(toImport).toEqual(
        {a: [{}]}
    )
  })

  test('import array with duplicates - first duplicate is imported', () => {
    const toImport = new Import(
        {a: ['b', 'b']}
    ).toggleSecondLevelElement('a', '0', 'import').configToImport()
    expect(toImport).toEqual(
        {a: ['b']}
    )
  })

  test('import array with duplicates - second duplicate is imported', () => {
    const toImport = new Import(
        {a: ['b', 'b']}
    ).toggleSecondLevelElement('a', '1', 'import').configToImport()
    expect(toImport).toEqual(
        {a: ['b']}
    )
  })

  test('import array and create missing parent', () => {
    const toImport = new Import(
        {a: [{}]},
        {a: [{}]}
    ).toggleSecondLevelElement('a', '0', 'import').configToImport()
    expect(toImport).toEqual(
        {a: [{}]}
    )
  })

  test('imported arrays are cloned deep', () => {
    const original = {a: [{}]}
    const toImport = new Import(original).toggleSecondLevelElement('a', '0', 'import').configToImport()
    expect(toImport.a[0]).not.toBe(original.a[0])
  })

  test('remove object element', () => {
    const toImport = new Import(
        {},
        {a: {b: 0, c: 1}}
    ).toggleSecondLevelElement('a', 'c', 'remove').configToImport()
    expect(toImport).toEqual(
        {a: {b: 0}}
    )
  })

  test('remove object element and empty parent', () => {
    const toImport = new Import(
        {},
        {a: {b: 0}}
    ).toggleSecondLevelElement('a', 'b', 'remove').configToImport()
    expect(toImport).toEqual(
        {}
    )
  })

  test('remove array element', () => {
    const toImport = new Import(
        {},
        {a: ['b','c']}
    ).toggleSecondLevelElement('a', '1', 'remove').configToImport()
    expect(toImport).toEqual(
        {a: ['b']}
    )
  })

  test('remove array only one duplicate array element', () => {
    const toImport = new Import(
        {},
        {a: ['b','b']}
    ).toggleSecondLevelElement('a', '1', 'remove').configToImport()
    expect(toImport).toEqual(
        {a: ['b']}
    )
  })

  test('remove array element', () => {
    const toImport = new Import(
        {},
        {a: [0,1]}
    ).toggleSecondLevelElement('a', '1', 'remove').configToImport()
    expect(toImport).toEqual(
        {a: [0]}
    )
  })

  test('remove array element and empty parent', () => {
    const toImport = new Import(
        {a: [0]},
        {a: [0]}
    ).toggleSecondLevelElement('a', '0', 'remove').configToImport()
    expect(toImport).toEqual(
        {}
    )
  })
})


describe('isSecondLevelElementImported', () => {

  test('is imported', () => {
    expect(new Import(
        {a: {b: 0}},
        {a: {b: 0}}
    ).isSecondLevelElementImported('a', 'b')).toBe(true)
  })

  test('with missing parent element is not imported', () => {
    expect(new Import(
        {a: {b: 0}},
        {}
    ).isSecondLevelElementImported('a', 'b')).toBe(false)
  })

  test('missing element is not imported', () => {
    expect(new Import(
        {a: {b: 0}},
        {a: {}}
    ).isSecondLevelElementImported('a', 'b')).toBe(false)
  })

  test('different element is not imported', () => {
    expect(new Import(
        {a: {b: 0}},
        {a: {b: 1}}
    ).isSecondLevelElementImported('a', 'b')).toBe(false)
  })

  test('is imported in array', () => {
    expect(new Import(
        {a: ['b']},
        {a: ['b']}
    ).isSecondLevelElementImported('a', '0')).toBe(true)
  })

  test('only second element is imported in array', () => {
    const i = new Import(
        {a: ['b','c']}
    ).toggleSecondLevelElement('a', '1', 'import');
    expect(i.isSecondLevelElementImported('a', '0')).toBe(false)
    expect(i.isSecondLevelElementImported('a', '1')).toBe(true)
  })

  test('duplicates in array are handled properly - first duplicate is imported', () => {
    const i = new Import(
        {a: ['b','b']}
    ).toggleSecondLevelElement('a', '0', 'import')
    expect(i.isSecondLevelElementImported('a', '0')).toBe(true)
    expect(i.isSecondLevelElementImported('a', '1')).toBe(false)
  })

  test('duplicates in array are handled properly - second duplicate is imported', () => {
    const i = new Import(
        {a: ['b','b']}
    ).toggleSecondLevelElement('a', '1', 'import')
    expect(i.isSecondLevelElementImported('a', '0')).toBe(false)
    expect(i.isSecondLevelElementImported('a', '1')).toBe(true)
  })

})