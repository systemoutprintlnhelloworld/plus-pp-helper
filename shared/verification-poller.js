function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodeUtf8Bytes(bytes) {
  if (!bytes.length) {
    return '';
  }
  if (typeof TextDecoder === 'function') {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  }
  return String.fromCharCode(...bytes);
}

function decodeQuotedPrintableText(text) {
  const raw = String(text || '');
  if (!/=(?:\r?\n|[0-9a-f]{2})/i.test(raw)) {
    return raw;
  }

  const normalized = raw
    .replace(/=\r\n/g, '')
    .replace(/=\n/g, '')
    .replace(/=\r/g, '');
  const bytes = [];
  let output = '';

  function flushBytes() {
    output += decodeUtf8Bytes(bytes);
    bytes.length = 0;
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const hex = normalized.slice(index + 1, index + 3);
    if (char === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      index += 2;
      continue;
    }

    const code = char.charCodeAt(0);
    if (code <= 0x7f) {
      bytes.push(code);
    } else {
      flushBytes();
      output += char;
    }
  }

  flushBytes();
  return output;
}

function stripHtmlForCodeExtraction(text) {
  return decodeQuotedPrintableText(text)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/https?:\/\/[^\s"'<>]+/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCharCode(value) : ' ';
    })
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectTextParts(source = {}, keys = []) {
  const parts = [];
  const seen = new Set();
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined || value === null) continue;
    const text = typeof value === 'string' ? value : String(value);
    if (!text.trim() || seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }
  return parts;
}

function extractVerificationCode(text) {
  const normalizedText = stripHtmlForCodeExtraction(text);
  const contextPatterns = [
    /(?:verification|temporary|one[-\s]*time|login|sign[-\s]*in|auth(?:entication)?)\s+(?:code|passcode|otp)[^\d]{0,160}\b(\d{6})\b/i,
    /(?:code|passcode|otp)[^\d]{0,120}\b(\d{6})\b/i,
    /(?:验证码|校验码|动态码|一次性代码|代码)[^\d]{0,120}\b(\d{6})\b/i,
  ];

  for (const pattern of contextPatterns) {
    const match = normalizedText.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  const sixDigitMatches = Array.from(normalizedText.matchAll(/(?<!\d)(\d{6})(?!\d)/g))
    .map((match) => match[1]);
  if (sixDigitMatches.length === 1) {
    return sixDigitMatches[0];
  }

  return '';
}

const MAIL_TEXT_KEYS = [
  'subject',
  'bodyText',
  'bodyHtml',
  'body',
  'text',
  'html',
  'content',
  'body_text',
  'body_html',
  'mail_body_html',
  'bodyPreview',
  'body_preview',
  'plain',
  'plainText',
  'htmlBody',
  'html_body',
  'contentHtml',
  'content_html',
];

function buildMailCodeText(mail = {}) {
  return collectTextParts(mail, MAIL_TEXT_KEYS).map(decodeQuotedPrintableText).join(' ').trim();
}

function buildMailMatchText(mail = {}) {
  return collectTextParts(mail, ['from', 'to', ...MAIL_TEXT_KEYS]).map(decodeQuotedPrintableText).join(' ').toLowerCase();
}

function limitDebugText(text, maxLength = 12000) {
  const raw = String(text || '');
  if (raw.length <= maxLength) {
    return raw;
  }
  return `${raw.slice(0, maxLength)}\n...（邮件调试内容过长，已截断 ${raw.length - maxLength} 字符）`;
}

function buildMailDebugSnapshot({ reason, mail = {}, detail = null, error = null } = {}) {
  const lines = [
    `原因：${reason || '未知'}`,
    `messageId：${mail.messageId || mail.id || ''}`,
    `idMode：${mail.idMode || mail.id_mode || ''}`,
    `from：${mail.from || ''}`,
    `to：${mail.to || ''}`,
    `subject：${mail.subject || ''}`,
    `receivedAt：${mail.receivedAt || mail.date || ''}`,
    `folder：${mail.folder || ''}`,
    `isRead：${mail.isRead === undefined ? '' : String(Boolean(mail.isRead))}`,
    '--- preview bodyText ---',
    mail.bodyText || mail.body_text || mail.text || '',
    '--- preview bodyHtml/body ---',
    mail.bodyHtml || mail.body || mail.body_html || mail.mail_body_html || mail.html || mail.content || '',
  ];

  if (detail) {
    lines.push(
      '--- detail subject/from ---',
      `subject：${detail.subject || ''}`,
      `from：${detail.from || ''}`,
      '--- detail bodyText ---',
      detail.bodyText || detail.body_text || detail.text || '',
      '--- detail bodyHtml/body ---',
      detail.body || detail.bodyHtml || detail.body_html || detail.mail_body_html || detail.html || detail.content || ''
    );
  }

  if (error) {
    lines.push('--- detail error ---', error?.message || String(error));
  }

  return limitDebugText(lines.join('\n'));
}

function buildExtractionFailure(reason, mail, detail = null, error = null) {
  return {
    code: '',
    mail,
    extractedFromDetail: false,
    debugSnapshot: buildMailDebugSnapshot({ reason, mail, detail, error }),
  };
}

function matchesMailBase(mail, match = {}, options = {}) {
  const fromIncludes = String(match.fromIncludes || '').trim().toLowerCase();
  const subjectContains = String(match.subjectContains || '').trim().toLowerCase();
  const unreadOnly = Boolean(options.unreadOnly);
  const consumedMessageIds = options.consumedMessageIds instanceof Set
    ? options.consumedMessageIds
    : new Set(options.consumedMessageIds || []);

  const subject = String(mail.subject || '').toLowerCase();
  const from = String(mail.from || '').toLowerCase();
  const messageId = String(mail.messageId || '').trim();

  if (subjectContains && !subject.includes(subjectContains)) {
    return false;
  }
  if (fromIncludes && !from.includes(fromIncludes)) {
    return false;
  }
  if (unreadOnly && mail?.isRead) {
    return false;
  }
  if (messageId && consumedMessageIds.has(messageId)) {
    return false;
  }
  return true;
}

function matchesKeywordText(text, keyword) {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase();
  if (!normalizedKeyword) {
    return true;
  }
  return String(text || '').toLowerCase().includes(normalizedKeyword);
}

function matchesMail(mail, match = {}, options = {}) {
  if (!matchesMailBase(mail, match, options)) {
    return false;
  }
  const keyword = String(match.keyword || '').trim().toLowerCase();
  const haystack = buildMailMatchText(mail);
  if (keyword && !haystack.includes(keyword)) {
    return false;
  }
  return true;
}

function selectFreshMail(mails, minReceivedAt, match, freshnessGraceMs = 0, {
  allowKeywordFallback = false,
  unreadOnly = false,
  consumedMessageIds = [],
} = {}) {
  const minTimestamp = parseTimestamp(minReceivedAt);
  return mails.find((mail) => {
    const matches = allowKeywordFallback
      ? matchesMailBase(mail, match, { unreadOnly, consumedMessageIds })
      : matchesMail(mail, match, { unreadOnly, consumedMessageIds });
    if (!matches) {
      return false;
    }
    const receivedAt = parseTimestamp(mail.receivedAt);
    if (!minTimestamp) {
      return true;
    }
    return receivedAt >= Math.max(0, minTimestamp - Math.max(0, Number(freshnessGraceMs) || 0));
  }) || null;
}

export async function pollVerificationCode({
  client,
  detailFetcher = null,
  email,
  mailboxContext = {},
  intervalMs = 3000,
  timeoutMs = 30000,
  minReceivedAt = '',
  freshnessGraceMs = 0,
  shouldContinue = null,
  match = {},
  addLog = async () => {},
  step = null,
  round = 1,
  maxRounds = 1,
  phaseLabel = '验证码',
  unreadOnly = false,
  consumedMessageIds = [],
} = {}) {
  if (!client?.listUserEmailMails) {
    throw new Error('邮件平台客户端缺少 listUserEmailMails 接口');
  }
  if (!email) {
    throw new Error('缺少邮箱地址，无法轮询验证码');
  }

  async function tryExtractCodeFromMail(mail, resolvedEmail) {
    const previewMatchText = buildMailMatchText(mail);
    const previewMatchesKeyword = matchesKeywordText(previewMatchText, match.keyword);
    const previewCode = extractVerificationCode(buildMailCodeText(mail));
    if (previewCode && previewMatchesKeyword) {
      return {
        code: previewCode,
        mail,
        extractedFromDetail: false,
      };
    }

    if (!detailFetcher?.getEmailDetail || !mail?.messageId) {
      const reason = previewCode
        ? `预览中提取到 ${previewCode}，但未命中 keyword=${match.keyword || '(空)'}`
        : '预览邮件正文中未提取到验证码，且没有可用的邮件详情接口';
      return buildExtractionFailure(reason, mail);
    }

    try {
      const detail = await detailFetcher.getEmailDetail(resolvedEmail || email, mail.messageId, {
        folder: mail.folder || 'inbox',
        idMode: mail.idMode || mail.id_mode || '',
        isTemp: Boolean(mailboxContext?.isTemp),
      });
      const detailMail = {
        subject: detail.subject || mail.subject || '',
        from: detail.from || mail.from || '',
        to: detail.to || mail.to || '',
        bodyText: detail.bodyText || detail.body_text || detail.text || '',
        bodyHtml: detail.body || detail.bodyHtml || detail.body_html || detail.mail_body_html || detail.html || detail.content || '',
      };
      const detailMatchText = buildMailMatchText(detailMail);
      if (!matchesKeywordText(`${previewMatchText} ${detailMatchText}`, match.keyword)) {
        return buildExtractionFailure(`预览和详情均未命中 keyword=${match.keyword || '(空)'}`, mail, detail);
      }
      const detailCode = extractVerificationCode(buildMailCodeText({
        ...detail,
        ...detailMail,
      }));
      if (!detailCode) {
        return buildExtractionFailure('邮件详情中未提取到验证码', mail, detail);
      }
      return {
        code: detailCode,
        mail: {
          ...mail,
          bodyText: detailMail.bodyText || mail.bodyText || '',
          bodyHtml: detailMail.bodyHtml || mail.bodyHtml || '',
        },
        extractedFromDetail: true,
      };
    } catch (error) {
      return buildExtractionFailure('读取邮件详情失败', mail, null, error);
    }
  }

  const deadline = Date.now() + timeoutMs;
  let latestMatchingMail = null;
  let latestMatchingResolvedEmail = '';
  let latestMatchingAlias = '';
  let attempt = 0;
  const allowKeywordFallback = Boolean(detailFetcher?.getEmailDetail);
  const consumedMessageIdSet = new Set(consumedMessageIds || []);
  while (Date.now() <= deadline) {
    attempt += 1;
    if (typeof shouldContinue === 'function') {
      await shouldContinue();
    }
    const result = await client.listUserEmailMails(email, {
      folder: 'all',
      top: 10,
      skip: 0,
      subjectContains: match.subjectContains,
      fromContains: match.fromIncludes,
      keyword: match.keyword,
      isTemp: Boolean(mailboxContext?.isTemp),
    });
    const matchingMails = (result.emails || []).filter((mail) => (
      allowKeywordFallback
        ? matchesMailBase(mail, match, { unreadOnly, consumedMessageIds: consumedMessageIdSet })
        : matchesMail(mail, match, { unreadOnly, consumedMessageIds: consumedMessageIdSet })
    ));
    if (matchingMails.length > 0) {
      latestMatchingMail = matchingMails[0];
      latestMatchingResolvedEmail = result.resolvedEmail || email;
      latestMatchingAlias = result.matchedAlias || '';
    }
    const newestMail = selectFreshMail(result.emails || [], minReceivedAt, match, freshnessGraceMs, {
      allowKeywordFallback,
      unreadOnly,
      consumedMessageIds: consumedMessageIdSet,
    });
    const remainSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

    if (newestMail) {
      await addLog(`步骤 ${step}：第 ${round}/${maxRounds} 轮第 ${attempt} 次检查发现新${phaseLabel}邮件，正在提取验证码...`, 'info');
      const extracted = await tryExtractCodeFromMail(newestMail, result.resolvedEmail || email);
      if (extracted?.code) {
        if (extracted.extractedFromDetail) {
          await addLog(`步骤 ${step}：已从邮件详情中提取到${phaseLabel}。`, 'info');
        }
        return {
          code: extracted.code,
          mail: extracted.mail,
          receivedAt: newestMail.receivedAt || '',
          resolvedEmail: result.resolvedEmail || email,
          matchedAlias: result.matchedAlias || '',
          extractedFromDetail: extracted.extractedFromDetail,
          usedOlderMatch: false,
          tags: [],
        };
      }
      const debugText = extracted?.debugSnapshot
        ? `\n邮件调试快照：\n${extracted.debugSnapshot}`
        : '';
      await addLog(`步骤 ${step}：检测到新${phaseLabel}邮件，但暂未提取出验证码，继续等待下一次检查。${debugText}`, 'warn');
    } else if (latestMatchingMail) {
      const aliasText = latestMatchingAlias ? `，当前命中别名 ${latestMatchingAlias}` : '';
      await addLog(`步骤 ${step}：第 ${round}/${maxRounds} 轮第 ${attempt} 次检查暂未发现更新的${phaseLabel}邮件，已有较早匹配邮件${aliasText}，距超时约 ${remainSeconds} 秒。`, 'info');
    } else {
      await addLog(`步骤 ${step}：第 ${round}/${maxRounds} 轮第 ${attempt} 次检查暂未发现匹配的${phaseLabel}邮件，距超时约 ${remainSeconds} 秒。`, 'info');
    }

    if (typeof shouldContinue === 'function') {
      await shouldContinue();
    }
    await sleep(intervalMs);
  }

  if (latestMatchingMail) {
    await addLog(`步骤 ${step}：本轮超时前未等到更新邮件，正在回退解析最近一封匹配的较早${phaseLabel}邮件...`, 'warn');
    const extracted = await tryExtractCodeFromMail(latestMatchingMail, latestMatchingResolvedEmail || email);
    if (extracted?.code) {
      if (extracted.extractedFromDetail) {
        await addLog(`步骤 ${step}：已从较早邮件详情中提取到${phaseLabel}。`, 'info');
      }
      return {
        code: extracted.code,
        mail: extracted.mail,
        receivedAt: latestMatchingMail.receivedAt || '',
        resolvedEmail: latestMatchingResolvedEmail || email,
        matchedAlias: latestMatchingAlias || '',
        extractedFromDetail: extracted.extractedFromDetail,
        usedOlderMatch: true,
        tags: [],
      };
    }
  }

  throw new Error(`轮询超时，未获取到验证码。邮箱=${email}`);
}
