# mcp-rewind

A streamable HTTP/SSE proxy for MCP servers that records traffic and replays it without the server being present.

Supports both old-style MCP (no `mcp-session-id`) and new-style MCP (with `mcp-session-id`).

## Purpose

mcp-rewind is designed for **testing MCP-powered applications in isolation** — without requiring the real MCP server to be running. Record a session once against the live server, commit the cache, and your tests replay it deterministically with no network dependency.

## Modes

### Record

```
MCP client  →  mcp-rewind (proxy)  →  MCP server
                     ↓
                  cache/
```

mcp-rewind sits between your MCP client and server, forwarding all traffic and saving results to the cache directory. Already-cached keys are skipped so re-running a partially recorded session is safe.

### Replay

```
MCP client  →  mcp-rewind  →  cache/
```

mcp-rewind answers every request directly from the cache — no MCP server needed. Requests with no cached entry return an error or an empty result depending on the method.

### Hybrid (replay with record fallback)

```
MCP client  →  mcp-rewind  →  cache/   (hit)
                     ↓
               MCP server + cache/     (miss → record for next time)
```

Pass both `--replay` and `--url` together. Cache hits are served immediately from disk; misses are forwarded to the live server and recorded, so the cache grows incrementally over time without re-recording the whole session.

### Proxy-only

```
MCP client  →  mcp-rewind (proxy)  →  MCP server
```

Forwards all traffic without reading or writing the cache. Useful for inspecting traffic in `--verbose` mode before committing to a recording.

### Replay ordering

Tools can be called in **any order** during replay, not just the order they were originally recorded. The replay cache is keyed by method and — for `tools/call` — by tool name plus a hash of the arguments. As long as the parameters are exactly the same as when they were recorded, the cached result will be returned regardless of call sequence.

## Usage

### Record

```bash
node index.js --url http://your-mcp-server --cache ./cache
```

Point your MCP client at the printed local URL instead of the real server. Traffic is recorded to `--cache`.

### Replay

```bash
node index.js --replay --cache ./cache
```

### Hybrid (replay with record fallback)

```bash
node index.js --replay --url http://your-mcp-server --cache ./cache
```

Cache hits are served from disk. Misses are proxied live and recorded so subsequent runs serve them from cache.

### Proxy-only

```bash
node index.js --proxy-only --url http://your-mcp-server
```

### Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--port` | `-p` | `0` (random) | Port to listen on |
| `--url` | `-u` | — | Upstream MCP server URL (required in record/hybrid/proxy-only modes) |
| `--cache` | `-c` | `./cache` | Directory to read/write cached results |
| `--replay` | `-r` | `false` | Replay from cache; add `--url` for hybrid mode |
| `--proxy-only` | — | `false` | Proxy without reading or writing cache |
| `--clean` | — | `false` | Wipe cache directory on startup (record mode only) |
| `--verbose` | `-v` | `false` | Log each cache hit, miss, and skip |

## Cache directory layout

Each recorded exchange produces up to four files, prefixed with a sequence number:

| File | Description |
|------|-------------|
| `<n> <key>.req.json` | Full request (URL, headers, body) |
| `<n> <key>.res.json` | Raw SSE response body |
| `<n> <key>.res-head.json` | Response status and headers |
| `<n> <key>.json` | **Distilled result — used by replay** |

Only the `<n> <key>.json` files are required for replay. The others are useful for debugging but can be gitignored:

```gitignore
cache/**/*.req.json
cache/**/*.res.json
cache/**/*.res-head.json
```

Or, to commit only the replay-relevant files:

```gitignore
cache/**/
!cache/**/*.json
cache/**/*.req.json
cache/**/*.res.json
cache/**/*.res-head.json
```

## What gets cached

| MCP method | Cached as |
|------------|-----------|
| `initialize` | `<n> initialize.json` |
| `tools/list` | `<n> tools_list.json` |
| `tools/call` | `<n> tools_call_<name>_<hash>.json` |
| `resources/list` | `<n> resources_list.json` |
| `resources/templates/list` | `<n> resources_templates_list.json` |
| `notifications/*` | Not cached — returns 202 immediately |

The hash in `tools/call` filenames is a SHA-256 (truncated to 16 hex chars) of the call arguments, so different argument combinations are cached independently.
