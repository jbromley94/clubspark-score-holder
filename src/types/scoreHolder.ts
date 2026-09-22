/** Synchronous callback. The undefined return type prevents accepting async listeners. */
export type ScoreListener = (score: string) => undefined;

/** Cancels one subscription; calling it again has no effect. */
export type Unsubscribe = () => void;
