import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VideTranscrPanels } from '../src/vide-transcr-panels.js'

const TAG = 'vide-transcr-panels-coverage-test'

if (!customElements.get(TAG)) {
  customElements.define(TAG, VideTranscrPanels)
}

class FakeRect {
  constructor (x, y, width, height, degrees) {
    this.x = x
    this.y = y
    this.width = width
    this.height = height
    this.degrees = degrees
  }
}

function createPanels ({ render = false, ready = false, viewers = null } = {}) {
  const panels = document.createElement(TAG)
  if (render) panels.render()
  if (ready) panels._ready = Promise.resolve()
  if (viewers) panels.viewers = viewers
  return panels
}

function parseSvg (svgMarkup) {
  return new DOMParser().parseFromString(svgMarkup, 'image/svg+xml').documentElement
}

describe('VideTranscrPanels coverage-focused tests', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    window.OpenSeadragon = { Rect: FakeRect }
    global.requestAnimationFrame = vi.fn(() => 1)
    global.cancelAnimationFrame = vi.fn()
    vi.spyOn(performance, 'now').mockReturnValue(0)

    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => {}
    }
  })

  it('resets internal state on disconnect and destroys viewers', () => {
    const panels = createPanels()
    const destroyA = vi.fn()
    const destroyB = vi.fn()

    panels.viewers = [{ destroy: destroyA }, { destroy: destroyB }]
    panels._shapeLinks = { a: ['b'] }
    panels._atLinks = { x: 'y' }

    panels.disconnectedCallback()

    expect(destroyA).toHaveBeenCalledTimes(1)
    expect(destroyB).toHaveBeenCalledTimes(1)
    expect(panels.viewers).toEqual([])
    expect(panels._shapeLinks).toBe(null)
    expect(panels._atLinks).toBe(null)
    expect(panels._panelStepValues).toEqual([2, 3, 8])
  })

  it('clamps and animates steps via buttons', () => {
    const panels = createPanels()
    const animateSpy = vi.spyOn(panels, '_animatePanelStep').mockImplementation(() => {})

    panels._panelStepValues[0] = 1
    panels._stepByButton(0, -1)
    expect(animateSpy).not.toHaveBeenCalled()

    panels._panelStepValues[0] = 3
    panels._stepByButton(0, 1)
    expect(animateSpy).toHaveBeenCalledWith(0, 4)

    expect(panels._snapStep(0.2)).toBe(1)
    expect(panels._snapStep(6.9)).toBe(7)
  })

  it('animates slider and commits final step', () => {
    const panels = createPanels({ render: true })

    panels._panelStepValues[0] = 2
    const setSpy = vi.spyOn(panels, '_setPanelStep')

    panels._animatePanelStep(0, 3)
    const tick = global.requestAnimationFrame.mock.calls[0][0]
    tick(2000)

    expect(setSpy).toHaveBeenCalledWith(0, 3)
    expect(global.requestAnimationFrame).toHaveBeenCalled()
  })

  it('cancels existing animation and covers in-progress RAF branch', () => {
    const panels = createPanels({ render: true })
    panels._panelStepValues[0] = 2
    panels._activeSliderAnimations[0] = 99

    const rafCallbacks = []
    global.requestAnimationFrame = vi.fn(cb => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })

    panels._animatePanelStep(0, 3)
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(99)

    rafCallbacks[0](100)
    expect(global.requestAnimationFrame).toHaveBeenCalledTimes(2)
  })

  it('applies step values to image, shapes and FT overlays', () => {
    const panels = createPanels()
    const setOpacity = vi.fn()
    const setProgress = vi.fn()
    const shapesEl = document.createElement('svg')
    const ftWrapper = document.createElement('div')

    panels._baseImageItems[0] = { setOpacity }
    panels._shapesSvgEls[0] = shapesEl
    panels._ftOverlayEls[0] = ftWrapper
    panels._panelAnimations[0] = { setProgress }

    panels._applyStepValue(0, 2.5, { commit: false, syncUi: false })
    expect(setOpacity).toHaveBeenCalled()
    expect(shapesEl.style.opacity).not.toBe('')
    expect(ftWrapper.style.opacity).not.toBe('')
    expect(setProgress).toHaveBeenCalled()

    panels._applyStepValue(0, 7, { commit: true, syncUi: false })
    expect(panels._panelStepValues[0]).toBe(7)

    panels._applyStepValue(0, 3.5, { commit: false, syncUi: false })
    expect(setOpacity).toHaveBeenCalled()

    panels._applyStepValue(0, 1, { commit: false, syncUi: false })
    expect(shapesEl.style.opacity).toBe('0')
  })

  it('configurePanels ignores non-numeric defaults', () => {
    const panels = createPanels()
    const uiSpy = vi.spyOn(panels, '_updateStepUi').mockImplementation(() => {})
    const applySpy = vi.spyOn(panels, '_applyStepValue').mockImplementation(() => {})

    panels.configurePanels({ defaultSteps: [4, 'x', 6] })

    expect(panels._panelStepValues[0]).toBe(4)
    expect(panels._panelStepValues[1]).toBe(3)
    expect(panels._panelStepValues[2]).toBe(6)
    expect(uiSpy).toHaveBeenCalledTimes(3)
    expect(applySpy).toHaveBeenCalledTimes(3)
  })

  it('initializes viewers and links panels when OSD is available', () => {
    const created = []

    class FakeViewer {
      constructor (opts) {
        this.opts = opts
        this.handlers = {}
        this.viewport = {
          getCenter: vi.fn(() => ({ x: 1, y: 2 })),
          getZoom: vi.fn(() => 3),
          panTo: vi.fn(),
          zoomTo: vi.fn()
        }
        created.push(this)
      }

      addHandler (name, cb) {
        this.handlers[name] = cb
      }

      destroy () {}
    }

    class FakeOSD extends FakeViewer {}
    FakeOSD.Rect = FakeRect
    window.OpenSeadragon = FakeOSD

    const panels = createPanels({ render: true })

    const configureSpy = vi.spyOn(panels, 'configurePanels').mockImplementation(() => {})

    panels._initViewers()

    expect(created).toHaveLength(3)
    expect(configureSpy).toHaveBeenCalled()
  })

  it('retries init when OSD is not yet loaded', () => {
    const panels = createPanels()
    const timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(() => 1)

    window.OpenSeadragon = null
    panels._initViewers()

    expect(timeoutSpy).toHaveBeenCalled()
  })

  it('syncs linked viewers only for active panel', () => {
    const panels = createPanels()
    panels.innerHTML = '<div id="transcr-panel-0"></div><div id="transcr-panel-1"></div>'

    const panTo = vi.fn()
    const zoomTo = vi.fn()

    const srcViewer = {
      viewport: { getCenter: () => ({ x: 5, y: 6 }), getZoom: () => 2, panTo: vi.fn(), zoomTo: vi.fn() },
      addHandler: vi.fn(function (name, cb) { this._handler = cb })
    }
    const tgtViewer = {
      viewport: { getCenter: () => ({ x: 0, y: 0 }), getZoom: () => 1, panTo, zoomTo },
      addHandler: vi.fn(function (name, cb) { this._handler = cb })
    }

    panels.viewers = [srcViewer, tgtViewer]
    panels._linkViewers(0, 1)

    const srcEl = panels.querySelector('#transcr-panel-0')
    const tgtEl = panels.querySelector('#transcr-panel-1')
    srcEl.dispatchEvent(new Event('pointerenter'))
    srcViewer._handler()

    expect(panTo).toHaveBeenCalled()
    expect(zoomTo).toHaveBeenCalled()

    srcEl.dispatchEvent(new PointerEvent('pointerleave', { buttons: 1, bubbles: true }))
    srcViewer._handler()
    expect(panTo).toHaveBeenCalledTimes(2)

    srcEl.dispatchEvent(new PointerEvent('pointerleave', { buttons: 0, bubbles: true }))
    srcViewer._handler()
    expect(panTo).toHaveBeenCalledTimes(2)

    tgtEl.dispatchEvent(new Event('pointerenter'))
    srcEl.dispatchEvent(new Event('pointerup'))
    srcViewer._handler()
    expect(panTo).toHaveBeenCalledTimes(2)
  })

  it('handles renderedWz and ft overlay success and failures', async () => {
    const panels = createPanels({ ready: true })
    const addOverlay = vi.fn()
    panels.viewers = [{ addOverlay }, { addOverlay }, null]

    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Boom' })
    await expect(panels.loadRenderedWzOverlay(0, 'https://example.test/wz.svg', { width: 10, height: 20 }))
      .rejects.toThrow('renderedWz fetch failed')

    global.fetch.mockResolvedValueOnce({ ok: true, text: async () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })
    await panels.loadRenderedWzOverlay(0, 'https://example.test/wz.svg', { width: 10, height: 20 })
    expect(addOverlay).toHaveBeenCalled()

    global.fetch.mockResolvedValueOnce({ ok: true, text: async () => '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="opacity" values="0;1" /></svg>' })
    await panels.loadFtOverlay(1, 'https://example.test/ft.svg', { width: 10, height: 20 })
    expect(panels._panelAnimations[1]).toBeTruthy()
    expect(panels._ftOverlayEls[1]).toBeTruthy()
  })

  it('loads AT svg, supports wheel zoom and drag panning', async () => {
    const panels = createPanels({ render: true, ready: true })

    const viewerDestroy = vi.fn()
    panels.viewers = [{ destroy: viewerDestroy }, null, null]

    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g data-id="a1"/></svg>'
    })

    await panels.loadSvg(0, 'https://example.test/at.svg')

    expect(viewerDestroy).toHaveBeenCalled()
    const panelEl = panels.querySelector('#transcr-panel-0')
    const wrapper = panelEl.firstElementChild
    const svg = wrapper.querySelector('svg')

    Object.defineProperty(wrapper, 'clientHeight', { value: 600, configurable: true })
    wrapper.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, clientX: 20, clientY: 30, bubbles: true, cancelable: true }))
    wrapper.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }))
    wrapper.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 20, clientY: 30, bubbles: true }))
    wrapper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))

    expect(svg.classList.contains('atTranscription')).toBe(true)
    expect(panels._atSvgEl).toBeTruthy()
  })

  it('throws on AT svg fetch and parse failures', async () => {
    const panels = createPanels({ render: true, ready: true })
    panels.viewers = [null, null, null]

    global.fetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
    await expect(panels.loadSvg(0, 'https://example.test/missing.svg')).rejects.toThrow('SVG fetch failed')

    global.fetch.mockResolvedValueOnce({ ok: true, text: async () => '<svg><parsererror>bad</parsererror></svg>' })
    await expect(panels.loadSvg(0, 'https://example.test/bad.svg')).rejects.toThrow('SVG parse error')
  })

  it('runs connectedCallback render + RAF init hook', () => {
    const panels = createPanels()
    const initSpy = vi.spyOn(panels, '_initViewers').mockImplementation(() => {})
    const rafSpy = vi.spyOn(global, 'requestAnimationFrame').mockImplementation(cb => {
      cb()
      return 1
    })

    panels.connectedCallback()

    expect(rafSpy).toHaveBeenCalled()
    expect(initSpy).toHaveBeenCalled()
    expect(panels.querySelector('#transcr-panel-0')).toBeTruthy()
  })

  it('commits slider value on change when pointer is not down', () => {
    const panels = createPanels({ render: true })

    const slider = panels.querySelector('[data-step-slider="0"]')
    slider.value = '5.7'
    slider.dispatchEvent(new Event('change'))

    expect(panels._panelStepValues[0]).toBe(6)
  })

  it('covers disableAutoAnimation catch branch for throwing endElement', async () => {
    const panels = createPanels({ ready: true, viewers: [null, { addOverlay: vi.fn() }, null] })

    global.fetch.mockResolvedValue({ ok: true, text: async () => '<svg xmlns="http://www.w3.org/2000/svg"><g><animate attributeName="opacity" values="0;1"/></g></svg>' })
    await panels.loadFtOverlay(1, 'https://example.test/ft.svg', { width: 10, height: 20 })

    const controller = panels._panelAnimations[1]
    const throwingEl = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      endElement: () => { throw new Error('boom') }
    }
    controller.animations = [{ element: throwingEl }]

    expect(() => controller.disableAutoAnimation()).not.toThrow()
    expect(throwingEl.setAttribute).toHaveBeenCalledWith('begin', 'indefinite')
    expect(throwingEl.removeAttribute).toHaveBeenCalledWith('repeatCount')
  })

  it('handles setShapeLinks/setAtLinks and highlight init gating', () => {
    const panels = createPanels()
    const initSpy = vi.spyOn(panels, '_initHighlighting').mockImplementation(() => {})

    panels._shapesSvgEls = [null, null, null]
    panels._dtSvgEls = [null, null, null]
    panels.setShapeLinks({ dt1: ['s1'] })
    expect(initSpy).not.toHaveBeenCalled()

    const docA = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="s1"/></svg>')
    const docB = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g data-id="dt1"/></svg>')
    panels._shapesSvgEls = [docA, null, null]
    panels._dtSvgEls = [docB, null, null]

    panels.setAtLinks({ at1: ['dt1'] })
    expect(initSpy).toHaveBeenCalledTimes(1)
  })

  it('covers fluid controller interpolation branches', async () => {
    const panels = createPanels({ ready: true })
    const addOverlay = vi.fn()
    panels.viewers = [null, { addOverlay }, null]

    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g id="n" opacity="0"><animate attributeName="opacity" values="0;1"/></g><g id="t" transform="translate(0 0)"><animateTransform attributeName="transform" type="translate" values="0 0;10 20"/></g><path id="p" d="M0 0 L1 1"><animate attributeName="d" values="M0 0 L1 1;M2 2 L3 3"/></path><polyline id="pts" points="0,0 10,10"><animate attributeName="points" values="0,0 10,10;20,20 30,30"/></polyline></svg>'
    global.fetch.mockResolvedValue({ ok: true, text: async () => svg })

    await panels.loadFtOverlay(1, 'https://example.test/ft.svg', { width: 10, height: 20 })
    const controller = panels._panelAnimations[1]

    const aOpacity = { attributeName: 'opacity' }
    const aTransform = { attributeName: 'transform', transformType: 'translate' }
    const aPath = { attributeName: 'd' }
    const aPoints = { attributeName: 'points' }
    const aFallback = { attributeName: 'unknown' }

    expect(controller.interpolateBetweenValues('0', '1', 0.5, aOpacity)).toBe('0.5')
    expect(controller.interpolateBetweenValues('0 0', '10 20', 0.5, aTransform)).toBe('5 10')
    expect(controller.interpolateBetweenValues('M0 0', 'M2 2', 0.5, aPath)).toContain('1')
    expect(controller.interpolateBetweenValues('0,0 10,10', '20,20 30,30', 0.5, aPoints)).toBe('10,10 20,20')
    expect(controller.interpolateBetweenValues('a', 'b', 0.2, aFallback)).toBe('a')
    expect(controller.interpolateBetweenValues('a', 'b', 0.7, aFallback)).toBe('b')

    expect(controller.interpolatePathData('M0 0', 'M1', 0.5)).toBe('M1')
    expect(controller.interpolatePoints('0,0', '0,0 1,1', 0.5)).toBe('0,0 1,1')
    expect(controller.parseTranslateValues('x y')).toEqual({ x: 0, y: 0 })
  })

  it('covers early returns for missing overlays and default page bounds branch', async () => {
    const panels = createPanels({ ready: true, viewers: [null, null, null] })

    await expect(panels.loadRenderedWzOverlay(0, '', { width: 1, height: 1 })).resolves.toBeUndefined()
    await expect(panels.loadFtOverlay(0, '', { width: 1, height: 1 })).resolves.toBeUndefined()

    const fitBounds = vi.fn()
    const viewer = {
      addTiledImage: vi.fn(({ success }) => success({ item: { setOpacity: vi.fn() } })),
      viewport: { fitBounds }
    }
    panels.viewers = [viewer, null, null]

    await panels.loadPageImage(0, {
      image: 'https://example.test/page.jpg#xywh=0,0,10,10&rotate=0',
      px: { width: 10, height: 10 },
      mm: { width: 5, height: 5 }
    })

    expect(fitBounds).toHaveBeenCalledTimes(1)
    const firstArg = fitBounds.mock.calls[0][0]
    expect(firstArg.width).toBe(5)
    expect(firstArg.height).toBe(5)
  })

  it('supports AT links as scalar and array in highlighting map', () => {
    const panels = createPanels()
    const shapeDoc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="shape-a"></g></svg>')
    const dtDoc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g data-id="dt-a"></g><g data-id="dt-b"></g></svg>')
    const atDoc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g data-id="at-a"></g><g data-id="at-b"></g></svg>')

    panels._shapesSvgEls = [shapeDoc]
    panels._dtSvgEls = [dtDoc]
    panels._shapeLinks = { 'dt-a': ['shape-a'], 'dt-b': ['shape-a'] }
    panels._atSvgEl = atDoc
    panels._atLinks = { 'at-a': 'dt-a', 'at-b': ['dt-a', 'dt-b'] }

    panels._initHighlighting()
    const dtA = dtDoc.querySelector('[data-id="dt-a"]')
    dtA.dispatchEvent(new Event('mouseenter'))
    expect(dtA.classList.contains('highlighted')).toBe(true)
  })

  it('does not rebind highlight listeners on repeated init', () => {
    const panels = createPanels()
    const shapeDoc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="shape-a"></g></svg>')
    const dtDoc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g data-id="dt-a"></g></svg>')

    panels._shapesSvgEls = [shapeDoc]
    panels._dtSvgEls = [dtDoc]
    panels._shapeLinks = { 'dt-a': ['shape-a'] }

    panels._initHighlighting()
    const dtA = dtDoc.querySelector('[data-id="dt-a"]')
    expect(dtA.dataset.transcrHighlightBound).toBe('1')

    panels._initHighlighting()
    expect(dtA.dataset.transcrHighlightBound).toBe('1')
  })

  it('covers loadShapesOverlay guards and error branches', async () => {
    const panels = createPanels({ ready: true, viewers: [{ addOverlay: vi.fn() }, null, null] })

    await expect(panels.loadShapesOverlay(0, { ...makeMinimalPage(), shapes: '' })).resolves.toBeUndefined()
    await expect(panels.loadShapesOverlay(1, { ...makeMinimalPage(), shapes: 'https://example.test/shapes.svg' })).resolves.toBeUndefined()

    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Boom' })
    await expect(panels.loadShapesOverlay(0, { ...makeMinimalPage(), shapes: 'https://example.test/shapes.svg' })).rejects.toThrow('Shapes fetch failed')

    global.fetch.mockResolvedValueOnce({ ok: true, text: async () => '<svg><parsererror>bad</parsererror></svg>' })
    await expect(panels.loadShapesOverlay(0, { ...makeMinimalPage(), shapes: 'https://example.test/shapes.svg' })).rejects.toThrow('Shapes SVG parse error')
  })
})

function makeMinimalPage () {
  return {
    image: 'https://example.test/page.jpg#xywh=0,0,10,10&rotate=0',
    px: { width: 10, height: 10 },
    mm: { width: 5, height: 5 },
    shapesGroupId: 'g1'
  }
}
