/**
 * Real HttpClient implementation over Node's global fetch (Node 20+). No
 * unit test: exercising a real network call is covered by the docker
 * smoke test (Phase 5) -- this file only needs to build cleanly. Channel
 * adapters never import fetch directly; they depend on the HttpClient
 * port so tests can inject FakeHttpClient instead.
 */
import type { HttpClient } from '../core/ports.js'

export class FetchHttpClient implements HttpClient {
  async request(opts: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: unknown
  }): Promise<{ status: number; body: string }> {
    const body =
      opts.body === undefined
        ? undefined
        : typeof opts.body === 'string'
          ? opts.body
          : JSON.stringify(opts.body)

    const response = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body
    })

    return { status: response.status, body: await response.text() }
  }
}
