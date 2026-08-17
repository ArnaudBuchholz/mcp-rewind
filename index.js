import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { capture, log, serve, body, send } from 'reserve'
import { port, url, cache, replay } from './args.js'

const cacheBasePath = join('.', cache ?? 'cache')
await mkdir(cacheBasePath, { recursive: true })

const LIST_ADMIN_METHODS = new Set(['initialize', 'notifications/initialized', 'tools/list', 'resources/list', 'resources/templates/list'])

function hashParams (params) {
  return createHash('sha256').update(JSON.stringify(params ?? {})).digest('hex').slice(0, 16)
}

function extractLastResult (sseText) {
  return sseText
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => { try { return JSON.parse(line.slice(5).trim()) } catch { return null } })
    .filter(parsed => parsed?.result != null)
    .at(-1)
    ?.result
}

const EMPTY_RESULTS = {
  'resources/list': { resources: [] },
  'resources/templates/list': { resourceTemplates: [] }
}

const replaySessionId = randomUUID()

let lastRequestId = 0

async function findCacheFile (key) {
  const suffix = ` ${key}.json`
  const entries = await readdir(cacheBasePath)
  const match = entries.find(e => e.endsWith(suffix))
  return match ? join(cacheBasePath, match) : null
}

function sendSse (res, id, result, withSessionId) {
  if (withSessionId) {
    res.setHeader('mcp-session-id', replaySessionId)
  }
  res.setHeader('Content-Type', 'text/event-stream')
  res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`)
}

const server = serve({
  port,
  mappings: [{
    method: 'POST',
    'invert-match': true, // Only POST supported
    status: 405
  }, {
    match: '^/(.*)',
    custom: async (req, res) => {
      if (!replay) {
        return
      }
      const requestBodyAsText = await body(req).text()
      if (!requestBodyAsText) {
        console.error('No body')
        return 500
      }
      const requestBody = JSON.parse(requestBodyAsText)
      const method = requestBody?.method
      const clientSentSessionId = !!req.headers['mcp-session-id']
      if (method?.startsWith('notifications/')) {
        return 202
      }
      let key
      if (LIST_ADMIN_METHODS.has(method)) {
        key = method.replaceAll('/', '_')
      } else if (method === 'tools/call') {
        key = `tools_call_${requestBody.params.name}_${hashParams(requestBody?.params?.arguments)}`
      }
      if (key) {
        try {
          const cachePath = await findCacheFile(key)
          if (cachePath) {
            const cached = await readFile(cachePath, 'utf8')
            sendSse(res, requestBody.id, JSON.parse(cached), clientSentSessionId)
            return
          }
        } catch (error) {
          console.error(error)
        }
        // No cache file — return empty result for known empty methods, 202 for others
        const emptyResult = EMPTY_RESULTS[method]
        if (emptyResult !== undefined) {
          sendSse(res, requestBody.id, emptyResult, clientSentSessionId)
          return
        }
        return LIST_ADMIN_METHODS.has(method) ? 202 : 500
      }
      console.error(requestBody)
      console.error('⚠️ No recorded response to send')
      return 500
    }
  }, {
    match: '^/(.*)',
    custom: async (req, res) => {
      const key = ++lastRequestId
      let name = ''
      let isAdminMethod = false
      let isToolCall = false
      const requestBodyAsText = await body(req).text()
      if (requestBodyAsText) {
        const requestBody = JSON.parse(requestBodyAsText)
        const method = requestBody?.method
        isAdminMethod = LIST_ADMIN_METHODS.has(method)
        isToolCall = method === 'tools/call'
        if (isAdminMethod) {
          name = ' ' + method.replaceAll('/', '_')
        } else if (isToolCall) {
          name = ` tools_call_${requestBody.params.name}_${hashParams(requestBody?.params?.arguments)}`
        }
        await writeFile(join(cacheBasePath, `${key}${name}.req.json`), JSON.stringify({
          verb: req.verb,
          url: req.url,
          headers: req.headers,
          body: requestBody
        }, 0, 2))
      }
      const file = createWriteStream(join(cacheBasePath, `${key}${name}.res.json`))
      capture(res, file)
        .then(async ({ status, headers }) => {
          const resHeadPath = join(cacheBasePath, `${key}${name}.res-head.json`)
          await writeFile(resHeadPath, JSON.stringify({ status, headers }, 0, 2))
          if (!isAdminMethod && !isToolCall) return
          const resPath = join(cacheBasePath, `${key}${name}.res.json`)
          const raw = await readFile(resPath, 'utf8')
          try {
            const result = extractLastResult(raw)
            if (result != null) {
              await writeFile(join(cacheBasePath, `${key}${name}.json`), JSON.stringify(result, 0, 2))
            }
          } catch {
            // ignore
          }
        })
        .catch(reason => {
          console.error('❌ Unable to cache', reason)
        })
    }
  }, url ? {
    match: '^/(.*)',
    url: new URL('$1', url).href
  } : { status: 4040 }]
})
log(server)
server.on('ready', ({ url: localUrl }) => {
  if (replay) {
    console.log(`▶️  ${localUrl} (replay recorded)`)
  } else {
    console.log(`⏺️  ${localUrl} => ${url}`)
  }
})
