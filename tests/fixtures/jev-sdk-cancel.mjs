// Real SDK against loopback HTTP, no external provider or real credential.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { TypeSafeClient, noul } from '@typesafe-ai/sdk'

let received
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.write('{"model":')
  received?.()
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
try {
  const client = new TypeSafeClient({ apiKey: 'local-test-only', baseURL: `http://127.0.0.1:${port}`, logLevel: 'off', retry: { maxRetries: 0 } })
  const request = { model: 'jev-1.13.0', state: 'synthetic', questions: { done: noul('Done?') } }
  const controller = new AbortController()
  const ready = new Promise(resolve => { received = resolve })
  const pending = assert.rejects(async () => await client.systemOne(request, { signal: controller.signal, timeout: 1000 }), { name: 'APIUserAbortError' })
  await ready
  controller.abort()
  await pending
  received = undefined
  await assert.rejects(async () => await client.systemOne(request, { timeout: 25 }), { name: 'APITimeoutError' })
  // Give late rejection handlers time to fire; uncaught failures must exit nonzero.
  await new Promise(resolve => setTimeout(resolve, 30))
  console.log('real SDK cancellation and timeout settled')
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
