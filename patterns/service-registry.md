# Service Registry

## Problem

A personal development hub accumulates local web services over time: the hub's own UI, project dev servers, documentation previews, tool dashboards. Without a registry, you memorize port numbers and lose track of what's actually running. Worse, none of it is reachable when you connect from another machine — a phone, a laptop on the same LAN — because the URLs say `localhost`.

The naive fix is a reverse proxy or a DNS entry per service. Both require ongoing maintenance and a process that has to stay up.

## Approach

Let each project *declare* its server as a field in the central project registry file. The hub reads those declarations on demand, pings each one for liveness, and exposes the results through a single API endpoint. For remote access, the client side rewrites `localhost` to whatever hostname the dashboard is currently served from — no proxy, no DNS, no service mesh.

Three decisions define this design:

1. **Services don't participate in their own registration.** Any HTTP server qualifies. No client library, no health endpoint, no startup hook required. The registry is purely metadata about what exists, not a runtime protocol.

2. **The project registry is the single source of truth.** The same file that records project paths and descriptions gets a `server` field. No separate database, no config file to keep in sync.

3. **Remote access is a client-side concern.** The server advertises URLs as stored; the browser rewrites them. The assumption — that everything runs on one machine — is explicit and correct for a personal hub.

## Implementation

### Data format

Each project in the registry can optionally carry a `server` field:

```json
{
  "name": "MyProject",
  "shorthand": "myproj",
  "path": "/path/to/project",
  "server": {
    "url": "http://localhost:5000",
    "label": "MyProject Dev"
  }
}
```

`label` is optional; the API falls back to the project name when it's absent. No other fields are required.

A project can have several services: a `servers` array sits beside or in place of `server`, and the hub flattens both. An entry may also carry `start` (an argv array) and `cwd` (relative to the project root), which turn a status-only entry into one the dashboard can start.

### Static sites

Not everything worth serving is a server. Built documentation, a compiled client, or a demo page is a directory of files. Rather than running a dev server per site, the hub serves registered directories itself under `/s/<slug>/`:

```json
"statics": [{ "slug": "xr2", "path": "web-ui/xr-iwsdk/dist", "label": "XR client (build)" }]
```

`path` resolves against the project root; register build-output directories rather than repo roots. Statics are always on while the hub runs, so their liveness is "the directory exists", with no ping. They inherit everything the hub already has (VPN binds, HTTPS, the per-machine fleet proxy) for free. Serving goes through the same streaming route the reader uses for documents (ETag, Range), path resolution refuses anything that escapes the directory, and dotfiles are never served. Pages must use relative URLs, because they live under a prefix rather than at a root. The feature ran in production for about four weeks with nine sites before it was committed. It was held until use had verified it, not just tests.

### Server-side: discovery and liveness

The `/api/services` endpoint reads the registry, filters for entries with a `server` field, then pings each URL in parallel before responding:

```javascript
const services = projects.filter(p => p.server).map(p => ({
  shorthand: p.shorthand,
  name: p.name,
  url: p.server.url,
  label: p.server.label || p.name,
}));

const pingPromises = services.map(svc => new Promise(resolve => {
  const mod = svc.url.startsWith('https') ? https : http;
  const req = mod.request(svc.url, { method: 'HEAD', timeout: 500 }, (resp) => {
    resolve({ ...svc, running: resp.statusCode < 500 });
  });
  req.on('error', () => resolve({ ...svc, running: false }));
  req.on('timeout', () => { req.destroy(); resolve({ ...svc, running: false }); });
  req.end();
}));

Promise.all(pingPromises).then(results => res.end(JSON.stringify(results)));
```

The liveness criterion is deliberately broad: any HTTP response with status < 500 counts as running. A 404 is fine; only server errors and connection failures mark a service offline. This avoids requiring a dedicated `/health` endpoint.

Pings fire in parallel with a 500 ms timeout. Even with a dozen services, the response arrives in under a second.

### Client-side: host rewriting

When the dashboard is accessed from another machine, `localhost` in stored URLs points to the wrong host. The fix happens entirely in the browser at render time:

```javascript
function serviceUrl(registeredUrl) {
  try {
    const u = new URL(registeredUrl);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      u.hostname = location.hostname;
    }
    return u.href;
  } catch { return registeredUrl; }
}
```

When the dashboard is at `http://192.168.1.10:3000`, `http://localhost:5000` becomes `http://192.168.1.10:5000`. The port is preserved; only the hostname changes. This works because most dev servers bind to `0.0.0.0` by default — they accept connections from any interface, not just loopback. The rewrite is applied only at link-generation time, never stored.

The UI renders a status dot (on/off) beside each service label, linking directly to the rewritten URL.

### CLI registration

A CLI tool manages registrations without touching the registry file by hand. It resolves the current working directory against known project paths:

```bash
# Register the server for the project matching the current directory
raven-ui service register --url http://localhost:5000 --label "Dev Server"

# Remove the registration
raven-ui service unregister

# List all registered services
raven-ui service list

# Show just ports (useful for firewall allowlists)
raven-ui service ports
```

The matching logic normalizes both the CWD and stored paths before comparing, and accepts any CWD that is the project root or a subdirectory of it. If no project matches, it fails with a clear error rather than silently writing to the wrong entry.

The registration itself is a JSON in-place update — the CLI reads the file, mutates the matched entry, and rewrites the whole file. That's acceptable when you're the only user and writes are rare.

## Gotchas

- **Liveness is shallow, not health.** A service that has started but not yet finished initializing — or that is serving errors — shows as running. At personal-tool scale this is fine; you know when your dev servers are misbehaving. Don't use this pattern for production-readiness checks.

- **Registrations are declarative, not ephemeral.** When a server crashes, its entry stays in the registry. The ping correctly reports it offline, but the entry doesn't vanish. This is intentional: the `server` field says "this project *has* a web server," not "this server is currently running." Clear the field explicitly with `unregister` when a project no longer runs a server.

- **Host rewriting assumes one machine.** If a registered service genuinely runs on a different host — a remote VM, a container with a separate IP — the `localhost` rewrite will produce a broken URL. The pattern only holds under the single-machine assumption. Register the actual hostname for multi-host scenarios.

- **No concurrent-write protection.** The CLI reads and rewrites the entire registry JSON. Two simultaneous `register` calls could clobber each other. Acceptable for a single-user setup; not appropriate if multiple processes might write concurrently.

- **A register command must merge, not replace.** The first CLI built a fresh `{url, label}` and assigned it over the existing entry. Re-registering a service to fix its label silently dropped a hand-added `start` command and turned a startable service into a status-only one, with no error. Now the URL is the identity, `register` merges and leaves omitted fields alone, and `unregister` refuses to guess when a project has several services, listing them instead. The same audit found that `list` and `ports` read only the single `server` field. Five of thirteen services had been invisible to the CLI all along, two of them the hub's own. When the read path supports a richer shape than the write path, the write path and the tooling around it drift toward the poorer one. Keep one writer module for the shape the reader expects.
- **A liveness probe should accept a self-signed certificate.** Dev servers on a LAN commonly serve per-machine self-signed certs. The default TLS check rejected them, so every HTTPS service read as permanently down, and the dashboard's start action took its slow-starter branch for servers that had come up fine. The probe asks only whether anything answers on the port, and nothing else trusts its answer, so skipping certificate verification there is correct. Say so in a comment, so nobody later reads it as a general TLS opt-out.
