export function createAutoRunPausedError(message = '自动流程已暂停') {
  const error = new Error(message);
  error.code = 'AUTO_RUN_PAUSED';
  return error;
}

export function isAutoRunPausedError(error) {
  return Boolean(error && (error.code === 'AUTO_RUN_PAUSED' || error.message === '自动流程已暂停'));
}

