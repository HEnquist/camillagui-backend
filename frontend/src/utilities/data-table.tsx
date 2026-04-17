import React from "react"
import {
  Cell,
  CellContext,
  ColumnDef,
  FilterFn,
  Header,
  HeaderContext,
  HeaderGroup,
  RowData as TanStackRowData,
  Row,
  RowSelectionState,
  SortingFn,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"

export interface DataTableColumnMeta {
  width?: string
  maxWidth?: string
  right?: boolean
  compact?: boolean
}

export interface SelectedRowsChange<RowData extends TanStackRowData> {
  allSelected: boolean
  selectedCount: number
  selectedRows: RowData[]
}

export function sortByRows<RowData extends TanStackRowData>(
  compare: (rowA: RowData, rowB: RowData) => number,
): SortingFn<RowData> {
  return (rowA: Row<RowData>, rowB: Row<RowData>) => compare(rowA.original, rowB.original)
}

export function DataTable<RowData extends TanStackRowData>(props: {
  columns: ColumnDef<RowData, unknown>[]
  data: RowData[]
  globalFilter?: string
  toolbar?: React.ReactNode
  selectableRows?: boolean
  onSelectedRowsChange?: (selection: SelectedRowsChange<RowData>) => void
  onRowClicked?: (row: RowData) => void
  highlightOnHover?: boolean
  pointerOnHover?: boolean
}) {
  const {
    columns,
    data,
    globalFilter,
    toolbar,
    selectableRows,
    onSelectedRowsChange,
    onRowClicked,
    highlightOnHover,
    pointerOnHover,
  } = props
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

  const normalizedGlobalFilter = globalFilter?.trim() ?? ""

  const tableColumns = React.useMemo<ColumnDef<RowData, unknown>[]>(() => {
    if (!selectableRows) {
      return columns
    }

    return [
      {
        id: "__select__",
        header: ({ table }: HeaderContext<RowData, unknown>) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            ref={(element) => {
              if (!element) {
                return
              }
              element.indeterminate = table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            aria-label="Select all rows"
          />
        ),
        cell: ({ row }: CellContext<RowData, unknown>) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableGlobalFilter: false,
        meta: {
          compact: true,
          width: "36px",
        } satisfies DataTableColumnMeta,
      } satisfies ColumnDef<RowData, unknown>,
      ...columns,
    ]
  }, [columns, selectableRows])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<RowData>({
    data,
    columns: tableColumns,
    state: {
      globalFilter: normalizedGlobalFilter,
      sorting,
      rowSelection,
    },
    globalFilterFn: tableGlobalFilter as FilterFn<RowData>,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: selectableRows === true,
  })

  React.useEffect(() => {
    if (!onSelectedRowsChange) {
      return
    }
    const selectedRows = table.getSelectedRowModel().rows.map((row: Row<RowData>) => row.original)
    onSelectedRowsChange({
      allSelected: data.length > 0 && selectedRows.length === data.length,
      selectedCount: selectedRows.length,
      selectedRows,
    })
  }, [data.length, onSelectedRowsChange, rowSelection, table])

  return (
    <div className="data-table-shell">
      {toolbar ? <div className="data-table-toolbar">{toolbar}</div> : null}
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup: HeaderGroup<RowData>) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header: Header<RowData, unknown>) => {
                const column = header.column.columnDef.meta as DataTableColumnMeta | undefined
                const canSort = header.column.getCanSort()
                const sortState = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    className={column?.compact ? "data-table-compact" : undefined}
                    aria-sort={ariaSort(sortState)}
                    style={columnStyle(column)}
                  >
                    <button
                      type="button"
                      className={canSort ? "data-table-sortable" : "data-table-static-header"}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      title={canSort ? "Sort by this column" : undefined}
                    >
                      <span>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      <span className="data-table-sort-indicator" aria-hidden="true">
                        {sortIndicator(sortState, canSort)}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row: Row<RowData>) => {
            const clickable = !!onRowClicked
            const rowClassNames = [
              highlightOnHover ? "data-table-hover" : "",
              pointerOnHover || clickable ? "data-table-pointer" : "",
              row.getIsSelected() ? "data-table-selected" : "",
            ]
              .filter(Boolean)
              .join(" ")

            return (
              <tr
                key={row.id}
                className={rowClassNames || undefined}
                onClick={clickable ? () => onRowClicked(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell: Cell<RowData, unknown>) => {
                  const column = cell.column.columnDef.meta as DataTableColumnMeta | undefined
                  return (
                    <td
                      key={cell.id}
                      className={column?.compact ? "data-table-compact" : undefined}
                      style={columnStyle(column)}
                      onClick={(event) => {
                        if (!clickable) {
                          return
                        }
                        const target = event.target as HTMLElement
                        if (target.closest("button, a, input, select, textarea, label")) {
                          event.stopPropagation()
                        }
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const tableGlobalFilter: FilterFn<TanStackRowData> = (row, columnId, filterValue) => {
  const query = normalizeFilterValue(filterValue)
  if (!query) {
    return true
  }

  const value = row.getValue(columnId)
  if (value === null || value === undefined) {
    return false
  }

  return normalizeFilterValue(value).includes(query)
}

function normalizeFilterValue(value: unknown): string {
  return String(value).trim().toLowerCase()
}

function columnStyle(column: DataTableColumnMeta | undefined): React.CSSProperties | undefined {
  if (!column) {
    return undefined
  }
  return {
    width: column.width,
    maxWidth: column.maxWidth,
    textAlign: column.right ? "right" : undefined,
  }
}

function sortIndicator(sortState: false | "asc" | "desc", canSort: boolean): string {
  if (sortState === "asc") {
    return "▲"
  }
  if (sortState === "desc") {
    return "▼"
  }
  return canSort ? "↕" : ""
}

function ariaSort(sortState: false | "asc" | "desc"): React.AriaAttributes["aria-sort"] {
  if (sortState === "asc") {
    return "ascending"
  }
  if (sortState === "desc") {
    return "descending"
  }
  return "none"
}
