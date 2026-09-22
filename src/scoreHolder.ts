import type {
  IHistory,
  INotification,
  IScoreHolder,
  ISubscription,
} from './interfaces/scoreHolder';
import type { ScoreListener, Unsubscribe } from './types/scoreHolder';

/**
 * Stores opaque score strings for multiple matches within one JavaScript process.
 * Each publication counts as an update, including repeated score values.
 */
export default class ScoreHolder implements IScoreHolder {
  private isNotifying = false;
  private readonly histories = new Map<string, IHistory>();
  private readonly historyLimit: number;
  private firstNotification: INotification | undefined;
  private lastNotification: INotification | undefined;
  private readonly subscribers = new Map<string, Set<ISubscription>>();
  private readonly waiters = new Map<string, Set<(score: string) => void>>();

  /**
   * @param historyLimit Maximum retained scores per match, allocated as updates arrive.
   * @throws {RangeError} If the limit is not a positive safe integer.
   */
  constructor(historyLimit = 10) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
      throw new RangeError('History limit must be a positive safe integer');
    }

    this.historyLimit = historyLimit;
  }

  /** Returns the latest stored score, or undefined if the match has no updates. */
  getScore(match: string): string | undefined {
    const history = this.histories.get(match);
    if (!history) {
      return undefined;
    }

    const index = history.nextIndex === 0 ? history.scores.length - 1 : history.nextIndex - 1;
    return history.scores[index];
  }

  /**
   * Stores an update, settles current waits, then delivers synchronous notifications.
   * Nested publications store immediately and queue their notifications in write order.
   * A callback should use its score argument; getScore may already reflect a nested write.
   * @throws {AggregateError} After the outermost delivery finishes if listeners threw.
   * Stored scores are retained even when notification delivery reports errors.
   */
  putScore(match: string, score: string): void {
    this.recordScore(match, score);
    this.resolveWaiters(match, score);
    this.enqueueNotifications(match, score);
    this.flushNotifications();
  }

  /** Returns an independent array, oldest first, or an empty array for an unknown match. */
  getHistory(match: string): string[] {
    const history = this.histories.get(match);
    if (!history) {
      return [];
    }

    // Rotate physical slots into chronological order. Before full, the first slice is empty.
    const { scores, nextIndex } = history;
    return scores.slice(nextIndex).concat(scores.slice(0, nextIndex));
  }

  /**
   * Waits for the first subsequent publication, without replaying or buffering old updates.
   * @param signal Optional cancellation, for example when a waiting request disconnects.
   * @returns A promise that resolves to the next score or rejects with the abort reason.
   */
  waitForNextScore(match: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    return new Promise<string>((resolve, reject) => {
      const matchWaiters = this.waiters.get(match) ?? new Set<(score: string) => void>();
      let removeAbortListener: (() => void) | undefined;

      const complete = (score: string): void => {
        removeAbortListener?.();

        // An earlier abort handler can publish before our own abort handler gets its turn.
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }

        resolve(score);
      };

      matchWaiters.add(complete);
      this.waiters.set(match, matchWaiters);

      if (signal) {
        const abort = (): void => {
          matchWaiters.delete(complete);

          if (matchWaiters.size === 0) {
            this.waiters.delete(match);
          }

          reject(signal.reason);
        };

        signal.addEventListener('abort', abort, { once: true });
        removeAbortListener = () => {
          signal.removeEventListener('abort', abort);
        };
      }
    });
  }

  /**
   * Registers a synchronous listener for future publications only.
   * @returns An idempotent cancellation function that also skips queued deliveries.
   * Each registration is independent, including registrations of the same callback.
   */
  subscribe(match: string, onScore: ScoreListener): Unsubscribe {
    const matchSubscribers = this.subscribers.get(match) ?? new Set<ISubscription>();
    const subscription: ISubscription = { listener: onScore, active: true };

    matchSubscribers.add(subscription);
    this.subscribers.set(match, matchSubscribers);

    return () => {
      if (!matchSubscribers.delete(subscription)) {
        return;
      }

      subscription.active = false;
      if (matchSubscribers.size === 0) {
        this.subscribers.delete(match);
      }
    };
  }

  private recordScore(match: string, score: string): void {
    let history = this.histories.get(match);
    if (!history) {
      history = { scores: [], nextIndex: 0 };
      this.histories.set(match, history);
    }

    // Overwrite the oldest slot after filling, avoiding an array shift on every update.
    history.scores[history.nextIndex] = score;
    history.nextIndex = (history.nextIndex + 1) % this.historyLimit;
  }

  private resolveWaiters(match: string, score: string): void {
    const matchWaiters = this.waiters.get(match);

    if (matchWaiters) {
      // Detach this publication's waiters before any later wait can be registered.
      this.waiters.delete(match);

      for (const resolve of matchWaiters) {
        resolve(score);
      }
    }
  }

  private enqueueNotifications(match: string, score: string): void {
    const matchSubscribers = this.subscribers.get(match);

    if (!matchSubscribers) {
      return;
    }

    // Snapshot recipients now so subscriptions added during delivery only see future writes.
    const notification: INotification = { score, subscriptions: [...matchSubscribers] };
    if (this.lastNotification) {
      this.lastNotification.next = notification;
    } else {
      this.firstNotification = notification;
    }
    this.lastNotification = notification;
  }

  private flushNotifications(): void {
    if (this.isNotifying || !this.firstNotification) {
      return;
    }

    // Nested putScore calls append work for this loop instead of recursively notifying.
    this.isNotifying = true;
    let notificationErrors: unknown[] | undefined;

    try {
      while (this.firstNotification) {
        const notification: INotification = this.firstNotification;
        // Release completed batches as we go, including during long reentrant update chains.
        this.firstNotification = notification.next;
        if (!this.firstNotification) {
          this.lastNotification = undefined;
        }

        for (const { active, listener } of notification.subscriptions) {
          if (!active) {
            continue;
          }

          try {
            listener(notification.score);
          } catch (error) {
            notificationErrors ??= [];
            notificationErrors.push(error);
          }
        }
      }
    } finally {
      this.firstNotification = undefined;
      this.lastNotification = undefined;
      this.isNotifying = false;
    }

    // Report failures only after healthy listeners and all queued updates have run.
    if (notificationErrors) {
      throw new AggregateError(
        notificationErrors,
        'Scores stored, but subscriber notifications failed',
      );
    }
  }
}
