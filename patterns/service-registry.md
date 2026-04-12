# Service Registry

## Problem

A personal development environment runs multiple web services — the main workspace UI, project-specific dev servers, documentation previews. Each lives on a different port. Without a registry, you're memorizing port numbers, and none of them are accessible when you connect from another machine (a phone, a laptop on the same network).

## Approach

Declarative registration in a central config file, on-demand liveness pinging, and client-side host rewriting for remote access. No service mesh, no heartbeats, no registration protocol — services don't need to know the registry exists.

The design priorities are:

1. **Zero overhead for services.** Any HTTP server can be registered. It doesn't need a health endpoint, a registration call, or a client library.
2. **Single source of truth.** The same project config file that tracks paths and metadata gets a `server` field. No separate database.
3. **Remote access for free.** When the dashboard is accessed from another machine, `localhost` URLs are rewritten to the current browser's hostname automatically.

## Implementation

### Data format

Each project in the central config can optionally include a `server` field:

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

The `label` is optional — falls back to the project name.

### Discovery endpoint

A REST endpoint reads the config, filters for projects with servers, and pings each one:

```javascript
// HEAD request, 500ms timeout, parallel
const services = projects.filter(p => p.server).map(async p => ({
  shorthand: p.shorthand,
  name: p.name,
  url: p.server.url,
  label: p.server.label || p.name,
  running: await ping(p.server.url)  // status < 500 = alive
}));
```

The liveness check is intentionally loose — a HEAD request with a short timeout. Any HTTP response (even a 404) counts as alive. This avoids requiring health check endpoints.

### Host rewriting

The key trick for remote access happens entirely in the browser:

```javascript
function serviceUrl(registeredUrl) {
  const u = new URL(registeredUrl);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
    u.hostname = location.hostname;  // use the dashboard's hostname
  }
  return u.href;
}
```

When you register `http://localhost:5000` and access the dashboard from `http://192.168.1.10:3000`, the service link becomes `http://192.168.1.10:5000`. No proxy, no DNS — just URL rewriting on the client. This works because the services are bound to `0.0.0.0` or all interfaces, which is the default for most dev servers.

### CLI management

A CLI tool manages registrations from the terminal:

```bash
# Register (matches current directory to a project in the config)
raven-ui service register --url http://localhost:5000 --label "Dev Server"

# List all registered services
raven-ui service list

# Show just ports (useful for firewall rules)
raven-ui service ports

# Remove registration
raven-ui service unregister
```

The CLI resolves the current working directory against project paths in the config, so you don't need to specify which project — just run it from the project root.

## Gotchas

- **Liveness is shallow.** The ping checks HTTP availability, not application health. A server that's started but still initializing shows as running. This is acceptable at personal-tool scale — you know when your servers are misbehaving.
- **No auto-deregistration.** When a server crashes, its entry stays in the config. The ping correctly shows it as offline, but the entry persists. This is by design — the registration is declarative ("this project *has* a server"), not ephemeral ("this server is running right now").
- **Host rewriting assumes same machine.** If a service genuinely runs on a different host, the `localhost` rewrite will break. The assumption is that everything runs on one development machine, which holds for a personal workspace.
- **No concurrent-write protection.** The CLI reads and rewrites the entire JSON file. Two simultaneous registrations could clobber each other. Acceptable when you're the only user.
