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

  // ---------- WhatsApp's own multi-select (props of the conversation's React tree) ----------
  const fiberOf = (el) => {
    const k = el && Object.keys(el).find((x) => x.startsWith('__reactFiber'));
    return k ? el[k] : null;
  };
  function convProps() {
    const el = document.querySelector('#main ' + MSG_SEL);
    for (let f = fiberOf(el), i = 0; f && i < 60; f = f.return, i++) {
      const p = f.memoizedProps;
      if (p && p.selectedMessages && typeof p.onSelectMessages === 'function') return p;
    }
    return null;
  }
  const inSelectMode = () => !!convProps()?.selectable;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

  async function selectMsgs(msgs) {
    let p = convProps();
    if (!p) return false;
    if (!p.selectable) {
      p.onSelectMessages();
      await nextFrame();
      p = convProps() || p;
    }
    for (const m of msgs) p.selectedMessages.setVal(m, true);
    return true;
  }
  function selectedMsgs() {
    const sel = convProps()?.selectedMessages?.getSelected?.() ?? [];
    return sel.filter(exportable).sort((a, b) => a.t - b.t || (a.rowId ?? 0) - (b.rowId ?? 0));
  }

  // Shift+click range anchor (last message clicked/selected in select mode).
  let anchor = null;
  function rangeMsgs(fromId, toId) {
    const msgs = chatMsgs();
    let a = msgs.findIndex((m) => m.id.id === fromId);
    let b = msgs.findIndex((m) => m.id.id === toId);
    if (a < 0 || b < 0) return [];
    if (a > b) [a, b] = [b, a];
    return msgs.slice(a, b + 1);
  }

  // ---------- days ----------
  const dayKey = (t) => {
    const d = new Date(t * 1000);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const dayMsgs = (key) => chatMsgs().filter((m) => dayKey(m.t) === key);

  // ---------- copy + feedback ----------
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
  function toast(msg) {
    try {
      const { ToastManager } = window.require('WAWebToastManager');
      const T = window.require('WAWebToast.react');
      const R = window.require('React');
      ToastManager.open(R.createElement(T.Toast, { msg, id: T.genId() }));
      return;
    } catch {}
    let el = document.getElementById('wac-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wac-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('wac-show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('wac-show'), 1800);
  }
  async function copyMsgs(msgs) {
    if (!msgs.length) return toast('Nothing to copy');
    const ok = await copyText(msgs.map(formatMsg).join('\n'));
    const n = msgs.length;
    toast(ok ? `Copied ${n} message${n === 1 ? '' : 's'}` : "Couldn't copy");
  }

  // ---------- icons (Material Icons, same 24px grid WhatsApp uses) ----------
  const P_COPY = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z';
  const P_SELECT = 'M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm0 16H5V5h14v14zM17.99 9l-1.41-1.42-6.59 6.59-2.58-2.57-1.42 1.41 4 3.99z';
  const P_SELECT_ALL = 'M20 4v12H8V4h12m0-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 9.67l-1.7-1.68L8.4 11.4l3.1 3.1 6.1-6.1-1.4-1.4zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z';
  function svg(path, size = 20) {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('height', size);
    s.setAttribute('width', size);
    s.setAttribute('fill', 'currentColor');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', path);
    s.appendChild(p);
    return s;
  }

  // ---------- hover buttons next to WhatsApp's own "React" button ----------
  // We clone WhatsApp's button wrapper so ours carry the exact same classes (size, shadow,
  // hover state, dark mode) and sit in the same flex row as the native one.
  function injectMsgButtons(reactBtn) {
    let container = reactBtn.parentElement;
    for (let i = 0; container && i < 4 && getComputedStyle(container).position !== 'absolute'; i++) {
      container = container.parentElement;
    }
    if (!container) return;
    let unit = reactBtn;
    while (unit.parentElement && unit.parentElement !== container) unit = unit.parentElement;
    // Keep React next to the bubble and ours further out (mirrored for outgoing messages).
    const msgEl = container.closest(MSG_SEL);
    const out = msgById(msgEl?.getAttribute('data-id'))?.id?.fromMe ?? !!msgEl?.querySelector('[data-icon="tail-out"]');
    let mine = [...container.querySelectorAll(':scope > .wac-unit')];
    if (mine.length) {
      // WhatsApp re-inserts its React button on every hover; put ours back in place around it.
      if (out ? unit.previousElementSibling !== mine[mine.length - 1] : unit.nextElementSibling !== mine[0]) {
        out ? unit.before(...mine) : unit.after(...mine);
      }
      return;
    }
    const make = (act, label, path) => {
      const u = unit.cloneNode(true);
      u.classList.add('wac-unit');
      const b = u.querySelector('[role="button"]') || u;
      b.removeAttribute('data-testid');
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
      b.dataset.wacAct = act;
      const old = b.querySelector('svg');
      if (old) old.replaceWith(svg(path));
      else b.appendChild(svg(path));
      return u;
    };
    mine = [make('copy', 'Copy message', P_COPY), make('select', 'Select messages', P_SELECT)];
    out ? unit.before(...mine.reverse()) : unit.after(...mine);
  }

  // ---------- "Copy" in WhatsApp's own multi-select bar ----------
  function findSelectBar() {
    for (const b of document.querySelectorAll('#main button')) {
      for (let f = fiberOf(b), i = 0; f && i < 25; f = f.return, i++) {
        const p = f.memoizedProps;
        if (p && p.selectedMessages && typeof p.onCancel === 'function') return b;
      }
    }
    return null;
  }
  function injectBarButton() {
    const anyBtn = findSelectBar();
    if (!anyBtn) return;
    // The action group is the closest ancestor holding several buttons; the bar holds them all.
    let bar = anyBtn;
    while (bar.parentElement && bar.querySelectorAll('button').length < 4) bar = bar.parentElement;
    if (bar.querySelector('.wac-bar-unit')) return;
    // Right-hand action group (Star, Delete, Forward, Download) = smallest ancestor of the last
    // two buttons; the first button (Cancel) lives outside it.
    const btns = [...bar.querySelectorAll('button')];
    if (btns.length < 3) return;
    const last = btns[btns.length - 1];
    let group = last.parentElement;
    while (group && !group.contains(btns[btns.length - 2])) group = group.parentElement;
    if (!group || group.contains(btns[0])) return;
    const unitOf = (b) => {
      let u = b;
      while (u.parentElement && u.parentElement !== group) u = u.parentElement;
      return u;
    };
    // Clone an enabled button so the copy doesn't inherit the greyed-out look.
    const source = btns.slice(1).reverse().find((b) => group.contains(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true') || last;
    const u = unitOf(source).cloneNode(true);
    u.classList.add('wac-bar-unit');
    const b = u.querySelector('button') || u;
    b.removeAttribute('disabled');
    b.removeAttribute('aria-disabled');
    b.removeAttribute('data-testid');
    b.setAttribute('aria-label', 'Copy');
    b.setAttribute('title', 'Copy  (⌘C)');
    b.dataset.wacAct = 'copy-selected';
    const old = b.querySelector('svg');
    if (old) old.replaceWith(svg(P_COPY, 24));
    else b.appendChild(svg(P_COPY, 24));
    group.insertBefore(u, unitOf(btns.find((b) => group.contains(b))));
  }

  // ---------- day separators ("Today", "Friday", "7/14/2026") ----------
  let listEl = null;
  // The list holds day separators and blocks of consecutive messages; system notices such as
  // "Use WhatsApp on your phone…" sit one level up, next to it in the messages panel.
  const messagesPanel = () => document.querySelector('#main [data-testid="conversation-panel-messages"]');
  function messageList() {
    if (listEl?.isConnected && listEl.querySelector(MSG_SEL)) return listEl;
    const panel = messagesPanel();
    const fromPanel = panel && [...panel.children].find((c) => c.querySelector(MSG_SEL));
    if (fromPanel) return (listEl = fromPanel);
    const msgs = document.querySelectorAll('#main ' + MSG_SEL);
    if (msgs.length < 2) return null;
    let a = msgs[0];
    while (a && !a.contains(msgs[msgs.length - 1])) a = a.parentElement;
    return (listEl = a);
  }
  // Direct child of `container` that holds `target`, unless it holds messages.
  function nonMessageChild(container, target) {
    if (!container || !container.contains(target)) return null;
    let el = target;
    while (el && el.parentElement !== container) el = el.parentElement;
    return el && !el.querySelector(MSG_SEL) ? el : null;
  }
  function separatorAt(target) {
    const el = nonMessageChild(messageList(), target);
    if (!el) return null;
    const text = el.innerText?.trim();
    if (!text || text.length > 40 || text.includes('\n')) return null;
    return el;
  }
  function separatorDay(sep) {
    for (let n = sep.nextElementSibling; n; n = n.nextElementSibling) {
      const msgEl = n.querySelector(MSG_SEL);
      const m = msgEl && msgById(msgEl.getAttribute('data-id'));
      if (m) return dayKey(m.t);
    }
    return null;
  }
  function pillOf(sep) {
    for (const el of sep.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return el;
    }
    return sep.firstElementChild || sep;
  }

  const dayTools = document.createElement('div');
  dayTools.id = 'wac-day';
  const dayBtn = (act, label, path) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.wacAct = act;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(svg(path, 16));
    return b;
  };
  dayTools.append(dayBtn('select-day', 'Select whole day', P_SELECT_ALL), dayBtn('copy-day', 'Copy whole day', P_COPY));
  let daySep = null;
  let dayHideTimer = null;

  function showDayTools(sep) {
    clearTimeout(dayHideTimer);
    if (!dayTools.isConnected) document.body.appendChild(dayTools);
    daySep = sep;
    const pill = pillOf(sep);
    const r = pill.getBoundingClientRect();
    const cs = getComputedStyle(pill);
    for (const b of dayTools.children) {
      b.style.background = cs.backgroundColor;
      b.style.color = cs.color;
      b.style.boxShadow = cs.boxShadow;
      b.style.height = b.style.width = Math.round(r.height) + 'px';
    }
    dayTools.style.display = 'flex';
    dayTools.style.left = r.right + 6 + 'px';
    dayTools.style.top = r.top + 'px';
  }
  function hideDayTools() {
    dayTools.style.display = 'none';
    daySep = null;
  }

  // ---------- older history from the phone ----------
  // WhatsApp Web stopped offering this in the UI, but still ships the mechanism: a
  // HISTORY_SYNC_ON_DEMAND peer-data request asks the primary phone for the messages before
  // the oldest one stored locally. The phone answers with a history-sync chunk that WhatsApp
  // writes to its DB; loadEarlierMsgs then pulls those into the open chat.
  const HISTORY_BATCH = 500; // WhatsApp asks for 50 (AB prop); the phone honours larger batches.
  const P_HISTORY = 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z';
  const fmtDay = (t) => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  let loading = null;

  // Resolves 'ok' when the phone delivered a chunk, 'end' when it answered with an error
  // (in practice: nothing older for this chat), 'timeout' when it didn't answer at all.
  // Event-driven on purpose: Chrome throttles timers in background tabs.
  async function requestFromPhone(chat) {
    const AB = window.require('WAWebABProps');
    const T = window.require('WAWebProtobufsE2E.pb').Message$PeerDataOperationRequestType;
    const { sendPeerDataOperationRequest } = window.require('WAWebSendNonMessageDataRequest');
    const E = window.require('WAWebHistorySyncOnDemandEvents').WAWebHistorySyncOnDemandEvents;
    const OK = 'history_sync_on_demand_events:success_history_sync_od';
    const ERR = 'history_sync_on_demand_events:error_history_sync_od';
    let finish;
    const answered = new Promise((resolve) => {
      const timer = setTimeout(() => finish('timeout'), 45000);
      const onOk = () => finish('ok');
      const onErr = () => finish('end');
      E.on(OK, onOk);
      E.on(ERR, onErr);
      finish = (result) => {
        clearTimeout(timer);
        E.off(OK, onOk);
        E.off(ERR, onErr);
        resolve(result);
      };
    });
    const orig = AB.getABPropConfigValue;
    AB.getABPropConfigValue = function (key) {
      return key === 'history_sync_on_demand_message_count' ? HISTORY_BATCH : orig.apply(this, arguments);
    };
    try {
      await sendPeerDataOperationRequest(T.HISTORY_SYNC_ON_DEMAND, { chatId: chat.id });
    } catch (err) {
      finish('timeout');
      throw err;
    } finally {
      AB.getABPropConfigValue = orig;
    }
    return answered;
  }

  async function loadHistory() {
    if (loading) {
      loading.cancel = true;
      return;
    }
    const chat = activeChat();
    if (!chat) return;
    const state = (loading = { cancel: false, chat });
    const { loadEarlierMsgs } = window.require('WAWebChatLoadMessages');
    const { getOldestMsgInChatFromDB } = window.require('WAWebNonMessageDataRequestHistorySyncOnDemandUtils');
    const stillHere = () => !state.cancel && activeChat() === chat;
    const report = (phase) => {
      const msgs = chatMsgs();
      showProgress(phase, msgs.length, msgs[0]?.t, state);
    };
    // Pull everything already in the local DB into the open chat.
    const drainLocal = async () => {
      for (;;) {
        const before = chat.msgs.length;
        chat.msgs.msgLoadState.noEarlierMsgs = false;
        await loadEarlierMsgs({ chat });
        if (chat.msgs.length === before || !stillHere()) return;
        report('loading');
      }
    };
    let outcome = 'done';
    try {
      report('loading');
      await drainLocal();
      while (stillHere()) {
        const before = (await getOldestMsgInChatFromDB(chat.id))?.t;
        const answer = await requestFromPhone(chat);
        if (answer === 'timeout') {
          outcome = 'offline';
          break;
        }
        if (answer === 'end' || !stillHere()) break;
        await drainLocal();
        const after = (await getOldestMsgInChatFromDB(chat.id))?.t;
        if (after === before) break; // the phone answered but had nothing older
      }
      if (state.cancel) outcome = 'stopped';
    } catch (err) {
      console.warn('[WA Copy] history load failed', err);
      outcome = 'error';
    } finally {
      loading = null;
    }
    if (activeChat() === chat) report(outcome);
  }

  // Progress pill under the chat header, styled like WhatsApp's date pills.
  const progressEl = document.createElement('div');
  progressEl.id = 'wac-progress';
  progressEl.innerHTML =
    '<span class="wac-progress-text"></span>' +
    '<button type="button" data-wac-act="copy-all">Copy all</button>' +
    '<button type="button" data-wac-act="progress-close" aria-label="Close" title="Close"></button>';
  progressEl.lastElementChild.appendChild(svg('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z', 16));
  let progressTimer = null;

  function showProgress(phase, count, oldestT, state) {
    clearTimeout(progressTimer);
    const main = document.querySelector('#main');
    if (!main) return;
    if (!progressEl.isConnected) document.body.appendChild(progressEl);
    const pill = document.querySelector('#main ' + MSG_SEL)
      ? [...(messageList()?.children || [])].map((c) => !c.querySelector(MSG_SEL) && pillOf(c)).find(Boolean)
      : null;
    if (pill) {
      const cs = getComputedStyle(pill);
      progressEl.style.background = cs.backgroundColor;
      progressEl.style.color = cs.color;
      progressEl.style.boxShadow = cs.boxShadow;
    }
    const since = oldestT ? ` · since ${fmtDay(oldestT)}` : '';
    const n = `${count.toLocaleString('en-US')} message${count === 1 ? '' : 's'}`;
    const text = {
      loading: `Loading history from phone… ${n}${since}`,
      done: `Full history loaded · ${n}${since}`,
      stopped: `Stopped · ${n}${since}`,
      offline: `Phone didn't respond, keep WhatsApp open on it · ${n}${since}`,
      error: `Couldn't load more · ${n}${since}`,
    }[phase];
    progressEl.querySelector('.wac-progress-text').textContent = text;
    progressEl.dataset.phase = phase;
    const header = main.querySelector('header')?.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    progressEl.style.left = mr.left + mr.width / 2 + 'px';
    progressEl.style.top = (header ? header.bottom : mr.top) + 12 + 'px';
    progressEl.style.display = 'flex';
    if (phase !== 'loading') progressTimer = setTimeout(hideProgress, 15000);
  }
  function hideProgress() {
    progressEl.style.display = 'none';
  }

  // Header button next to WhatsApp's own Search, cloned from it.
  function injectHeaderButton() {
    const header = document.querySelector('#main header');
    if (!header || header.querySelector('.wac-header-unit')) return;
    const iconBtn = (name) => [...header.querySelectorAll('button')].find((b) => b.querySelector('svg title')?.textContent === name);
    const search = iconBtn('ic-search');
    const menu = iconBtn('ic-more-vert');
    if (!search) return;
    let group = search.parentElement;
    while (group && menu && !group.contains(menu)) group = group.parentElement;
    if (!group) return;
    let unit = search;
    while (unit.parentElement && unit.parentElement !== group) unit = unit.parentElement;
    const u = unit.cloneNode(true);
    u.classList.add('wac-header-unit');
    const b = u.querySelector('button') || u;
    b.removeAttribute('data-testid');
    b.setAttribute('aria-label', 'Load older messages from phone');
    b.setAttribute('title', 'Load older messages from phone');
    b.dataset.wacAct = 'load-history';
    const old = b.querySelector('svg');
    if (old) old.replaceWith(svg(P_HISTORY, 24));
    group.insertBefore(u, unit);
  }

  // "Use WhatsApp on your phone to see older messages from before …" becomes clickable again.
  function historyNoticeAt(target) {
    const el = nonMessageChild(messageList(), target) || nonMessageChild(messagesPanel(), target);
    if (!el) return null;
    const text = el.innerText?.trim() || '';
    // Long system line that carries a date, e.g. "… older messages from before 7/14/2026."
    return text.length > 40 && /\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/.test(text) ? el : null;
  }

  // ---------- events ----------
  // Inject buttons whenever WhatsApp renders its hover controls or the select bar.
  let scheduled = false;
  function scan() {
    scheduled = false;
    for (const rb of document.querySelectorAll('#main [data-testid="reaction-entry-point"]')) injectMsgButtons(rb);
    const selecting = inSelectMode();
    document.body.classList.toggle('wac-selecting', selecting);
    if (selecting) injectBarButton();
    injectHeaderButton();
  }
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('#wac-day')) return clearTimeout(dayHideTimer);
    const notice = historyNoticeAt(t);
    if (notice && !notice.dataset.wacNotice) {
      notice.dataset.wacNotice = '1';
      notice.title = 'Click to load older messages from your phone';
      pillOf(notice).style.cursor = 'pointer';
    }
    const sep = separatorAt(t);
    if (sep) return sep !== daySep ? showDayTools(sep) : clearTimeout(dayHideTimer);
    if (daySep) {
      clearTimeout(dayHideTimer);
      dayHideTimer = setTimeout(hideDayTools, 200);
    }
  }, true);
  document.addEventListener('scroll', () => daySep && hideDayTools(), true);

  const swallow = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  // Our buttons: handle on pointerdown/click in capture phase so WhatsApp's handlers never see them.
  window.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-wac-act]')) swallow(e);
  }, true);
  window.addEventListener('mousedown', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('[data-wac-act]')) return swallow(e);
    // Shift+click in select mode would otherwise start a native text selection.
    if (e.shiftKey && t.closest('#main [role="row"]') && inSelectMode()) e.preventDefault();
  }, true);

  window.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest('[data-wac-act]');
    if (btn) {
      swallow(e);
      const act = btn.dataset.wacAct;
      if (act === 'copy-selected') return copyMsgs(selectedMsgs());
      if (act === 'load-history') return loadHistory();
      if (act === 'copy-all') return copyMsgs(chatMsgs());
      if (act === 'progress-close') {
        if (loading) loading.cancel = true;
        return hideProgress();
      }
      if (act === 'select-day' || act === 'copy-day') {
        const key = daySep && separatorDay(daySep);
        const msgs = key ? dayMsgs(key) : [];
        if (act === 'copy-day') return copyMsgs(msgs);
        if (msgs.length && (await selectMsgs(msgs))) anchor = msgs[msgs.length - 1].id.id;
        return;
      }
      const msgEl = btn.closest(MSG_SEL);
      const m = msgEl && msgById(msgEl.getAttribute('data-id'));
      if (act === 'copy') {
        if (m) return copyMsgs([m]);
        const ok = msgEl && (await copyText(formatDom(msgEl)));
        return toast(ok ? 'Copied 1 message' : "Couldn't copy");
      }
      if (act === 'select' && m) {
        if (await selectMsgs([m])) anchor = m.id.id;
        else toast('Selection is not available');
      }
      return;
    }
    if (historyNoticeAt(t)) {
      swallow(e);
      return loadHistory();
    }
    // Select mode: remember the anchor, Shift+click selects everything in between.
    const row = t.closest('#main [role="row"]');
    const msgEl = row?.querySelector(MSG_SEL);
    if (!msgEl || !inSelectMode()) return;
    const id = msgEl.getAttribute('data-id');
    if (e.shiftKey && anchor && anchor !== id) {
      swallow(e);
      await selectMsgs(rangeMsgs(anchor, id));
    }
    anchor = id;
  }, true);

  // ⌘C / Ctrl+C in select mode copies the selected messages (unless text is highlighted).
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'c') return;
    if (window.getSelection()?.isCollapsed === false) return;
    if (!inSelectMode()) return;
    const msgs = selectedMsgs();
    if (!msgs.length) return;
    swallow(e);
    copyMsgs(msgs);
  }, true);

  // Forget the anchor when switching chats.
  let chatKey = null;
  setInterval(() => {
    const key = activeChat()?.id?._serialized || null;
    if (key !== chatKey) {
      chatKey = key;
      anchor = null;
      hideDayTools();
      if (!loading) hideProgress();
    }
  }, 1000);
})();
