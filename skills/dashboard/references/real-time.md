# Real-Time Dashboards

## WebSocket Connection

```typescript
class DashboardWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private listeners = new Map<string, Set<(data: any) => void>>();

  connect(url: string) {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.subscribe(['metrics', 'alerts']);
    };

    this.ws.onmessage = (event) => {
      const { type, data } = JSON.parse(event.data);
      this.emit(type, data);
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };
  }

  subscribe(channels: string[]) {
    this.ws?.send(JSON.stringify({ action: 'subscribe', channels }));
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    setTimeout(() => this.connect(this.ws!.url), delay);
  }
}
```

## React Hook

```typescript
function useRealTimeData<T>(channel: string, initialData: T) {
  const [data, setData] = useState<T>(initialData);
  const wsRef = useRef<DashboardWebSocket>();

  useEffect(() => {
    const ws = new DashboardWebSocket();
    ws.connect(import.meta.env.VITE_WS_URL);

    ws.on(channel, (newData) => {
      setData(prev => mergeData(prev, newData));
    });

    wsRef.current = ws;

    return () => ws.disconnect();
  }, [channel]);

  return data;
}

// Usage
function MetricsDashboard() {
  const metrics = useRealTimeData('metrics', { cpu: 0, memory: 0 });

  return (
    <div>
      <Gauge value={metrics.cpu} label="CPU" />
      <Gauge value={metrics.memory} label="Memory" />
    </div>
  );
}
```

## Server-Sent Events (SSE)

Simpler alternative for one-way updates:

```typescript
function useSSE<T>(url: string) {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      setData(JSON.parse(event.data));
    };

    return () => eventSource.close();
  }, [url]);

  return data;
}
```

## Polling Fallback

```typescript
function usePolling<T>(
  fetcher: () => Promise<T>,
  interval: number,
  enabled = true
) {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      const result = await fetcher();
      setData(result);
    };

    poll(); // Initial fetch
    const id = setInterval(poll, interval);

    return () => clearInterval(id);
  }, [fetcher, interval, enabled]);

  return data;
}
```

## Data Buffering

For high-frequency updates:

```typescript
function useBufferedUpdates<T>(
  source: Observable<T>,
  flushInterval = 100
) {
  const [data, setData] = useState<T[]>([]);
  const bufferRef = useRef<T[]>([]);

  useEffect(() => {
    const sub = source.subscribe(item => {
      bufferRef.current.push(item);
    });

    const flush = setInterval(() => {
      if (bufferRef.current.length > 0) {
        setData(prev => [...prev.slice(-100), ...bufferRef.current]);
        bufferRef.current = [];
      }
    }, flushInterval);

    return () => {
      sub.unsubscribe();
      clearInterval(flush);
    };
  }, [source, flushInterval]);

  return data;
}
```
