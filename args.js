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
    }
  }
})

export const port = Number(values.port)
if (!Number.isInteger(port) || port < 0) {
  console.error('❌ --port / -p must be a non-negative integer')
  process.exit(1)
}

export const { cache, replay, clean } = values

if (clean && replay) {
  console.error('❌ --clean cannot be used with --replay')
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
