import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
const { version } = createRequire(import.meta.url)('./package.json')

console.log(`mcp-rewind@${version}`)

const { values } = parseArgs({
  options: {
    port: {
      type: 'string',
      short: 'p',
      default: '0'
    },
    url: {
      type: 'string',
      short: 'u',
      default: ''
    },
    cache: {
      type: 'string',
      short: 'c'
    },
    replay: {
      type: 'boolean',
      short: 'r',
      default: false
    },
    clean: {
      type: 'boolean',
      default: false
    },
    verbose: {
      type: 'boolean',
      short: 'v',
      default: false
    },
    'proxy-only': {
      type: 'boolean',
      default: false
    },
    'result-hash-ignore': {
      type: 'string',
      multiple: true
    },
    'result-hash-path': {
      type: 'string'
    }
  }
})

export const port = Number(values.port)
if (!Number.isInteger(port) || port < 0) {
  console.error('❌ --port / -p must be a non-negative integer')
  process.exit(1)
}

export const { cache, replay, clean, verbose, 'proxy-only': proxyOnly } = values

export const resultIgnore = values['result-hash-ignore'] ?? []
export const resultHashPath = values['result-hash-path']

if (clean && replay) {
  console.error('❌ --clean cannot be used with --replay')
  process.exit(1)
}

if (proxyOnly && replay) {
  console.error('❌ --proxy-only cannot be used with --replay')
  process.exit(1)
}

export let url = ''
if (values.url) {
  try {
    url = new URL(values.url).href
  } catch {
    console.error('❌ --url / -u must be a valid URL')
    process.exit(1)
  }
  try {
    const probe = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-rewind', version } } })
    })
    if (!probe.ok) {
      console.error(`❌ MCP server at ${url} responded with ${probe.status}`)
      process.exit(1)
    }
    const text = await probe.text()
    if (!text.includes('"protocolVersion"')) {
      console.error(`❌ ${url} does not appear to be a valid MCP server (no protocolVersion in response)`)
      process.exit(1)
    }
    const probeSessionId = probe.headers.get('mcp-session-id')
    if (probeSessionId) {
      await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': probeSessionId } }).catch(() => {})
    }
  } catch (error) {
    console.error(`❌ ${url} is unreachable: ${error.message}`)
    process.exit(1)
  }
  console.log(`✅ ${url} appears to be a valid MCP server`)
} else if (!replay && !proxyOnly) {
  console.error('❌ --url / -u is required in record mode')
  process.exit(1)
}

export { version }
