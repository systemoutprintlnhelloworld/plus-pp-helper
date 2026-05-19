export function resolveLoginPassword({
  defaultLoginPassword = '',
  accountPassword = '',
} = {}) {
  const preferred = String(defaultLoginPassword || '').trim();
  if (preferred) {
    return preferred;
  }
  return String(accountPassword || '');
}

