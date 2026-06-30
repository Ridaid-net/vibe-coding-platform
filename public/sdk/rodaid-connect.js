/*!
 * RODAID Open-Connect SDK — Botón de Verificación (Hito 16).
 *
 * Integra el "Botón de Verificación" de RODAID en cualquier sitio web con UNA
 * sola línea, manteniendo el flujo de confianza: el botón consulta el Verificador
 * Público de RODAID y muestra el veredicto (segura / robada / en validación) con
 * un enlace a la verificación oficial. No expone datos personales del propietario.
 *
 * Uso mínimo:
 *   <script src="https://rodaid.netlify.app/sdk/rodaid-connect.js"
 *           data-rodaid-serial="ABC123" async></script>
 *
 * O bien, declarativo en cualquier contenedor:
 *   <div data-rodaid-verify data-serial="ABC123"></div>
 *
 * O programático:
 *   RodaidConnect.mount(elemento, { serial: "ABC123" })
 *   RodaidConnect.verify("ABC123").then(console.log)
 *
 * Modo OAuth (consentimiento del dueño antes de compartir con un tercero):
 *   <div data-rodaid-verify data-client-id="rid_..." data-redirect-uri="https://app/cb"
 *        data-scope="verificacion:read"></div>
 */
(function () {
  'use strict'

  // Origen de RODAID: se deriva del propio <script> que cargó este SDK.
  var SELF = document.currentScript || (function () {
    var s = document.getElementsByTagName('script')
    for (var i = s.length - 1; i >= 0; i--) {
      if (s[i].src && s[i].src.indexOf('rodaid-connect.js') !== -1) return s[i]
    }
    return null
  })()

  var ORIGIN = (function () {
    try {
      if (SELF && SELF.src) return new URL(SELF.src).origin
    } catch (e) {}
    return 'https://rodaid.netlify.app'
  })()

  var ESTADOS = {
    SEGURO: { etiqueta: 'Identidad verificada', color: '#3f6212', fondo: '#ecfccb', emoji: '✔' },
    ROBADA: { etiqueta: 'Reportada como robada', color: '#9f1239', fondo: '#ffe4e6', emoji: '⚠' },
    EN_VALIDACION: { etiqueta: 'En validación', color: '#854d0e', fondo: '#fef9c3', emoji: '⏳' },
    SIN_VERIFICAR: { etiqueta: 'Sin identidad verificada', color: '#854d0e', fondo: '#fef9c3', emoji: '?' },
    NO_ENCONTRADA: { etiqueta: 'No encontrada', color: '#44403c', fondo: '#f5f5f4', emoji: '—' }
  }

  var CSS = [
    '.rodaid-connect{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:inline-block;max-width:380px}',
    '.rodaid-btn{display:inline-flex;align-items:center;gap:.5rem;cursor:pointer;border:0;border-radius:999px;background:#14160e;color:#f2efe4;font-size:14px;font-weight:600;padding:.6rem 1.1rem;line-height:1;transition:transform .15s ease,opacity .15s ease}',
    '.rodaid-btn:hover{transform:translateY(-1px)}',
    '.rodaid-btn:disabled{opacity:.6;cursor:progress}',
    '.rodaid-btn .rodaid-dot{width:9px;height:9px;border-radius:999px;background:#bef264;box-shadow:0 0 0 3px rgba(190,242,100,.25)}',
    '.rodaid-result{margin-top:.6rem;border:1px solid rgba(20,22,14,.12);border-radius:14px;padding:.85rem 1rem;background:#f2efe4}',
    '.rodaid-badge{display:inline-flex;align-items:center;gap:.4rem;border-radius:999px;font-size:12.5px;font-weight:700;padding:.28rem .7rem}',
    '.rodaid-title{margin:.55rem 0 .15rem;font-size:15px;font-weight:700;color:#14160e}',
    '.rodaid-msg{margin:0;font-size:13px;line-height:1.45;color:#4b4f40}',
    '.rodaid-meta{margin-top:.5rem;font-size:11.5px;color:#6f7363;display:flex;flex-wrap:wrap;gap:.4rem .8rem}',
    '.rodaid-link{display:inline-block;margin-top:.55rem;font-size:12.5px;font-weight:600;color:#3f6212;text-decoration:none}',
    '.rodaid-link:hover{text-decoration:underline}',
    '.rodaid-foot{margin-top:.5rem;font-size:10.5px;color:#8a8d7e}'
  ].join('')

  function injectStyles() {
    if (document.getElementById('rodaid-connect-styles')) return
    var st = document.createElement('style')
    st.id = 'rodaid-connect-styles'
    st.textContent = CSS
    ;(document.head || document.documentElement).appendChild(st)
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  // Consulta el Verificador Público (endpoint abierto, sin datos personales).
  function verify(serial) {
    var url = ORIGIN + '/api/v1/verificar/' + encodeURIComponent(String(serial || '').trim())
    return fetch(url, { headers: { accept: 'application/json' } }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error((data && data.message) || 'No se pudo verificar.')
        return data
      })
    })
  }

  function renderResult(container, serial, v) {
    var prev = container.querySelector('.rodaid-result')
    if (prev) prev.remove()
    var cfg = ESTADOS[v.estado] || ESTADOS.NO_ENCONTRADA
    var box = el('div', 'rodaid-result')

    var badge = el('span', 'rodaid-badge')
    badge.style.color = cfg.color
    badge.style.background = cfg.fondo
    badge.appendChild(el('span', null, cfg.emoji))
    badge.appendChild(el('span', null, cfg.etiqueta))
    box.appendChild(badge)

    box.appendChild(el('p', 'rodaid-title', v.titulo || cfg.etiqueta))
    box.appendChild(el('p', 'rodaid-msg', v.mensaje || ''))

    if (v.bicicleta) {
      var meta = el('div', 'rodaid-meta')
      var b = v.bicicleta
      if (b.marca || b.modelo) meta.appendChild(el('span', null, [b.marca, b.modelo].filter(Boolean).join(' ')))
      if (b.numeroSerie) meta.appendChild(el('span', null, 'Serie: ' + b.numeroSerie))
      if (v.bfa && v.bfa.coincide) meta.appendChild(el('span', null, '⛓ Anclada en la BFA'))
      box.appendChild(meta)
    }

    var link = el('a', 'rodaid-link', 'Ver verificación oficial →')
    link.href = ORIGIN + '/verificar/' + encodeURIComponent(serial)
    link.target = '_blank'
    link.rel = 'noopener'
    box.appendChild(link)

    box.appendChild(el('div', 'rodaid-foot', 'Verificado por RODAID · sin datos personales'))
    container.appendChild(box)
  }

  // Modo OAuth: redirige al consentimiento del dueño antes de compartir con la app.
  function startConsent(opts) {
    var u = new URL(ORIGIN + '/conectar')
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', opts.clientId)
    if (opts.redirectUri) u.searchParams.set('redirect_uri', opts.redirectUri)
    u.searchParams.set('scope', opts.scope || 'verificacion:read')
    if (opts.state) u.searchParams.set('state', opts.state)
    if (opts.codeChallenge) {
      u.searchParams.set('code_challenge', opts.codeChallenge)
      u.searchParams.set('code_challenge_method', opts.codeChallengeMethod || 'S256')
    }
    window.location.href = u.toString()
  }

  function mount(container, opts) {
    if (!container) return
    injectStyles()
    opts = opts || {}
    container.classList.add('rodaid-connect')
    container.innerHTML = ''

    var btn = el('button', 'rodaid-btn')
    btn.type = 'button'
    btn.appendChild(el('span', 'rodaid-dot'))

    // Modo OAuth (consentimiento) vs. modo verificación pública.
    if (opts.clientId) {
      btn.appendChild(el('span', null, opts.label || 'Conectar con RODAID'))
      btn.addEventListener('click', function () { startConsent(opts) })
      container.appendChild(btn)
      return
    }

    btn.appendChild(el('span', null, opts.label || 'Verificar con RODAID'))
    container.appendChild(btn)

    function run() {
      var serial = opts.serial || container.getAttribute('data-serial')
      if (!serial) { renderError(container, 'Falta el número de serie.'); return }
      btn.disabled = true
      var original = btn.lastChild.textContent
      btn.lastChild.textContent = 'Verificando…'
      verify(serial).then(function (v) {
        renderResult(container, serial, v)
      }).catch(function (err) {
        renderError(container, err.message)
      }).then(function () {
        btn.disabled = false
        btn.lastChild.textContent = original
      })
    }
    btn.addEventListener('click', run)
    if (opts.auto || container.getAttribute('data-auto') === 'true') run()
  }

  function renderError(container, msg) {
    var prev = container.querySelector('.rodaid-result')
    if (prev) prev.remove()
    var box = el('div', 'rodaid-result')
    box.appendChild(el('p', 'rodaid-msg', msg || 'No se pudo verificar.'))
    container.appendChild(box)
  }

  function readOpts(node) {
    return {
      serial: node.getAttribute('data-serial') || node.getAttribute('data-rodaid-serial'),
      label: node.getAttribute('data-label'),
      auto: node.getAttribute('data-auto') === 'true',
      clientId: node.getAttribute('data-client-id'),
      redirectUri: node.getAttribute('data-redirect-uri'),
      scope: node.getAttribute('data-scope'),
      state: node.getAttribute('data-state')
    }
  }

  function autoInit() {
    // 1) Contenedores declarativos.
    var nodes = document.querySelectorAll('[data-rodaid-verify]')
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-rodaid-mounted')) continue
      nodes[i].setAttribute('data-rodaid-mounted', '1')
      mount(nodes[i], readOpts(nodes[i]))
    }
    // 2) Si el propio <script> trae data-rodaid-serial, monta un botón junto a él.
    if (SELF && (SELF.getAttribute('data-rodaid-serial') || SELF.getAttribute('data-rodaid-client-id'))) {
      if (!SELF.getAttribute('data-rodaid-mounted')) {
        SELF.setAttribute('data-rodaid-mounted', '1')
        var holder = el('div')
        SELF.parentNode.insertBefore(holder, SELF.nextSibling)
        mount(holder, {
          serial: SELF.getAttribute('data-rodaid-serial'),
          label: SELF.getAttribute('data-rodaid-label'),
          clientId: SELF.getAttribute('data-rodaid-client-id'),
          redirectUri: SELF.getAttribute('data-rodaid-redirect-uri'),
          scope: SELF.getAttribute('data-rodaid-scope')
        })
      }
    }
  }

  window.RodaidConnect = {
    origin: ORIGIN,
    mount: mount,
    verify: verify,
    startConsent: startConsent
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit)
  } else {
    autoInit()
  }
})();
