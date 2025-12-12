# Dashboard Filtering

## Filter State Management

```typescript
interface FilterState {
  search: string;
  dateRange: { start: Date; end: Date } | null;
  categories: string[];
  status: string[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

const defaultFilters: FilterState = {
  search: '',
  dateRange: null,
  categories: [],
  status: [],
  sortBy: 'date',
  sortOrder: 'desc',
};

// URL sync for shareable filters
function useFilterState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => ({
    search: searchParams.get('q') || '',
    categories: searchParams.getAll('cat'),
    status: searchParams.getAll('status'),
    dateRange: parseDateRange(searchParams.get('dates')),
    sortBy: searchParams.get('sort') || 'date',
    sortOrder: (searchParams.get('order') || 'desc') as 'asc' | 'desc',
  }), [searchParams]);

  const setFilters = useCallback((updates: Partial<FilterState>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);

      if (updates.search !== undefined) {
        updates.search ? next.set('q', updates.search) : next.delete('q');
      }

      if (updates.categories !== undefined) {
        next.delete('cat');
        updates.categories.forEach(c => next.append('cat', c));
      }

      // ... handle other filters

      return next;
    });
  }, [setSearchParams]);

  return [filters, setFilters] as const;
}
```

## Filter Components

### Search Input

```tsx
function SearchFilter({ value, onChange }: Props) {
  const [local, setLocal] = useState(value);
  const debouncedOnChange = useMemo(
    () => debounce(onChange, 300),
    [onChange]
  );

  return (
    <input
      type="search"
      value={local}
      onChange={(e) => {
        setLocal(e.target.value);
        debouncedOnChange(e.target.value);
      }}
      placeholder="Search..."
    />
  );
}
```

### Multi-Select Facet

```tsx
function FacetFilter({ options, selected, onChange, label }: Props) {
  return (
    <fieldset>
      <legend>{label}</legend>
      {options.map(option => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={(e) => {
              const next = e.target.checked
                ? [...selected, option.value]
                : selected.filter(v => v !== option.value);
              onChange(next);
            }}
          />
          {option.label}
          <span className="count">({option.count})</span>
        </label>
      ))}
    </fieldset>
  );
}
```

### Date Range Picker

```tsx
function DateRangeFilter({ value, onChange }: Props) {
  const presets = [
    { label: 'Today', range: () => todayRange() },
    { label: 'Last 7 days', range: () => last7Days() },
    { label: 'Last 30 days', range: () => last30Days() },
    { label: 'This month', range: () => thisMonth() },
  ];

  return (
    <div className="date-range">
      <div className="presets">
        {presets.map(preset => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(preset.range())}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="custom">
        <input
          type="date"
          value={value?.start?.toISOString().split('T')[0] || ''}
          onChange={(e) => onChange({
            start: new Date(e.target.value),
            end: value?.end || new Date(),
          })}
        />
        <span>to</span>
        <input
          type="date"
          value={value?.end?.toISOString().split('T')[0] || ''}
          onChange={(e) => onChange({
            start: value?.start || new Date(),
            end: new Date(e.target.value),
          })}
        />
      </div>
    </div>
  );
}
```

## Server-Side Filtering

```typescript
// API query builder
function buildQuery(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search) {
    params.set('q', filters.search);
  }

  if (filters.dateRange) {
    params.set('start', filters.dateRange.start.toISOString());
    params.set('end', filters.dateRange.end.toISOString());
  }

  filters.categories.forEach(c => params.append('category', c));
  filters.status.forEach(s => params.append('status', s));

  params.set('sort', `${filters.sortBy}:${filters.sortOrder}`);

  return params;
}

// React Query integration
function useDashboardData(filters: FilterState) {
  return useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => fetch(`/api/data?${buildQuery(filters)}`).then(r => r.json()),
  });
}
```

## Active Filters Display

```tsx
function ActiveFilters({ filters, onClear, onClearAll }: Props) {
  const chips = useMemo(() => {
    const result = [];

    if (filters.search) {
      result.push({ key: 'search', label: `"${filters.search}"` });
    }

    filters.categories.forEach(cat => {
      result.push({ key: `cat:${cat}`, label: cat });
    });

    if (filters.dateRange) {
      result.push({
        key: 'dates',
        label: `${formatDate(filters.dateRange.start)} - ${formatDate(filters.dateRange.end)}`,
      });
    }

    return result;
  }, [filters]);

  if (chips.length === 0) return null;

  return (
    <div className="active-filters">
      {chips.map(chip => (
        <span key={chip.key} className="chip">
          {chip.label}
          <button onClick={() => onClear(chip.key)}>×</button>
        </span>
      ))}
      <button onClick={onClearAll}>Clear all</button>
    </div>
  );
}
```
