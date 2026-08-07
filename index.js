import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { capture, log, serve, body } from 'reserve'

const { values } = parseArgs({
  options: {
    port: {
      type: 'string',
      short: 'p',
      default: '0'
    },
    url: {
      type: 'string',
      short: 'u'
    },
    cache: {
      type: 'string',
      short: 'c'
    }
  }
})

const port = Number(values.port)
if (!Number.isInteger(port) || port < 0) {
  console.error('--port / -p must be a non-negative integer')
  process.exit(1)
}

if (!values.url) {
  console.error('--url / -u is required')
  process.exit(1)
}

let url
try {
  url = new URL(values.url)
} catch {
  console.error('--url / -u must be a valid URL')
  process.exit(1)
}

const { cache } = values
const cacheBasePath = join('.', cache ?? 'cache')
await mkdir(cacheBasePath, { recursive: true })

let lastRequestId = 0

// Need to handle the mcp-session-id
// Need to handle the initialize

const server = serve({
  port,
  mappings: [{
    match: '^/(.*)',
    custom: async (req, res) => {
      const key = ++lastRequestId // Will be improved over time
      const requestBody = await body(req).json();
      await writeFile(join(cacheBasePath, `${key}.req.json`), JSON.stringify({
        verb: req.verb,
        url: req.url,
        headers: req.headers,
        body: requestBody,
      }, 0, 2))
      const file = createWriteStream(join(cacheBasePath, `${key}.res.json`)) // auto closed
      capture(res, file)
        .catch(reason => {
          console.error('Unable to cache', reason)
        })
    }
  }, {
    match: '^/(.*)',
    url: new URL('$1', url).href
  }]
})
log(server)
server.on('ready', ({ url: localUrl }) => {
  console.log(`${localUrl} => ${url}`)
})
