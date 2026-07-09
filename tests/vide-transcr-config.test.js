import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VideTranscr } from '../src/vide-transcr.js'
import { VideTranscrContent } from '../src/vide-transcr-content.js'

if (!customElements.get('vide-transcr')) {
  customElements.define('vide-transcr', VideTranscr)
}

if (!customElements.get('vide-transcr-content')) {
  customElements.define('vide-transcr-content', VideTranscrContent)
}

function flushAsync () {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('VideTranscr configuration wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    window.router = null
  })

  it('passes a programmatic config object to the router', async () => {
    const routerSpy = vi.fn().mockImplementation(function (app, config) {
      this.app = app
      this.config = config
    })
    window.VideTranscrRouter = routerSpy

    const el = document.createElement('vide-transcr')
    el.config = {
      apiBase: 'https://example.org/exist/apps/api/document',
      documents: {
        NK: '/custom/overview.json'
      }
    }

    document.body.appendChild(el)
    await flushAsync()

    expect(routerSpy).toHaveBeenCalledOnce()
    expect(routerSpy).toHaveBeenCalledWith(el, {
      apiBase: 'https://example.org/exist/apps/api/document',
      documents: {
        NK: '/custom/overview.json'
      }
    })
  })

  it('loads config-src and lets attributes override it', async () => {
    const routerSpy = vi.fn().mockImplementation(function (app, config) {
      this.app = app
      this.config = config
    })
    window.VideTranscrRouter = routerSpy

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        apiBase: 'https://config.example/exist/apps/api/document',
        documents: {
          NK: '/config/overview.json'
        }
      })
    }))

    const el = document.createElement('vide-transcr')
    el.setAttribute('config-src', '/vide-component-transcriptions/config.json')
    el.setAttribute('api-base', 'https://override.example/exist/apps/api/document')

    document.body.appendChild(el)
    await flushAsync()

    expect(routerSpy).toHaveBeenCalledOnce()
    expect(routerSpy).toHaveBeenCalledWith(el, {
      apiBase: 'https://override.example/exist/apps/api/document',
      documents: {
        NK: '/config/overview.json'
      }
    })
  })
})
