---
name: dashboard
description: Data dashboard development patterns including charts, real-time updates, filtering, and responsive layouts. Use when building analytics dashboards, monitoring UIs, or data visualization interfaces.
---

# Dashboard Development

Comprehensive patterns for building data dashboards with charts, real-time updates, and filtering.

## Topics

This skill includes reference documentation for three core dashboard concerns:

| Topic | Reference | Use When |
|-------|-----------|----------|
| Charts | `references/charts.md` | Data visualization with D3, Recharts, or Chart.js |
| Real-time | `references/real-time.md` | WebSocket connections, live data streaming |
| Filtering | `references/filtering.md` | Search, faceted filters, query builders |

## When to Load References

- **Building visualizations?** Read `references/charts.md` for D3/Recharts patterns
- **Need live updates?** Read `references/real-time.md` for WebSocket setup
- **Adding search/filters?** Read `references/filtering.md` for filter UI patterns

## Architecture Overview

```
Dashboard
├── DataLayer (fetching, caching, transforms)
├── ChartComponents (reusable visualizations)
├── FilterPanel (search, facets, date ranges)
├── Layout (responsive grid, drag-and-drop)
└── RealTimeManager (WebSocket, polling fallback)
```

## Data Flow Pattern

```
API/WebSocket → DataStore → Transform → Charts
                    ↑
              Filters/Queries
```

## Key Patterns

### Responsive Layout
- Use CSS Grid for dashboard tiles
- Implement breakpoint-based chart simplification
- Consider virtualization for large data tables

### State Management
- Centralize filter state (URL params or store)
- Debounce filter changes before API calls
- Cache transformed data, not raw responses

### Performance
- Virtualize large tables (react-window, tanstack-virtual)
- Use canvas for 10k+ data points
- Implement chart-level loading states

## Common Combinations

| Dashboard Type | Topics to Load |
|----------------|----------------|
| Analytics dashboard | charts + filtering |
| Live monitoring | charts + real-time |
| Full-featured admin | All three topics |

## Related Skills

- `d3js-visualization` — Deep D3.js patterns
- `form-react` or `form-vanilla` — Filter form implementation
