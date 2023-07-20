import {Filters} from "../camilladsp/config"
import {eqApoFiltersToJson} from "./filterimport"

test('Ignore EqAPO header and unused filters', () => {
  const text = `
Filter Settings file

Room EQ V5.20.13
Dated: 01.01.2000 12:00:00

Notes:

Equaliser: Generic
Comment
MyFilter: ON PK Fc 10.0 Hz Gain 1 dB Q 1
Filter unused: ON  None`
  const filters = eqApoFiltersToJson(text)
  expect(filters).toEqual<Filters>(
      {
        'MyFilter': {
          type: 'Biquad',
          description: null,
          parameters: {type: 'Peaking', freq: 10, gain: 1, q: 1}
        }
      }
  )
})

test('Import multiple EqAPO filters', () => {
  const text = `
Filter 1: ON PK Fc 10.0 Hz Gain 1 dB Q 1
Filter 2: ON PK Fc 20.0 Hz Gain 2 dB Q 2`
  const filters = eqApoFiltersToJson(text)
  expect(filters).toEqual<Filters>(
      {
        'Filter 1': {
          type: 'Biquad',
          description: null,
          parameters: {type: 'Peaking', freq: 10, gain: 1, q: 1}
        },
        'Filter 2': {
          type: 'Biquad',
          description: null,
          parameters: {type: 'Peaking', freq: 20, gain: 2, q: 2}
        },
      }
  )
})

test('Import EqAPO preamp to gain filter', () => {
  const text = 'Preamp: -1.23 dB'
  const filters = eqApoFiltersToJson(text)
  expect(filters).toEqual<Filters>(
      { 'Gain-1.23': {
          type: 'Gain',
          description: null,
          parameters: {gain: -1.23, scale: 'dB', inverted: false}
      }}
  )
})

test('Import EqAPO Lowshelf', () => {
  const text = 'MyFilter: ON LSC Fc 10.0 Hz Gain -2.34 dB Q 0.01'
  const filters = eqApoFiltersToJson(text)
  expect(filters).toEqual<Filters>(
      { 'MyFilter': {
          type: 'Biquad',
          description: null,
          parameters: {type: 'Lowshelf', freq: 10, gain: -2.34, q: 0.01}
      }}
  )
})

test('Import EqAPO Peaking', () => {
  const text = 'MyFilter: ON PK Fc 20.0 Hz Gain -3.45 dB Q 0.02'
  const filters = eqApoFiltersToJson(text)
  expect(filters).toEqual<Filters>(
      { 'MyFilter': {
          type: 'Biquad',
          description: null,
          parameters: {type: 'Peaking', freq: 20, gain: -3.45, q: 0.02}
      }}
  )
})

test('Import EqAPO Highshelf', () => {
  const text = 'Filter 3: ON HSC Fc 30.0 Hz Gain -4.56 dB Q 0.03'
  const filters = eqApoFiltersToJson(text)
  expect(filters).toEqual<Filters>(
      { 'Filter 3': {
          type: 'Biquad',
          description: null,
          parameters: {type: 'Highshelf', freq: 30, gain: -4.56, q: 0.03}
      }}
  )
})