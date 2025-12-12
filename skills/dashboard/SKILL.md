# Dashboard Router

Routes to specialized sub-skills for data dashboard development.

## Sub-Skills

| Sub-Skill | Use When |
|-----------|----------|
| **charts** | Data visualization with D3, Recharts, or Chart.js |
| **real-time** | WebSocket connections, live data streaming |
| **filtering** | Search, faceted filters, query builders |

## Architecture Overview

```
Dashboard
├── DataLayer (fetching, caching, transforms)
├── ChartComponents (reusable visualizations)
├── FilterPanel (search, facets, date ranges)
├── Layout (responsive grid, drag-and-drop)
└── RealTimeManager (WebSocket, polling fallback)
```

## Key Patterns

### Data Flow
```
API/WebSocket → DataStore → Transform → Charts
                    ↑
              Filters/Queries
```

### Responsive Layout
- Use CSS Grid for dashboard tiles
- Implement breakpoint-based chart simplification
- Consider virtualization for large data tables

## Common Combinations

- **Analytics dashboard**: `charts` + `filtering`
- **Live monitoring**: `charts` + `real-time`
- **Full-featured**: All sub-skills
