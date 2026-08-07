import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface FilterOption {
  value: string
  label: string
}

interface SearchFilterBarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  filterValue?: string
  onFilterChange?: (value: string) => void
  filterOptions?: FilterOption[]
  filterLabel?: string
}

export function SearchFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = '搜索...',
  filterValue,
  onFilterChange,
  filterOptions,
  filterLabel = '全部',
}: SearchFilterBarProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-8 pr-8"
        />
        {searchValue && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
            onClick={() => onSearchChange('')}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      {filterOptions && onFilterChange && (
        <Select value={filterValue || 'all'} onValueChange={v => onFilterChange(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder={filterLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{filterLabel}</SelectItem>
            {filterOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
