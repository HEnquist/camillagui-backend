import {Errors} from './errors'

describe('hasErrors()', () => {

  test('false for no errors', () => {
    expect(new Errors().hasErrors())
        .toBe(false)
  })

  test('true for errors', () => {
    expect(new Errors([[[], '']]).hasErrors())
        .toBe(true)
  })

})

describe('hasErrorsFor(path)', () => {

  test('false for no errors', () => {
    expect(new Errors().hasErrorsFor('path'))
        .toBe(false)
  })

  test('true for errors', () => {
    expect(new Errors([[['path'], 'message']]).hasErrorsFor('path'))
        .toBe(true)
  })

})

describe('rootMessage()', () => {

  test('rootMessage() is undefined, when there are no errors', () => {
    expect(new Errors().rootMessage())
        .toBe(undefined)
  })

  test('rootMessage() contains root error only', () => {
    const errors = new Errors([
      [[], 'root error'],
      [['irrelevant'], 'irrelevant error'],
      [[0], 'another irrelevant error']
    ])
    expect(errors.rootMessage())
        .toEqual('root error')
  })

  test('rootMessage() joins two errors', () => {
    const errors = new Errors([
      [[], 'error1'],
      [[], 'error2']
    ])
    expect(errors.rootMessage())
        .toEqual("error1\nerror2")
  })

})

describe('messageFor(path)', () => {

  test('messageFor(path) is undefined, when there are no errors', () => {
    expect(new Errors().messageFor('path'))
        .toBe(undefined)
  })

  test('messageFor(path) contains only message for path', () => {
    const errors = new Errors([
        [[], 'parent message'],
        [['path'], 'message'],
        [['path', 'sub'], 'child message']
    ])
    expect(errors.messageFor('path'))
        .toBe('message')
  })
})

describe('asText()', () => {

  test('asText() is empty string, when there are no errors', () => {
    expect(new Errors().asText())
        .toBe('')
  })


  test('asText() contains all errors including their paths', () => {
    const errors = new Errors([
      [[], 'root error'],
      [['sub'], 'sub error'],
      [['sub', 1], 'sub 1 error'],
      [['sub', 2], 'sub 2 error']
    ])
    expect(errors.asText())
        .toBe(
            'root error\n' +
            'sub: sub error\n' +
            'sub|1: sub 1 error\n' +
            'sub|2: sub 2 error'
        )
  })

})

describe('forSubpath()', () => {

  const errors = new Errors([
    [[], 'root error'],
    [['sub'], 'sub error'],
    [['sub', 1], 'sub 1 error'],
    [['sub', 2], 'sub 2 error']
  ])

  test('simple subpath', () => {
    expect(errors.forSubpath('sub').asText())
        .toEqual(
            'sub error\n' +
            '1: sub 1 error\n' +
            '2: sub 2 error'
        )
  })

  test('nested subpath', () => {
    expect(errors.forSubpath('sub', 1).asText())
        .toEqual('sub 1 error')
  })

})

