import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function migrate (cacheBasePath, hashResult) {
  const existing = await readdir(cacheBasePath)
  let count = 0
  for (const entry of existing) {
    if (!entry.endsWith('.json') || entry.includes('.res') || entry.includes('.req')) continue
    if (!entry.replace(/^\d+ /, '').startsWith('tools_call_')) continue
    const filePath = join(cacheBasePath, entry)
    try {
      const data = JSON.parse(await readFile(filePath, 'utf8'))
      if (data.result != null && data.resultHash == null) {
        data.resultHash = hashResult(data.result)
        await writeFile(filePath, JSON.stringify(data, 0, 2))
        ++count
      }
    } catch {
      // ignore unreadable files
    }
  }
  if (count) console.log(`🔄 Migrated ${count} cache file${count === 1 ? '' : 's'}`)
}
