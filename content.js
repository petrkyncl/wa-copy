// WA Copy — runs in the page (MAIN world) so it can read WhatsApp's own message store.
// Data comes from the store (exact time, sender, media type, works for messages the
// virtualized list already dropped from the DOM); the DOM is only used for UI and as fallback.
(() => {
  if (window.__waCopy) return;
  window.__waCopy = true;

  const MSG_SEL = '[data-testid^="conv-msg-"]';
  // call_log entries live in the chat's store but WhatsApp Web doesn't render them in the chat.
  const SKIP_TYPE = /notification|^gp2$|^protocol$|^ciphertext$|^debug$|^call_log$/;

  // ---------- store access ----------
  let S = null;
  function store() {
    if (S) return S;
    try { S = window.require('WAWebCollections'); } catch { S = null; }
    return S;
  }
  function activeChat() {
    const s = store();
    if (!s) return null;
    try { return s.Chat.getActive?.() || s.Chat.getModelsArray().find((c) => c.active) || null; } catch { return null; }
  }
  function rawMsgs() {
    try { return activeChat()?.msgs?.getModelsArray() ?? []; } catch { return []; }
  }
  // The collection is NOT in display order (synced history gets appended), so sort by time.
  function chatMsgs() {
    return rawMsgs()
      .filter(exportable)
      .sort((a, b) => a.t - b.t || (a.rowId ?? 0) - (b.rowId ?? 0));
  }
  const sameId = (m, id) => m?.id && (m.id.id === id || m.id._serialized === id);
  function msgById(id) {
    return rawMsgs().find((m) => sameId(m, id)) || null;
  }

  // ---------- names ----------
  const contactName = (c) => c && (c.name || c.pushname || c.verifiedName || c.formattedName || null);
  let meNameCache = null;
  function meName() {
    if (meNameCache) return meNameCache;
    try {
      const u = window.require('WAWebUserPrefsMeUser');
      const s = store();
      const c = s.Contact.get(u.getMaybeMeLidUser?.()) || s.Contact.get(u.getMaybeMePnUser?.());
      meNameCache = c?.pushname || c?.verifiedName || c?.name || null;
    } catch {}
    return meNameCache || 'Me';
  }
  function nameForWid(wid) {
    if (!wid) return null;
    try { return contactName(store().Contact.get(wid)); } catch { return null; }
  }
  function senderName(m) {
    if (m.id?.fromMe) return meName();
    const chat = activeChat();
    if (chat?.isGroup || m.author) {
      return contactName(m.senderObj) || nameForWid(m.author) || m.notifyName || 'Unknown';
    }
    return contactName(chat?.contact) || chat?.name || chat?.formattedTitle || contactName(m.senderObj) || 'Unknown';
  }

  // ---------- formatting ----------
  const pad = (n) => String(n).padStart(2, '0');
  function fmtTime(t) {
    const d = new Date(t * 1000);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtDur(sec) {
    sec = Number(sec);
    if (!sec) return '';
    return ` ${Math.floor(sec / 60)}:${pad(Math.round(sec % 60))}`;
  }
  // Never fall back to `body` for media: there it holds a base64 thumbnail.
  function content(m) {
    const cap = m.caption ? ' ' + m.caption : '';
    switch (m.type) {
      case 'chat': return m.body ?? '';
      case 'image': return '<image>' + cap;
      case 'video': return (m.isGif ? '<GIF>' : '<video' + fmtDur(m.duration) + '>') + cap;
      case 'ptv': return '<video message' + fmtDur(m.duration) + '>';
      case 'ptt': return '<voice message' + fmtDur(m.duration) + '>';
      case 'audio': return '<audio' + fmtDur(m.duration) + '>' + cap;
      case 'document': return `<document: ${m.filename || 'file'}>` + (m.caption && m.caption !== m.filename ? cap : '');
      case 'sticker': return '<sticker>';
      case 'location': return `<location: ${m.lat}, ${m.lng}>` + (m.loc ? ' ' + m.loc : '');
      case 'vcard': return `<contact: ${m.vcardFormattedName || ''}>`;
      case 'multi_vcard': return '<contacts>';
      case 'poll_creation': {
        const opts = (m.pollOptions || []).map((o) => o.name).filter(Boolean);
        return `<poll: ${m.pollName || ''}>` + (opts.length ? ' [' + opts.join(' | ') + ']' : '');
      }
      case 'revoked': return '<message deleted>';
      case 'call_log': {
        const kind = m.isVideoCall ? 'video call' : 'call';
        if (m.callDuration) return `<${kind}${fmtDur(m.callDuration)}>`;
        return `<${kind}${m.callOutcome ? ': ' + String(m.callOutcome).toLowerCase() : ''}>`;
      }
      default: return `<${m.type}>` + cap;
    }
  }
  function quotePrefix(m) {
    const q = m.quotedMsg;
    if (!q || !q.type) return '';
    let who = null;
    if (m.quotedParticipant) {
      try {
        const u = window.require('WAWebUserPrefsMeUser');
        const qp = m.quotedParticipant._serialized || String(m.quotedParticipant);
        const mine = [u.getMaybeMeLidUser?.(), u.getMaybeMePnUser?.()].some((w) => w && w._serialized === qp);
        who = mine ? meName() : nameForWid(m.quotedParticipant);
      } catch {}
    }
    let snip = content(q).replace(/\s+/g, ' ').trim();
    if (snip.length > 60) snip = snip.slice(0, 57) + '…';
    return `(↩ ${who ? who + ': ' : ''}"${snip}") `;
  }
  function formatMsg(m) {
    return `[${fmtTime(m.t)}] ${senderName(m)}: ${quotePrefix(m)}${content(m)}`;
  }
  const exportable = (m) => m && m.t && !SKIP_TYPE.test(m.type || '');

  // DOM fallback when the store is not reachable (WhatsApp changed its internals).
  function formatDom(el) {
    const pre = el.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text');
    const text = el.querySelector('[data-testid="selectable-text"]')?.innerText?.trim() || '';
    let media = '';
    if (el.querySelector('video')) media = '<video>';
    else if (el.querySelector('[data-icon*="audio"], [data-icon*="ptt"]')) media = '<voice message>';
    else if (el.querySelector('[data-icon*="document"]')) media = '<document>';
    else if (el.querySelector('img[src^="blob:"]')) media = '<image>';
    const body = [media, text].filter(Boolean).join(' ');
    if (pre) return `${pre.trim()} ${body}`;
    const who = el.querySelector('span[aria-label]')?.getAttribute('aria-label')?.replace(/:$/, '') || '?';
    const time = el.querySelector('[data-testid="msg-meta"]')?.innerText?.trim() || '';
    return `[${time}] ${who}: ${body}`;
  }

  // ---------- selection ----------
  let selected = new Set();
  let anchor = null;
  let chatKey = null;

  function domIds() {
    return [...document.querySelectorAll('#main ' + MSG_SEL)].map((e) => e.getAttribute('data-id'));
  }
  function orderedIds() {
    const msgs = chatMsgs();
    return msgs.length ? msgs.map((m) => m.id.id) : domIds();
  }
  function selectRange(fromId, toId) {
    const ids = orderedIds();
    let a = ids.indexOf(fromId), b = ids.indexOf(toId);
    if (a < 0 || b < 0) { selected.add(toId); return; }
    if (a > b) [a, b] = [b, a];
    selected = new Set(ids.slice(a, b + 1));
  }
  function toggle(id) {
    selected.has(id) ? selected.delete(id) : selected.add(id);
    anchor = id;
  }
  function clearSel() {
    selected = new Set();
    anchor = null;
    render();
  }
  function selectionText() {
    const msgs = chatMsgs();
    if (msgs.length) {
      return msgs.filter((m) => selected.has(m.id.id)).map(formatMsg).join('\n');
    }
    return [...document.querySelectorAll('#main ' + MSG_SEL)]
      .filter((el) => selected.has(el.getAttribute('data-id')))
      .map(formatDom).join('\n');
  }
  function singleText(el) {
    const m = msgById(el.getAttribute('data-id'));
    return m ? formatMsg(m) : formatDom(el);
  }
  function selCount() {
    const msgs = chatMsgs();
    return msgs.length ? msgs.filter((m) => selected.has(m.id.id)).length : selected.size;
  }
  function checkChat() {
    const c = activeChat();
    const key = c?.id?._serialized || location.href;
    if (key !== chatKey) {
      chatKey = key;
      if (selected.size) clearSel();
    }
  }

  // ---------- clipboard ----------
  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }
  const plural = (n) => (n === 1 ? 'zpráva' : n >= 2 && n <= 4 ? 'zprávy' : 'zpráv');
  async function doCopy(text, n) {
    const ok = await copyText(text);
    toast(ok ? `Zkopírováno: ${n} ${plural(n)}` : 'Kopírování selhalo');
  }

  // ---------- UI ----------
  const ICON_COPY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const tools = document.createElement('div');
  tools.id = 'wac-tools';
  tools.innerHTML =
    `<button type="button" data-act="select" title="Vybrat (Shift = rozsah, ⌘ = přidat)">${ICON_CHECK}</button>` +
    `<button type="button" data-act="copy" title="Kopírovat">${ICON_COPY}</button>`;

  const bar = document.createElement('div');
  bar.id = 'wac-bar';
  bar.innerHTML =
    '<span class="wac-count"></span>' +
    `<button type="button" data-act="copy-sel" class="wac-primary">${ICON_COPY}<span>Kopírovat</span></button>` +
    `<button type="button" data-act="clear" title="Zrušit výběr (Esc)">${ICON_X}</button>`;

  const toastEl = document.createElement('div');
  toastEl.id = 'wac-toast';

  const selStyle = document.createElement('style');
  selStyle.id = 'wac-sel-style';

  function mount() {
    if (!document.body) return;
    for (const el of [tools, bar, toastEl]) if (!el.isConnected) document.body.appendChild(el);
    if (!selStyle.isConnected) document.head.appendChild(selStyle);
  }

  let hoverEl = null;
  let hideTimer = null;

  function placeTools(el) {
    const bubble = el.querySelector('[data-testid="msg-container"]') || el;
    const r = bubble.getBoundingClientRect();
    const main = document.querySelector('#main')?.getBoundingClientRect();
    if (!r.height || !main) return hideTools();
    const id = el.getAttribute('data-id');
    tools.classList.toggle('wac-on', selected.has(id));
    tools.style.display = 'flex';
    const w = tools.offsetWidth;
    const right = r.left + r.width / 2 > main.left + main.width / 2; // outgoing bubble sits on the right
    let left = right ? r.left - w - 6 : r.right + 6;
    left = Math.max(main.left + 4, Math.min(left, main.right - w - 4));
    const top = Math.max(main.top + 60, Math.min(r.top + 2, r.bottom - tools.offsetHeight));
    tools.style.left = left + 'px';
    tools.style.top = top + 'px';
  }
  function showTools(el) {
    clearTimeout(hideTimer);
    hoverEl = el;
    placeTools(el);
  }
  function hideTools() {
    tools.style.display = 'none';
    hoverEl = null;
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTools, 150);
  }

  function render() {
    const n = selCount();
    bar.querySelector('.wac-count').textContent = `${n} ${plural(n)}`;
    bar.style.display = selected.size ? 'flex' : 'none';
    if (selected.size) {
      const main = document.querySelector('#main');
      const footer = main?.querySelector('footer');
      const mr = main?.getBoundingClientRect();
      if (mr) {
        bar.style.left = mr.left + mr.width / 2 + 'px';
        const bottomEdge = footer ? footer.getBoundingClientRect().top : mr.bottom;
        bar.style.top = bottomEdge - 56 + 'px';
      }
    }
    const ids = [...selected].map((id) => `#main [data-id="${CSS.escape(id)}"]`);
    selStyle.textContent = ids.length
      ? `${ids.join(',\n')} { background-color: var(--wac-sel-bg) !important; }`
      : '';
    if (hoverEl) placeTools(hoverEl);
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    const mr = document.querySelector('#main')?.getBoundingClientRect();
    toastEl.style.left = (mr ? mr.left + mr.width / 2 : window.innerWidth / 2) + 'px';
    toastEl.style.top = (mr ? mr.top + 72 : 72) + 'px';
    toastEl.classList.add('wac-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('wac-show'), 1600);
  }

  function pick(el, e) {
    const id = el.getAttribute('data-id');
    if (e.shiftKey && anchor) selectRange(anchor, id);
    else toggle(id);
    render();
  }

  // ---------- events ----------
  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('#wac-tools')) { clearTimeout(hideTimer); return; }
    const el = t.closest('#main ' + MSG_SEL);
    if (el) {
      mount();
      checkChat();
      if (el !== hoverEl) showTools(el);
      else clearTimeout(hideTimer);
    } else if (hoverEl) scheduleHide();
  }, true);

  tools.addEventListener('mousedown', (e) => e.preventDefault()); // keep composer focus & text selection intact
  tools.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !hoverEl) return;
    e.stopPropagation();
    if (btn.dataset.act === 'select') pick(hoverEl, e);
    else if (btn.dataset.act === 'copy') {
      const id = hoverEl.getAttribute('data-id');
      if (selected.size > 1 && selected.has(id)) doCopy(selectionText(), selCount());
      else doCopy(singleText(hoverEl), 1);
    }
  });

  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.act === 'copy-sel') doCopy(selectionText(), selCount());
    else if (btn.dataset.act === 'clear') clearSel();
  });

  // While something is selected: Shift+click a message = range, ⌘/Ctrl+click = add/remove.
  document.addEventListener('mousedown', (e) => {
    if (!selected.size || !(e.shiftKey || e.metaKey || e.ctrlKey)) return;
    if (e.target.closest?.('#main ' + MSG_SEL)) e.preventDefault(); // no native text selection
  }, true);
  document.addEventListener('click', (e) => {
    if (!selected.size || !(e.shiftKey || e.metaKey || e.ctrlKey)) return;
    const t = e.target;
    if (!(t instanceof Element) || t.closest('#wac-tools, #wac-bar')) return;
    const el = t.closest('#main ' + MSG_SEL);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    pick(el, e);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!selected.size) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearSel();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && window.getSelection()?.isCollapsed !== false) {
      e.preventDefault();
      e.stopImmediatePropagation();
      doCopy(selectionText(), selCount());
    }
  }, true);

  document.addEventListener('scroll', () => {
    if (hoverEl) {
      if (hoverEl.isConnected) placeTools(hoverEl);
      else hideTools();
    }
  }, true);
  window.addEventListener('resize', render);
  setInterval(() => {
    mount();
    checkChat();
  }, 1000);
})();
