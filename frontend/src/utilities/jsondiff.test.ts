import { expect, test } from "vitest"
import { jsonUndoDiff } from "./jsondiff"

test("diff with one property", () => {
    expect(
        jsonUndoDiff(
            { unchanged: true, a: { b: 1 } },
            { unchanged: true, a: { b: 2 } },
        ),
    ).toBe("a > b: 1 => 2")
})

test("diff with multiple properties", () => {
    expect(
        jsonUndoDiff(
            { a: { b: 1, c: { d: 10 }, oldProperty: "isDeleted" } },
            { a: { b: 2, c: { d: 20 }, newProperty: "isNew" } },
        ),
    ).toBe(
        "a > oldProperty: *removed* => isDeleted<br/>" +
            "a > newProperty: *added* => isNew<br/>" +
            "a > b: 1 => 2<br/>" +
            "a > c > d: 10 => 20",
    )
})

test("property added", () => {
    expect(jsonUndoDiff({ a: {} }, { a: { newProperty: true } })).toBe(
        "a > newProperty: *added* => true",
    )
})

test("property removed", () => {
    expect(jsonUndoDiff({ a: { oldProperty: true } }, { a: {} })).toBe(
        "a > oldProperty: *removed* => true",
    )
})

test("object property added", () => {
    expect(jsonUndoDiff({}, { a: { b: 1, c: 2 } })).toBe(
        "a: *added* => {b:1,c:2}",
    )
})

test("objects in array changed", () => {
    expect(
        jsonUndoDiff(
            { objects: [{ child1: 0 }, { child2: 2 }] },
            { objects: [{ child1: 1 }, { child3: 3 }] },
        ),
    ).toBe(
        "objects > 0 > child1: 0 => 1<br/>" +
            "objects > 1 > child2: *removed* => 2<br/>" +
            "objects > 1 > child3: *added* => 3",
    )
})

test("object in array added", () => {
    expect(jsonUndoDiff({ objects: [] }, { objects: [{ child1: 1 }] })).toBe(
        "objects > -: *added* => {child1:1}",
    )
})

test("object in array removed", () => {
    expect(jsonUndoDiff({ objects: [{ child1: 1 }] }, { objects: [] })).toBe(
        "objects > 0: *removed* => {child1:1}",
    )
})

test("object in array moved", () => {
    expect(
        jsonUndoDiff(
            { objects: [{ child1: 1 }, { child2: 2 }] },
            { objects: [{ child2: 2 }, { child1: 1 }] },
        ),
    ).toBe(
        "objects > 0: *added* => {child2:2}<br/>" +
            "objects > 2: *removed* => {child2:2}",
    )
})
