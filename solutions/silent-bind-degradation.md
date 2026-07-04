# Silent Degradation on Multi-Address Bind

## Problem

A server binds several addresses: loopback (always) plus the machine's VPN address, so other machines on a private fleet can reach it. The secondary binds were "best-effort" by design — a bind error logs once and the server carries on, because loopback still works and the VPN address may legitimately be unavailable (VPN down, IP changed).

A restart exposes the flaw in that design. The dying server hasn't fully released the VPN port when its replacement starts; the new bind hits `EADDRINUSE`, logs once to a console nobody is watching, and the server runs loopback-only. The port frees moments later — but nothing retries. The result is a server that answers on localhost and is dead to every other machine, a state indistinguishable from a remote client's point of view from the server being down entirely. The failure is invisible exactly where it matters.

## Fix

Three changes, one per layer of the problem:

**1. Retry `EADDRINUSE` on secondary binds.** The restart race is transient by nature — the old process is exiting — so the listener retries every couple of seconds for ~30 seconds and comes up the moment the port frees:

```js
function bindExtra(srv, scheme, port, host, attempt = 1) {
  const MAX_ATTEMPTS = 15, RETRY_MS = 2000;
  const onError = (e) => {
    srv.removeListener('listening', onListening);
    if (e.code === 'EADDRINUSE' && attempt < MAX_ATTEMPTS) {
      console.warn(`${host}:${port} busy — retry ${attempt}/${MAX_ATTEMPTS} ` +
        `(previous server likely still shutting down)`);
      setTimeout(() => bindExtra(srv, scheme, port, host, attempt + 1), RETRY_MS);
    } else {
      console.error(`cannot bind ${host}:${port} — ${e.code}; ` +
        `unreachable on this address (gave up after ${attempt} attempts)`);
    }
  };
  const onListening = () => {
    srv.removeListener('error', onError);
    console.log(`also listening at ${scheme}://${host}:${port}`);
  };
  srv.once('error', onError);
  srv.once('listening', onListening);
  srv.listen(port, host);
}
```

**2. Release secondary listeners explicitly on restart.** The restart handler closes the extra listeners before `process.exit()`, so the port is free the instant the replacement binds. The retry on the new side and the clean teardown on the old side are both needed — either alone leaves a window.

**3. Log the degraded state loudly.** Warn-level messages on every retry, error-level on giving up. A loopback-only state should never again be something you discover by noticing your phone can't connect.

And the deliberate counterpart: the **primary loopback bind has no error handler at all**. If loopback can't bind, the server is useless — it should crash loudly at startup, not limp on.

## Why

The failure modes are not symmetric, and the handling shouldn't be either:

| Failure | Nature | Handling |
|---|---|---|
| `EADDRINUSE` on secondary | Understood, transient (restart race) | Retry until it clears |
| VPN down / IP gone on secondary | Understood, persistent environment state | Log loudly, don't retry |
| Loopback bind failure | Not understood, should never happen | Crash |

The original code treated all three the same way — log once, keep going — which is the classic shape of a fallback added for surprises rather than for understood failures. "Graceful degradation" earns its name only when the degraded state is loud and, where the failure is transient, self-healing. Otherwise it's just silent failure with better branding.

The general rule: retry exactly the failure you understand, surface the ones you don't, and let the truly fatal ones be fatal.

## Cross-references

- [process-lifecycle.md](process-lifecycle.md) — the other half of restart hygiene: making sure the PID you stop is the PID that owns the port
