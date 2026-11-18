// Quartz-style shell for visual explainers. Injected by build.py — edit here, then rebuild.
// Wraps the page's existing content in Quartz's three-column layout and builds the sidebars
// (search, graph, table of contents, backlinks, margin doodles) from the manifest in quartz-data.js.
(function () {
  const Q = window.QUARTZ || { site: 'Visual Explainers', home: 'index.html', pages: [] };
  const pages = Q.pages;
  const here = decodeURIComponent(location.pathname.split('/').pop());
  const byFile = Object.fromEntries(pages.map(p => [p.file, p]));
  const isHome = here === Q.home.split('/').pop() || here === '';
  const me = byFile[here] || { file: here, href: here, title: document.title, tag: 'Uncategorized', tags: [], links: [], words: 0 };

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, txt) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (txt != null) n.textContent = txt;
    return n;
  }
  function icon(path, size = 14) {
    const s = svg('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    s.innerHTML = path;
    // Inline size: some pages style every svg as width:100%, which would blow icons up.
    s.style.cssText = `width:${size}px;height:${size}px;display:inline-block;flex:none`;
    return s;
  }
  const CHEVRON = '<polyline points="6 9 12 15 18 9"/>';
  const SEARCH = '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>';
    const GLOBE = '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>';
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const isFloating = el => ['fixed', 'absolute'].includes(getComputedStyle(el).position);
  // Sidebar panel header that collapses its panel. The open/closed choice is remembered across
  // pages (localStorage is shared by every file:// page), so a collapsed panel stays collapsed.
  function panelHead(panel, key, label) {
    const stored = 'quartz:collapsed:' + key;
    try { if (localStorage.getItem(stored)) panel.classList.add('q-collapsed'); } catch (e) { /* storage blocked */ }
    return h('button', { class: 'q-section-btn', onclick: () => {
      const closed = panel.classList.toggle('q-collapsed');
      try { closed ? localStorage.setItem(stored, '1') : localStorage.removeItem(stored); } catch (e) { /* storage blocked */ }
    } }, label, icon(CHEVRON));
  }

  // ---------- 1. move the page into the centre column ----------
  const article = h('article', { id: 'q-article' });
  // The page's own centring wrapper fights the grid; let it fill the column instead.
  // Only a wrapper (recognised by its max-width) loses its padding: a card or panel placed
  // directly in <body> needs its padding, or its text runs into its border. Measure while the
  // elements are still in <body>: `article` isn't attached yet, and a detached element's
  // computed max-width is '' rather than 'none', which would mark everything as a wrapper.
  const wrappers = new Set();
  [...document.body.children]
    .filter(el => !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName) && !isFloating(el))
    .forEach(el => {
      if (getComputedStyle(el).maxWidth !== 'none') wrappers.add(el);
      article.append(el);
    });
  for (const el of article.children) {
    const isWrapper = wrappers.has(el);
    el.style.maxWidth = 'none';
    el.style.marginLeft = el.style.marginRight = '0';
    if (isWrapper) el.style.paddingLeft = el.style.paddingRight = el.style.paddingTop = '0';
  }

  // Fonts: pages hard-code their own stacks. Rewrite every font-family in the page's own
  // stylesheets and inline styles — monospace stacks become the code font, everything else the
  // body font — so elements the page draws later pick it up too.
  const MONO = /mono|menlo|courier|consolas/i;
  const swapFont = st => {
    if (st.fontFamily && !st.fontFamily.includes('--q-')) st.fontFamily = MONO.test(st.fontFamily) ? 'var(--q-code)' : 'var(--q-body)';
  };
  // Light theme only: drop any dark-mode blocks the page carries (index.html has one).
  const walkRules = (rules, owner) => {
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r.media && /prefers-color-scheme:\s*dark/.test(r.conditionText || r.media.mediaText)) { owner.deleteRule(i); continue; }
      if (r.style) swapFont(r.style);
      if (r.cssRules) walkRules(r.cssRules, r);
    }
  };
  for (const sheet of document.styleSheets) {
    if (sheet.href && sheet.href.endsWith('quartz.css')) continue;
    try { walkRules(sheet.cssRules, sheet); } catch (e) { /* cross-origin sheet */ }
  }
  document.querySelectorAll('[style*="font"]').forEach(el => swapFont(el.style));

  // Glossary: a page may define GLOSSARY = [{ term: 'Scope', match: ['scope', 'scopes'], def: '…html…' }].
  // Every use of a term in the prose (text matching `match`, default [term], case-insensitive, whole
  // words) gets a dotted underline and the definition on hover, including text the page adds later
  // (step-through narration). `match: []` lists a term in the table without underlining it, and
  // anything inside a .q-noterm element (a demo table, say) is never underlined.
  // The full list fills <section id="words">, which is inserted after the header if the page lacks it.
  const GLOSS = (typeof GLOSSARY !== 'undefined' && GLOSSARY) || window.GLOSSARY || [];
  if (GLOSS.length) {
    let words = article.querySelector('#words');
    if (!words) {
      words = h('section', { id: 'words' }, h('h2', null, 'Words used on this page'));
      const header = article.querySelector('header');
      header ? header.after(words) : article.prepend(words);
    }
    const table = h('table', { class: 'q-gloss' });
    for (const g of GLOSS) {
      const def = h('td'); def.innerHTML = g.def;
      table.append(h('tr', null, h('td', null, h('strong', null, g.term)), def));
    }
    words.append(table);

    const byForm = new Map();
    GLOSS.forEach((g, i) => (g.match || [g.term]).forEach(f => byForm.set(f.toLowerCase(), i)));
    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const forms = [...byForm.keys()].sort((a, b) => b.length - a.length).map(esc);
    const re = forms.length && new RegExp('(?<![\\w#:/.-])(' + forms.join('|') + ')(?![\\w-])', 'gi');
    const SKIP = 'pre, script, style, svg, button, textarea, input, select, h1, h2, h3, a, #words, .q-term, .q-note, .q-noterm';
    const wrapTerms = root => {
      if (!re) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const hits = [];
      for (let n; (n = walker.nextNode());) {
        if (n.parentElement && !n.parentElement.closest(SKIP) && re.test(n.data)) hits.push(n);
        re.lastIndex = 0;
      }
      for (const n of hits) {
        const frag = document.createDocumentFragment();
        let last = 0;
        n.data.replace(re, (m, _f, at) => {
          frag.append(n.data.slice(last, at), h('span', { class: 'q-term', 'data-g': byForm.get(m.toLowerCase()) }, m));
          last = at + m.length;
        });
        frag.append(n.data.slice(last));
        n.replaceWith(frag);
      }
    };
    wrapTerms(article);
    new MutationObserver(recs => recs.forEach(r => r.addedNodes.forEach(n => {
      const el = n.nodeType === 1 ? n : n.parentElement;
      if (el && article.contains(el) && !el.closest(SKIP)) wrapTerms(n.nodeType === 1 ? n : el);
    }))).observe(article, { childList: true, subtree: true });

    const tip = h('div', { class: 'q-note q-gloss-tip' });
    document.body.append(tip);
    let hideTimer;
    const hide = () => { hideTimer = setTimeout(() => tip.classList.remove('q-show'), 120); };
    article.addEventListener('mouseover', e => {
      const t = e.target.closest('.q-term');
      if (!t) return;
      clearTimeout(hideTimer);
      const g = GLOSS[t.dataset.g];
      tip.innerHTML = '<strong>' + g.term + '</strong><br>' + g.def;
      const r = t.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(r.left, innerWidth - 430)) + 'px';
      tip.style.top = (r.bottom + 6) + 'px';
      tip.classList.add('q-show');
    });
    article.addEventListener('mouseout', e => { if (e.target.closest('.q-term')) hide(); });
    tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    tip.addEventListener('mouseleave', hide);
    addEventListener('scroll', () => tip.classList.remove('q-show'), { passive: true });
  }

  // Code blocks: Quartz-style copy button (shows on hover), plus two learning aids.
  //  - Typing practice: click a block and it clears; retype it monkeytype-style (Enter auto-indents,
  //    Tab skips up to 4 leading spaces, Backspace undoes). Dragging still selects text to copy.
  //  - Hover notes: <pre data-note-key="k"> gets per-line popovers from the page's own
  //    LINE_NOTES_BY_KEY = { k: { 0: '<strong>Syntax:</strong> …', … } } (0-indexed lines).
  const NOTES = (typeof LINE_NOTES_BY_KEY !== 'undefined' && LINE_NOTES_BY_KEY) || window.LINE_NOTES_BY_KEY || {};
  // Sounds: reuse the page's buzz()/chime() when it has them (so its Sound toggle applies), else quiet defaults.
  let audio;
  const tone = (type, freqs, gap, len, vol) => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    freqs.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * gap;
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + len);
    });
  };
  const buzz = typeof window.buzz === 'function' ? window.buzz : () => tone('sawtooth', [200], 0, 0.3, 0.05);
  const chime = typeof window.chime === 'function' ? window.chime : () => tone('sine', [523.25, 659.25, 783.99], 0.12, 0.35, 0.06);

  const KEYWORDS = new Set(('return try catch val var fun if else elsif when is in not for while do class object interface ' +
    'data private public protected internal override const let function async await new import export from package as ' +
    'null true false this self super throw throws open abstract sealed enum type union input mutation query directive ' +
    'def end begin rescue ensure unless until module yield nil and or then case ' +
    'select where join left on group by order limit with insert update delete into values set').split(' '));
  // Per-char class: k keyword, s string, c comment (// always; # at line start or after a space).
  function classify(text) {
    const out = new Array(text.length).fill('');
    for (let i = 0; i < text.length;) {
      const c = text[i];
      if ((c === '/' && text[i + 1] === '/') || (c === '#' && (i === 0 || /\s/.test(text[i - 1])))) {
        let j = i; while (j < text.length && text[j] !== '\n') j++;
        out.fill('c', i, j); i = j;
      } else if (c === '"' || c === "'" || c === '`') {
        let j = i + 1; while (j < text.length && text[j] !== c && text[j] !== '\n') { if (text[j] === '\\') j++; j++; }
        out.fill('s', i, Math.min(j + 1, text.length)); i = j + 1;
      } else if (/[A-Za-z_@]/.test(c)) {
        let j = i; while (j < text.length && /[\w@?!]/.test(text[j])) j++;
        if (KEYWORDS.has(text.slice(i, j).replace(/^@+/, '').toLowerCase())) out.fill('k', i, j);
        i = j;
      } else i++;
    }
    return out;
  }
  const esc = c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c);

  const note = h('div', { class: 'q-note', 'data-q': '' });
  document.body.append(note);
  const blocks = [];
  let active = null;

  function render(b) {
    const out = [], wrap = !!b.notes;
    let line = 0;
    if (wrap) out.push('<span class="q-line" data-line="0">');
    for (let i = 0; i < b.text.length; i++) {
      const c = b.text[i];
      let cls = 'q-ch';
      if (i < b.typed.length) cls += b.typed[i] === c ? ' q-ok' + (b.cls[i] ? ' q-' + b.cls[i] : '') : ' q-bad';
      if (b === active && i === b.typed.length) cls += ' q-caret';
      if (c === '\n') {
        out.push(`<span class="${cls} q-nl">↵</span>`);
        out.push(wrap ? `</span>\n<span class="q-line" data-line="${++line}">` : '\n');
      } else out.push(`<span class="${cls}">${esc(c)}</span>`);
    }
    if (wrap) out.push('</span>');
    b.body.innerHTML = out.join('');
  }

  for (const pre of article.querySelectorAll('pre')) {
    const text = pre.textContent.replace(/\s+$/, '');
    const b = { pre, text, cls: classify(text), typed: text, finished: false, notes: NOTES[pre.dataset.noteKey] || null };
    b.body = h('span', { class: 'q-code' });
    const btn = h('button', { class: 'q-copy', title: 'Copy' }, 'Copy');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1200);
    });
    pre.textContent = '';
    pre.classList.add('q-pre', 'q-practice', 'q-idle');
    pre.append(b.body, btn);
    render(b);
    blocks.push(b);

    // A drag (pointer moved, or text left selected) is a copy gesture, not a click-to-practice.
    let down = null;
    pre.addEventListener('mousedown', e => (down = { x: e.clientX, y: e.clientY }));
    pre.addEventListener('click', e => {
      const moved = down && (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4);
      if (moved || String(getSelection()).length) return;
      const prev = active;
      for (const x of blocks) x.pre.classList.remove('q-active');
      pre.classList.add('q-active');
      if (pre.classList.contains('q-idle')) { pre.classList.remove('q-idle'); b.typed = ''; b.finished = false; }
      active = b;
      if (prev && prev !== b) render(prev);
      render(b);
    });

    if (b.notes) {
      let hot = null;
      const hide = () => { hot?.classList.remove('q-hover'); hot = null; note.classList.remove('q-show'); };
      pre.addEventListener('mousemove', e => {
        const line = e.target.closest('.q-line');
        if (line === hot) return;
        hide();
        const html = line && b.notes[line.dataset.line];
        if (!html) return;
        hot = line;
        line.classList.add('q-hover');
        note.innerHTML = html;
        note.classList.add('q-show');
        // Below the line, or above it when there's no room; clamped to the window.
        const r = line.getBoundingClientRect(), n = note.getBoundingClientRect();
        let top = r.bottom + 10;
        if (top + n.height > innerHeight - 20) top = Math.max(20, r.top - n.height - 10);
        note.style.top = top + 'px';
        note.style.left = Math.max(20, Math.min(r.left, innerWidth - n.width - 20)) + 'px';
      });
      pre.addEventListener('mouseleave', hide);
    }
  }

  // Leaving a practice block: click anywhere outside it to stop capturing keys.
  document.addEventListener('click', e => {
    if (active && !active.pre.contains(e.target)) { const b = active; active = null; b.pre.classList.remove('q-active'); render(b); }
  });
  function typeChar(c) {
    const b = active;
    if (b.finished) return;
    const target = b.text[b.typed.length];
    if (c !== target) buzz();
    b.typed += c;
    // Auto-indent: a correct newline also consumes the next line's leading whitespace.
    if (c === '\n' && target === '\n') while (/[ \t]/.test(b.text[b.typed.length] || '')) b.typed += b.text[b.typed.length];
    render(b);
    if (b.typed.length === b.text.length) { b.finished = true; chime(); }
  }
  // Registered before the search shortcuts below, so stopImmediatePropagation keeps a typed "/" from opening search.
  document.addEventListener('keydown', e => {
    if (!active || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    const b = active;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { active = null; b.pre.classList.remove('q-active'); render(b); return; }
    if (e.key === 'Backspace') { e.preventDefault(); if (b.typed) { b.typed = b.typed.slice(0, -1); b.finished = false; render(b); } return; }
    if (e.key === 'Enter') { e.preventDefault(); typeChar('\n'); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      for (let n = 0; n < 4 && /[ \t]/.test(b.text[b.typed.length] || ''); n++) typeChar(b.text[b.typed.length]);
      return;
    }
    if (e.key.length === 1) { e.preventDefault(); typeChar(e.key); }
  });

  // Article header: title, then "date, N min read", then tag pills.
  const h1 = article.querySelector('h1');
  if (h1 && !isHome) {
    const d = me.date ? new Date(me.date + 'T12:00:00') : new Date(document.lastModified);
    const mins = Math.max(1, Math.round((me.words || article.innerText.split(/\s+/).length) / 200));
    const meta = h('p', { class: 'q-meta' }, `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${mins} min read`);
    const tagNames = [me.tag, ...(me.tags || []).slice(0, 5)].filter((t, i, a) => t && a.indexOf(t) === i);
    const tags = h('ul', { class: 'q-tags' }, tagNames.map(t => h('li', null, h('a', { onclick: () => openSearch(t) }, t.toLowerCase()))));
    h1.after(meta, tags);
  }

  const crumbs = h('nav', { class: 'q-crumbs' },
    h('a', { href: Q.home }, 'Home'), h('span', { class: 'q-sep' }, '❯'),
    h('a', { href: '#', onclick: e => { e.preventDefault(); openSearch(me.tag); } }, me.tag), h('span', { class: 'q-sep' }, '❯'),
    h('span', { class: 'q-here' }, trunc(me.title, 60)));
  const below = h('div', { id: 'q-below' });
  const footer = h('footer', { class: 'q-footer' }, `${Q.site} · ${pages.length} pages · `, h('a', { href: Q.home }, 'index'));
  const center = h('main', { id: 'q-center' }, isHome ? null : crumbs, article, below, footer);

  // ---------- 2. left sidebar: title, search, graph ----------
  // No page list here: the index page is the list. The graph sits on the left so the right
  // sidebar (TOC, backlinks) leaves room below it for doodles.
  const graphPanel = h('div', { class: 'q-panel q-graph' });
  graphPanel.append(panelHead(graphPanel, 'graph', 'Graph View'));
  const localBox = h('div', { class: 'q-graph-box' },
    h('button', { class: 'q-graph-global', title: 'Global graph', onclick: () => openGlobalGraph() }, icon(GLOBE, 16)));
  graphPanel.append(localBox);
  const left = h('aside', { id: 'q-left' },
    h('h2', { class: 'q-site' }, h('a', { href: Q.home }, Q.site)),
    h('button', { class: 'q-search-btn', title: 'Search', onclick: () => openSearch('') }, icon(SEARCH), h('span', null, 'Search'), h('kbd', null, '⌘K')),
    graphPanel);

  // ---------- 3. right sidebar: table of contents, backlinks ----------
  // TOC entries: every <h2>, plus every collapsible card (an element with an id whose first
  // child is a "head" row) — many pages keep their real sections in cards, not headings.
  const tocItems = [];
  let n = 0;
  for (const el of article.querySelectorAll('h2, h3, [id]')) {
    if (el.closest('header')) continue;
    if (el.tagName === 'H2' || (el.tagName === 'H3' && !el.closest('[id]:not(h3)'))) {
      if (!el.id) el.id = 'q-h-' + n++;
      tocItems.push({ el, level: el.tagName === 'H2' ? 1 : 2, label: el.textContent });
      continue;
    }
    const head = el.firstElementChild;
    if (!head || !/head|-h\b/.test(head.className)) continue;
    if (head.querySelector('h2, h3')) continue;  // a section whose head row holds its heading: already listed
    const t = head.querySelector('h1,h2,h3,h4,.card-title,.t,.title') || head;
    tocItems.push({ el, level: 2, label: t.textContent, card: el, head });
  }
  const toc = h('div', { class: 'q-toc q-panel' });
  toc.append(panelHead(toc, 'toc', 'Table of Contents'));
  const tocLinks = tocItems.map(it => {
    const a = h('a', { href: '#' + it.el.id }, trunc(it.label.replace(/\s+/g, ' ').replace(/^\s*\d+\s*[·.:)]?\s*/, '').trim(), 70));
    a.addEventListener('click', e => {
      e.preventDefault();
      // Collapsed card: click its own header so the page's toggle code (redraws, sounds) runs.
      if (it.card && !it.card.classList.contains('open')) it.head.click();
      it.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + it.el.id);
    });
    return a;
  });
  toc.append(tocItems.length
    ? h('ul', null, tocItems.map((it, i) => h('li', { class: it.level === 2 ? 'q-l2' : '' }, tocLinks[i])))
    : h('p', { class: 'q-empty' }, 'No headings on this page.'));

  const backlinkPages = pages.filter(p => p.links.includes(me.file));
  const backlinks = h('div', { class: 'q-backlinks q-panel' });
  backlinks.append(panelHead(backlinks, 'backlinks', 'Backlinks'),
    backlinkPages.length
      ? h('ul', null, backlinkPages.map(p => h('li', null, h('a', { href: p.href }, p.title))))
      : h('p', { class: 'q-empty' }, 'No backlinks found'));

  const right = h('aside', { id: 'q-right' }, toc, backlinks);
  const root = h('div', { id: 'q-root' }, left, center, right);
  document.body.prepend(root);

  // Narrow screens: Quartz drops the right sidebar below the article; on phones the left
  // sidebar is a top bar, so the graph goes below too.
  const narrow = matchMedia('(max-width: 1200px)');
  const phone = matchMedia('(max-width: 800px)');
  function placeRight() {
    (phone.matches ? below : left).append(graphPanel);
    for (const p of [toc, backlinks]) (narrow.matches ? below : right).append(p);
  }
  narrow.addEventListener('change', placeRight);
  phone.addEventListener('change', placeRight);
  placeRight();

  // Highlight TOC entries whose section is on screen.
  if (tocItems.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const i = tocItems.findIndex(it => it.el === e.target);
        if (i >= 0) tocLinks[i].classList.toggle('q-inview', e.isIntersecting);
      }
    });
    tocItems.forEach(it => io.observe(it.el));
  }

  // ---------- 4. full-width fixed bars (ask-bar etc.) sit over the centre column only ----------
  const spanning = [...document.body.children].filter(el => {
    if (el === root || el.dataset.q != null) return false;
    const cs = getComputedStyle(el);
    return cs.position === 'fixed' && cs.left === '0px' && cs.right === '0px';
  });
  function alignFixed() {
    const r = center.getBoundingClientRect();
    for (const el of spanning) {
      el.style.left = r.left + 'px';
      el.style.right = Math.max(0, innerWidth - r.right) + 'px';
    }
  }
  addEventListener('resize', alignFixed);
  alignFixed();

  // ---------- 4b. anything wider than the column scrolls sideways on its own ----------
  // Pages were built for ~1100px; on narrow windows a diagram row or table would otherwise
  // push the whole page sideways. Mark only the outermost too-wide element of each branch.
  function fitWide() {
    for (const el of article.querySelectorAll('[data-q-wide]')) { el.removeAttribute('data-q-wide'); }
    const aw = article.clientWidth + 1;
    const walk = node => {
      for (const el of node.children) {
        if (el.closest('svg') && el.tagName !== 'svg') continue;
        const cs = getComputedStyle(el);
        if (['absolute', 'fixed'].includes(cs.position) || cs.display === 'none') continue;
        if (el.getBoundingClientRect().width > aw) el.setAttribute('data-q-wide', '');
        else if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) walk(el);  // a child pokes out
      }
    };
    walk(article);
  }
  let fitTimer;
  addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitWide, 120); });
  addEventListener('load', fitWide);
  fitWide();

  // ---------- 5. graph (force-directed, pages + tag nodes, like Quartz's showTags) ----------
  function buildGraph(local) {
    const nodes = new Map();
    const edges = [];
    const add = (id, props) => { if (!nodes.has(id)) nodes.set(id, { id, ...props }); return nodes.get(id); };
    for (const p of pages) {
      add(p.file, { label: p.title, href: p.href, page: true });
      add('#' + p.tag, { label: p.tag, tag: true });
      edges.push([p.file, '#' + p.tag]);
      for (const l of p.links) edges.push([p.file, l]);
    }
    if (!byFile[me.file]) { add(me.file, { label: me.title, page: true }); edges.push([me.file, '#' + me.tag]); add('#' + me.tag, { label: me.tag, tag: true }); }
    if (local) {
      // Depth 2 from this page: page → its tag → sibling pages, plus direct links either way.
      const adj = new Map();
      for (const [a, b] of edges) { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); }
      const keep = new Set([me.file]);
      let frontier = [me.file];
      for (let d = 0; d < 2; d++) {
        const next = [];
        for (const id of frontier) for (const nb of adj.get(id) || []) if (!keep.has(nb)) { keep.add(nb); next.push(nb); }
        frontier = next;
      }
      for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id);
    }
    const E = edges.filter(([a, b]) => nodes.has(a) && nodes.has(b));
    return { nodes: [...nodes.values()], edges: E };
  }

  function layout(g) {
    const N = g.nodes;
    const idx = new Map(N.map((n, i) => [n.id, i]));
    N.forEach((n, i) => { const a = i * 2.39996; const r = 10 * Math.sqrt(i + 1); n.x = r * Math.cos(a); n.y = r * Math.sin(a); n.vx = n.vy = 0; });
    const E = g.edges.map(([a, b]) => [idx.get(a), idx.get(b)]);
    for (let it = 0; it < 400; it++) {
      const cool = 1 - it / 400;
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const dx = N[i].x - N[j].x, dy = N[i].y - N[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 1), f = 900 / d2;
        const d = Math.sqrt(d2);
        N[i].vx += f * dx / d; N[i].vy += f * dy / d; N[j].vx -= f * dx / d; N[j].vy -= f * dy / d;
      }
      for (const [a, b] of E) {
        const dx = N[b].x - N[a].x, dy = N[b].y - N[a].y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 45) * 0.04;
        N[a].vx += f * dx / d; N[a].vy += f * dy / d; N[b].vx -= f * dx / d; N[b].vy -= f * dy / d;
      }
      for (const n of N) {
        n.vx -= n.x * 0.01; n.vy -= n.y * 0.01;
        n.x += Math.max(-10, Math.min(10, n.vx)) * cool; n.y += Math.max(-10, Math.min(10, n.vy)) * cool;
        n.vx *= 0.5; n.vy *= 0.5;
      }
    }
    return E;
  }

  function drawGraph(box, local) {
    box.querySelector('svg')?.remove();
    const g = buildGraph(local);
    const E = layout(g);
    const N = g.nodes;
    const deg = new Array(N.length).fill(0);
    E.forEach(([a, b]) => { deg[a]++; deg[b]++; });
    // Fit the layout, leaving room for labels, but never zoom in past a 190×170 window —
    // a page with two neighbours should look sparse, not blown up.
    const xs = N.map(n => n.x), ys = N.map(n => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = Math.max(190, Math.max(...xs) - Math.min(...xs) + 120), hgt = Math.max(170, Math.max(...ys) - Math.min(...ys) + 60);
    const minX = cx - w / 2, minY = cy - hgt / 2;
    const s = svg('svg', { viewBox: `${minX} ${minY} ${w} ${hgt}`, preserveAspectRatio: 'xMidYMid meet' });
    const eg = svg('g', { class: 'q-edges' });
    const lines = E.map(([a, b]) => eg.appendChild(svg('line', { x1: N[a].x, y1: N[a].y, x2: N[b].x, y2: N[b].y })));
    s.append(eg);
    const scale = Math.max(1, w / 220);  // global graph: grow nodes/labels with the canvas
    const nodeEls = N.map((n, i) => {
      const r = (n.tag ? 3.5 : 2.5 + Math.sqrt(deg[i])) * Math.min(scale, 2.2) * 0.8;
      const gEl = svg('g', { class: 'q-node' + (n.tag ? ' q-tagnode' : '') + (n.id === me.file ? ' q-me' : ''), transform: `translate(${n.x},${n.y})` });
      gEl.append(svg('circle', { r }), svg('text', { y: r + 8 * Math.min(scale, 2), 'font-size': 7 * Math.min(scale, 2) }, trunc(n.tag ? '#' + n.label.toLowerCase() : n.label, 30)));
      gEl.addEventListener('mouseenter', () => hover(i, true));
      gEl.addEventListener('mouseleave', () => hover(i, false));
      gEl.addEventListener('click', () => { if (n.href) location.href = n.href; else if (n.tag) openSearch(n.label); });
      s.append(gEl);
      return gEl;
    });
    function hover(i, on) {
      const nb = new Set([i]);
      E.forEach(([a, b]) => { if (a === i) nb.add(b); if (b === i) nb.add(a); });
      nodeEls.forEach((el, j) => { el.classList.toggle('q-dim', on && !nb.has(j)); el.classList.toggle('q-hover', on && nb.has(j)); });
      lines.forEach((l, k) => l.classList.toggle('q-hot', on && (E[k][0] === i || E[k][1] === i)));
    }
    box.append(s);
  }
  drawGraph(localBox, !isHome);

  const overlay = h('div', { id: 'q-graph-overlay', 'data-q': '', onclick: e => { if (e.target === overlay) overlay.classList.remove('q-open'); } });
  const globalBox = h('div', { class: 'q-graph-box' });
  overlay.append(globalBox);
  root.append(overlay);
  function openGlobalGraph() {
    overlay.classList.add('q-open');
    if (!globalBox.querySelector('svg')) drawGraph(globalBox, false);
  }

  // ---------- 6. search (⌘K or /) ----------
  const input = h('input', { type: 'search', placeholder: 'Search for something', spellcheck: 'false' });
  const results = h('div', { class: 'q-results' });
  const searchEl = h('div', { id: 'q-search', 'data-q': '', onclick: e => { if (e.target === searchEl) closeSearch(); } },
    h('div', { class: 'q-search-panel' }, input, results));
  root.append(searchEl);
  let sel = 0, hits = [];

  function mark(text, terms) {
    const frag = document.createDocumentFragment();
    if (!terms.length) { frag.append(text); return frag; }
    const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    text.split(re).forEach((part, i) => frag.append(i % 2 ? h('mark', null, part) : part));
    return frag;
  }
  function runSearch() {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    results.textContent = '';
    if (!terms.length) { hits = []; return; }
    hits = pages.map(p => {
      const fields = [[p.title, 5], [p.tag, 3], [p.tags.join(' '), 3], [p.blurb, 2], [p.headings.join(' '), 1]];
      let score = 0;
      for (const t of terms) {
        const s = fields.reduce((acc, [f, w]) => acc + (f.toLowerCase().includes(t) ? w : 0), 0);
        if (!s) return null;
        score += s;
      }
      return { p, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12).map(x => x.p);
    sel = 0;
    if (!hits.length) { results.append(h('div', { class: 'q-noresult' }, 'No results.')); return; }
    hits.forEach((p, i) => {
      const heading = p.headings.find(x => terms.some(t => x.toLowerCase().includes(t)));
      results.append(h('a', { class: 'q-result' + (i === sel ? ' q-sel' : ''), href: p.href },
        h('div', { class: 'q-rt' }, mark(p.title, terms)),
        h('div', { class: 'q-rb' }, mark(p.blurb || heading || '', terms)),
        h('span', { class: 'q-rtag' }, p.tag)));
    });
  }
  function openSearch(q) {
    searchEl.classList.add('q-open');
    input.value = q || '';
    runSearch();
    input.focus();
  }
  function closeSearch() { searchEl.classList.remove('q-open'); }
  input.addEventListener('input', runSearch);
  input.addEventListener('keydown', e => {
    const items = results.querySelectorAll('.q-result');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      items[sel].classList.remove('q-sel');
      sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[sel].classList.add('q-sel');
      items[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && hits[sel]) location.href = hits[sel].href;
  });
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchEl.classList.contains('q-open') ? closeSearch() : openSearch(''); }
    else if (e.key === '/' && !typing) { e.preventDefault(); openSearch(''); }
    else if (e.key === 'Escape') { closeSearch(); overlay.classList.remove('q-open'); }
  });

  // ---------- 7. margin doodles ----------
  // Hand-drawn doodles fill the empty space below each sidebar's panels. Each side gets a fixed
  // layer clipped to that space, holding a page-tall track that moves with scroll, so the doodles
  // pass by as if drawn on the page. They alternate sides (zigzagging within each sidebar) and
  // cycle through the set down long pages. Hovering one redraws it stroke by stroke (quartz.css).
  const doodles = Q.doodles || [];
  const GAP = 260;  // vertical distance between consecutive doodles (alternating sides)
  const sides = doodles.length ? [left, right].map(aside => {
    const track = h('div', { class: 'q-doodle-track' });
    const layer = h('div', { class: 'q-doodles', 'data-q': '', 'aria-hidden': 'true' }, track);
    document.body.append(layer);
    return { aside, layer, track, top: 0 };
  }) : [];
  function scrollDoodles() {
    for (const sd of sides) sd.track.style.transform = `translateY(${-(scrollY + sd.top)}px)`;
  }
  function layoutDoodles() {
    for (const sd of sides) {
      const r = sd.aside.getBoundingClientRect();
      const kids = [...sd.aside.children].filter(k => k.offsetParent);
      sd.top = Math.max(0, ...kids.map(k => k.getBoundingClientRect().bottom)) + 32;
      const room = !phone.matches && r.width > 0 && innerHeight - sd.top > 140;
      sd.layer.classList.toggle('q-on', room);
      Object.assign(sd.layer.style, { left: r.left + 'px', width: r.width + 'px', top: sd.top + 'px', height: Math.max(0, innerHeight - sd.top) + 'px' });
      sd.track.textContent = '';
    }
    const on = sides.filter(sd => sd.layer.classList.contains('q-on'));
    if (on.length) {
      const start = Math.max(...on.map(sd => sd.top)) + 20;
      const count = Math.max(2, Math.floor((document.documentElement.scrollHeight - start) / GAP));
      for (let i = 0; i < count; i++) {
        const sd = on[i % on.length], d = doodles[i % doodles.length];
        const el = h('span', { class: 'q-doodle' });
        el.innerHTML = d.svg;
        // Zigzag within the sidebar: every other doodle on a given side hugs its outer edge.
        const outer = Math.floor(i / on.length) % 2 === 0;
        const edge = (sd.aside === left) === outer ? 'left' : 'right';
        el.style.cssText = `--rot:${d.rot}deg;top:${start + i * GAP}px;${edge}:40px`;
        sd.track.append(el);
      }
    }
    scrollDoodles();
  }
  if (sides.length) {
    addEventListener('scroll', scrollDoodles, { passive: true });
    let doodleTimer;
    const relayout = () => { clearTimeout(doodleTimer); doodleTimer = setTimeout(layoutDoodles, 100); };
    addEventListener('resize', relayout);
    addEventListener('load', relayout);
    // Collapsing the TOC or opening cards changes the free space and the page height.
    new ResizeObserver(relayout).observe(article);
    // The sidebars are always one window tall, so watch the panels inside them: collapsing one
    // changes how much room is left for doodles.
    const panelsRO = new ResizeObserver(relayout);
    for (const panel of [graphPanel, toc, backlinks]) panelsRO.observe(panel);
    layoutDoodles();
  }

  // Canvases and width-dependent diagrams were sized for the old layout; let pages re-measure.
  requestAnimationFrame(() => dispatchEvent(new Event('resize')));
})();
