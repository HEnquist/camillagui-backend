import {jsonDiff} from "../utilities/jsondiff"

export class UndoRedo<T> {

  private readonly currentItem: T
  private readonly undoItems: T[]
  private readonly redoItems: T[]

  constructor(currentItem: T, undoItems: T[] = [], redoItems: T[] = []) {
    this.changeTo = this.changeTo.bind(this)
    this.current = this.current.bind(this)
    this.canUndo = this.canUndo.bind(this)
    this.undo = this.undo.bind(this)
    this.canRedo = this.canRedo.bind(this)
    this.redo = this.redo.bind(this)
    this.currentItem = currentItem
    this.undoItems = undoItems
    this.redoItems = redoItems
  }

  changeTo(item: T): UndoRedo<T> {
    return new UndoRedo<T>(
        item,
        this.currentItem === undefined ? this.undoItems : this.undoItems.concat(this.currentItem),
        []
    )
  }

  current() : T {
    return this.currentItem
  }

  canUndo(): boolean {
    return this.undoItems.length > 0
  }

  undo(): UndoRedo<T> {
    const currentItem = this.currentItem
    const undoItems = this.undoItems
    const redoItems = this.redoItems
    return new UndoRedo<T>(
        undoItems[undoItems.length-1],
        undoItems.slice(0, undoItems.length-1),
        currentItem === undefined ? redoItems : redoItems.concat(currentItem)
    )
  }

  undoDiff(): string {
    return this.canUndo() ?
        jsonDiff(this.currentItem, this.undoItems[this.undoItems.length-1])
        : ""
  }

  canRedo(): boolean {
    return this.redoItems.length > 0
  }

  redo(): UndoRedo<T> {
    const currentItem = this.currentItem!
    const undoItems = this.undoItems
    const redoItems = this.redoItems
    return new UndoRedo<T>(
        redoItems[redoItems.length-1],
        undoItems.concat(currentItem),
        redoItems.slice(0, redoItems.length-1)
    )
  }

  redoDiff(): string {
    return this.canRedo() ?
        jsonDiff(this.currentItem, this.redoItems[this.redoItems.length-1])
        : ""
  }

}