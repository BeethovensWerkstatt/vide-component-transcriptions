import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchCached } from '../src/data-cache.js'

describe('fetchCached', () => {
  beforeEach(() => {
    window.__BW_DataCache = new Map()
    global.fetch = vi.fn()
  })

  it('returns cached promise for repeated URL', async () => {
    const payload = [{ ok: true }]
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => payload
    })

    const first = fetchCached('https://example.test/overview.json')
    const second = fetchCached('https://example.test/overview.json')

    expect(first).toBe(second)

    const result = await first
    expect(result).toEqual(payload)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('throws on non-ok responses', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error'
    })

    await expect(fetchCached('https://example.test/fail.json')).rejects.toThrow('HTTP 500 Server Error')
  })
})
