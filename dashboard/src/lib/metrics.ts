// =============================================================================
// Prometheus-Compatible Metrics Collector
// =============================================================================
// Supports Counter, Histogram, and Gauge metric types with label dimensions.
// Renders metrics in Prometheus text exposition format (version 0.0.4).
// No external dependencies — pure in-memory storage.
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetricMeta {
  type: 'counter' | 'histogram' | 'gauge';
  help: string;
  buckets?: number[];
}

interface CounterEntry {
  labels: Record<string, string>;
  value: number;
}

interface HistogramEntry {
  labels: Record<string, string>;
  values: number[];
  sum: number;
}

interface GaugeEntry {
  labels: Record<string, string>;
  value: number;
}

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

const registry = new Map<string, MetricMeta>();
const counterStore = new Map<string, Map<string, CounterEntry>>();
const histogramStore = new Map<string, Map<string, HistogramEntry>>();
const gaugeStore = new Map<string, Map<string, GaugeEntry>>();

// ---------------------------------------------------------------------------
// Pre-defined metric metadata
// ---------------------------------------------------------------------------

const predefinedMetrics: Record<
  string,
  { type: 'counter' | 'histogram' | 'gauge'; help: string; buckets?: number[] }
> = {
  http_requests_total: {
    type: 'counter',
    help: 'Total HTTP requests',
  },
  http_request_duration_seconds: {
    type: 'histogram',
    help: 'HTTP request duration in seconds',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
  active_users_total: {
    type: 'gauge',
    help: 'Total active users',
  },
  transactions_total: {
    type: 'counter',
    help: 'Total transactions',
  },
  payroll_jobs_total: {
    type: 'counter',
    help: 'Total payroll jobs',
  },
  wallet_balance_aed: {
    type: 'gauge',
    help: 'Wallet balance in AED',
  },
  queue_size: {
    type: 'gauge',
    help: 'Current queue size',
  },
  errors_total: {
    type: 'counter',
    help: 'Total errors',
  },
};

// Register all pre-defined metrics on module load
for (const [name, meta] of Object.entries(predefinedMetrics)) {
  registerMetric(name, meta.type, meta.help, meta.buckets);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialise a label set into a deterministic map key */
function labelKey(labels: Record<string, string> = {}): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

/** Register a metric in the registry (no-op if already registered) */
function registerMetric(
  name: string,
  type: 'counter' | 'histogram' | 'gauge',
  help: string,
  buckets?: number[],
): void {
  if (!registry.has(name)) {
    registry.set(name, { type, help, buckets });
  }
}

/** Return the help text for a known metric, or fall back to the name */
function resolveHelp(name: string): string {
  return predefinedMetrics[name]?.help ?? name;
}

/** Return the bucket boundaries for a known histogram, or undefined */
function resolveBuckets(name: string): number[] | undefined {
  return predefinedMetrics[name]?.buckets;
}

/** Compute an approximate percentile from a sorted array using linear interpolation */
function percentile(sortedValues: number[], p: number): number {
  const len = sortedValues.length;
  if (len === 0) return 0;

  const index = (p / 100) * (len - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper || upper >= len) return sortedValues[lower];

  const fraction = index - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * fraction;
}

/** Get (or create) the inner label-map for a counter */
function getCounterMap(name: string): Map<string, CounterEntry> {
  let m = counterStore.get(name);
  if (!m) {
    m = new Map();
    counterStore.set(name, m);
  }
  return m;
}

/** Get (or create) the inner label-map for a histogram */
function getHistogramMap(name: string): Map<string, HistogramEntry> {
  let m = histogramStore.get(name);
  if (!m) {
    m = new Map();
    histogramStore.set(name, m);
  }
  return m;
}

/** Get (or create) the inner label-map for a gauge */
function getGaugeMap(name: string): Map<string, GaugeEntry> {
  let m = gaugeStore.get(name);
  if (!m) {
    m = new Map();
    gaugeStore.set(name, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

/**
 * Increment (or create) a counter by a given value (default 1).
 *
 * @example
 * incrementCounter('http_requests_total', { method: 'GET', route: '/api/health', status: '200' });
 * incrementCounter('errors_total', { source: 'auth', error_type: 'validation' }, 1);
 */
export function incrementCounter(
  name: string,
  labels?: Record<string, string>,
  value: number = 1,
): void {
  registerMetric(name, 'counter', resolveHelp(name));

  const map = getCounterMap(name);
  const key = labelKey(labels);

  const existing = map.get(key);
  if (existing) {
    existing.value += value;
  } else {
    map.set(key, { labels: { ...labels }, value });
  }
}

/**
 * Return all label-value entries for a counter.
 */
export function getCounter(
  name: string,
): { value: number; labels: Record<string, string> }[] {
  const map = counterStore.get(name);
  if (!map) return [];
  return Array.from(map.values()).map((e) => ({ value: e.value, labels: e.labels }));
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

/**
 * Record a single observation into a histogram.
 *
 * @example
 * recordHistogram('http_request_duration_seconds', 0.042, { method: 'GET', route: '/api/users' });
 */
export function recordHistogram(
  name: string,
  value: number,
  labels?: Record<string, string>,
): void {
  registerMetric(name, 'histogram', resolveHelp(name), resolveBuckets(name));

  const map = getHistogramMap(name);
  const key = labelKey(labels);

  const existing = map.get(key);
  if (existing) {
    existing.values.push(value);
    existing.sum += value;
  } else {
    map.set(key, { labels: { ...labels }, values: [value], sum: value });
  }
}

/**
 * Return aggregated histogram statistics across all label sets.
 *
 * Buckets are cumulative counts keyed by the upper-bound string (e.g. "0.1").
 * A special "+Inf" key contains the total count.
 */
export function getHistogram(
  name: string,
): {
  count: number;
  sum: number;
  buckets: Record<string, number>;
  p50: number;
  p95: number;
  p99: number;
} {
  const map = histogramStore.get(name);
  const empty = { count: 0, sum: 0, buckets: {}, p50: 0, p95: 0, p99: 0 };
  if (!map) return empty;

  const meta = registry.get(name);
  const bucketBoundaries = meta?.buckets ?? [];

  // Aggregate all observations across every label-set
  const allValues: number[] = [];
  let totalSum = 0;

  for (const entry of map.values()) {
    allValues.push(...entry.values);
    totalSum += entry.sum;
  }

  if (allValues.length === 0) {
    return {
      count: 0,
      sum: 0,
      buckets: Object.fromEntries(
        bucketBoundaries.map((b) => [b.toString(), 0]).concat([['+Inf', 0]]),
      ),
      p50: 0,
      p95: 0,
      p99: 0,
    };
  }

  const sorted = [...allValues].sort((a, b) => a - b);
  const total = sorted.length;

  // Compute cumulative bucket counts
  const bucketCounts: Record<string, number> = {};
  for (const boundary of bucketBoundaries) {
    // Two-pointer style: count observations ≤ boundary
    bucketCounts[boundary.toString()] = sorted.filter(
      (v) => v <= boundary,
    ).length;
  }
  bucketCounts['+Inf'] = total;

  return {
    count: total,
    sum: totalSum,
    buckets: bucketCounts,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/**
 * Set a gauge to an absolute value.
 *
 * @example
 * setGauge('active_users_total', 128);
 * setGauge('queue_size', 42, { queue_name: 'email' });
 */
export function setGauge(
  name: string,
  value: number,
  labels?: Record<string, string>,
): void {
  registerMetric(name, 'gauge', resolveHelp(name));

  const map = getGaugeMap(name);
  const key = labelKey(labels);
  map.set(key, { labels: { ...labels }, value });
}

/**
 * Increment (or create) a gauge by a given value (default 1).
 *
 * @example
 * incrementGauge('active_users_total', undefined, 1);
 */
export function incrementGauge(
  name: string,
  labels?: Record<string, string>,
  value: number = 1,
): void {
  registerMetric(name, 'gauge', resolveHelp(name));

  const map = getGaugeMap(name);
  const key = labelKey(labels);

  const existing = map.get(key);
  if (existing) {
    existing.value += value;
  } else {
    map.set(key, { labels: { ...labels }, value });
  }
}

/**
 * Return the gauge value for the unlabelled entry.
 * Returns 0 if the metric or unlabelled entry does not exist.
 */
export function getGauge(name: string): number {
  const map = gaugeStore.get(name);
  if (!map) return 0;
  const key = labelKey({});
  return map.get(key)?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Convenience: trackRequest
// ---------------------------------------------------------------------------

/**
 * Record a single HTTP request — increments `http_requests_total` and records
 * the duration into `http_request_duration_seconds` in one call.
 *
 * @param method  HTTP method (e.g. "GET")
 * @param route   Normalised route (e.g. "/api/users")
 * @param status  HTTP status code (e.g. 200)
 * @param durationMs  Request duration in **milliseconds** (converted to seconds internally)
 */
export function trackRequest(
  method: string,
  route: string,
  status: number,
  durationMs: number,
): void {
  incrementCounter('http_requests_total', {
    method,
    route,
    status: String(status),
  });
  recordHistogram(
    'http_request_duration_seconds',
    durationMs / 1000,
    { method, route },
  );
}

// ---------------------------------------------------------------------------
// Render — Prometheus text exposition format
// ---------------------------------------------------------------------------

/** Render a single metric line with optional labels */
function renderLine(
  name: string,
  labels: Record<string, string>,
  value: number,
): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return `${name} ${value}`;
  const labelStr = entries.map(([k, v]) => `${k}="${v}"`).join(',');
  return `${name}{${labelStr}} ${value}`;
}

/**
 * Render **all** registered metrics in Prometheus text format.
 *
 * Output example:
 * ```
 * # HELP http_requests_total Total HTTP requests
 * # TYPE http_requests_total counter
 * http_requests_total{method="GET",route="/api/wallet",status="200"} 42
 * # HELP http_request_duration_seconds HTTP request duration in seconds
 * # TYPE http_request_duration_seconds histogram
 * http_request_duration_seconds_bucket{le="0.005",method="GET",route="/api/wallet"} 0
 * ...
 * http_request_duration_seconds_bucket{le="+Inf",method="GET",route="/api/wallet"} 42
 * http_request_duration_seconds_count{method="GET",route="/api/wallet"} 42
 * http_request_duration_seconds_sum{method="GET",route="/api/wallet"} 3.14
 * ```
 */
export function renderMetrics(): string {
  const lines: string[] = [];

  for (const [name, meta] of registry) {
    lines.push(`# HELP ${name} ${meta.help}`);
    lines.push(`# TYPE ${name} ${meta.type}`);

    if (meta.type === 'counter') {
      const map = counterStore.get(name);
      if (map) {
        for (const entry of map.values()) {
          lines.push(renderLine(name, entry.labels, entry.value));
        }
      }
    } else if (meta.type === 'gauge') {
      const map = gaugeStore.get(name);
      if (map) {
        for (const entry of map.values()) {
          lines.push(renderLine(name, entry.labels, entry.value));
        }
      }
    } else if (meta.type === 'histogram') {
      const map = histogramStore.get(name);
      if (map) {
        const bucketBoundaries = meta.buckets ?? [];
        for (const entry of map.values()) {
          const sorted = [...entry.values].sort((a, b) => a - b);
          let cumulative = 0;

          for (const boundary of bucketBoundaries) {
            while (cumulative < sorted.length && sorted[cumulative] <= boundary) {
              cumulative++;
            }
            lines.push(
              renderLine(
                `${name}_bucket`,
                { ...entry.labels, le: boundary.toString() },
                cumulative,
              ),
            );
          }

          // +Inf bucket — all observations
          lines.push(
            renderLine(
              `${name}_bucket`,
              { ...entry.labels, le: '+Inf' },
              entry.values.length,
            ),
          );

          lines.push(
            renderLine(`${name}_count`, entry.labels, entry.values.length),
          );
          lines.push(renderLine(`${name}_sum`, entry.labels, entry.sum));
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}
