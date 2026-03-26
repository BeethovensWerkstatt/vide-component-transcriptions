import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VideTranscrRouter } from '../src/vide-transcr-router.js'

function makeRouter () {
  const router = Object.create(VideTranscrRouter.prototype)
  router.basePath = '/transcr'
  router.contentEl = document.createElement('div')
  router.app = document.createElement('div')
  return router
}

describe('VideTranscrRouter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/transcr/')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => []
    })
  })

  describe('constructor behavior', () => {
    it('logs and returns when content component is missing', () => {
      const app = document.createElement('div')
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const router = new VideTranscrRouter(app)

      expect(errorSpy).toHaveBeenCalledWith('[VideTranscr] Content component not found')
      expect(router.contentEl).toBeNull()
      errorSpy.mockRestore()
    })

    it('initializes when content component exists', () => {
      const app = document.createElement('div')
      const content = document.createElement('vide-transcr-content')
      app.appendChild(content)
      const initSpy = vi.spyOn(VideTranscrRouter.prototype, 'init').mockImplementation(() => {})

      const router = new VideTranscrRouter(app)

      expect(router.contentEl).toBe(content)
      expect(initSpy).toHaveBeenCalledOnce()
      initSpy.mockRestore()
    })
  })

  describe('route dispatch', () => {
    it('routes home path to renderHome', () => {
      const router = makeRouter()
      router.renderHome = vi.fn()
      router.renderNotFound = vi.fn()
      router.loadDocument = vi.fn()
      router.loadWritingZone = vi.fn()

      router.route('/')

      expect(router.renderHome).toHaveBeenCalledOnce()
      expect(router.renderNotFound).not.toHaveBeenCalled()
      expect(router.loadDocument).not.toHaveBeenCalled()
      expect(router.loadWritingZone).not.toHaveBeenCalled()
    })

    it('routes unknown document to not-found renderer', () => {
      const router = makeRouter()
      router.renderHome = vi.fn()
      router.renderNotFound = vi.fn()
      router.loadDocument = vi.fn()
      router.loadWritingZone = vi.fn()

      router.route('/UNKNOWN/')

      expect(router.renderNotFound).toHaveBeenCalledOnce()
      expect(router.renderNotFound).toHaveBeenCalledWith('/UNKNOWN/')
      expect(router.loadDocument).not.toHaveBeenCalled()
    })

    it('routes known document to overview loading', () => {
      const router = makeRouter()
      router.renderHome = vi.fn()
      router.renderNotFound = vi.fn()
      router.loadDocument = vi.fn()
      router.loadWritingZone = vi.fn()

      router.route('/NK/')

      expect(router.loadDocument).toHaveBeenCalledWith('NK')
      expect(router.loadWritingZone).not.toHaveBeenCalled()
    })

    it('routes writing-zone path to zone loading', () => {
      const router = makeRouter()
      router.renderHome = vi.fn()
      router.renderNotFound = vi.fn()
      router.loadDocument = vi.fn()
      router.loadWritingZone = vi.fn()

      router.route('/NK/wz2.3/')

      expect(router.loadWritingZone).toHaveBeenCalledWith('NK', 'wz2.3')
    })
  })

  describe('init and path handling', () => {
    it('getCurrentPath strips base path', () => {
      const router = makeRouter()
      window.history.replaceState({}, '', '/transcr/NK/wz1.1/')

      expect(router.getCurrentPath()).toBe('/NK/wz1.1/')
    })

    it('getCurrentPath returns root outside base path', () => {
      const router = makeRouter()
      window.history.replaceState({}, '', '/outside')

      expect(router.getCurrentPath()).toBe('/')
    })

    it('init consumes _path and routes with replaceState', () => {
      const router = makeRouter()
      router.app = document.createElement('div')
      router.route = vi.fn()
      const replaceSpy = vi.spyOn(window.history, 'replaceState')

      window.history.replaceState({}, '', '/transcr/?_path=%2FNK%2F')
      router.init()

      expect(replaceSpy).toHaveBeenCalledWith({ path: '/NK/' }, '', '/transcr/NK/')
      expect(router.route).toHaveBeenCalledWith('/NK/')
    })

    it('init routes current path when no _path is present', () => {
      const router = makeRouter()
      router.app = document.createElement('div')
      router.route = vi.fn()
      router.getCurrentPath = vi.fn(() => '/NK/')

      window.history.replaceState({}, '', '/transcr/NK/')
      router.init()

      expect(router.route).toHaveBeenCalledWith('/NK/')
    })

    it('init handles popstate and click-based SPA navigation', () => {
      const router = makeRouter()
      router.app = document.createElement('div')
      const routeSpy = vi.fn()
      router.route = routeSpy
      router.getCurrentPath = vi.fn(() => '/NK/')
      const pushSpy = vi.spyOn(window.history, 'pushState')

      window.history.replaceState({}, '', '/transcr/NK/')
      router.init()

      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(routeSpy).toHaveBeenCalledWith('/NK/')

      const link = document.createElement('a')
      link.setAttribute('data-spa-link', '')
      link.setAttribute('href', '/transcr/NK/wz1.1/')
      router.app.appendChild(link)
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(pushSpy).toHaveBeenCalledWith({ path: '/NK/wz1.1/' }, '', '/transcr/NK/wz1.1/')
      expect(routeSpy).toHaveBeenCalledWith('/NK/wz1.1/')
    })
  })

  describe('parsing and helpers', () => {
    it('parses valid writing-zone specs', () => {
      const router = makeRouter()

      expect(router.parseWzSpec('wz1.1')).toEqual({ pageIndex: 0, wzIndex: 0 })
      expect(router.parseWzSpec('wz12.4')).toEqual({ pageIndex: 11, wzIndex: 3 })
    })

    it('rejects malformed writing-zone specs', () => {
      const router = makeRouter()

      expect(router.parseWzSpec('wz1')).toBeNull()
      expect(router.parseWzSpec('wz1-2')).toBeNull()
      expect(router.parseWzSpec('foo')).toBeNull()
    })

    it('formats key signatures correctly', () => {
      const router = makeRouter()

      expect(router.formatKeySig('0')).toBe('0')
      expect(router.formatKeySig('3f')).toBe('3♭')
      expect(router.formatKeySig('2s')).toBe('2♯')
      expect(router.formatKeySig('weird')).toBe('weird')
    })

    it('escapes HTML control characters', () => {
      const router = makeRouter()
      const input = '<a&"\'>'

      expect(router.escapeHtml(input)).toBe('&lt;a&amp;&quot;&#39;&gt;')
    })
  })

  describe('metadata rendering', () => {
    it('renders home, not-found and error views', () => {
      const router = makeRouter()
      router.contentEl = {
        html: '',
        setContent (html) { this.html = html }
      }

      router.renderHome()
      expect(router.contentEl.html).toContain('Transkriptionen')

      router.renderNotFound('/<bad>/')
      expect(router.contentEl.html).toContain('&lt;bad&gt;')

      router.renderError('kaputt', new Error('boom'))
      expect(router.contentEl.html).toContain('kaputt')
      expect(router.contentEl.html).toContain('Error: boom')

      router.renderError('still kaputt')
      expect(router.contentEl.html).not.toContain('<pre>undefined</pre>')
    })

    it('setupSidePanel returns safely when panel structure is missing', () => {
      const router = makeRouter()
      router.contentEl.innerHTML = ''

      expect(() => router.setupSidePanel()).not.toThrow()
    })

    it('setupSidePanel toggles collapsed and active tab state', () => {
      const router = makeRouter()
      router.contentEl.innerHTML = `
        <div id="side-panel">
          <button class="side-panel-tab active" data-panel="info">Info</button>
          <button class="side-panel-tab" data-panel="other">Other</button>
        </div>
      `

      router.setupSidePanel()

      const sidePanel = router.contentEl.querySelector('#side-panel')
      const tabs = router.contentEl.querySelectorAll('.side-panel-tab')

      tabs[0].click()
      expect(sidePanel.classList.contains('collapsed')).toBe(true)

      tabs[1].click()
      expect(sidePanel.classList.contains('collapsed')).toBe(false)
      expect(tabs[1].classList.contains('active')).toBe(true)
      expect(tabs[0].classList.contains('active')).toBe(false)
    })

    it('renders fallback sections when metadata is missing', () => {
      const router = makeRouter()

      const html = router.createWzMetadata({})

      expect(html).toContain('no-sketch-props')
      expect(html).toContain('no-wz-props')
      expect(html).toContain('no-work-relations')
    })

    it('renders rich metadata including relation target descriptions', () => {
      const router = makeRouter()
      const zone = {
        sketchProps: {
          staves: 2,
          atMeasures: 4,
          keySig: { val: '3f', supplied: true },
          meterSig: { val: '2/4', supplied: false },
          tempo: { val: 'Allegro', supplied: true }
        },
        wzProps: {
          staves: 1,
          layers: ['a', 'b'],
          metaNavigation: true,
          metaClarification: true,
          otherMeta: true
        },
        workRelations: [
          {
            opus: 'Op.120',
            work: 'Diabelli-Variationen',
            target: {
              start: { mdivPos: 1, label: '10' },
              end: { mdivPos: 1, label: '13' }
            }
          },
          {
            opus: 'Op.120',
            work: 'Diabelli-Variationen',
            target: {
              name: 'measure',
              mdivPos: 2,
              label: '44'
            }
          },
          {
            opus: 'Op.125',
            work: 'Sinfonie Nr. 9',
            target: {
              name: 'mdiv',
              mdivLabel: 'Scherzo'
            }
          }
        ]
      }

      const html = router.createWzMetadata(zone)

      expect(html).toContain('Vorzeichnung: <strong>3♭</strong>')
      expect(html).toContain('Taktart: <strong>2/4</strong>')
      expect(html).toContain('Tempo: <strong>Allegro</strong>')
      expect(html).toContain('1. Satz, T. 10–13')
      expect(html).toContain('2. Satz, T. 44')
      expect(html).toContain('Scherzo')
    })

    it('covers relation-target fallback branches and skips empty targets', () => {
      const router = makeRouter()
      const zone = {
        sketchProps: { staves: 1 },
        wzProps: { layers: ['a'] },
        workRelations: [
          {
            opus: 'Op.10',
            work: 'Werk A',
            target: null
          },
          {
            opus: 'Op.11',
            work: 'Werk B',
            target: {
              start: { label: '1' },
              end: { label: '3' }
            }
          },
          {
            opus: 'Op.12',
            work: 'Werk C',
            target: {
              name: 'measure',
              label: '9'
            }
          },
          {
            opus: 'Op.13',
            work: 'Werk D',
            target: {
              name: 'mdiv',
              mdivLabel: '   ',
              label: '4'
            }
          },
          {
            opus: 'Op.14',
            work: 'Werk E',
            target: {
              name: 'mdiv'
            }
          }
        ]
      }

      const html = router.createWzMetadata(zone)

      expect(html).toContain('T. 1–3')
      expect(html).toContain('T. 9')
      expect(html).toContain('4. Satz')
      expect(html).not.toContain('undefined')
    })

    it('populates side panel with zone list and active element marker', () => {
      const router = makeRouter()
      router.contentEl.innerHTML = '<div class="panel-section" data-panel="info"></div>'
      const zone = {
        sketchProps: { staves: 1 },
        wzProps: { layers: ['a'] },
        workRelations: []
      }

      router.populateWzMetadata(zone, {
        docId: 'NK',
        wzOccurrences: [
          { pageIndex: 0, label: '1' },
          { pageIndex: 1, label: '2' }
        ],
        activeOccIdx: 1
      })

      const panel = router.contentEl.querySelector('.panel-section[data-panel="info"]')
      expect(panel.innerHTML).toContain('wz-nav-list')
      expect(panel.querySelectorAll('.wz-nav-item').length).toBe(2)
      expect(panel.querySelectorAll('.wz-nav-item.active').length).toBe(1)
      expect(panel.innerHTML).toContain('/transcr/NK/wz1.1/')
    })
  })

  describe('programmatic navigation', () => {
    it('navigateTo pushes state and routes to document', () => {
      const router = makeRouter()
      const pushStateSpy = vi.spyOn(window.history, 'pushState')
      router.route = vi.fn()

      router.navigateTo('NK')

      expect(pushStateSpy).toHaveBeenCalledWith({ path: '/NK' }, '', '/transcr/NK')
      expect(router.route).toHaveBeenCalledWith('/NK')
    })

    it('navigateToWz pushes state and routes to writing zone', () => {
      const router = makeRouter()
      const pushStateSpy = vi.spyOn(window.history, 'pushState')
      router.route = vi.fn()

      router.navigateToWz('NK', 3, 2)

      expect(pushStateSpy).toHaveBeenCalledWith({ path: '/NK/wz3.2' }, '', '/transcr/NK/wz3.2')
      expect(router.route).toHaveBeenCalledWith('/NK/wz3.2')
    })
  })
})
