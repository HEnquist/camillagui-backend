import {DndProvider, DragElementWrapper, DropTargetMonitor, useDrag, useDrop} from "react-dnd"
import React, {ReactNode} from "react"
import Icon from "@mdi/react"
import {mdiDrag} from "@mdi/js"
import isEqual from "lodash/isEqual"
import {HTML5Backend} from "react-dnd-html5-backend"

export function DndContainer(props: { children: ReactNode }) {
  return <DndProvider backend={HTML5Backend}>
    {props.children}
  </DndProvider>
}

export interface DndProps {
  isDragging: boolean
  canDrop: boolean
  drag: DragElementWrapper<any>
  preview: DragElementWrapper<any>
  drop: DragElementWrapper<any>
}

interface anyNonPrimitiveObject {
  [key: string]: any
}

export function useDndSort<POSITION extends anyNonPrimitiveObject>(
    itemType: string,
    itemPosition: POSITION,
    moveItemFrom: (from: POSITION, to: POSITION) => void
): DndProps {
  const [{isDragging}, drag, preview] = useDrag(() => ({
    type: itemType,
    item: itemPosition,
    options: {dropEffect: 'move'},
    collect: monitor => ({isDragging: monitor.isDragging()})
  }))
  const [{canDrop}, drop] = useDrop(() => ({
    accept: itemType,
    collect: (monitor: DropTargetMonitor<any>) => ({
      canDrop: monitor.isOver() && !isEqual(monitor.getItem(), itemPosition)
    }),
    drop: (item: POSITION) => moveItemFrom(item, itemPosition)
  }))
  return {isDragging, canDrop, drag, preview, drop}
}

export function DndSortable(props: DndProps & { children: ReactNode }) {
  const {isDragging, canDrop, preview, drop, children} = props
  return <div ref={preview} className="dropTargetParent" style={{width: '100%'}}>
    <div
        ref={drop}
        style={{width: '100%'}}
        className={`horizontally-spaced-content${isDragging ? ' dragSource' : ''}${canDrop ? ' dropTarget' : ''}`}>
      {children}
    </div>
  </div>
}

export function DragHandle(props: {
  drag: DragElementWrapper<any>
  tooltip: string
}) {
  return <span ref={props.drag} style={{display: "flex", alignItems: 'center'}}>
    <Icon path={mdiDrag} size={'24px'} className="drag-handle" data-tooltip-html={props.tooltip} data-tooltip-id="main-tooltip"/>
  </span>
}