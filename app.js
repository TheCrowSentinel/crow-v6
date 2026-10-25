/* Crow v6 UI — every amount, signature, and escrow action is simulated. */
(() => {
  'use strict';
  const C = window.CrowCore;
  const $ = selector => document.querySelector(selector);
  const STORAGE_KEY = 'crow.v6.demo';
  const MOTION_KEY = 'crow.v6.motion';
  const dialog = $('#app-dialog');
  const content = $('#dialog-content');
  let state = { orders: C.seedOrders(), selectedId: 'CRW-0601', clockOffset: 0 };
  let storageAvailable = true;
  let toastTimer;
  let lastFocused;
  const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let manualMotion = false;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = C.readSaved(saved);
      const offset = JSON.parse(saved).clockOffset;
      state = { ...parsed, clockOffset: Number.isSafeInteger(offset) && offset >= 0 && offset <= 365 * C.DAY ? offset : 0 };
    }
    manualMotion = localStorage.getItem(MOTION_KEY) === 'reduce';
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { storageAvailable = false; }
  }
  const now = () => Date.now() + state.clockOffset;
  const current = () => state.orders.find(order => order.id === state.selectedId) || state.orders[0];
  function esc(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function amount(drops) { return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(drops / 1000000); }
  function date(timestamp, full = false) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(full ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(timestamp); }
  function remaining(timestamp) {
    const difference = Math.max(0, timestamp - now());
    const hours = Math.floor(difference / C.HOUR);
    const minutes = Math.floor((difference % C.HOUR) / 60000);
    return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h left` : `${hours}h ${minutes}m left`;
  }
  function notify(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').classList.add('show');
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4200);
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 6, ...state })); storageAvailable = true; }
    catch { storageAvailable = false; }
    const indicator = $('#storage-status');
    if (indicator) indicator.textContent = storageAvailable ? 'Demo saved on this device' : 'Temporary demo — storage unavailable';
  }
  function renderList() {
    $('#trade-count').textContent = String(state.orders.length).padStart(2, '0');
    $('#trade-list').innerHTML = state.orders.map(order => {
      const status = C.displayStatus(order, now());
      const category = { construction: 'PROJECT / MILESTONE', goods: 'GOODS / PRIVATE SALE', services: 'HOME / SERVICES' }[order.category];
      return `<button class="trade-item" data-select="${esc(order.id)}" aria-pressed="${order.id === state.selectedId}" aria-label="${esc(order.title)}, ${esc(status.label)}"><span class="trade-category">${category}</span><span class="trade-name">${esc(order.title)}</span><span class="trade-row"><span>${amount(order.amountDrops)} XRP</span><i class="mini-status ${esc(order.status)}" aria-hidden="true"></i></span></button>`;
    }).join('');
  }
  function renderDetail() {
    const order = current();
    const status = C.displayStatus(order, now());
    const delivered = order.deliveredAt !== null;
    const funded = order.events.some(event => event.type === 'funded');
    const terminal = ['released', 'refunded'].includes(order.status);
    const steps = [{ label: 'Agreed', done: true }, { label: 'Funded', done: funded }, { label: 'Delivered', done: delivered }, { label: order.status === 'refunded' ? 'Refunded' : 'Released', done: terminal }];
    const active = order.status === 'draft' ? 0 : order.status === 'funded' ? 1 : terminal ? 3 : delivered ? 2 : 1;
    const displayId = order.id.length > 14 ? `CRW-${order.id.slice(-8).toUpperCase()}` : order.id;
    let actions = '';
    let notice = '';
    let factTitle = 'INSPECTION WINDOW';
    let factValue = `${order.inspectionHours} hours after delivery`;
    let factFoot = 'Your approval is still required.';
    let advice = 'Inspect the work. Check the agreement. Release when you’re ready.';
    if (status.key === 'expired') {
      factTitle = 'FIXED EXPIRY REACHED'; factValue = 'Refund path available'; factFoot = 'Cancellation is still required.';
      actions = '<button class="button button-blue" data-action="cancel-review">Simulate cancellation <span aria-hidden="true">↗</span></button>';
      notice = 'The deadline has passed. Release is blocked; a cancellation transaction would return the escrow to the buyer.';
      advice = 'Expiry does not refund automatically. Cancellation is the next step.';
    } else {
      switch (order.status) {
        case 'draft':
          actions = '<button class="button button-blue" data-action="fund-review">Review & simulate funding <span aria-hidden="true">↗</span></button>';
          factFoot = 'Starts when delivery is marked.'; advice = 'Check the scope, recipient, amount, and deadline before funding.'; break;
        case 'funded':
          actions = '<button class="button button-blue" data-action="delivery-review">Mark demo delivery <span aria-hidden="true">↗</span></button><button class="button dispute-button" data-action="dispute">Raise a dispute</button>';
          factFoot = 'Starts when delivery is marked.'; advice = 'Waiting for delivery. The fixed expiry continues to run.'; break;
        case 'inspection':
          factValue = now() >= order.inspectionEndsAt ? 'Review reminder ended' : remaining(order.inspectionEndsAt);
          factFoot = now() >= order.inspectionEndsAt ? 'No automatic release.' : `Up to ${order.inspectionHours}h; expiry takes priority.`;
          actions = '<button class="button button-blue" data-action="release-review">Approve & release <span aria-hidden="true">↗</span></button><button class="button dispute-button" data-action="dispute">Raise a dispute</button>'; break;
        case 'disputed':
          factValue = 'On hold for review'; factFoot = 'Ledger expiry cannot be paused.';
          actions = '<button class="button button-outline" data-action="mediation">Explore mediation outcomes <span aria-hidden="true">↗</span></button>';
          notice = 'Normal release is paused. A human mediator would review both sides before an outcome. The fixed expiry remains in effect.';
          advice = 'Start with the agreement and evidence. Disputes need human judgment.'; break;
        case 'refund_pending':
          factValue = 'Awaiting fixed expiry'; factFoot = 'No early cancellation in this model.';
          actions = '<button class="button button-outline" data-action="expiry-review">Preview expiry & refund path <span aria-hidden="true">↗</span></button>';
          notice = 'Buyer-favorable demo outcome: release is withheld. After expiry, cancellation can return the escrow to the buyer.';
          advice = 'A refund decision withholds release. The escrow must still reach its fixed expiry.'; break;
        case 'released':
          factTitle = 'DEMO OUTCOME'; factValue = 'Seller payment simulated'; factFoot = 'No XRP was transferred.';
          actions = '<button class="button button-outline" data-action="new-order">Create another demo escrow <span aria-hidden="true">＋</span></button>';
          notice = 'This demo trade is complete. In the intended flow, ledger validation would confirm payment before the trade is marked released.';
          advice = 'A clear agreement and an explicit approval. That’s a completed demo trade.'; break;
        case 'refunded':
          factTitle = 'DEMO OUTCOME'; factValue = 'Buyer refund simulated'; factFoot = 'No XRP was transferred.';
          actions = '<button class="button button-outline" data-action="new-order">Create another demo escrow <span aria-hidden="true">＋</span></button>';
          notice = 'Cancellation after expiry has been simulated. A real refund would require a validated EscrowCancel transaction.';
          advice = 'The demo cancellation is complete. No funds moved.'; break;
      }
    }
    $('#guardian-advice').textContent = advice;
    $('#trade-detail').innerHTML = `<div class="detail-topline"><span class="trade-id">DEMO ESCROW / ${esc(displayId)}</span><span class="badge ${status.color}">${status.label}</span></div><h3>${esc(order.title)}</h3><div class="trade-subtitle"><span>${C.CATEGORIES[order.category]}</span><span>You are the buyer</span><button class="subtle-button" data-action="agreement">View terms ↗</button></div><div class="amount-row"><div><div class="trade-amount">${amount(order.amountDrops)}<small>XRP</small></div><p class="amount-caption">${order.status === 'draft' ? 'Proposed demo amount' : terminal ? 'Simulated settlement' : 'Held in demo escrow'}</p></div><div class="expiry-caption">FIXED EXPIRY<strong>${date(order.cancelAfter)}</strong>${!terminal && order.status !== 'draft' ? (status.key === 'expired' ? 'Deadline reached' : esc(remaining(order.cancelAfter))) : 'Set in the agreement'}</div></div><div class="timeline" aria-label="Trade progress">${steps.map((step, index) => `<span class="timeline-node ${step.done ? 'done' : ''} ${active === index ? 'current' : ''}" ${active === index ? 'aria-current="step"' : ''}>${step.label}</span>`).join('')}</div><div class="trade-facts"><div class="fact-box"><span class="fact-label">${factTitle}</span><span class="fact-value">${esc(factValue)}</span><p class="fact-foot">${esc(factFoot)}</p></div><div class="fact-box"><span class="fact-label">AGREED SELLER</span><span class="fact-value">${esc(order.seller)}</span><p class="fact-foot">Fictional demo counterparty</p></div></div>${notice ? `<p class="trade-notice ${status.color === 'orange' ? 'orange' : ''}">${esc(notice)}</p>` : ''}<div class="detail-actions">${actions}</div><p class="detail-note">SIMULATED ACTIONS ONLY. NO WALLET IS CONNECTED.${state.clockOffset ? ' DEMO CLOCK ADVANCED.' : ''}</p>${funded && !terminal && !['expired', 'refund_pending'].includes(status.key) ? '<button class="subtle-button" data-action="expiry-review">Preview fixed expiry ↗</button>' : ''}`;
  }
  function render() { renderList(); renderDetail(); persist(); }
  function openDialog(title, html, eyebrow = 'CROW / DEMO WORKSPACE') {
    lastFocused = document.activeElement;
    $('#dialog-title').textContent = title;
    $('#dialog-eyebrow').textContent = eyebrow;
    content.innerHTML = html;
    if (!dialog.open) dialog.showModal();
    const first = content.querySelector('input:not([type="radio"]), textarea, button');
    if (first && matchMedia('(min-width: 541px)').matches) first.focus({ preventScroll: true });
  }
  function closeDialog() { dialog.close(); }
  function summary(order) {
    return `<div class="dialog-summary"><div class="dialog-summary-row"><span>Trade</span><strong>${esc(order.title)}</strong></div><div class="dialog-summary-row"><span>Agreed seller</span><strong>${esc(order.seller)}</strong></div><div class="dialog-summary-row"><span>Fixed expiry</span><strong>${date(order.cancelAfter, true)}</strong></div><div class="dialog-summary-row total"><span>Simulated amount</span><strong>${amount(order.amountDrops)} XRP</strong></div></div>`;
  }
  function dialogActions(label, action, blue = true) { return `<div class="dialog-actions"><button class="button button-outline" data-action="close-dialog">Go back</button><button class="button ${blue ? 'button-blue' : 'button-outline'}" data-action="${action}">${label} <span aria-hidden="true">↗</span></button></div>`; }
  function demoNote() { return '<p class="dialog-note">LOCAL SIMULATION / NO SIGNATURES / NO REAL FUNDS</p>'; }
  function newOrder(category = 'goods') {
    if (state.orders.length >= 20) { notify('This demo supports 20 trades. Export or reset to start again.'); return; }
    const templates = {
      goods: { title: '', seller: '', requirements: 'Inspect the agreed item and condition before approving payment.' },
      construction: { title: '', seller: '', requirements: 'Milestone 1: define the completed work, inspection evidence, and acceptance criteria here.' },
      services: { title: '', seller: '', requirements: 'Define the service area, completed tasks, and what a finished job looks like.' }
    };
    const template = templates[category] || templates.goods;
    openDialog('Make the agreement clear.', `<p class="dialog-description">Create a fictional trade to explore Crow. One agreement, one seller, one payment.</p><form id="new-order-form"><fieldset class="template-options"><legend>What kind of exchange?</legend>${[['goods','Goods'],['construction','Milestone'],['services','Home service']].map(([key, label]) => `<label class="template-option"><input type="radio" name="category" value="${key}" ${category === key ? 'checked' : ''}>${label}</label>`).join('')}</fieldset><div class="form-grid"><div class="form-field full"><label for="trade-title">Trade or milestone title</label><input id="trade-title" name="title" placeholder="e.g. Deck restoration — milestone 1" minlength="3" maxlength="80" required autocomplete="off"></div><div class="form-field full"><label for="trade-seller">Fictional seller label</label><input id="trade-seller" name="seller" placeholder="e.g. Sample contractor" minlength="2" maxlength="60" required autocomplete="off"></div><div class="form-field full amount-field"><label for="trade-amount">Demo amount in XRP</label><div class="amount-input"><input id="trade-amount" name="amount" type="text" inputmode="decimal" placeholder="0.00" required maxlength="20" autocomplete="off"><span>XRP</span></div></div><div class="form-field"><label for="trade-expiry">Fixed expiry</label><select id="trade-expiry" name="expiryDays"><option value="7">7 days from now</option><option value="14">14 days from now</option><option value="30">30 days from now</option></select></div><div class="form-field"><label for="trade-inspection">Inspection reminder</label><select id="trade-inspection" name="inspectionHours"><option value="24">24 hours after delivery</option><option value="48">48 hours after delivery</option><option value="72" selected>72 hours after delivery</option></select></div><div class="form-field full"><label for="trade-requirements">What counts as delivered?</label><textarea id="trade-requirements" name="requirements" minlength="3" maxlength="500" required>${esc(template.requirements)}</textarea><span class="field-hint">Use fictional details only. Do not enter personal information, wallet secrets, or recovery phrases. Inspection never extends expiry.</span></div></div><p class="form-error" id="form-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button button-outline" data-action="close-dialog">Cancel</button><button type="submit" class="button button-blue">Create demo agreement <span aria-hidden="true">↗</span></button></div>${demoNote()}</form>`);
  }
  function review(kind) {
    const order = current();
    if (kind === 'release') {
      openDialog('Ready to release?', `<p class="dialog-description">Review the delivery and agreement before approving the seller’s payment.</p>${summary(order)}<label class="consent-label"><input type="checkbox" id="release-consent">I have inspected the delivery and it meets our agreement.</label>${dialogActions('Simulate buyer release', 'confirm-release')}${demoNote()}`);
      const confirm = content.querySelector('[data-action="confirm-release"]'); confirm.disabled = true;
      $('#release-consent').addEventListener('change', event => { confirm.disabled = !event.target.checked; });
    } else if (kind === 'fund') {
      openDialog('Review before the hold.', `<p class="dialog-description">In the intended live flow, you would review and sign an EscrowCreate transaction in Xaman. This button only updates the local demo.</p>${summary(order)}<p class="dialog-description">The expiry is fixed. Normal release needs buyer approval; Crow would hold technical release authority for mediation.</p>${dialogActions('Simulate funding', 'confirm-fund')}${demoNote()}`);
    } else if (kind === 'delivery') {
      openDialog('Mark the demo delivery.', `<p class="dialog-description">This starts the inspection reminder. Marking delivery does not approve payment and does not extend the fixed expiry.</p>${summary(order)}${dialogActions('Start demo inspection', 'confirm-deliver')}${demoNote()}`);
    } else if (kind === 'cancel') {
      openDialog('Simulate the refund path.', `<p class="dialog-description">The fixed expiry has passed. A real EscrowCancel transaction would now be required and validated before the buyer receives the escrow back.</p>${summary(order)}${dialogActions('Simulate cancellation', 'confirm-cancel')}${demoNote()}`);
    }
  }
  function apply(action, detail = '') {
    try {
      const updated = C.transition(current(), action, now(), detail);
      state.orders = state.orders.map(order => order.id === updated.id ? updated : order);
      closeDialog(); render();
      const messages = { fund: 'Demo funded. Nothing was signed or sent.', deliver: 'Inspection started. Payment still needs your approval.', release: 'Buyer release simulated. No XRP moved.', dispute: 'Demo dispute opened. Normal release is on hold.', mediator_release: 'Seller-favorable mediation outcome simulated.', mediator_refund: 'Refund path selected. Fixed expiry still applies.', cancel: 'Cancellation and buyer refund simulated.' };
      notify(messages[action]);
      $('#trade-detail').setAttribute('tabindex', '-1'); $('#trade-detail').focus({ preventScroll: true });
    } catch (error) { notify(error.message); }
  }
  function dispute() {
    openDialog('Bring it under review.', `<p class="dialog-description">Describe a fictional issue. In a live trade, a human mediator would review both sides’ evidence. The fixed expiry continues to run.</p><form id="dispute-form"><div class="form-field"><label for="dispute-reason">What needs a closer look?</label><textarea id="dispute-reason" name="reason" placeholder="e.g. The delivered item differs from the agreed condition." minlength="10" maxlength="500" required></textarea><span class="field-hint">10–500 characters. Use fictional details only.</span></div><p class="form-error" id="form-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button button-outline" data-action="close-dialog">Go back</button><button type="submit" class="button button-blue">Open demo dispute ↗</button></div>${demoNote()}</form>`);
  }
  function mediation() {
    openDialog('Explore a human decision.', `<p class="dialog-description">These controls simulate a mediator’s decision for this local demo. They are not live mediation permissions. A real mediator would first review the agreement and both parties’ evidence.</p><div class="outcome-options"><button class="outcome-button" data-action="mediator-release-review"><span><strong>Seller-favorable outcome</strong><small>Authorize the agreed payment before expiry.</small></span><span aria-hidden="true">↗</span></button><button class="outcome-button" data-action="mediator-refund-review"><span><strong>Buyer-favorable outcome</strong><small>Withhold release, wait for expiry, then cancel.</small></span><span aria-hidden="true">↗</span></button></div>${demoNote()}`, 'CROW / MEDIATION SIMULATOR');
  }
  function expiry() {
    openDialog('See what expiry changes.', `<p class="dialog-description">Advance the local demo clock to the selected trade’s fixed expiry. Other demo deadlines advance too. The deadline itself stays unchanged.</p>${summary(current())}<p class="dialog-description">After expiry, release is blocked and cancellation becomes available. Expiry alone does not refund the trade.</p>${dialogActions('Advance demo clock', 'advance-clock')}${demoNote()}`, 'CROW / EXPIRY SIMULATOR');
  }
  function activity() {
    const order = current();
    openDialog('Every demo step, in view.', `<p class="dialog-description">${esc(order.title)} · Local demo activity.${state.clockOffset ? ' The demo clock has been advanced.' : ''}</p><ol class="activity-list">${[...order.events].reverse().map(event => `<li><div><strong>${C.EVENT_LABELS[event.type]}</strong><time datetime="${new Date(event.at).toISOString()}">${date(event.at, true)}</time>${event.type === 'disputed' ? `<p>${esc(order.disputeReason)}</p>` : ''}</div></li>`).join('')}</ol><p class="dialog-note">THIS IS A LOCAL DEMO LOG, NOT A VALIDATED LEDGER RECORD.</p>`, 'CROW / TRADE ACTIVITY');
  }
  function exportDemo() {
    try {
      const blob = new Blob([JSON.stringify({ version: 6, exportedAt: new Date().toISOString(), notice: 'Crow local demo only. No ledger transactions or wallet credentials.', ...state }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'crow-v6-demo.json'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      notify('Demo exported as JSON. No wallet data is included.');
    } catch { notify('Export is unavailable in this browser. Your demo remains on this device.'); }
  }
  document.addEventListener('click', event => {
    const template = event.target.closest('[data-template]');
    if (template) { newOrder(template.dataset.template); return; }
    const selection = event.target.closest('[data-select]');
    if (selection) { state.selectedId = selection.dataset.select; render(); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    const actions = {
      'new-order': () => newOrder(), 'close-dialog': closeDialog,
      'release-review': () => review('release'), 'fund-review': () => review('fund'),
      'delivery-review': () => review('delivery'), 'cancel-review': () => review('cancel'),
      'confirm-release': () => { if ($('#release-consent')?.checked) apply('release'); },
      'confirm-fund': () => apply('fund'), 'confirm-deliver': () => apply('deliver'), 'confirm-cancel': () => apply('cancel'),
      'dispute': dispute, 'mediation': mediation, 'expiry-review': expiry, 'activity': activity, 'export': exportDemo,
      'mediator-release-review': () => openDialog('Review seller payment.', `<p class="dialog-description">Simulate a seller-favorable human mediation decision. Crow would need the release secret and an authorized signing flow before expiry. This local button has no wallet authority.</p>${summary(current())}${dialogActions('Simulate seller payment', 'confirm-mediator-release')}${demoNote()}`, 'CROW / MEDIATION SIMULATOR'),
      'mediator-refund-review': () => openDialog('Review the refund path.', `<p class="dialog-description">Simulate a buyer-favorable decision by withholding release. The refund still waits for fixed expiry and a cancellation transaction.</p>${summary(current())}${dialogActions('Select refund path', 'confirm-mediator-refund')}${demoNote()}`, 'CROW / MEDIATION SIMULATOR'),
      'confirm-mediator-release': () => apply('mediator_release'), 'confirm-mediator-refund': () => apply('mediator_refund'),
      'advance-clock': () => { state.clockOffset = Math.max(state.clockOffset, current().cancelAfter - Date.now() + 1000); closeDialog(); render(); notify('Demo clock advanced. Release is blocked; cancellation is available.'); },
      'agreement': () => openDialog('The agreement, in view.', `${summary(current())}<p class="form-label">Agreed delivery criteria</p><p class="dialog-description" id="agreement-criteria"></p><p class="dialog-description">Inspection reminder: ${current().inspectionHours} hours after delivery, limited by expiry. Normal release requires explicit buyer approval. Crow mediation depends on the mediator holding the release secret. One escrow, one full payment.</p><p class="dialog-note">DEMO TERMS ONLY / NO LEGAL AGREEMENT CREATED</p>`),
      'reset': () => openDialog('Start with a clean slate?', '<p class="dialog-description">This replaces all trades and activity saved by this demo on this device with the three original samples. Export first if you want to keep a copy. Motion preferences remain unchanged.</p>' + dialogActions('Reset local demo', 'confirm-reset')),
      'confirm-reset': () => { state = { orders: C.seedOrders(), selectedId: 'CRW-0601', clockOffset: 0 }; closeDialog(); render(); notify('Demo reset. Three fresh sample trades are ready.'); }
    };
    actions[action]?.();
    if (action === 'agreement') $('#agreement-criteria').textContent = current().requirements;
  });
  document.addEventListener('submit', event => {
    if (!['new-order-form', 'dispute-form'].includes(event.target.id)) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target).entries());
    try {
      if (event.target.id === 'new-order-form') {
        if (state.orders.length >= 20) throw new Error('The demo is limited to 20 trades.');
        const order = C.createOrder(values, now());
        state.orders.unshift(order); state.selectedId = order.id;
        closeDialog(); render();
        $('#workspace').scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' });
        notify('Demo agreement created. Review it before simulating funding.');
      } else {
        C.noSecrets(values.reason);
        if (String(values.reason).trim().length < 10) throw new Error('Describe the issue in at least 10 characters.');
        apply('dispute', values.reason);
      }
    } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  });
  let pointerDownOutside = false;
  dialog.addEventListener('pointerdown', event => { pointerDownOutside = event.target === dialog; });
  dialog.addEventListener('click', event => { if (event.target === dialog && pointerDownOutside) closeDialog(); pointerDownOutside = false; });
  dialog.addEventListener('close', () => { lastFocused?.isConnected && lastFocused.focus({ preventScroll: true }); });
  const menuButton = $('.menu-toggle');
  menuButton.addEventListener('click', () => {
    const expanded = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!expanded)); menuButton.setAttribute('aria-label', expanded ? 'Open navigation' : 'Close navigation'); $('#mobile-nav').hidden = expanded;
  });
  $('#mobile-nav').addEventListener('click', event => { if (event.target.closest('a')) { menuButton.setAttribute('aria-expanded', 'false'); menuButton.setAttribute('aria-label', 'Open navigation'); $('#mobile-nav').hidden = true; } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#mobile-nav').hidden) { $('#mobile-nav').hidden = true; menuButton.setAttribute('aria-expanded', 'false'); menuButton.setAttribute('aria-label', 'Open navigation'); menuButton.focus(); } });
  function motionReduced() { return manualMotion || systemMotion.matches; }
  function updateMotion() {
    const reduced = motionReduced();
    document.documentElement.classList.toggle('reduce-motion', reduced);
    $('.motion-toggle').setAttribute('aria-pressed', String(reduced));
    $('.motion-toggle').textContent = reduced ? 'Motion reduced' : 'Reduce motion';
  }
  $('.motion-toggle').addEventListener('click', () => {
    if (systemMotion.matches) { notify('Reduced motion follows your device accessibility preference.'); return; }
    manualMotion = !manualMotion; updateMotion();
    try { localStorage.setItem(MOTION_KEY, manualMotion ? 'reduce' : 'full'); } catch { /* Motion remains available for this session. */ }
  });
  systemMotion.addEventListener('change', updateMotion); updateMotion();
  document.querySelectorAll('.reactive').forEach(card => {
    let frame = 0;
    card.addEventListener('pointermove', event => {
      if (motionReduced() || event.pointerType === 'touch') return;
      const x = event.clientX, y = event.clientY;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = card.getBoundingClientRect();
        const px = Math.max(0, Math.min(1, (x - bounds.left) / bounds.width));
        const py = Math.max(0, Math.min(1, (y - bounds.top) / bounds.height));
        card.style.setProperty('--px', `${px * 100}%`); card.style.setProperty('--py', `${py * 100}%`); card.style.setProperty('--glow-opacity', '1');
        card.style.setProperty('--rx', `${(0.5 - py) * 5}deg`); card.style.setProperty('--ry', `${(px - 0.5) * 6}deg`);
      });
    });
    card.addEventListener('pointerleave', () => { cancelAnimationFrame(frame); card.style.setProperty('--glow-opacity', '0'); card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
  });
  const sections = [...document.querySelectorAll('main section[id]')];
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) document.querySelectorAll('.desktop-nav a').forEach(link => link.classList.toggle('active', link.hash === '#' + entry.target.id)); }, { rootMargin: '-20% 0px -60% 0px' });
    sections.forEach(section => observer.observe(section));
  }
  render();
  setInterval(() => { if (!document.hidden && !dialog.open) { renderList(); renderDetail(); } }, 30000);
})();
