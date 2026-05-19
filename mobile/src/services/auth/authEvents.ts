type Listener = () => void;

/**
 * Tiny event bus for auth-level signals (token refresh failures →
 * `FORCE_LOGOUT`). Lives in its own module to avoid the circular import
 * chain `client → useAuth → tokenManager → client`.
 */
class AuthEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: 'FORCE_LOGOUT', cb: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  emit(event: 'FORCE_LOGOUT'): void {
    this.listeners.get(event)?.forEach((cb) => cb());
  }
}

export const authEmitter = new AuthEmitter();
