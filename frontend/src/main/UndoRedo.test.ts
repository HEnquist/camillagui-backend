import {expect, test} from 'vitest'
import {UndoRedo} from "./UndoRedo"

test('Cannot undo/redo when empty', () => {
  const undoRedo = new UndoRedo(0)
  expect(undoRedo.canUndo()).toBe(false)
  expect(undoRedo.canRedo()).toBe(false)
  expect(undoRedo.current()).toBe(0)
})

test('Change item', () => {
  const undoRedo = new UndoRedo(0).changeTo(1)
  expect(undoRedo.canUndo()).toBe(true)
  expect(undoRedo.canRedo()).toBe(false)
  expect(undoRedo.current()).toBe(1)
})

test('Change item twice', () => {
  const undoRedo = new UndoRedo(0).changeTo(1).changeTo(2)
  expect(undoRedo.current()).toBe(2)
  expect(undoRedo.canUndo()).toBe(true)
  expect(undoRedo.canRedo()).toBe(false)
})

test('Undo', () => {
  const undoRedo = new UndoRedo(0).changeTo(1).undo()
  expect(undoRedo.current()).toBe(0)
  expect(undoRedo.canUndo()).toBe(false)
  expect(undoRedo.canRedo()).toBe(true)
})

test('Redo', () => {
  const undoRedo = new UndoRedo(0).changeTo(1).undo().redo()
  expect(undoRedo.current()).toBe(1)
  expect(undoRedo.canUndo()).toBe(true)
  expect(undoRedo.canRedo()).toBe(false)
})

test('Undo/Redo Diff', () => {
  const undoRedo = new UndoRedo(0)
  expect(undoRedo.undoDiff()).toEqual("")
  expect(undoRedo.redoDiff()).toEqual("")
  const canUndo = undoRedo.changeTo(1)
  expect(canUndo.undoDiff()).not.toEqual("")
  expect(canUndo.redoDiff()).toEqual("")
  const canRedo = canUndo.undo()
  expect(canRedo.undoDiff()).toEqual("")
  expect(canRedo.redoDiff()).not.toEqual("")
})
