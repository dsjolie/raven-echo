# Offline-First Model Serving: Cached Weights, Dead Server

## Problem

A self-hosted image-generation server with **fully cached weights** started returning instant 500s on every cold load. Nothing about the model, the disk, or the code had changed. The cause was an expired hub-auth OAuth token: the model-loading library's cold-load path makes an online HEAD probe against the model repo before touching the local cache, and for a *gated* repo an expired token turns that probe into a 401 — which the library surfaces as `RepositoryNotFoundError`. The single-file fallback path didn't catch that exception class, so a server with every byte it needed sitting on local disk refused to serve, because a remote server said a repo "didn't exist."

The failure is nasty precisely because it's invisible in every review: the serving path *looks* local. The network dependency was accidental — a validation probe, not a data fetch — and it only bites when a token quietly ages out, potentially months after the last deploy.

## Fix

Serve offline-first. Set the hub-offline switch (`HF_HUB_OFFLINE=1` for the Hugging Face stack) in the server's environment so the loading path never touches the network — cached weights load unconditionally. Unset it (and refresh the token) only in the explicit, attended workflow that downloads new weights.

```
# service environment — serving never validates online
HF_HUB_OFFLINE=1

# weight updates are a separate, deliberate act:
#   refresh auth token → unset offline flag → pull weights → re-set flag
```

## Why

The general rule: **local serving must not depend on network validation.** Any "load from cache, with online check/fallback" path has its polarity backwards for a server — the online step is the fragile one, and auth expiry, DNS trouble, or an upstream outage converts a healthy local service into a dead one. Cache-first-validate-online is a fine default for a developer workstation (freshness matters, a human is present); for an unattended service the default must invert: offline is the path, online is the exception you opt into.

Worth auditing for the same shape elsewhere: license-check phone-homes, telemetry that blocks startup, "update check" on boot, package managers invoked at service start. Each is an accidental availability dependency on somebody else's server — and on the freshness of your own credentials.
