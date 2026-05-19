const FORBIDDEN_SESSION_HOSTS = new Set([

]);

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase();
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1';
}

function isForbiddenSessionHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (FORBIDDEN_SESSION_HOSTS.has(normalized)) {
    return true;
  }
  return normalized.endsWith('.openai.com') || normalized.endsWith('.chatgpt.com');
}

function parseUrl(value, baseUrl = 'http://localhost/') {
  try {
    return new URL(String(value || '').trim(), baseUrl);
  } catch {
    return null;
  }
}

function collectAllowedHostnames(allowedBaseUrls = []) {
  return new Set(
    allowedBaseUrls
      .map((value) => parseUrl(value))
      .filter(Boolean)
      .map((url) => normalizeHostname(url.hostname))
      .filter(Boolean)
  );
}

export function validateSandboxSessionEndpoint(endpoint, {
  allowedBaseUrls = [],
  baseUrl = 'http://localhost/',
  enforceAllowlist = true,
} = {}) {
  const parsed = parseUrl(endpoint, baseUrl);
  if (!parsed) {
    throw new Error('Session JSON URL 无效');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Session JSON URL 仅支持 http/https');
  }

  if (isForbiddenSessionHostname(parsed.hostname)) {
    throw new Error('拒绝读取真实 ChatGPT/OpenAI session endpoint；请配置比赛 sandbox/mock 地址');
  }

  const allowedHostnames = collectAllowedHostnames(allowedBaseUrls);
  const hostname = normalizeHostname(parsed.hostname);
  if (enforceAllowlist && !isLoopbackHostname(hostname) && allowedHostnames.size > 0 && !allowedHostnames.has(hostname)) {
    throw new Error(`Session JSON URL 不在当前 sandbox allowlist 中：${hostname}`);
  }

  return parsed.toString();
}

export function isForbiddenOpenAITarget(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed && isForbiddenSessionHostname(parsed.hostname));
}
