export interface ApiSuccess<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: Array<{ field: string; message: string }>;
  statusCode: number;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
