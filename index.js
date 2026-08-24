#!/usr/bin/env node
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { capture, log, serve, body } from 'reserve'
import { port, url, cache, replay, clean, verbose, proxyOnly, resultIgnore, resultHashPath } from './args.js'
import { buildHashResult } from './hash.js'
import { migrate } from './migrate.js'

const cacheBasePath = cache && isAbsolute(cache) ? cache : join('.', cache ?? 'cache')
if (!proxyOnly) {
  await mkdir(cacheBasePath, { recursive: true })
  if (clean) {
    await rm(cacheBasePath, { recursive: true, force: true })
    await mkdir(cacheBasePath)
  }
}

const LIST_ADMIN_METHODS = new Set(['initialize', 'tools/list', 'resources/list', 'resources/templates/list'])

function hashParams (params) {
  return createHash('sha256').update(JSON.stringify(params ?? {})).digest('hex').slice(0, 16)
}

const hashResult = buildHashResult(resultIgnore, resultHashPath)

function matchesSignature (signature, incomingArguments) {
  for (const [key, pattern] of Object.entries(signature)) {
    const value = incomingArguments[key]
    if (pattern !== null && typeof pattern === 'object' && '$regexp' in pattern) {
      if (!new RegExp(pattern.$regexp, pattern.$flags ?? '').test(String(value ?? ''))) return false
    } else if (value !== pattern) {
      return false
    }
  }
  return true
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
if (!proxyOnly) {
  const existing = await readdir(cacheBasePath)
  for (const entry of existing) {
    const num = parseInt(entry, 10)
    if (!Number.isNaN(num) && num > lastRequestId) lastRequestId = num
  }
  await migrate(cacheBasePath, hashResult)
}

async function findCacheFile (key) {
  const suffix = ` ${key}.json`
  const entries = await readdir(cacheBasePath)
  const match = entries.find(e => e.endsWith(suffix))
  return match ? join(cacheBasePath, match) : null
}

async function findBestMatch (toolName, incomingArguments) {
  const prefix = `tools_call_${toolName}_`
  const entries = await readdir(cacheBasePath)
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.includes('.res') || entry.includes('.req')) continue
    const stem = entry.replace(/^\d+ /, '')
    if (!stem.startsWith(prefix)) continue
    try {
      const cached = JSON.parse(await readFile(join(cacheBasePath, entry), 'utf8'))
      for (const signature of cached.additionalArguments ?? []) {
        if (matchesSignature(signature, incomingArguments)) return cached
      }
    } catch {
      // ignore unreadable files
    }
  }
  return null
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
    method: 'GET',
    match: '/healthcheck',
    status: 200
  }, {
    method: 'POST',
    'invert-match': true, // Only POST supported
    status: 405
  }, { // REPLAY
    match: '^/(.*)',
    custom: async (req, res) => {
      if (!replay || proxyOnly) {
        return
      }
      const requestBodyAsText = await body(req).text()
      if (!requestBodyAsText) {
        console.error('No body')
        return 400
      }
      const requestBody = JSON.parse(requestBodyAsText)
      const method = requestBody?.method
      const clientSentSessionId = !!req.headers['mcp-session-id']
      if (method?.startsWith('notifications/')) {
        return 202
      }
      let key
      if (LIST_ADMIN_METHODS.has(method) && !url) {
        key = method.replaceAll('/', '_')
      } else if (method === 'tools/call') {
        key = `tools_call_${requestBody.params.name}_${hashParams(requestBody?.params?.arguments)}`
      }
      if (key) {
        try {
          const cachePath = await findCacheFile(key)
          if (cachePath) {
            const cached = JSON.parse(await readFile(cachePath, 'utf8'))
            const result = method === 'tools/call' ? cached.result : cached
            if (verbose) console.log(`✅ ${key}`)
            sendSse(res, requestBody.id, result, clientSentSessionId)
            return
          }
          if (method === 'tools/call') {
            const best = await findBestMatch(requestBody.params.name, requestBody.params.arguments ?? {})
            if (best) {
              if (verbose) console.log(`✅🔍 ${key} (best match)`)
              sendSse(res, requestBody.id, best.result, clientSentSessionId)
              return
            }
          }
        } catch (error) {
          console.error(error)
        }
        if (url) {
          if (verbose) console.log(`⚠️ ${key} (no cache)`)
          return // fall through to record+proxy
        }
        if (verbose) console.log(`❌ ${key} (no cache)`)
        // No cache file — return empty result for known empty methods, 202 for others
        const emptyResult = EMPTY_RESULTS[method]
        if (emptyResult !== undefined) {
          sendSse(res, requestBody.id, emptyResult, clientSentSessionId)
          return
        }
        if (LIST_ADMIN_METHODS.has(method)) {
          return 202
        }
      }
      if (url) return // fall through to record+proxy
      if (method === 'tools/call') {
        console.error(`⚠️ No recorded response for ${requestBody.params?.name}`)
        sendSse(res, requestBody.id, {
          content: [{ type: 'text', text: `Error: no recorded response for ${requestBody.params?.name}` }],
          isError: true
        }, clientSentSessionId)
        return
      }
      console.error(requestBody)
      console.error('⚠️ No recorded response to send')
      return 404
    }
  }, { // RECORD
    match: '^/(.*)',
    custom: async (req, res) => {
      if (proxyOnly) {
        return
      }
      let name = ''
      let isAdminMethod = false
      let isToolCall = false
      let requestBody
      const requestBodyAsText = await body(req).text()
      if (requestBodyAsText) {
        requestBody = JSON.parse(requestBodyAsText)
        const method = requestBody?.method
        if (method?.startsWith('notifications/')) {
          if (verbose) console.log(`⏭️  ${method}`)
          return
        }
        isAdminMethod = LIST_ADMIN_METHODS.has(method)
        isToolCall = method === 'tools/call'
        if (isAdminMethod) {
          name = ' ' + method.replaceAll('/', '_')
        } else if (isToolCall) {
          name = ` tools_call_${requestBody.params.name}_${hashParams(requestBody?.params?.arguments)}`
        }
        if ((isAdminMethod || isToolCall) && await findCacheFile(name.trim())) {
          if (verbose) console.log(`⏭️  ${name.trim()} (already cached)`)
          return
        }
      }
      const key = ++lastRequestId
      if (requestBody) {
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
              if (isToolCall) {
                const rHash = hashResult(result)
                const toolName = requestBody?.params?.name
                const prefix = `tools_call_${toolName}_`
                const allEntries = await readdir(cacheBasePath)
                let groupedInto = null
                for (const entry of allEntries) {
                  if (!entry.endsWith('.json') || entry.includes('.res') || entry.includes('.req')) continue
                  if (!entry.replace(/^\d+ /, '').startsWith(prefix)) continue
                  try {
                    const entryData = JSON.parse(await readFile(join(cacheBasePath, entry), 'utf8'))
                    if (entryData.resultHash === rHash) {
                      entryData.additionalArguments = [...(entryData.additionalArguments ?? []), requestBody?.params?.arguments ?? {}]
                      await writeFile(join(cacheBasePath, entry), JSON.stringify(entryData, 0, 2))
                      groupedInto = entry
                      break
                    }
                  } catch {
                    // ignore unreadable files
                  }
                }
                if (groupedInto) {
                  if (verbose) console.log(`⏺️  ${name.trim()} (grouped into ${groupedInto})`)
                } else {
                  const distilled = { arguments: requestBody?.params?.arguments ?? {}, resultHash: rHash, result }
                  await writeFile(join(cacheBasePath, `${key}${name}.json`), JSON.stringify(distilled, 0, 2))
                  if (verbose) console.log(`⏺️  ${name.trim()}`)
                }
              } else {
                await writeFile(join(cacheBasePath, `${key}${name}.json`), JSON.stringify(result, 0, 2))
                if (verbose) console.log(`⏺️  ${name.trim()}`)
              }
            }
          } catch {
            // ignore
          }
        })
        .catch(reason => {
          console.error('❌ Unable to cache', reason)
        })
    }
  }, url
    ? {
        url
      }
    : { status: 404 }]
})
log(server)
server.on('ready', ({ url: localUrl }) => {
  if (replay && url) {
    console.log(`▶️ ⏺️  ${localUrl} => ${url} (replay with record fallback)`)
  } else if (replay) {
    console.log(`▶️  ${localUrl} (replay only)`)
  } else if (proxyOnly) {
    console.log(`⏩  ${localUrl} => ${url} (proxy only)`)
  } else {
    console.log(`⏺️  ${localUrl} => ${url} (record only)`)
  }
})
