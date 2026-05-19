export function getAutoRunPrimaryControl(state = {}) {
  const hasFailedStep = Object.values(state.stepStatuses || {}).includes('failed');
  if (state.autoRunning) {
    return { label: '暂停', action: 'pause' };
  }
  if (state.autoPaused || hasFailedStep) {
    return { label: '继续', action: 'continue' };
  }
  return { label: '自动运行', action: 'start' };
}

export function getAutoRunRestartLabel(state = {}) {
  const hasFailedStep = Object.values(state.stepStatuses || {}).includes('failed');
  if (state.autoPaused || hasFailedStep) {
    return '重新开始';
  }
  return '重启本轮';
}
