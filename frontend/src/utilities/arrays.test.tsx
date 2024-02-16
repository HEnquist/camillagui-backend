import {moveItem, toMap} from "./arrays"

describe('Move item', () => {
    test('Move item down', () => {
        const array = [0, 1, 2]
        moveItem(array, 0, 1)
        expect(array).toEqual([1, 0, 2])
    })

    test('Move another item down', () => {
        const array = [0, 1, 2]
        moveItem(array, 1, 2)
        expect(array).toEqual([0, 2, 1])
    })

    test('Move item up', () => {
        const array = [0, 1, 2]
        moveItem(array, 1, 0)
        expect(array).toEqual([1, 0, 2])
    })

    test('Move another item up', () => {
        const array = [0, 1, 2]
        moveItem(array, 2, 1)
        expect(array).toEqual([0, 2, 1])
    })
})


test('Convert array toMap', () => {
    const array = ['a', 'b', 'c'];
    expect(toMap(array)).toEqual({
        'a': 'a',
        'b': 'b',
        'c': 'c'
    })
})