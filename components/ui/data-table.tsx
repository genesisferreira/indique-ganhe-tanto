"use client"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

interface Column<T> {
  key: string
  header: string
  cell: (item: T) => React.ReactNode
  className?: string
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  /** Chave estável por linha (evita bugs com DropdownMenu em tabelas). */
  getRowKey?: (item: T) => string | number
  searchable?: boolean
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  emptyMessage?: string
  className?: string
}

export function DataTable<T>({
  data,
  columns,
  getRowKey,
  searchable,
  searchPlaceholder = "Buscar...",
  searchValue,
  onSearchChange,
  emptyMessage = "Nenhum item encontrado",
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn("space-y-4", className)}>
      {searchable && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="pl-9"
          />
        </div>
      )}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                      column.className
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                data.map((item, index) => (
                  <tr
                    key={getRowKey != null ? String(getRowKey(item)) : index}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "px-4 py-3 text-sm",
                          column.className
                        )}
                      >
                        {column.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
