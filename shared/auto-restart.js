export function buildAutoRestartRuntimeUpdates({
  mode = 'current',
  currentAccountIndex = 0,
} = {}) {
  const nextIndex = mode === 'next'
    ? Math.max(0, Number(currentAccountIndex) + 1)
    : Math.max(0, Number(currentAccountIndex) || 0);

  return {
    currentAccountIndex: nextIndex,
    currentAccount: null,
    currentEmailRecord: null,
    localhostUrl: '',
    lastSignupCode: '',
    lastSignupMail: null,
    lastLoginCode: '',
    lastLoginMail: null,
    autoPaused: false,
    stopRequested: false,
  };
}
