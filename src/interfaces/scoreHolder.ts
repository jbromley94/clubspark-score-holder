import type { ScoreListener, Unsubscribe } from '../types/scoreHolder';

/** Public contract used by adapters without exposing storage or notification internals. */
export interface IScoreHolder {
  /** Returns the latest score, or undefined for an unknown match. */
  getScore(match: string): string | undefined;
  /**
   * Records every publication, including repeated values.
   * An AggregateError means the score was stored but synchronous listeners failed.
   */
  putScore(match: string, score: string): void;
  /** Returns an independent history snapshot, oldest first. */
  getHistory(match: string): string[];
  /** Waits for the first future publication, rejecting with the optional signal's abort reason. */
  waitForNextScore(match: string, signal?: AbortSignal): Promise<string>;
  /** Registers a synchronous listener and returns an idempotent cancellation function. */
  subscribe(match: string, listener: ScoreListener): Unsubscribe;
}

/** Internal ring buffer. Scores stay in physical slot order until read as history. */
export interface IHistory {
  readonly scores: string[];
  /** Next slot to write; also the oldest slot once the buffer is full. */
  nextIndex: number;
}

/** One registration, so subscribing the same callback twice remains independent. */
export interface ISubscription {
  readonly listener: ScoreListener;
  /** Queued notifications check this flag so cancellation takes effect immediately. */
  active: boolean;
}

/** One published update and its recipients, linked in publication order. */
export interface INotification {
  readonly score: string;
  /** Membership is fixed at publication; individual registrations can become inactive. */
  readonly subscriptions: readonly ISubscription[];
  next?: INotification;
}
