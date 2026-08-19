import { parseArgs } from 'node:util'

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
    }
  }
})

export const port = Number(values.port)
if (!Number.isInteger(port) || port < 0) {
  console.error('❌ --port / -p must be a non-negative integer')
  process.exit(1)
}

export const { cache, replay, clean, verbose, 'proxy-only': proxyOnly } = values

if (clean && replay) {
  console.error('❌ --clean cannot be used with --replay')
  process.exit(1)
}

if (proxyOnly && replay) {
  console.error('❌ --proxy-only cannot be used with --replay')
  process.exit(1)
}

export let url = ''
if (!replay) {
  try {
    url = new URL(values.url).href
  } catch {
    console.error('❌ --url / -u must be a valid URL')
    process.exit(1)
  }
}
