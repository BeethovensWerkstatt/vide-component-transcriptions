import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VideTranscrPanels } from '../src/vide-transcr-panels.js'

if (!customElements.get('vide-transcr-panels')) {
  customElements.define('vide-transcr-panels', VideTranscrPanels)
}

const PAGE_ONE = {
  image: 'https://edirom-images.beethovens-werkstatt.de/Scaler/IIIF/D-BNba_HCB_Mh_60%2FHCB_Mh_60_05.jpg#xywh=250,239,7233,5497&rotate=-0.3',
  px: {
    width: 7712,
    height: 6000
  },
  mm: {
    width: 305,
    height: 232
  },
  shapes: 'https://example.test/p005-shapes.svg',
  shapesGroupId: 'zone-g-1'
}

describe('VideTranscrPanels placement using page-one fixture', () => {
  beforeEach(() => {
    global.fetch = vi.fn()

    class FakeRect {
      constructor (x, y, width, height, degrees) {
        this.x = x
        this.y = y
        this.width = width
        this.height = height
        this.degrees = degrees
      }
    }

    window.OpenSeadragon = { Rect: FakeRect }
  })

  it('calculatePagePosition returns stable world-space placement for page one', () => {
    const panels = document.createElement('vide-transcr-panels')
    const pos = panels.calculatePagePosition(PAGE_ONE)

    expect(pos.tileSource).toContain('/info.json')
    expect(pos.mmPerPx).toBeCloseTo(0.04216784183602931, 12)
    expect(pos.width).toBeCloseTo(325.1983962394581, 10)
    expect(pos.x).toBeCloseTo(-10.541960459007328, 10)
    expect(pos.y).toBeCloseTo(-9.976427485137577, 10)
    expect(pos.degrees).toBeCloseTo(0.3, 12)
  })

  it('loadShapesOverlay applies page-one rotation while preserving expected OSD placement', async () => {
    const panels = document.createElement('vide-transcr-panels')
    const addOverlay = vi.fn()

    panels.viewers = [{ addOverlay }, null, null]
    panels._ready = Promise.resolve()

    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => '<svg xmlns="http://www.w3.org/2000/svg"><g id="zone-g-1"><path d="M0 0"/></g></svg>'
    })

    await panels.loadShapesOverlay(0, PAGE_ONE)

    expect(addOverlay).toHaveBeenCalledTimes(1)
    const { element, location, checkResize } = addOverlay.mock.calls[0][0]

    expect(checkResize).toBe(false)
    expect(location.x).toBeCloseTo(-10.541960459007328, 10)
    expect(location.y).toBeCloseTo(-9.976427485137577, 10)
    expect(location.width).toBeCloseTo(325.1983962394581, 10)
    expect(location.degrees).toBeCloseTo(0, 12)

    const overlaySvg = element.querySelector('svg.pageShapes')
    const rotateWrapper = element.querySelector('.rotateWrapper')
    expect(overlaySvg).toBeTruthy()
    expect(rotateWrapper).toBeTruthy()
    expect(rotateWrapper.style.transform).toBe('rotate(0.3deg)')

    const activeGroup = element.querySelector('#zone-g-1')
    expect(activeGroup.classList.contains('active')).toBe(true)
  })

  it('calculateRectBounds applies rotation and 10% padding', () => {
    const panels = document.createElement('vide-transcr-panels')
    const pos = {
      x: 10,
      y: 20,
      degrees: 0,
      mmPerPx: 2
    }
    const rect = { x: 1, y: 2, w: 3, h: 4 }

    const bounds = panels.calculateRectBounds(rect, pos)

    expect(bounds.x).toBeCloseTo(11.4, 10)
    expect(bounds.y).toBeCloseTo(23.2, 10)
    expect(bounds.width).toBeCloseTo(7.2, 10)
    expect(bounds.height).toBeCloseTo(9.6, 10)
  })

  it('loadRenderedWzOverlay places SVG crop using page-one geometry', async () => {
    const panels = document.createElement('vide-transcr-panels')
    const addOverlay = vi.fn()
    panels.viewers = [null, { addOverlay }, null]
    panels._ready = Promise.resolve()

    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
    })

    await panels.loadRenderedWzOverlay(1, 'https://example.test/dt.svg', PAGE_ONE.mm)

    expect(addOverlay).toHaveBeenCalledTimes(1)
    const call = addOverlay.mock.calls[0][0]
    expect(call.checkResize).toBe(false)
    expect(call.location.width).toBeCloseTo(PAGE_ONE.mm.width, 10)
    expect(call.location.height).toBeCloseTo(PAGE_ONE.mm.height, 10)
    expect(call.location.x).toBeCloseTo(0, 12)
    expect(call.location.y).toBeCloseTo(0, 12)
    expect(call.element.querySelector('svg.renderedWz')).toBeTruthy()
  })

  it('loadPageImage uses bounds and opacity from callback', async () => {
    const panels = document.createElement('vide-transcr-panels')
    panels._ready = Promise.resolve()

    const setOpacity = vi.fn()
    const fitBounds = vi.fn()
    const viewer = {
      addTiledImage: vi.fn(({ success }) => success({ item: { setOpacity } })),
      viewport: { fitBounds }
    }
    panels.viewers = [{ ...viewer }, null, null]

    await panels.loadPageImage(0, PAGE_ONE, {
      rect: { x: 10, y: 20, w: 100, h: 200 },
      opacity: 0.5
    })

    expect(viewer.addTiledImage).toHaveBeenCalledTimes(1)
    expect(setOpacity).toHaveBeenCalledWith(0.5)
    expect(fitBounds).toHaveBeenCalledTimes(1)
  })

  it('highlighting links shapes, dt and at elements together on hover', () => {
    const panels = document.createElement('vide-transcr-panels')

    const shapeDoc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="shape-a"></g></svg>',
      'image/svg+xml'
    )
    const dtDoc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><g data-id="dt-a"></g></svg>',
      'image/svg+xml'
    )
    const atDoc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><g data-id="at-a"></g></svg>',
      'image/svg+xml'
    )

    panels._shapesSvgEl = shapeDoc.documentElement
    panels._dtSvgEl = dtDoc.documentElement
    panels._atSvgEl = atDoc.documentElement
    panels._shapesSvgEls = [shapeDoc.documentElement]
    panels._dtSvgEls = [dtDoc.documentElement]
    panels._shapeLinks = { 'dt-a': ['shape-a'] }
    panels._atLinks = { 'at-a': 'dt-a' }

    panels._initHighlighting()

    const dtEl = panels._dtSvgEl.querySelector('[data-id="dt-a"]')
    const shapeEl = panels._shapesSvgEl.getElementById('shape-a')
    const atEl = panels._atSvgEl.querySelector('[data-id="at-a"]')

    dtEl.dispatchEvent(new Event('mouseenter'))
    expect(dtEl.classList.contains('highlighted')).toBe(true)
    expect(shapeEl.classList.contains('highlighted')).toBe(true)
    expect(atEl.classList.contains('highlighted')).toBe(true)

    dtEl.dispatchEvent(new Event('mouseleave'))
    expect(dtEl.classList.contains('highlighted')).toBe(false)
    expect(shapeEl.classList.contains('highlighted')).toBe(false)
    expect(atEl.classList.contains('highlighted')).toBe(false)
  })
})
