(() => {
  "use strict";

  // ---------- utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const DEMO = new URLSearchParams(location.search).has("demo");
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };
  const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const brl = (v) => (v == null || Number.isNaN(v) ? "—" : moeda.format(v));
  const num1 = (v) => Math.abs(v).toFixed(1).replace(".", ",");
  const numCurto = (v) => String(Math.round(Math.abs(v) * 10) / 10).replace(".", ",");
  const pct = (v) => (v == null ? "" : (v > 0 ? "+" : v < 0 ? "−" : "") + num1(v) + "%");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COR = { 9: "var(--mm9)", 21: "var(--mm21)", 50: "var(--mm50)" };
  const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  function dataCurta(iso) {
    const [a, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}`;
  }
  function rotuloDia(iso) {
    const hoje = hojeISO();
    const ontem = new Date(Date.parse(hoje + "T12:00:00") - 864e5).toISOString().slice(0, 10);
    if (iso === hoje) return "Hoje";
    if (iso === ontem) return "Ontem";
    const sem = new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long" });
    return `${sem.charAt(0).toUpperCase() + sem.slice(1)}, ${dataCurta(iso)}`;
  }
  function quando(isoDataHora) {
    const dia = isoDataHora.slice(0, 10), hora = isoDataHora.slice(11, 16);
    return dia === hojeISO() ? `hoje às ${hora}` : `em ${dataCurta(dia)} às ${hora}`;
  }

  let timerAviso;
  function avisar(texto, tipo = "") {
    const el = $("#aviso");
    el.textContent = texto;
    el.className = `aviso visivel ${tipo}`;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => el.classList.remove("visivel"), tipo === "erro" ? 6000 : 3500);
  }

  // ---------- GitHub (ou dados de demonstração) ----------
  const ARQ = {
    painel: "saida/painel.json", alertas: "saida/notificacoes.json",
    carteira: "dados/carteira.json", config: "dados/config.json",
    operacoes: "dados/operacoes.json", backtest: "saida/backtest.json",
  };
  const demoGravado = {};

  function decodificar(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function codificar(texto) {
    const bytes = new TextEncoder().encode(texto);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  const gh = {
    repo: () => LS.get("gh-repo"),
    token: () => LS.get("gh-token"),
    conectado() { return DEMO || Boolean(this.repo() && this.token()); },
    cab() {
      return {
        Authorization: `Bearer ${this.token()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
    },
    erro(status) {
      if (status === 401) return "Token inválido ou vencido. Gere outro e salve em Ajustes.";
      if (status === 403) return "O token não tem permissão (ou o limite do GitHub foi atingido). Confira Contents: Read and write.";
      if (status === 404) return "Repositório não encontrado. Confira o nome e se o token tem acesso a ele.";
      return `O GitHub respondeu com erro ${status}. Tente de novo em instantes.`;
    },
    async testar(repo, token) {
      const r = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { ...this.cab(), Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!r.ok) throw new Error(this.erro(r.status));
      // o teste de verdade: o token consegue ler os arquivos do monitor? (Contents)
      const c = await fetch(`https://api.github.com/repos/${repo}/contents/dados`, {
        headers: { ...this.cab(), Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (c.status === 403 || c.status === 401) throw new Error("O token entra no repositório, mas não lê os arquivos. Ele precisa de Contents: Read and write.");
      if (!c.ok && c.status !== 404) throw new Error(this.erro(c.status));
    },
    async ler(caminho) {
      if (DEMO) {
        if (caminho in demoGravado) return { dados: structuredClone(demoGravado[caminho]), sha: "demo" };
        const r = await fetch(`demo/${caminho.split("/").pop()}`, { cache: "no-store" });
        return { dados: r.ok ? await r.json() : null, sha: "demo" };
      }
      const r = await fetch(`https://api.github.com/repos/${this.repo()}/contents/${caminho}`,
        { headers: this.cab(), cache: "no-store" });
      if (r.status === 404) return { dados: null, sha: null };
      if (!r.ok) throw new Error(this.erro(r.status));
      const j = await r.json();
      return { dados: JSON.parse(decodificar(j.content)), sha: j.sha };
    },
    // Lê o arquivo mais recente, aplica a mudança e grava. Se o monitor gravar ao mesmo tempo, tenta de novo.
    async alterar(caminho, mudar, mensagem) {
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        const { dados, sha } = await this.ler(caminho);
        const novo = mudar(structuredClone(dados ?? {}));
        if (DEMO) { demoGravado[caminho] = novo; return novo; }
        const corpo = { message: mensagem, content: codificar(JSON.stringify(novo, null, 2) + "\n") };
        if (sha) corpo.sha = sha;
        const r = await fetch(`https://api.github.com/repos/${this.repo()}/contents/${caminho}`,
          { method: "PUT", headers: this.cab(), body: JSON.stringify(corpo) });
        if (r.ok) return novo;
        if (r.status !== 409 && r.status !== 422) throw new Error(this.erro(r.status));
      }
      throw new Error("O arquivo mudou enquanto eu gravava. Toque de novo para tentar.");
    },
  };

  // ---------- dados ----------
  let dados = { painel: null, alertas: [], carteira: {}, config: {}, operacoes: [], backtest: null };
  let erroCarga = null, carregando = false, ultimaCarga = 0;
  try { const c = JSON.parse(LS.get("cache-dados") || "null"); if (c && !DEMO) dados = c; } catch { /* ignora */ }

  async function carregar() {
    if (!gh.conectado() || carregando) { render(); return; }
    carregando = true;
    $("#recarregar").disabled = true;
    $("#atualizado").textContent = "Atualizando…";
    try {
      const [p, a, c, f, o, b] = await Promise.all(
        [ARQ.painel, ARQ.alertas, ARQ.carteira, ARQ.config, ARQ.operacoes, ARQ.backtest].map((x) => gh.ler(x)));
      dados = {
        painel: p.dados, alertas: a.dados || [], carteira: c.dados || {}, config: f.dados || {},
        operacoes: Array.isArray(o.dados) ? o.dados : [], backtest: b.dados,
      };
      if (!DEMO) LS.set("cache-dados", JSON.stringify(dados));
      erroCarga = null;
      ultimaCarga = Date.now();
    } catch (e) {
      erroCarga = e.message || "Sem conexão com o GitHub.";
    }
    carregando = false;
    $("#recarregar").disabled = false;
    render();
  }

  // ---------- abas ----------
  const ABAS = ["carteira", "alertas", "resultados", "ajustes"];
  function abrirAba(nome, salvar = true) {
    if (!ABAS.includes(nome)) nome = "carteira";
    for (const a of ABAS) {
      $(`#${a}`).hidden = a !== nome;
      $(`#tab-${a}`).setAttribute("aria-selected", String(a === nome));
      $(`#tab-${a}`).tabIndex = a === nome ? 0 : -1;
    }
    if (salvar) LS.set("aba", nome);
    if (location.hash !== "#" + nome) history.replaceState(null, "", "#" + nome);
  }
  document.querySelector(".abas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-aba]");
    if (b) { abrirAba(b.dataset.aba); window.scrollTo(0, 0); }
  });
  document.querySelector(".abas").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const atual = ABAS.findIndex((a) => !$(`#${a}`).hidden);
    const prox = ABAS[(atual + (e.key === "ArrowRight" ? 1 : ABAS.length - 1)) % ABAS.length];
    abrirAba(prox);
    $(`#tab-${prox}`).focus();
  });
  window.addEventListener("hashchange", () => abrirAba(location.hash.slice(1)));

  // ---------- render ----------
  function render() {
    renderBarra();
    renderCarteira();
    renderAlertas();
    renderResultados();
    renderAjustes();
  }

  function renderBarra() {
    const el = $("#atualizado");
    if (carregando) return;
    el.classList.toggle("erro", Boolean(erroCarga));
    if (erroCarga) { el.textContent = erroCarga; return; }
    if (!gh.conectado()) { el.textContent = "Não conectado"; return; }
    const ult = dados.painel?.ultima_rodada;
    el.textContent = ult ? `Monitor rodou ${quando(ult)}${DEMO ? " (demonstração)" : ""}` : "O monitor ainda não rodou";
  }

  const GRAFICO_VAZIO = `<svg viewBox="0 0 320 90" aria-hidden="true">
    <path d="M0 52 C 80 50, 160 46, 320 40" stroke="var(--mm50)"/>
    <path d="M0 58 C 80 56, 170 50, 320 32" stroke="var(--mm21)"/>
    <path d="M0 68 C 90 72, 190 60, 320 18" stroke="var(--mm9)"/>
    <path d="M0 76 L30 72 L58 79 L86 74 L112 81 L140 75 L168 78 L196 66 L222 56 L248 42 L272 30 L296 14 L320 6" stroke="var(--preco)" stroke-width="3"/>
  </svg>`;

  // ---------- gráfico de candle ----------
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const GRAF = {};   // dados de cada gráfico na tela, para o toque
  const n2 = (v) => (v == null ? "—" : v.toFixed(2).replace(".", ","));

  function divisoes(lo, hi, alvo) {
    const bruto = (hi - lo) / alvo, mag = 10 ** Math.floor(Math.log10(bruto));
    const passo = [1, 2, 2.5, 5, 10].find((s) => s * mag >= bruto) * mag;
    const res = [];
    for (let v = Math.ceil(lo / passo) * passo; v <= hi; v += passo) res.push(Math.round(v * 100) / 100);
    return res;
  }

  function grafico(id, a, opts = {}) {
    const g = a?.grafico;
    if (!g || !g.c?.length) return `<p class="saida">O gráfico aparece na próxima rodada do monitor.</p>`;
    const W = 340, H = 196, X0 = 2, X1 = W - 42, Y0 = 6, Y1 = H - 20;
    const n = g.c.length, passo = (X1 - X0) / n, corpo = Math.max(1.6, passo * 0.62);
    const vals = [...g.h, ...g.l];
    for (const s of Object.values(g.mm)) for (const v of s) if (v != null) vals.push(v);
    if (opts.stop) vals.push(opts.stop);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const folga = (hi - lo) * 0.05 || hi * 0.01;
    lo -= folga; hi += folga;
    const y = (v) => Y1 - ((v - lo) / (hi - lo)) * (Y1 - Y0);
    const xc = (i) => X0 + passo * (i + 0.5);
    const f = (v) => v.toFixed(1);

    let svg = "";
    const yUlt = y(g.c[n - 1]);
    for (const t of divisoes(lo, hi, 4)) {
      svg += `<line class="grade" x1="${X0}" x2="${X1}" y1="${f(y(t))}" y2="${f(y(t))}"/>`;
      if (Math.abs(y(t) - yUlt) > 13) svg += `<text class="eixo" x="${X1 + 5}" y="${f(y(t) + 3.5)}">${n2(t)}</text>`;
    }
    let mesAnt = null;
    g.d.forEach((d, i) => {
      const m = Number(d.slice(5, 7));
      if (mesAnt !== null && m !== mesAnt) {
        const xm = f(xc(i) - passo / 2);
        svg += `<line class="grade mes" x1="${xm}" x2="${xm}" y1="${Y0}" y2="${Y1}"/>` +
          `<text class="eixo mes" x="${f(xc(i) - passo / 2 + 3)}" y="${H - 6}">${MESES[m - 1]}</text>`;
      }
      mesAnt = m;
    });
    g.c.forEach((c, i) => {
      const o = g.o[i], h = g.h[i], l = g.l[i];
      if ([o, h, l, c].some((v) => v == null)) return;
      const parcial = opts.emAndamento && i === n - 1;
      const topo = y(Math.max(o, c)), alt = Math.max(1, Math.abs(y(o) - y(c)));
      svg += `<g class="vela ${c >= o ? "alta" : "baixa"}${parcial ? " parcial" : ""}">` +
        `<line x1="${f(xc(i))}" x2="${f(xc(i))}" y1="${f(y(h))}" y2="${f(y(l))}"/>` +
        `<rect x="${f(xc(i) - corpo / 2)}" y="${f(topo)}" width="${f(corpo)}" height="${f(alt)}"/></g>`;
    });
    for (const [p, serie] of Object.entries(g.mm)) {
      const pts = serie.map((v, i) => (v == null ? null : `${f(xc(i))},${f(y(v))}`)).filter(Boolean).join(" ");
      if (pts) svg += `<polyline class="mm${Number(p) === opts.saida ? " saida" : ""}" stroke="${COR[p] || "var(--tinta-suave)"}" points="${pts}"/>`;
    }
    if (opts.compra?.data && opts.compra.preco) {
      const i = g.d.indexOf(opts.compra.data);
      if (i >= 0 && g.l[i] != null) {
        const yb = y(g.l[i]) + 5, xi = xc(i);
        svg += `<line class="linha-compra" x1="${f(xi)}" x2="${X1}" y1="${f(y(opts.compra.preco))}" y2="${f(y(opts.compra.preco))}"/>` +
          `<path class="marca-compra" d="M${f(xi)} ${f(yb)} l5 8 h-10 z"/>`;
      }
    }
    if (opts.stop) {
      svg += `<line class="linha-stop" x1="${X0}" x2="${X1}" y1="${f(y(opts.stop))}" y2="${f(y(opts.stop))}"/>` +
        `<text class="eixo stop-txt" x="${X0 + 3}" y="${f(y(opts.stop) - 3)}">stop ${n2(opts.stop)}</text>`;
    }
    const ult = g.c[n - 1];
    svg += `<rect class="etiqueta" x="${X1 + 1}" y="${f(y(ult) - 8)}" width="${W - X1 - 1}" height="16" rx="4"/>` +
      `<text class="etiqueta-txt" x="${X1 + 5}" y="${f(y(ult) + 4)}">${n2(ult)}</text>`;
    svg += `<line class="mira" x1="0" x2="0" y1="${Y0}" y2="${Y1}" visibility="hidden"/>`;

    GRAF[id] = { g, opts, X0, passo, W };
    const legenda = Object.keys(g.mm).map((p) => `<span class="leg l${p}">${p}${Number(p) === opts.saida ? " (saída)" : ""}</span>`).join("");
    const desc = `Gráfico diário dos últimos ${n} pregões. Último: ${brl(ult)}.`;
    return `<div class="grafico" data-grafico="${esc(id)}">
      <p class="legenda">Médias ${legenda}</p>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${svg}</svg>
      <div class="leitura" aria-live="polite">${leitura(id, n - 1)}</div>
    </div>`;
  }

  function leitura(id, i) {
    const { g, opts } = GRAF[id];
    const parcial = opts.emAndamento && i === g.c.length - 1;
    const dia = new Date(g.d[i] + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    const mms = Object.entries(g.mm).map(([p, s]) => `<span class="leg l${p}">${p}</span> ${n2(s[i])}`).join(" ");
    return `<p class="leitura-dia">${dia.charAt(0).toUpperCase() + dia.slice(1)}, ${dataCurta(g.d[i])}${parcial ? ", em andamento" : ""}</p>
      <dl>
        <div><dt>Abertura</dt><dd>${n2(g.o[i])}</dd></div>
        <div><dt>Máxima</dt><dd>${n2(g.h[i])}</dd></div>
        <div><dt>Mínima</dt><dd>${n2(g.l[i])}</dd></div>
        <div><dt>${parcial ? "Atual" : "Fechamento"}</dt><dd>${n2(g.c[i])}</dd></div>
      </dl>
      <p class="leitura-mm">${mms}</p>`;
  }

  function tocarGrafico(e) {
    const box = e.target.closest(".grafico");
    if (!box) return;
    const svg = box.querySelector("svg"), dadosG = GRAF[box.dataset.grafico];
    if (!svg || !dadosG) return;
    const r = svg.getBoundingClientRect();
    const xv = ((e.clientX - r.left) / r.width) * dadosG.W;
    const i = Math.max(0, Math.min(dadosG.g.c.length - 1, Math.floor((xv - dadosG.X0) / dadosG.passo)));
    const xm = (dadosG.X0 + dadosG.passo * (i + 0.5)).toFixed(1);
    const mira = svg.querySelector(".mira");
    mira.setAttribute("x1", xm); mira.setAttribute("x2", xm); mira.setAttribute("visibility", "visible");
    box.querySelector(".leitura").innerHTML = leitura(box.dataset.grafico, i);
  }
  document.addEventListener("pointerdown", (e) => { if (e.target.closest(".grafico svg")) tocarGrafico(e); });
  document.addEventListener("pointermove", (e) => {
    if (e.target.closest(".grafico svg") && (e.pointerType === "mouse" || e.buttons)) tocarGrafico(e);
  });

  function renderCarteira() {
    const ul = $("#lista-carteira");
    $("#nova-compra").hidden = !gh.conectado();
    if (!gh.conectado()) {
      ul.innerHTML = `<li class="vazio">${GRAFICO_VAZIO}
        <p>Conecte o app ao repositório do monitor para ver sua carteira e os alertas.</p>
        <button type="button" class="botao" data-ir="ajustes">Conectar em Ajustes</button></li>`;
      return;
    }
    const carteira = dados.carteira || {};
    const tickers = Object.keys(carteira).sort();
    if (!tickers.length) {
      ul.innerHTML = `<li class="vazio"><p>Nenhuma ação na carteira. Quando comprar, toque em Registrar compra
        ou no botão Comprei de um alerta. A partir daí o monitor avisa a hora de vender.</p></li>`;
      return;
    }
    ul.innerHTML = tickers.map((t) => {
      const pos = carteira[t];
      const a = dados.painel?.ativos?.[t];
      const mm = Number(pos.media);
      const stop = nivelStop(pos);
      let h = `<li class="ativo"><div class="ativo-topo"><h3>${esc(t)}</h3>`;
      if (a) h += `<p class="preco">${brl(a.preco)}<span class="${a.variacao_dia >= 0 ? "sobe" : "cai"}">${pct(a.variacao_dia)}</span></p>`;
      h += "</div>";
      if (a) {
        h += grafico(`c-${t}`, a, { saida: mm, compra: { data: pos.data, preco: pos.preco },
          emAndamento: a.origem === "pregão", stop: stop?.preco });
        const s = a.medias?.[String(mm)];
        if (s && s.lado === "abaixo") {
          h += `<p class="saida alerta">Está abaixo da média de ${mm} (${brl(s.valor)}). ` +
            (a.origem === "pregão" ? "Se fechar assim, é sinal de venda." : "Sinal de venda pela sua regra.") + "</p>";
        } else if (s) {
          const queda = (1 - s.valor / a.preco) * 100;
          h += `<p class="saida">Vende se fechar abaixo de <strong>${brl(s.valor)}</strong> (média de ${mm}), uma queda de ${num1(queda)}%.</p>`;
        } else {
          h += `<p class="saida">Ainda sem histórico suficiente para a média de ${mm}.</p>`;
        }
      } else {
        h += `<p class="saida">Aguardando a próxima rodada do monitor.</p>`;
      }
      if (stop) {
        h += a && a.preco <= stop.preco
          ? `<p class="saida alerta">Abaixo do stop de ${numCurto(stop.pct)}% (${brl(stop.preco)}).</p>`
          : `<p class="saida">Stop de ${numCurto(stop.pct)}% em <strong>${brl(stop.preco)}</strong>.</p>`;
      }
      if (a?.volume_rel != null) h += `<p class="compra-info">${volTxt(a.volume_rel)} hoje</p>`;
      const res = a && pos.preco ? (a.preco / pos.preco - 1) * 100 : null;
      h += `<p class="compra-info">Comprou a ${brl(pos.preco)}${pos.data ? ` em ${dataCurta(pos.data)}` : ""}` +
        (res != null ? `, <span class="${res >= 0 ? "sobe" : "cai"}">${pct(res)}</span>` : "") + "</p>";
      h += `<button type="button" class="botao secundario pequeno" data-vender="${esc(t)}">Registrar venda</button></li>`;
      return h;
    }).join("");
  }

  function stopPadrao() {
    return Number(dados.painel?.stop_percentual ?? dados.config?.stop_percentual ?? 5);
  }
  function nivelStop(pos) {
    const p = Number(pos?.stop ?? stopPadrao());
    if (!pos?.preco || !(p > 0)) return null;
    return { pct: p, preco: Math.round(pos.preco * (1 - p / 100) * 100) / 100 };
  }
  function volTxt(v) {
    return v == null ? "" : `volume ${num1(v)}× a média`;
  }

  function retratoDe(ticker) {
    return dados.painel?.ativos?.[ticker] || dados.painel?.graficos?.[ticker] || null;
  }
  function nomeAcao(ticker) {
    return retratoDe(ticker)?.grafico
      ? `<button type="button" class="link-acao" data-ver="${esc(ticker)}">${esc(ticker)}</button>`
      : `<strong>${esc(ticker)}</strong>`;
  }

  function botaoComprei(ticker, medias, preco) {
    if (dados.carteira?.[ticker]) return `<span class="hora">Na carteira</span>`;
    return `<button type="button" class="botao secundario pequeno" data-comprar="${esc(ticker)}"
      data-medias="${esc((medias || []).join(","))}" data-preco="${preco ?? ""}">Comprei</button>`;
  }

  function renderAlertas() {
    const box = $("#lista-alertas");
    if (!gh.conectado()) { box.innerHTML = `<p class="ajuda" style="margin-top:20px">Conecte o app em Ajustes para ver os alertas.</p>`; return; }
    const lista = [...(dados.alertas || [])].sort((x, y) => (y.enviada_em || "").localeCompare(x.enviada_em || "")).slice(0, 80);
    if (!lista.length) {
      box.innerHTML = `<p class="ajuda" style="margin-top:20px">Nenhum alerta ainda. Eles aparecem aqui assim que o monitor encontrar um cruzamento.</p>`;
      return;
    }
    let html = "", diaAtual = "";
    for (const m of lista) {
      const dia = (m.enviada_em || "").slice(0, 10);
      if (dia !== diaAtual) {
        if (diaAtual) html += "</div>";
        html += `<h2 class="dia">${esc(rotuloDia(dia))}</h2><div>`;
        diaAtual = dia;
      }
      html += `<div class="alerta-item ${esc(m.acao || "")} ${esc(m.etapa || "")}"><span class="faixa"></span><div>
        <p class="hora">${esc((m.enviada_em || "").slice(11, 16))}</p>
        <h3>${esc(m.titulo)}</h3>`;
      if (m.etapa === "resumo" && Array.isArray(m.itens)) {
        html += `<ul class="itens">${m.itens.map((i) => `<li><span>${nomeAcao(i.ticker)}
          média ${esc(i.medias.join(", "))}, ${brl(i.preco)}${i.vol != null ? `<br><small>${volTxt(i.vol)}</small>` : ""}</span>${botaoComprei(i.ticker, i.medias, i.preco)}</li>`).join("")}</ul>`;
      } else {
        html += `<p class="corpo">${esc(m.corpo)}</p>`;
        const botoes = [];
        if (m.ticker && retratoDe(m.ticker)?.grafico) {
          botoes.push(`<button type="button" class="botao secundario pequeno" data-ver="${esc(m.ticker)}">Ver gráfico</button>`);
        }
        if (m.acao === "compra" && (m.etapa === "previa" || m.etapa === "confirmado") && m.ticker) {
          botoes.push(botaoComprei(m.ticker, m.medias, m.preco));
        }
        if ((m.acao === "venda" || m.acao === "stop") && m.ticker && dados.carteira?.[m.ticker]) {
          botoes.push(`<button type="button" class="botao secundario pequeno" data-vender="${esc(m.ticker)}">Registrar venda</button>`);
        }
        if (botoes.length) html += `<div class="linha">${botoes.join("")}</div>`;
      }
      html += "</div></div>";
    }
    box.innerHTML = html + "</div>";
  }

  // ---------- resultados: suas operações + backtest ----------
  const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
  const cor = (v) => (v >= 0 ? "sobe" : "cai");
  let varianteBT = LS.get("bt-variante") || "volume";

  function statsOps(ops) {
    const r = ops.map((o) => Number(o.resultado)).filter((x) => !Number.isNaN(x));
    if (!r.length) return null;
    const soma = r.reduce((a, b) => a + b, 0);
    return { n: r.length, acerto: (100 * r.filter((x) => x > 0).length) / r.length, medio: soma / r.length, soma };
  }

  function renderResultados() {
    const box = $("#conteudo-resultados");
    if (!gh.conectado()) {
      box.innerHTML = `<p class="ajuda" style="margin-top:20px">Conecte o app em Ajustes para ver os resultados.</p>`;
      return;
    }
    let h = `<h2>Suas operações</h2>`;
    const ops = [...(dados.operacoes || [])].sort((a, b) => (b.data_venda || "").localeCompare(a.data_venda || ""));
    const st = statsOps(ops);
    if (!st) {
      h += `<p class="ajuda">Ainda não há operações encerradas. Quando você registrar uma venda, ela aparece aqui com o resultado.</p>`;
    } else {
      h += `<dl class="numeros">
        <div><dt>Operações</dt><dd>${st.n}</dd></div>
        <div><dt>Acertos</dt><dd>${num1(st.acerto)}%</dd></div>
        <div><dt>Média por operação</dt><dd class="${cor(st.medio)}">${pct(st.medio)}</dd></div>
        <div><dt>Soma</dt><dd class="${cor(st.soma)}">${pct(st.soma)}</dd></div>
      </dl>`;
      const porMedia = [9, 21, 50].map((p) => [p, statsOps(ops.filter((o) => Number(o.media) === p))]).filter(([, s]) => s);
      if (porMedia.length) {
        h += `<table class="tabela"><thead><tr><th scope="col">Saída</th><th scope="col">Operações</th><th scope="col">Acertos</th><th scope="col">Média</th></tr></thead><tbody>` +
          porMedia.map(([p, s]) => `<tr><th scope="row"><span class="leg l${p}">MM${p}</span></th><td>${s.n}</td><td>${num1(s.acerto)}%</td><td class="${cor(s.medio)}">${pct(s.medio)}</td></tr>`).join("") +
          `</tbody></table>`;
      }
      h += `<ul class="lista ops">` + ops.slice(0, 40).map((o) => `<li>
          <div class="ativo-topo"><h3>${esc(o.ticker)}</h3><p class="preco ${cor(o.resultado)}">${pct(o.resultado)}</p></div>
          <p class="compra-info">MM${esc(o.media)}${o.motivo === "stop" ? ", saiu no stop" : ""}: comprou a ${brl(o.preco_compra)} em ${dataCurta(o.data_compra || "")},
          vendeu a ${brl(o.preco_venda)} em ${dataCurta(o.data_venda || "")}</p></li>`).join("") + `</ul>`;
    }

    h += `<h2>Backtest das médias</h2>`;
    const bt = dados.backtest;
    if (!bt?.resultados) {
      h += `<p class="ajuda">O backtest ainda não rodou. Ele roda sozinho todo dia 1º do mês, ou na hora pelo GitHub:
        monitor-acoes › Actions › Backtest › Run workflow.</p>`;
    } else {
      const vars = Object.keys(bt.variantes);
      if (!vars.includes(varianteBT)) varianteBT = vars[0];
      const comOps = bt.resultados.filter((r) => r.operacoes);
      const geral = comOps.reduce((a, b) => (b.medio > a.medio ? b : a), comOps[0]);
      h += `<p class="ajuda">De ${dataBR(bt.inicio)} a ${dataBR(bt.fim)}, ${bt.acoes_analisadas} ações do Ibovespa, média ${esc(bt.tipo_media)}.
        Compra na abertura do dia seguinte ao rompimento e vende na abertura do dia seguinte à perda da mesma média.</p>`;
      if (geral) {
        h += `<p class="destaque">Melhor combinação no período: <strong>média de ${geral.media}, ${esc(bt.variantes[geral.variante].toLowerCase())}</strong>.
          Resultado médio de <span class="${cor(geral.medio)}">${pct(geral.medio)}</span> por operação, ${num1(geral.acerto)}% de acertos em ${geral.operacoes} operações.</p>`;
      }
      h += `<div class="segmentos" role="group" aria-label="Variação do backtest">` +
        vars.map((v) => `<button type="button" data-variante="${esc(v)}" aria-pressed="${v === varianteBT}">${esc(bt.variantes[v])}</button>`).join("") + `</div>`;
      const linhas = bt.resultados.filter((r) => r.variante === varianteBT);
      const melhorLinha = linhas.filter((r) => r.operacoes).reduce((a, b) => (!a || b.medio > a.medio ? b : a), null);
      h += `<table class="tabela"><thead><tr><th scope="col">Média</th><th scope="col">Operações</th><th scope="col">Acertos</th><th scope="col">Média/op.</th><th scope="col">Dias</th></tr></thead><tbody>` +
        linhas.map((r) => r.operacoes
          ? `<tr class="${r === melhorLinha ? "melhor" : ""}"><th scope="row"><span class="leg l${r.media}">MM${r.media}</span></th><td>${r.operacoes}</td><td>${num1(r.acerto)}%</td><td class="${cor(r.medio)}">${pct(r.medio)}</td><td>${num1(r.dias)}</td></tr>`
          : `<tr><th scope="row"><span class="leg l${r.media}">MM${r.media}</span></th><td colspan="4">sem operações</td></tr>`).join("") +
        `</tbody></table>`;
      if (melhorLinha) {
        h += `<p class="compra-info">Nas operações da MM${melhorLinha.media}: ganho médio de ${pct(melhorLinha.ganho_medio)} quando acerta e perda média de ${pct(melhorLinha.perda_media)} quando erra.` +
          (melhorLinha.stops ? ` ${melhorLinha.stops} saíram no stop.` : "") + `</p>`;
        const top = bt.melhores_acoes?.[`${melhorLinha.media}:${varianteBT}`] || [];
        if (top.length) {
          h += `<p class="compra-info">Ações que mais renderam com a MM${melhorLinha.media}: ` +
            top.map((t) => `${esc(t.ticker)} (${pct(t.soma)})`).join(", ") + `.</p>`;
        }
      }
      if (bt.comprar_e_segurar_medio != null) {
        h += `<p class="compra-info">Referência: no mesmo período, quem comprou e segurou as ações teve ${pct(bt.comprar_e_segurar_medio)} em média.</p>`;
      }
      h += `<p class="rodape">${esc(bt.aviso || "")} Atualizado em ${dataBR((bt.gerado_em || "").slice(0, 10))}.</p>`;
    }
    box.innerHTML = h;
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-variante]");
    if (!b) return;
    varianteBT = b.dataset.variante;
    LS.set("bt-variante", varianteBT);
    renderResultados();
  });

  function renderAjustes() {
    const repo = gh.repo();
    if (document.activeElement?.id !== "repo") $("#repo").value = DEMO ? "demonstração" : repo || "";
    $("#token").placeholder = gh.token() ? "Token salvo neste aparelho" : "github_pat_…";
    $("#token").required = !gh.token();
    $("#desconectar").hidden = !gh.repo();
    const tipo = dados.config?.tipo_media || "exponencial";
    for (const r of document.querySelectorAll('#tipo-media input')) {
      r.checked = r.value === tipo;
      r.disabled = !gh.conectado();
    }
  }

  // ---------- ações ----------
  document.addEventListener("click", (e) => {
    const ir = e.target.closest("[data-ir]");
    if (ir) abrirAba(ir.dataset.ir);
    const comprar = e.target.closest("[data-comprar]");
    if (comprar) {
      comprar.closest("dialog")?.close();
      abrirCompra(comprar.dataset.comprar, comprar.dataset.medias, comprar.dataset.preco);
    }
    const vender = e.target.closest("[data-vender]");
    if (vender) abrirVenda(vender.dataset.vender);
    const fechar = e.target.closest("[data-fechar]");
    if (fechar) fechar.closest("dialog").close();
    const ver = e.target.closest("[data-ver]");
    if (ver) abrirGrafico(ver.dataset.ver);
  });

  const dlgGrafico = $("#dlg-grafico");
  function abrirGrafico(ticker) {
    const a = retratoDe(ticker);
    if (!a) return;
    const pos = dados.carteira?.[ticker];
    $("#g-titulo").textContent = ticker;
    $("#g-preco").innerHTML = `${brl(a.preco)} <span class="${a.variacao_dia >= 0 ? "sobe" : "cai"}">${pct(a.variacao_dia)}</span>`;
    $("#g-corpo").innerHTML = grafico(`d-${ticker}`, a, {
      saida: pos ? Number(pos.media) : null,
      compra: pos ? { data: pos.data, preco: pos.preco } : null,
      emAndamento: a.origem === "pregão",
      stop: pos ? nivelStop(pos)?.preco : null,
    });
    const acima = Object.entries(a.medias || {}).filter(([, m]) => m.lado === "acima").map(([p]) => p);
    $("#g-texto").textContent = acima.length
      ? `Preço acima da${acima.length > 1 ? "s médias" : " média"} de ${acima.join(", ").replace(/, (\d+)$/, " e $1")}.`
      : "Preço abaixo das três médias.";
    $("#g-acoes").innerHTML = pos ? "" : botaoComprei(ticker, acima, a.preco);
    dlgGrafico.showModal();
  }

  $("#nova-compra").addEventListener("click", () => abrirCompra("", "", ""));
  $("#recarregar").addEventListener("click", carregar);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - ultimaCarga > 60000) carregar();
  });

  const dlgCompra = $("#dlg-compra"), fCompra = $("#form-compra");
  function abrirCompra(ticker, medias, preco) {
    precoJaConfirmado = null;
    fCompra.reset();
    $("#c-erro").textContent = "";
    fCompra.ticker.value = ticker;
    const lista = (medias || "").split(",").filter(Boolean);
    if (lista.length === 1) fCompra.querySelector(`input[name="media"][value="${lista[0]}"]`).checked = true;
    if (preco) fCompra.preco.value = Number(preco).toFixed(2).replace(".", ",");
    fCompra.stop.value = String(stopPadrao()).replace(".", ",");
    dlgCompra.showModal();
    (ticker ? (lista.length === 1 ? fCompra.preco : fCompra.querySelector('input[name="media"]')) : fCompra.ticker).focus();
  }
  // Confere se o preço digitado faz sentido (ex.: 4120 em vez de 41,20). Se estiver muito longe
  // da referência, avisa e só aceita quando a pessoa tocar de novo com o mesmo valor.
  let precoJaConfirmado = null;
  function precoConferido(preco, referencia, alvoErro, nomeRef) {
    if (!referencia || precoJaConfirmado === preco) return true;
    const razao = preco / referencia;
    if (razao <= 1.5 && razao >= 0.5) return true;
    precoJaConfirmado = preco;
    $(alvoErro).textContent = `${brl(preco)} está muito longe do preço ${nomeRef} (${brl(referencia)}). ` +
      "Confira a vírgula. Se estiver certo, toque no botão de novo.";
    return false;
  }

  const numero = (txt) => Number(String(txt).trim().replace(/\./g, (m, i, s) => (s.includes(",") ? "" : ".")).replace(",", "."));
  fCompra.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker = fCompra.ticker.value.trim().toUpperCase();
    const media = Number(new FormData(fCompra).get("media"));
    const preco = numero(fCompra.preco.value);
    const stop = fCompra.stop.value.trim() === "" ? 0 : numero(fCompra.stop.value);
    if (!/^[A-Z]{4}\d{1,2}$/.test(ticker)) { $("#c-erro").textContent = "Código da ação inválido. Exemplo: PETR4."; return; }
    if (!media) { $("#c-erro").textContent = "Escolha a média que vai usar para vender."; return; }
    if (!(preco > 0)) { $("#c-erro").textContent = "Informe o preço pago. Exemplo: 38,40."; return; }
    if (!(stop >= 0 && stop < 50)) { $("#c-erro").textContent = "Stop entre 0 e 50%. Use 0 para não ter stop."; return; }
    if (!precoConferido(preco, retratoDe(ticker)?.preco, "#c-erro", "atual")) return;
    const bt = fCompra.querySelector('[type="submit"]');
    bt.disabled = true;
    try {
      dados.carteira = await gh.alterar(ARQ.carteira, (c) => {
        c[ticker] = { media, preco: Math.round(preco * 100) / 100, data: hojeISO(), stop };
        return c;
      }, `Painel: comprei ${ticker} (média de ${media}, stop ${stop}%)`);
      dlgCompra.close();
      render();
      avisar(`${ticker} entrou na carteira. O monitor avisa se fechar abaixo da média de ${media}` +
        (stop > 0 ? ` ou cair ${numCurto(stop)}%.` : "."));
    } catch (err) {
      $("#c-erro").textContent = err.message;
    } finally {
      bt.disabled = false;
    }
  });

  const dlgVenda = $("#dlg-venda"), fVenda = $("#form-venda");
  let vendendo = "";
  function abrirVenda(ticker) {
    vendendo = ticker;
    precoJaConfirmado = null;
    fVenda.reset();
    $("#v-erro").textContent = "";
    const pos = dados.carteira?.[ticker];
    const atual = dados.painel?.ativos?.[ticker]?.preco;
    $("#v-titulo").textContent = `Registrar venda de ${ticker}`;
    $("#v-texto").textContent = pos
      ? `Comprou a ${brl(pos.preco)}${pos.data ? ` em ${dataCurta(pos.data)}` : ""}. O resultado vai para a aba Resultados e o monitor para de acompanhar a ação.`
      : "O monitor para de acompanhar a ação.";
    if (atual) fVenda.preco.value = Number(atual).toFixed(2).replace(".", ",");
    dlgVenda.showModal();
    fVenda.preco.focus();
  }
  fVenda.addEventListener("submit", async (e) => {
    e.preventDefault();
    const precoVenda = numero(fVenda.preco.value);
    if (!(precoVenda > 0)) { $("#v-erro").textContent = "Informe o preço de venda. Exemplo: 41,20."; return; }
    const pos = dados.carteira?.[vendendo];
    if (!precoConferido(precoVenda, pos?.preco, "#v-erro", "de compra")) return;
    const bt = fVenda.querySelector('[type="submit"]');
    bt.disabled = true;
    try {
      if (pos?.preco) {
        const stop = nivelStop(pos);
        const op = {
          ticker: vendendo, media: Number(pos.media), stop: pos.stop ?? stopPadrao(),
          preco_compra: pos.preco, data_compra: pos.data || null,
          preco_venda: Math.round(precoVenda * 100) / 100, data_venda: hojeISO(),
          resultado: Math.round((precoVenda / pos.preco - 1) * 10000) / 100,
          motivo: stop && precoVenda <= stop.preco ? "stop" : "media",
        };
        dados.operacoes = await gh.alterar(ARQ.operacoes, (lista) => [...(Array.isArray(lista) ? lista : []), op],
          `Painel: resultado ${vendendo} ${op.resultado}%`);
      }
      dados.carteira = await gh.alterar(ARQ.carteira, (c) => { delete c[vendendo]; return c; },
        `Painel: vendi ${vendendo}`);
      dlgVenda.close();
      render();
      const res = pos?.preco ? (precoVenda / pos.preco - 1) * 100 : null;
      avisar(`Venda de ${vendendo} registrada${res != null ? `: ${pct(res)}` : ""}.`);
    } catch (err) {
      $("#v-erro").textContent = err.message;
    } finally {
      bt.disabled = false;
    }
  });

  $("#form-conexao").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (DEMO) { avisar("No modo de demonstração a conexão não é salva."); return; }
    const repo = $("#repo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
    const token = $("#token").value.trim() || gh.token();
    const estado = $("#estado-conexao");
    estado.className = "estado";
    estado.textContent = "Testando…";
    try {
      await gh.testar(repo, token);
      LS.set("gh-repo", repo);
      LS.set("gh-token", token);
      $("#token").value = "";
      estado.className = "estado ok";
      estado.textContent = "Conectado.";
      await carregar();
    } catch (err) {
      estado.className = "estado erro";
      estado.textContent = err.message;
    }
  });
  $("#desconectar").addEventListener("click", () => {
    LS.del("gh-repo"); LS.del("gh-token"); LS.del("cache-dados");
    dados = { painel: null, alertas: [], carteira: {}, config: {} };
    $("#estado-conexao").textContent = "";
    render();
    avisar("Desconectado. O token foi apagado deste aparelho.");
  });

  $("#tipo-media").addEventListener("change", async (e) => {
    const tipo = e.target.value;
    try {
      dados.config = await gh.alterar(ARQ.config, (c) => ({ ...c, tipo_media: tipo }), `Painel: média ${tipo}`);
      avisar(`Média ${tipo} salva. Vale a partir da próxima rodada do monitor.`);
    } catch (err) {
      avisar(err.message, "erro");
      renderAjustes();
    }
  });

  // ---------- notificações (push) ----------
  const codigo = $("#codigo"), btAtivar = $("#ativar"), btCopiar = $("#copiar"), btTestar = $("#testar");
  const instalado = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const temPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function passo(id, classe, estado = "") {
    const el = $(id);
    el.classList.remove("feito", "atual", "bloqueado");
    el.classList.add(classe);
    const e = el.querySelector("[data-estado]");
    if (e) e.textContent = estado;
  }
  function chaveParaBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function mostrarCodigo(json) {
    codigo.value = json;
    btCopiar.disabled = false;
    btTestar.disabled = false;
  }

  async function atualizarPush() {
    passo("#p1", instalado ? "feito" : "atual", instalado ? "Instalado" : "Ainda não instalado");
    if (!instalado) {
      passo("#p2", "bloqueado", "Disponível depois do passo 1");
      btAtivar.disabled = true;
      passo("#p3", "bloqueado");
      return;
    }
    if (!temPush) {
      passo("#p2", "atual", "Este iPhone não aceita notificações de apps da web. Atualize para o iOS 16.4 ou mais novo.");
      btAtivar.disabled = true;
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const inscricao = await reg.pushManager.getSubscription();
    if (Notification.permission === "denied") {
      passo("#p2", "atual", "Notificações bloqueadas. Libere em Ajustes › Notificações › Médias.");
      btAtivar.disabled = true;
    } else if (inscricao) {
      passo("#p2", "feito", "Notificações ativas");
      const json = JSON.stringify(inscricao);
      LS.set("inscricao-push", json);
      mostrarCodigo(json);
      passo("#p3", "atual");
    } else {
      passo("#p2", "atual");
      btAtivar.disabled = false;
      passo("#p3", "bloqueado");
    }
  }

  btAtivar.addEventListener("click", async () => {
    if (!window.VAPID_PUBLIC_KEY || window.VAPID_PUBLIC_KEY.startsWith("COLE_AQUI")) {
      avisar("A chave pública do push ainda não foi colocada no config.js.", "erro");
      return;
    }
    btAtivar.disabled = true;
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        avisar("Sem permissão, o app não consegue avisar. Libere em Ajustes › Notificações › Médias.", "erro");
        return atualizarPush();
      }
      const reg = await navigator.serviceWorker.ready;
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(window.VAPID_PUBLIC_KEY) });
      avisar("Notificações ativadas. Agora copie o código do passo 3.");
    } catch (e) {
      avisar("Não deu para ativar: " + e.message, "erro");
    }
    atualizarPush();
  });

  btCopiar.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(codigo.value);
      avisar("Código copiado.");
    } catch {
      codigo.select();
      avisar("Selecionei o código: toque e segure para copiar.");
    }
  });

  btTestar.addEventListener("click", async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("PETR4 — COMPRA confirmada", {
      body: "Exemplo: rompeu para cima a média de 21 no fechamento (R$ 38,40).",
      icon: "icons/icon-192.png", tag: "teste",
    });
    avisar("Notificação de teste enviada.");
  });

  // ---------- início ----------
  const salvo = LS.get("inscricao-push");
  if (salvo) mostrarCodigo(salvo);
  abrirAba(location.hash.slice(1) || (gh.conectado() ? LS.get("aba") || "carteira" : "ajustes"), false);
  render();
  carregar();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(atualizarPush).catch(() => atualizarPush());
  } else {
    atualizarPush();
  }
})();
