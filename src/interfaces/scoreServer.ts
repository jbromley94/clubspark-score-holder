/** Server-owned timings. Query parameters cannot extend a client's waiting period. */
export interface IScoreServerOptions {
  /** Maximum duration of a one-shot HTTP wait; defaults to 30 seconds. */
  readonly waitTimeoutMs?: number;
  /** SSE keepalive comment interval; defaults to 15 seconds. */
  readonly heartbeatIntervalMs?: number;
}
