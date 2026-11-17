// tudo da loja num arquivo so, sem framework
(function () {
  const $ = (s, el = document) => el.querySelector(s)
  const $$ = (s, el = document) => [...el.querySelectorAll(s)]

  // menu mobile
  const burger = $('.burger')
  if (burger) burger.addEventListener('click', () => {
    const m = $('.menu')
    m.classList.toggle('aberto')
    burger.setAttribute('aria-expanded', m.classList.contains('aberto'))
  })

  // ---------- carrossel ----------
  const hero = $('.hero')
  if (hero) {
    const slides = $$('.slide', hero)
    const pontos = $$('.pontos button', hero)
    let i = 0, timer
    const ir = n => {
      i = (n + slides.length) % slides.length
      slides.forEach((s, k) => { s.classList.toggle('on', k === i); s.setAttribute('aria-hidden', k !== i) })
      pontos.forEach((p, k) => p.classList.toggle('on', k === i))
    }
    const play = () => { clearInterval(timer); if (slides.length > 1) timer = setInterval(() => ir(i + 1), 6500) }
    $('.seta.ant', hero)?.addEventListener('click', () => { ir(i - 1); play() })
    $('.seta.prox', hero)?.addEventListener('click', () => { ir(i + 1); play() })
    pontos.forEach((p, k) => p.addEventListener('click', () => { ir(k); play() }))
    hero.addEventListener('mouseenter', () => clearInterval(timer))
    hero.addEventListener('mouseleave', play)
    ir(0); play()
  }

  // ---------- toast ----------
  let toastT
  function toast(html) {
    let t = $('.toast')
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t) }
    t.innerHTML = html
    requestAnimationFrame(() => t.classList.add('on'))
    clearTimeout(toastT)
    toastT = setTimeout(() => t.classList.remove('on'), 3500)
  }
  const escapa = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  async function addSacola(variante) {
    const r = await fetch('/sacola/adicionar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ variante, qtd: 1 }),
    })
    const d = await r.json()
    if (!r.ok) { toast(escapa(d.erro || 'Não deu certo, tente de novo.')); return false }
    $$('.js-qtd-sacola').forEach(el => { el.textContent = d.qtd; el.hidden = false })
    toast(`${escapa(d.nome)} · ${escapa(d.tamanho)} na sacola <a href="/sacola">ver sacola</a>`)
    return true
  }

  // quick add: 1o clique mostra tamanhos, 2o adiciona
  document.addEventListener('click', async e => {
    const abre = e.target.closest('.js-quick')
    if (abre) {
      const q = abre.closest('.quick')
      const tams = $$('.tam:not([disabled])', q)
      if (tams.length === 1) { addSacola(tams[0].dataset.v); return } // tamanho unico
      q.classList.add('aberto')
      tams[0]?.focus()
      return
    }
    const tam = e.target.closest('.quick .tam')
    if (tam && !tam.disabled) {
      tam.disabled = true
      await addSacola(tam.dataset.v)
      tam.disabled = false
      tam.closest('.quick').classList.remove('aberto')
    }
  })

  // favoritos
  document.addEventListener('click', async e => {
    const b = e.target.closest('.coracao')
    if (!b) return
    e.preventDefault()
    const r = await fetch('/favoritos/' + b.dataset.id, { method: 'POST', headers: { Accept: 'application/json' } })
    if (r.status === 401) { location.href = '/entrar'; return }
    const d = await r.json()
    b.setAttribute('aria-pressed', d.fav)
    b.setAttribute('aria-label', d.fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos')
  })

  // pagina do produto: escolher tamanho
  const formPdp = $('#form-pdp')
  if (formPdp) {
    const hidden = $('input[name=variante]', formPdp)
    const botao = $('button[type=submit]', formPdp)
    $$('.tam', formPdp).forEach(t => t.addEventListener('click', () => {
      $$('.tam', formPdp).forEach(x => x.setAttribute('aria-pressed', 'false'))
      t.setAttribute('aria-pressed', 'true')
      hidden.value = t.dataset.v
      botao.disabled = false
      botao.textContent = 'Adicionar à sacola'
    }))
    formPdp.addEventListener('submit', async e => {
      e.preventDefault()
      if (!hidden.value) return
      botao.disabled = true
      await addSacola(hidden.value)
      botao.disabled = false
    })
  }

  // ---------- CEP -> endereco (ViaCEP) ----------
  const cep = $('input[name=cep]')
  if (cep) {
    const form = cep.form
    const msg = $('#cep-msg')
    const campo = n => $(`[name=${n}]`, form)
    cep.addEventListener('input', async () => {
      let v = cep.value.replace(/\D/g, '').slice(0, 8)
      cep.value = v.length > 5 ? v.slice(0, 5) + '-' + v.slice(5) : v
      if (v.length !== 8) return
      cep.classList.add('carregando')
      try {
        const r = await fetch(`https://viacep.com.br/ws/${v}/json/`)
        const d = await r.json()
        if (d.erro) { if (msg) msg.textContent = 'CEP não encontrado. Preencha o endereço manualmente.'; return }
        campo('rua').value = d.logradouro || ''
        campo('bairro').value = d.bairro || ''
        campo('cidade').value = d.localidade || ''
        campo('uf').value = d.uf || ''
        if (msg) msg.textContent = ''
        campo(d.logradouro ? 'numero' : 'rua').focus()
        campo('uf').dispatchEvent(new Event('change'))
      } catch {
        if (msg) msg.textContent = 'Não consegui buscar o CEP agora, preencha manualmente.'
      } finally {
        cep.classList.remove('carregando')
      }
    })
  }

  // mascaras simples
  $$('input[name=cpf]').forEach(i => i.addEventListener('input', () => {
    const v = i.value.replace(/\D/g, '').slice(0, 11)
    i.value = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }))
  $$('input[name=telefone]').forEach(i => i.addEventListener('input', () => {
    const v = i.value.replace(/\D/g, '').slice(0, 11)
    i.value = v.length > 10 ? v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : v.replace(/(\d{2})(\d{0,4})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '')
  }))

  // checkout: frete muda com o estado
  const uf = $('#checkout [name=uf]')
  if (uf) uf.addEventListener('change', async () => {
    const r = await fetch('/api/frete?uf=' + encodeURIComponent(uf.value))
    const d = await r.json()
    const fmt = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    $('#frete-valor').textContent = d.frete === null ? '—' : (d.frete === 0 ? 'Grátis' : fmt(d.frete))
    $('#total-valor').textContent = fmt(d.total)
  })

  // cookies
  const ck = $('.cookies')
  if (ck) {
    let ok = false
    try { ok = localStorage.getItem('cookies-ok') === '1' } catch {}
    ck.hidden = ok
    $('button', ck).addEventListener('click', () => {
      ck.hidden = true
      try { localStorage.setItem('cookies-ok', '1') } catch {}
    })
  }
  // console.log('loja.js ok')
})()
