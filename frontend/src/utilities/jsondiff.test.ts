import {jsonDiff} from "./jsondiff"

test('diff with one property', () => {
  expect(jsonDiff(
      {unchanged: true, a: {b: 1}},
      {unchanged: true, a: {b: 2}}
  )).toBe("a > b: 1 => 2<br/>")
})

test('diff with multiple properties', () => {
  expect(jsonDiff(
      {a: {b: 1, c: {d: 10}, oldProperty: 'isDeleted'}},
      {a: {b: 2, c: {d: 20}, newProperty: 'isNew'}}
  )).toBe(
      "a > newProperty: undefined => isNew<br/>" +
      "a > oldProperty: isDeleted => undefined<br/>" +
      "a > b: 1 => 2<br/>" +
      "a > c > d: 10 => 20<br/>"
  )
})

test('property added', () => {
  expect(jsonDiff(
      {a: {}},
      {a: {newProperty: true}}
  )).toBe("a > newProperty: undefined => true<br/>")
})

test('property removed', () => {
  expect(jsonDiff(
      {a: {oldProperty: true}},
      {a: {}}
  )).toBe("a > oldProperty: true => undefined<br/>")
})