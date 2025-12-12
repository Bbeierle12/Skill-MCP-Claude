# Dashboard Charts

## Recharts (React)

### Basic Line Chart

```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function RevenueChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="revenue" stroke="#8884d8" />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### Multi-Series Bar Chart

```tsx
import { BarChart, Bar, Legend } from 'recharts';

function ComparisonChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="thisYear" fill="#8884d8" name="2024" />
        <Bar dataKey="lastYear" fill="#82ca9d" name="2023" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

## D3.js Patterns

### Reusable Chart Pattern

```typescript
function createLineChart() {
  let width = 600;
  let height = 400;
  let margin = { top: 20, right: 20, bottom: 30, left: 50 };

  function chart(selection) {
    selection.each(function(data) {
      const svg = d3.select(this)
        .selectAll('svg')
        .data([data])
        .join('svg')
        .attr('width', width)
        .attr('height', height);

      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;

      const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.date))
        .range([0, innerWidth]);

      const y = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value)])
        .range([innerHeight, 0]);

      const line = d3.line()
        .x(d => x(d.date))
        .y(d => y(d.value));

      const g = svg.selectAll('.chart-group')
        .data([null])
        .join('g')
        .attr('class', 'chart-group')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      g.selectAll('.line')
        .data([data])
        .join('path')
        .attr('class', 'line')
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', 'steelblue');
    });
  }

  // Getter/setters for configuration
  chart.width = function(_) {
    return arguments.length ? (width = _, chart) : width;
  };

  return chart;
}
```

## Chart.js

```typescript
import { Chart } from 'chart.js/auto';

const ctx = document.getElementById('myChart');
new Chart(ctx, {
  type: 'doughnut',
  data: {
    labels: ['Red', 'Blue', 'Yellow'],
    datasets: [{
      data: [300, 50, 100],
      backgroundColor: ['#ff6384', '#36a2eb', '#ffce56'],
    }]
  },
  options: {
    responsive: true,
    plugins: {
      legend: { position: 'bottom' }
    }
  }
});
```

## Performance Tips

- Use `useMemo` for data transformations
- Implement windowing for large datasets
- Debounce resize handlers
- Use canvas-based charts for 10k+ points
