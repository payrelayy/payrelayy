/** Keep a single PostgreSQL Client's catalog checks and operations on one lane. */
export function createSerializedPostgresLane() {
  let tail: Promise<void> = Promise.resolve();

  return Object.freeze({
    run<Result>(operation: () => Promise<Result>): Promise<Result> {
      const result = tail.then(operation);
      // A failed operation must not poison the lane or strand later callers.
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    drain(): Promise<void> {
      return tail;
    },
  });
}
