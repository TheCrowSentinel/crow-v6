/* Crow v6 demo model. No ledger, wallet, secret generation, or signing code. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrowCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const HOUR = 3600000;
  const CATEGORIES = Object.freeze({ goods: 'Goods & marketplaces', construction: 'Construction milestone', services: 'Home services' });
  const STATUSES = new Set(['draft', 'funded', 'inspection', 'disputed', 'refund_pending', 'released', 'refunded']);
  const EVENT_LABELS = Object.freeze({ created: 'Agreement created', funded: 'Demo escrow funded', delivered: 'Delivery marked complete', released: 'Buyer approved release', disputed: 'Dispute opened', mediator_release: 'Demo mediator authorized seller payment', mediator_refund: 'Demo mediator selected the refund path', cancelled: 'Expired escrow cancellation simulated' });
  const safeTime = value => Number.isSafeInteger(value) && value > 0 && value < 8640000000000000;
  function noSecrets(value) {
    const text = String(value || '');
    if (/\b(?:seed\s*(?:phrase|secret)?|private[\s_-]*key|recovery[\s_-]*phrase|mnemonic|api[\s_-]*secret)\s*[:=]/i.test(text) || /\bs[1-9A-HJ-NP-Za-km-z]{24,35}\b/.test(text) || /\b[0-9a-f]{64}\b/i.test(text)) {
      throw new Error('Use fictional demo details only. Wallet secrets and private keys are not accepted.');
    }
    return text;
  }
  function cleanText(value, name, min, max) {
    if (typeof value !== 'string') throw new Error(`${name} is required.`);
    const text = noSecrets(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (text.length < min || text.length > max) throw new Error(`${name} must be ${min}–${max} characters.`);
    return text;
  }
  function parseAmount(value) {
    const text = String(value).trim();
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(text)) throw new Error('Enter a positive XRP amount with up to 6 decimal places, without commas.');
    const [whole, decimal = ''] = text.split('.');
    const drops = Number(whole) * 1000000 + Number(decimal.padEnd(6, '0'));
    if (!Number.isSafeInteger(drops) || drops < 1 || drops > 1000000000000) throw new Error('Demo amount must be between 0.000001 and 1,000,000 XRP.');
    return drops;
  }
  function amountString(drops) {
    if (!Number.isSafeInteger(drops) || drops < 1) throw new Error('Invalid amount.');
    const whole = Math.floor(drops / 1000000);
    const fraction = String(drops % 1000000).padStart(6, '0').replace(/0+$/, '');
    return String(whole) + (fraction ? '.' + fraction : '');
  }
  function createOrder(input, now = Date.now(), id) {
    if (!safeTime(now)) throw new Error('Invalid demo clock.');
    if (!Object.hasOwn(CATEGORIES, input.category)) throw new Error('Choose a trade type.');
    const days = Number(input.expiryDays);
    const hours = Number(input.inspectionHours);
    if (![7, 14, 30].includes(days)) throw new Error('Choose a supported expiry.');
    if (![24, 48, 72].includes(hours)) throw new Error('Choose a supported inspection window.');
    return {
      id: id || 'CRW-' + (globalThis.crypto?.randomUUID?.() || `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
      title: cleanText(input.title, 'Trade title', 3, 80),
      seller: cleanText(input.seller, 'Sample seller label', 2, 60),
      requirements: cleanText(input.requirements || 'Inspect the agreed delivery before approving release.', 'Agreement', 3, 500),
      category: input.category,
      amountDrops: parseAmount(input.amount),
      inspectionHours: hours,
      createdAt: now,
      cancelAfter: now + days * DAY,
      deliveredAt: null,
      inspectionEndsAt: null,
      status: 'draft',
      disputeReason: '',
      events: [{ type: 'created', at: now }]
    };
  }
  function isExpired(order, now = Date.now()) {
    return !['draft', 'released', 'refunded'].includes(order.status) && now >= order.cancelAfter;
  }
  function displayStatus(order, now = Date.now()) {
    if (isExpired(order, now)) return { label: 'Refund available', color: 'orange', key: 'expired' };
    const statuses = {
      draft: ['Ready to fund', 'gray'], funded: ['Awaiting delivery', 'blue'], inspection: ['Inspection open', ''],
      disputed: ['In mediation', 'orange'], refund_pending: ['Waiting for expiry', 'orange'],
      released: ['Payment released', ''], refunded: ['Buyer refunded', 'blue']
    };
    if (order.status === 'inspection' && now >= order.inspectionEndsAt) return { label: 'Approval needed', color: 'blue', key: 'inspection' };
    const [label, color] = statuses[order.status];
    return { label, color, key: order.status };
  }
  function transition(order, action, now = Date.now(), detail = '') {
    if (!safeTime(now) || now < order.createdAt || now < order.events.at(-1).at) throw new Error('Invalid demo clock.');
    const next = { ...order, events: order.events.map(e => ({ ...e })) };
    const expired = now >= order.cancelAfter;
    const allowed = {
      fund: ['draft'], deliver: ['funded'], release: ['inspection'], dispute: ['funded', 'inspection'],
      mediator_release: ['disputed'], mediator_refund: ['disputed'], cancel: ['funded', 'inspection', 'disputed', 'refund_pending']
    };
    if (!allowed[action]?.includes(order.status)) throw new Error('That action is not available for this trade.');
    if (action === 'cancel' && !expired) throw new Error('Cancellation becomes available only after the fixed expiry.');
    if (action !== 'cancel' && expired) throw new Error('This escrow has expired. Use the cancellation path to simulate a refund.');
    let eventType;
    switch (action) {
      case 'fund': next.status = 'funded'; eventType = 'funded'; break;
      case 'deliver':
        next.status = 'inspection'; next.deliveredAt = now;
        next.inspectionEndsAt = Math.min(now + order.inspectionHours * HOUR, order.cancelAfter);
        eventType = 'delivered'; break;
      case 'release': next.status = 'released'; eventType = 'released'; break;
      case 'dispute':
        next.disputeReason = cleanText(detail, 'Dispute description', 10, 500);
        next.status = 'disputed'; eventType = 'disputed'; break;
      case 'mediator_release': next.status = 'released'; eventType = 'mediator_release'; break;
      case 'mediator_refund': next.status = 'refund_pending'; eventType = 'mediator_refund'; break;
      case 'cancel': next.status = 'refunded'; eventType = 'cancelled'; break;
    }
    next.events.push({ type: eventType, at: now });
    return next;
  }
  function seedOrders(now = Date.now()) {
    function sample(id, input, age) { return createOrder(input, now - age, id); }
    let a = sample('CRW-0601', { title: 'Beachside deck restoration', seller: 'Sample project contractor', requirements: 'Milestone 1: deck boards installed, trim finished, and work area cleared. Inspect against the agreed scope before release.', category: 'construction', amount: '2400', expiryDays: 7, inspectionHours: 72 }, 3 * DAY);
    a = transition(a, 'fund', now - 3 * DAY + HOUR);
    a = transition(a, 'deliver', now - 3 * HOUR);
    let b = sample('CRW-0602', { title: 'Studio camera kit', seller: 'Sample equipment seller', requirements: 'Camera body, two lenses, batteries, and case. Check condition and operation at handoff.', category: 'goods', amount: '825', expiryDays: 7, inspectionHours: 48 }, 2 * DAY);
    b = transition(b, 'fund', now - 2 * DAY + HOUR);
    const c = sample('CRW-0603', { title: 'Garden & landscape refresh', seller: 'Sample home service provider', requirements: 'Edge, trim, remove debris, and leave the agreed garden areas clean.', category: 'services', amount: '180', expiryDays: 14, inspectionHours: 24 }, DAY);
    return [a, b, c];
  }
  function validateOrder(raw) {
    if (!raw || typeof raw !== 'object' || !STATUSES.has(raw.status)) throw new Error('Invalid saved trade.');
    if (typeof raw.id !== 'string' || !/^CRW-[A-Za-z0-9-]{4,60}$/.test(raw.id)) throw new Error('Invalid trade ID.');
    if (!safeTime(raw.createdAt) || !safeTime(raw.cancelAfter)) throw new Error('Invalid saved dates.');
    const duration = (raw.cancelAfter - raw.createdAt) / DAY;
    const base = createOrder({ title: raw.title, seller: raw.seller, requirements: raw.requirements, category: raw.category, amount: amountString(raw.amountDrops), expiryDays: duration, inspectionHours: raw.inspectionHours }, raw.createdAt, raw.id);
    if (!Array.isArray(raw.events) || raw.events.length < 1 || raw.events.length > 12) throw new Error('Invalid saved activity.');
    if (raw.events[0].type !== 'created' || raw.events[0].at !== raw.createdAt) throw new Error('Invalid creation event.');
    let replay = base;
    const actions = { funded: 'fund', delivered: 'deliver', released: 'release', disputed: 'dispute', mediator_release: 'mediator_release', mediator_refund: 'mediator_refund', cancelled: 'cancel' };
    let previous = raw.createdAt;
    for (const event of raw.events.slice(1)) {
      if (!event || !Object.hasOwn(actions, event.type) || !safeTime(event.at) || event.at < previous) throw new Error('Invalid saved event.');
      replay = transition(replay, actions[event.type], event.at, raw.disputeReason);
      previous = event.at;
    }
    if (replay.status !== raw.status || replay.deliveredAt !== raw.deliveredAt || replay.inspectionEndsAt !== raw.inspectionEndsAt || replay.cancelAfter !== raw.cancelAfter) throw new Error('Saved state does not match its activity.');
    return replay;
  }
  function readSaved(json) {
    const data = JSON.parse(json);
    if (data?.version !== 6 || !Array.isArray(data.orders) || data.orders.length < 1 || data.orders.length > 20) throw new Error('Unsupported demo backup.');
    const orders = data.orders.map(validateOrder);
    if (new Set(orders.map(o => o.id)).size !== orders.length) throw new Error('Duplicate trade IDs.');
    return { orders, selectedId: orders.some(o => o.id === data.selectedId) ? data.selectedId : orders[0].id };
  }
  return Object.freeze({ DAY, HOUR, CATEGORIES, EVENT_LABELS, createOrder, transition, seedOrders, displayStatus, isExpired, parseAmount, amountString, readSaved, validateOrder, noSecrets });
});
