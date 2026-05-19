function normalizeTabId(tabId) {
  const normalized = Number(tabId);
  return Number.isInteger(normalized) && normalized > 0 ? String(normalized) : '';
}

function normalizePendingPayload(payload = {}) {
  const step = Number(payload?.step || 0);
  if (!step) {
    return null;
  }

  return {
    step,
    startedAt: Math.max(0, Number(payload?.startedAt) || 0),
    ...(payload?.phase ? { phase: String(payload.phase) } : {}),
    ...(payload?.payload !== undefined ? { payload: payload.payload } : {}),
  };
}

export function setPendingSignupStepForTab(store = {}, tabId, payload = {}) {
  const key = normalizeTabId(tabId);
  const entry = normalizePendingPayload(payload);
  if (!key || !entry) {
    return { ...(store || {}) };
  }

  return {
    ...(store || {}),
    [key]: entry,
  };
}

export function getPendingSignupStepForTab(store = {}, tabId, { now = Date.now(), ttlMs = 180000 } = {}) {
  const key = normalizeTabId(tabId);
  if (!key) {
    return null;
  }

  const entry = store?.[key];
  if (!entry?.step) {
    return null;
  }

  const startedAt = Math.max(0, Number(entry.startedAt) || 0);
  if (startedAt && (Math.max(0, Number(now) || 0) - startedAt) > Math.max(1000, Number(ttlMs) || 0)) {
    return null;
  }

  return {
    step: Number(entry.step),
    ...(startedAt ? { startedAt } : {}),
    ...(entry.phase ? { phase: String(entry.phase) } : {}),
    ...(entry.payload !== undefined ? { payload: entry.payload } : {}),
  };
}

export function clearPendingSignupStepForTab(store = {}, tabId) {
  const key = normalizeTabId(tabId);
  if (!key || !store?.[key]) {
    return { ...(store || {}) };
  }

  const nextStore = { ...(store || {}) };
  delete nextStore[key];
  return nextStore;
}
