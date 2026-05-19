export function createReadyCommandQueue() {
  const entries = new Map();
  const pending = new Map();

  function markPending(source, tabId = null) {
    entries.set(source, { tabId, ready: false });
  }

  function isReady(source) {
    return Boolean(entries.get(source)?.ready);
  }

  function isReadyForTab(source, tabId = null) {
    const entry = entries.get(source);
    return Boolean(entry?.ready) && (tabId == null || entry.tabId === tabId);
  }

  function markReady(source, tabId = null) {
    const previous = entries.get(source) || {};
    entries.set(source, {
      tabId: tabId ?? previous.tabId ?? null,
      ready: true,
    });
  }

  function queueCommand(source, message, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(source);
        reject(new Error(`${source} 就绪超时，等待超过 ${Math.round(timeoutMs / 1000)} 秒`));
      }, timeoutMs);
      pending.set(source, { message, resolve, reject, timer });
    });
  }

  async function flushReadyCommand(source, send) {
    markReady(source);
    const command = pending.get(source);
    if (!command) return null;

    pending.delete(source);
    clearTimeout(command.timer);

    try {
      const result = await send(command.message);
      command.resolve(result);
      return result;
    } catch (error) {
      command.reject(error);
      throw error;
    }
  }

  return {
    flushReadyCommand,
    isReady,
    isReadyForTab,
    markPending,
    markReady,
    queueCommand,
  };
}
