# mcp-rewind

A streamable HTTP/SSE proxy for MCP servers that records traffic and replays it without the server being present.

Supports both old-style MCP (no `mcp-session-id`) and new-style MCP (with `mcp-session-id`).

## Purpose

mcp-rewind is designed for **testing MCP-powered applications in isolation** — without requiring the real MCP server to be running. Record a session once against the live server, commit the cache, and your tests replay it deterministically with no network dependency.

## How it works

```
MCP client  →  mcp-rewind (proxy)  →  MCP server
```

In **record** mode, mcp-rewind sits between your MCP client and server, forwarding all traffic and saving the results to a cache directory.

In **replay** mode, mcp-rewind answers client requests directly from the cache — no MCP server needed.

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
node index.js --url http://placeholder --cache ./cache --replay
```

The `--url` value is ignored in replay mode but is still required by the argument parser.

### Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--port` | `-p` | `0` (random) | Port to listen on |
| `--url` | `-u` | *(required)* | Upstream MCP server URL |
| `--cache` | `-c` | `./cache` | Directory to read/write cached results |
| `--replay` | `-r` | `false` | Replay from cache instead of proxying |

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
