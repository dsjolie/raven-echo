# Hot Reload That Ignores Atomic Writes

## Symptom

A server hot-reloads a config file (here, the scheduler's job list) with `fs.watch`. A job added through an agent's file-editing tool never fires. There is no error, no log line, and no routing miss, because as far as the server knows the job does not exist. The same edit made with `fs.writeFileSync` fires on schedule. A job *removed* through the editing tool stays registered and keeps firing.

## Cause

The watcher only acts on one event type:

```javascript
fs.watch(JOBS_FILE, { persistent: false }, (eventType) => {
  if (eventType === 'change') setTimeout(loadJobs, 200);
});
```

An in-place write (open, truncate, write) produces `change`. Most editors and agent editing tools do not write in place. They write a temp file and rename it over the target, so a crash cannot leave a half-written file. A rename surfaces as `rename`, not `change`, and the filter throws it away. Depending on the platform, the watch can also stay attached to the file that was replaced, so later events are lost too.

The original comment on the debounce said it guarded against "editors that write in two stages (truncate then write)". That covers the in-place case and never mentions the atomic one, which is the more common case for modern tools.

## Fix

Any of these works. Pick by how much the reload has to be trusted.

1. **Watch the directory, filter by filename, accept both event types.** A directory watch survives the target being replaced, and a debounced reload that reads the file contents is indifferent to how the bytes got there.

   ```javascript
   fs.watch(path.dirname(JOBS_FILE), (eventType, filename) => {
     if (filename === path.basename(JOBS_FILE)) debounce(loadJobs, 200);
   });
   ```

2. **Poll with `fs.watchFile`.** A stat-based watcher compares mtime and size on an interval. It is slower and does not care about event semantics.
3. **Make the reload observable.** Log every reload with the job count and names. A job that "never fires" can then be told apart from a job that was never registered in one glance.

Raven has not changed the code yet. It currently relies on a convention, "edit the jobs file in place, with a `writeFileSync` one-liner, never with an editor tool". That convention is written into the agent's memory index. It works, and it is the weak kind of fix: it depends on every future session remembering it.

## Why it is worth writing down

The failure is silent in both directions, and the two directions have different costs. A missed add means a job that never runs, which someone eventually notices. A missed *removal* means a job that keeps running after everyone believes it is gone, which is harder to notice and can be worse.

The diagnostic tell is specific: **a scheduled job that never fires and never logs a routing miss was never registered.** A registered job that fails to deliver leaves a trace. An unregistered one leaves nothing.

## Related

- [patterns/scheduler.md](../patterns/scheduler.md) — the scheduler this watcher reloads.
- [patterns/instrument-trust.md](../patterns/instrument-trust.md) — the general family: a check that didn't run looks like one that passed.
