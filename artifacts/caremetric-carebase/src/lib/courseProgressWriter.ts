/**
 * Serialize one mounted assignment's snapshots: the server keeps the progress cursor monotonic,
 * but learning_tools is replaced wholesale, so an older request must not finish after a newer one.
 * Completion closes the queue synchronously, drains older saves, persists the final snapshot, and
 * only then calls the completion RPC that checks and locks that evidence.
 */
export function createCourseProgressWriter() {
  let tail: Promise<void> = Promise.resolve();
  let completion: Promise<void> | null = null;
  let closed = false;

  return {
    isClosed: () => closed,
    confirmCompleted() {
      // A fresh authoritative read can prove that completion committed even when its response
      // was lost. Keep later timer snapshots out of the now-immutable evidence row.
      closed = true;
      completion = Promise.resolve();
    },
    checkpoint(write: () => Promise<unknown>): Promise<void> {
      // A timer scheduled before the completion click may still fire. Its snapshot is superseded
      // by the final save, and must not run after the server has locked the completed assignment.
      if (closed) return Promise.resolve();
      const pending = tail.then(write).then(() => undefined);
      // A transient failed save is reported to its caller without poisoning later checkpoints.
      tail = pending.catch(() => undefined);
      return pending;
    },
    complete(saveLatest: () => Promise<unknown>, finish: () => Promise<unknown>): Promise<void> {
      if (completion) return completion;
      closed = true;
      const pending = tail.then(saveLatest).then(finish).then(() => undefined);
      completion = pending;
      tail = pending.catch(() => undefined);
      void pending.catch(() => {
        // Neither a failed final save nor a rejected completion may strand the learner. The next
        // attempt saves a fresh snapshot; a successful completion keeps the writer closed.
        closed = false;
        completion = null;
      });
      return pending;
    },
  };
}
