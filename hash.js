import { createHash } from 'node:crypto'

function getByPath (obj, path) {
  return path.split('.').reduce((cur, key) => cur != null ? cur[key] : undefined, obj)
}

function deleteByPath (obj, path) {
  const parts = path.split('.')
  const last = parts.pop()
  const parent = parts.reduce((cur, key) => cur != null ? cur[key] : undefined, obj)
  if (parent != null) delete parent[last]
}

export function buildHashResult (resultIgnore, resultHashPath) {
  return function hashResult (result) {
    let value = structuredClone(result)
    if (resultHashPath !== undefined) {
      value = getByPath(value, resultHashPath)
    }
    for (const path of resultIgnore) {
      deleteByPath(value, path)
    }
    return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16)
  }
}
