export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: unknown;
  retryAfter?: number;
}
