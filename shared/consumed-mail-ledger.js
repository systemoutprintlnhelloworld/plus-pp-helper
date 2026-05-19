const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PER_EMAIL = 100;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeMessageId(messageId) {
  return String(messageId || '').trim();
}

function toTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEntry(entry = {}) {
  const messageId = normalizeMessageId(entry.messageId);
  const usedAt = String(entry.usedAt || '').trim();
  if (!messageId || !usedAt || !toTimestamp(usedAt)) {
    return null;
  }
  return { messageId, usedAt };
}

function pruneEntries(entries = [], { now = new Date().toISOString(), ttlMs = DEFAULT_TTL_MS, maxPerEmail = DEFAULT_MAX_PER_EMAIL } = {}) {
  const nowTs = toTimestamp(now) || Date.now();
  const maxAge = Math.max(0, Number(ttlMs) || DEFAULT_TTL_MS);
  const limit = Math.max(1, Number(maxPerEmail) || DEFAULT_MAX_PER_EMAIL);
  const deduped = [];
  const seen = new Set();

  for (const rawEntry of entries) {
    const entry = normalizeEntry(rawEntry);
    if (!entry) continue;
    const usedAtTs = toTimestamp(entry.usedAt);
    if (!usedAtTs) continue;
    if (nowTs - usedAtTs > maxAge) continue;
    if (seen.has(entry.messageId)) continue;
    seen.add(entry.messageId);
    deduped.push(entry);
  }

  deduped.sort((left, right) => toTimestamp(right.usedAt) - toTimestamp(left.usedAt));
  return deduped.slice(0, limit);
}

export function pruneConsumedMailLedger(ledger = {}, options = {}) {
  const nextLedger = {};

  for (const [rawEmail, rawEntries] of Object.entries(ledger || {})) {
    const email = normalizeEmail(rawEmail);
    if (!email || !Array.isArray(rawEntries)) continue;
    const entries = pruneEntries(rawEntries, options);
    if (entries.length > 0) {
      nextLedger[email] = entries;
    }
  }

  return nextLedger;
}

export function markVerificationMailConsumed(ledger = {}, {
  email,
  messageId,
  usedAt = new Date().toISOString(),
  now = usedAt,
  ttlMs = DEFAULT_TTL_MS,
  maxPerEmail = DEFAULT_MAX_PER_EMAIL,
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedMessageId = normalizeMessageId(messageId);
  const prunedLedger = pruneConsumedMailLedger(ledger, { now, ttlMs, maxPerEmail });

  if (!normalizedEmail || !normalizedMessageId) {
    return prunedLedger;
  }

  const existingEntries = Array.isArray(prunedLedger[normalizedEmail]) ? prunedLedger[normalizedEmail] : [];
  const nextEntries = pruneEntries([
    { messageId: normalizedMessageId, usedAt: String(usedAt || now || new Date().toISOString()) },
    ...existingEntries,
  ], { now, ttlMs, maxPerEmail });

  if (nextEntries.length > 0) {
    prunedLedger[normalizedEmail] = nextEntries;
  }

  return prunedLedger;
}

export function getConsumedMessageIds(ledger = {}, emails = [], options = {}) {
  const prunedLedger = pruneConsumedMailLedger(ledger, options);
  const ids = new Set();

  for (const rawEmail of emails) {
    const email = normalizeEmail(rawEmail);
    if (!email) continue;
    for (const entry of prunedLedger[email] || []) {
      if (entry?.messageId) {
        ids.add(entry.messageId);
      }
    }
  }

  return Array.from(ids);
}
