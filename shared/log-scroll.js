export function isScrollNearBottom(metrics = {}, threshold = 24) {
  const scrollTop = Number(metrics.scrollTop || 0);
  const scrollHeight = Number(metrics.scrollHeight || 0);
  const clientHeight = Number(metrics.clientHeight || 0);
  return (scrollHeight - clientHeight - scrollTop) <= threshold;
}

export function getLogAreaScrollTop({ preserveScrollTop = 0, nextScrollHeight = 0, stickToBottom = false } = {}) {
  if (stickToBottom) {
    return Number(nextScrollHeight || 0);
  }
  return Number(preserveScrollTop || 0);
}
