const DEFAULT_BASE_URL = 'http://localhost:5000';
const DEFAULT_ACCOUNTS_PATH = '/api/external/accounts';
const DEFAULT_MAILS_PATH = '/api/external/emails';

function buildUrl(baseUrl, pathname, query = {}) {
  const base = baseUrl || DEFAULT_BASE_URL;
  const url = new URL(pathname || '/', base.endsWith('/') ? base : `${base}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`邮箱平台返回的不是 JSON (${response.status})`);
  }

  if (!response.ok || payload?.success === false || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `邮箱平台请求失败 (${response.status})`);
  }
  return payload;
}

function pickArrayPayload(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.accounts)) return payload.data.accounts;
  if (Array.isArray(payload?.data?.emails)) return payload.data.emails;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => {
    if (typeof tag === 'string') {
      return { name: tag };
    }
    return tag || {};
  });
}

function normalizeAccount(account = {}) {
  return {
    id: account.id || account.account_id || account.email_id || 0,
    address: String(account.email || account.address || account.mail || account.email_addr || '').trim().toLowerCase(),
    aliases: Array.isArray(account.aliases)
      ? account.aliases.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : [],
    password: account.password || account.mail_password || account.login_password || '',
    clientId: account.client_id || account.clientId || '',
    refreshToken: account.refresh_token || account.refreshToken || '',
    groupId: account.group_id || 0,
    groupName: account.group_name || '',
    tags: normalizeTags(account.tags),
    status: account.status || '',
    provider: account.provider || account.channel || '',
    source: account.source || 'sandbox',
    isTemp: Boolean(account.isTemp || account.is_temp),
    requestedEmail: account.requested_email || account.email || account.address || '',
    resolvedEmail: account.resolved_email || account.email || account.address || '',
    matchedAlias: account.matched_alias || '',
  };
}

function firstTextValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = typeof value === 'string' ? value : String(value);
    if (text.trim()) return text;
  }
  return '';
}

function normalizeSingleAccountPayload(payload = {}) {
  if (payload?.email || payload?.address || payload?.mail || payload?.email_addr) {
    return [normalizeAccount(payload)];
  }
  if (payload?.account && typeof payload.account === 'object') {
    return [normalizeAccount(payload.account)];
  }
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return normalizeSingleAccountPayload(payload.data);
  }
  return [];
}

function normalizeMail(mail = {}) {
  return {
    messageId: mail.id || mail.message_id || mail.messageId || '',
    idMode: mail.id_mode || mail.idMode || '',
    from: mail.from || mail.sender || '',
    to: mail.to || mail.receiver || '',
    subject: mail.subject || '',
    bodyText: firstTextValue(
      mail.body_preview,
      mail.body_text,
      mail.text,
      mail.plain,
      mail.plainText,
      mail.content_text,
      mail.content,
      mail.body
    ),
    bodyHtml: firstTextValue(
      mail.mail_body_html,
      mail.body_html,
      mail.html,
      mail.htmlBody,
      mail.html_body,
      mail.content_html,
      mail.content,
      mail.body
    ),
    receivedAt: mail.date || mail.received_at || mail.created_at || '',
    folder: mail.folder || 'inbox',
    isRead: Boolean(mail.is_read || mail.read),
  };
}

function normalizeMailDetail(mail = {}, messageId = '') {
  return {
    id: mail.id || mail.message_id || mail.messageId || messageId,
    messageId: mail.id || mail.message_id || mail.messageId || messageId,
    idMode: mail.id_mode || mail.idMode || '',
    subject: mail.subject || '',
    from: mail.from || mail.sender || '',
    to: mail.to || mail.receiver || '',
    bodyText: firstTextValue(mail.body_text, mail.bodyText, mail.body_preview, mail.text, mail.plain, mail.plainText, mail.content_text, mail.content, mail.body),
    body: firstTextValue(mail.body, mail.bodyHtml, mail.body_html, mail.mail_body_html, mail.html, mail.htmlBody, mail.html_body, mail.content_html, mail.content),
    receivedAt: mail.received_at || mail.date || mail.created_at || '',
  };
}

function getDetailMethod(options = {}) {
  if (options.method) {
    return options.method;
  }
  const idMode = String(options.idMode || options.id_mode || '').trim().toLowerCase();
  if (idMode === 'uid' || idMode === 'sequence') {
    return 'imap';
  }
  return 'graph';
}

function buildDetailFailureMessage(internalError) {
  const internalMessage = internalError?.message || '';
  if (/\b401\b|unauthorized|未经授权/i.test(internalMessage)) {
    return '无法读取邮件详情：内部详情接口返回 401。outlookEmail 的 external API Key 只能读取邮件列表预览，完整正文需要浏览器已登录配置的邮箱后台并携带 Web session，或由服务端开放包含完整正文的 external 详情接口。';
  }
  const detailMessage = internalMessage || '邮件详情接口不可用';
  return `无法读取邮件详情：${detailMessage}`;
}

function isAccountRegistered(account = {}) {
  const status = String(account.status || '').trim().toLowerCase();
  if (['registered', 'used', 'completed', 'done'].includes(status)) {
    return true;
  }
  return (account.tags || []).some((tag) => {
    const name = String(tag?.name || tag || '').trim().toLowerCase();
    return name === 'plus' || name === '已注册' || name === 'registered';
  });
}

export function createSandboxMailClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  accountsPath = DEFAULT_ACCOUNTS_PATH,
  mailsPath = DEFAULT_MAILS_PATH,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) {
    throw new Error('邮件平台 API Key 不能为空');
  }
  if (!baseUrl) {
    throw new Error('邮件平台 Base URL 不能为空');
  }

  async function request(pathname, query = {}, options = {}) {
    const url = buildUrl(baseUrl, pathname, query);
    let response;
    try {
      const headers = {
        'X-API-Key': apiKey,
        ...(options.headers || {}),
      };
      if (options.body) {
        headers['Content-Type'] = 'application/json';
      }
      response = await fetchImpl(url, {
        method: options.method || 'GET',
        credentials: options.credentials,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      throw new Error(`无法连接邮箱平台接口：${url}。原始错误：${error?.message || String(error)}`);
    }
    return parseJsonResponse(response);
  }

  async function listAccounts() {
    const payload = await request(accountsPath, {
      status: 'unregistered',
    });
    const arrayAccounts = pickArrayPayload(payload, ['accounts', 'emails', 'items', 'results'])
      .map(normalizeAccount);
    const singleAccounts = normalizeSingleAccountPayload(payload);
    return [...arrayAccounts, ...singleAccounts]
      .filter((account, index, accounts) => (
        account.address
        && !isAccountRegistered(account)
        && accounts.findIndex((item) => item.address === account.address) === index
      ));
  }

  async function findUserEmailByAddress(address) {
    const normalizedAddress = String(address || '').trim().toLowerCase();
    const accounts = await listAccounts();
    return accounts.find((account) => (
      account.address === normalizedAddress
      || account.aliases.includes(normalizedAddress)
    )) || null;
  }

  async function listUserEmailMails(email, {
    folder = 'all',
    top = 10,
    skip = 0,
    subjectContains = '',
    fromContains = '',
    keyword = '',
  } = {}) {
    const payload = await request(mailsPath, {
      email,
      folder,
      top,
      skip,
      subject_contains: subjectContains,
      from_contains: fromContains,
      keyword,
    });
    const emails = pickArrayPayload(payload, ['emails', 'mails', 'messages', 'items', 'results']);
    return {
      emails: emails.map(normalizeMail),
      partial: Boolean(payload.partial),
      details: payload.details || null,
      requestedEmail: payload.requested_email || email,
      resolvedEmail: payload.resolved_email || email,
      matchedAlias: payload.matched_alias || '',
      hasMore: Boolean(payload.has_more),
    };
  }

  async function getEmailDetail(email, messageId, options = {}) {
    const folder = options.folder || 'inbox';
    const method = getDetailMethod(options);
    try {
      const payload = await request(`/api/email/${encodeURIComponent(email)}/${encodeURIComponent(messageId)}`, {
        folder,
        method,
      }, {
        credentials: 'include',
      });
      const mail = payload.mail || payload.email || payload.message || payload.data || payload;
      return normalizeMailDetail(mail, messageId);
    } catch (error) {
      throw new Error(buildDetailFailureMessage(error));
    }
  }

  return {
    listAccounts,
    findUserEmailByAddress,
    listUserEmailMails,
    getEmailDetail,
  };
}
