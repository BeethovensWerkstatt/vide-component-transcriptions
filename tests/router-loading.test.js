import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCached } from '../src/data-cache.js'
import { VideTranscrRouter } from '../src/vide-transcr-router.js'

vi.mock('../src/data-cache.js', () => {
  return {
    fetchCached: vi.fn()
  }
})

function createContentEl () {
  const root = document.createElement('div')
  return {
    root,
    setContent (html) {
      root.innerHTML = html
    },
    querySelector (selector) {
      return root.querySelector(selector)
    },
    querySelectorAll (selector) {
      return root.querySelectorAll(selector)
    }
  }
}

function makeRouter () {
  const router = Object.create(VideTranscrRouter.prototype)
  router.basePath = '/transcr'
  router.contentEl = createContentEl()
  return router
}

if (!customElements.get('vide-transcr-panels')) {
  class FakePanels extends HTMLElement {
    constructor () {
      super()
      this.calls = []
    }

    setShapeLinks (value) { this.calls.push(['setShapeLinks', value]) }
    loadPageImage (index, page, opts) { this.calls.push(['loadPageImage', index, page, opts]) }
    loadShapesOverlay (index, page) { this.calls.push(['loadShapesOverlay', index, page]) }
    loadRenderedWzOverlay (index, url, page) { this.calls.push(['loadRenderedWzOverlay', index, url, page]) }
    setAtLinks (value) { this.calls.push(['setAtLinks', value]) }
    loadSvg (index, svg) { this.calls.push(['loadSvg', index, svg]) }
  }

  customElements.define('vide-transcr-panels', FakePanels)
}

describe('VideTranscrRouter loading flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('loadDocument renders overview on success', async () => {
    const router = makeRouter()
    fetchCached.mockResolvedValue([
      {
        id: 'NK',
        title: 'Notizierungsbuch',
        source: {
          pages: [
            { writingZones: [{}, {}] },
            { writingZones: [{}] }
          ]
        }
      }
    ])

    await router.loadDocument('NK')

    const html = router.contentEl.root.innerHTML
    expect(html).toContain('Notirungsbuch')
    expect(html).toContain('3 Schreibzonen')
  })

  it('loadDocument renders error on fetch failure', async () => {
    const router = makeRouter()
    fetchCached.mockRejectedValue(new Error('boom'))

    await router.loadDocument('NK')

    expect(router.contentEl.root.innerHTML).toContain('Fehler beim Laden')
  })

  it('loadWritingZone renders validation error for malformed wz spec', async () => {
    const router = makeRouter()

    await router.loadWritingZone('NK', 'bad')

    expect(router.contentEl.root.innerHTML).toContain('Ungültiger Schreibzonen-Bezeichner')
    expect(fetchCached).not.toHaveBeenCalled()
  })

  it('loadWritingZone handles missing page', async () => {
    const router = makeRouter()
    fetchCached.mockResolvedValue([
      {
        source: {
          pages: []
        }
      }
    ])

    await router.loadWritingZone('NK', 'wz2.1')

    expect(router.contentEl.root.innerHTML).toContain('nicht gefunden')
  })

  it('loadWritingZone handles missing zone on an existing page', async () => {
    const router = makeRouter()
    fetchCached.mockResolvedValue([
      {
        source: {
          pages: [{ writingZones: [] }]
        }
      }
    ])

    await router.loadWritingZone('NK', 'wz1.1')

    expect(router.contentEl.root.innerHTML).toContain('Schreibzone 1 auf Seite 1 nicht gefunden')
  })

  it('loadWritingZone handles zone without genDescId', async () => {
    const router = makeRouter()
    fetchCached.mockResolvedValue([
      {
        source: {
          pages: [{ writingZones: [{ label: '1', identifier: {} }] }]
        }
      }
    ])

    await router.loadWritingZone('NK', 'wz1.1')

    expect(router.contentEl.root.innerHTML).toContain('Keine genDescId')
  })

  it('loadWritingZone renders viewer and metadata on success', async () => {
    const router = makeRouter()

    const overview = [
      {
        source: {
          pages: [
            {
              writingZones: [
                {
                  label: '1',
                  identifier: { genDescId: 'gd1' },
                  sketchProps: { staves: 1 },
                  wzProps: { layers: ['a'] },
                  workRelations: []
                }
              ]
            }
          ]
        }
      }
    ]

    const genDesc = {
      writingZones: [
        {
          page: {
            image: 'https://example.org/iiif#xywh=1,2,3,4&rotate=0',
            px: { width: 100, height: 100 },
            mm: { width: 10, height: 10 }
          },
          rect: { x: 1, y: 1, width: 5, height: 5 },
          shapeLinks: { a: ['b'] },
          renderedWz: 'https://example.org/rendered.svg'
        }
      ],
      at: {
        dtLinks: { at1: 'dt1' },
        renderedSvg: '<svg></svg>'
      }
    }

    fetchCached
      .mockResolvedValueOnce(overview)
      .mockResolvedValueOnce(genDesc)

    await router.loadWritingZone('NK', 'wz1.1')

    const panelTitle = router.contentEl.querySelector('.transcription-header-title')
    expect(panelTitle.textContent).toBe('NK 1/1')

    const panelsEl = router.contentEl.querySelector('vide-transcr-panels')
    expect(panelsEl).toBeTruthy()
    expect(panelsEl.calls.some(call => call[0] === 'setShapeLinks')).toBe(true)
    expect(panelsEl.calls.some(call => call[0] === 'loadPageImage')).toBe(true)
    expect(panelsEl.calls.some(call => call[0] === 'setAtLinks')).toBe(true)
    expect(panelsEl.calls.some(call => call[0] === 'loadSvg')).toBe(true)
  })

  it('loadWritingZone renders generic load error when downstream fetch fails', async () => {
    const router = makeRouter()
    fetchCached
      .mockResolvedValueOnce([
        {
          source: {
            pages: [
              {
                writingZones: [{
                  label: '1',
                  identifier: { genDescId: 'gd1' },
                  sketchProps: { staves: 1 },
                  wzProps: { layers: ['a'] },
                  workRelations: []
                }]
              }
            ]
          }
        }
      ])
      .mockRejectedValueOnce(new Error('genDesc failed'))

    await router.loadWritingZone('NK', 'wz1.1')

    expect(router.contentEl.root.innerHTML).toContain('Fehler beim Laden')
    expect(router.contentEl.root.innerHTML).toContain('genDesc failed')
  })
})
