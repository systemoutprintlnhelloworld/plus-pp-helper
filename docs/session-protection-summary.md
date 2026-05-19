# Session Protection Summary

## 当前结论

Session endpoint 校验分为两层：

1. `background.js` 在发起 Step 6 前先校验配置。
2. `content/sandbox-login-page.js` 在页面内真正 `fetch()` session endpoint 前再次校验。

`sessionProtectionEnabled=false` 目前只会关闭 sandbox allowlist 校验，不会关闭真实 OpenAI / ChatGPT 域名硬拒绝。

## 硬拒绝逻辑位置

### 1. Background 层

文件：`shared/sandbox-session.js`

- 禁止域名集合：`FORBIDDEN_SESSION_HOSTS`
- 判断函数：`isForbiddenSessionHostname(hostname)`
- 对外校验函数：`validateSandboxSessionEndpoint(endpoint, options)`
- 登录页 URL 防误用函数：`isForbiddenOpenAITarget(url)`

当前硬拒绝规则：

```js
const FORBIDDEN_SESSION_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'auth.openai.com',
  'auth0.openai.com',
  'accounts.openai.com',
  'openai.com',
]);
```

同时还拒绝：

```js
normalized.endsWith('.openai.com') || normalized.endsWith('.chatgpt.com')
```

调用位置：

- `background.js` 的 `COPY_SANDBOX_SESSION_JSON()` 会调用 `validateSandboxSessionEndpoint(...)`。
- `background.js` 的 `assertSandboxAutomationUrl(...)` 会调用 `isForbiddenOpenAITarget(...)`，防止登录页 URL 指向真实 OpenAI/ChatGPT 域名。

### 2. Content Script 层

文件：`content/sandbox-login-page.js`

- 判断函数：`isForbiddenHost(hostname)`
- 校验函数：`validateSessionEndpoint(endpoint, allowedBaseUrls, options)`
- 调用位置：`copySandboxSessionJson(payload)`

当前硬拒绝规则：

```js
return normalized === 'chatgpt.com'
  || normalized === 'chat.openai.com'
  || normalized === 'openai.com'
  || normalized.endsWith('.openai.com')
  || normalized.endsWith('.chatgpt.com');
```

这层是实际 `fetch(endpoint, { credentials: 'include' })` 前的兜底校验。

## 其他校验位置

### 1. 关闭保护密码

文件：`background.js`

- 密码常量：`SESSION_PROTECTION_DISABLE_PASSWORD`
- 校验函数：`assertSessionProtectionSettings(updates)`
- 调用位置：`SAVE_SETTINGS(payload)`

当前密码：

```text
CTF-SANDBOX
```

如果 `sessionProtectionEnabled=false` 且密码不匹配，保存设置会失败。

### 2. Allowlist 校验

文件：`shared/sandbox-session.js`

选项：

```js
enforceAllowlist = true
```

开启时，非 localhost 的 session endpoint 必须匹配：

- `loginPageUrl` 的 hostname
- 或 `mailApiBaseUrl` 的 hostname

关闭保护时：

```js
enforceAllowlist: state.sessionProtectionEnabled !== false
```

会放宽这个 allowlist，但不会放宽真实 OpenAI/ChatGPT 硬拒绝。

### 3. URL 协议校验

两层都要求：

```js
http:
https:
```

其他协议会拒绝。

## 如果要修改，应该改哪里

### 方案 A：只改关闭密码

改这里：

```text
background.js
```

搜索：

```js
SESSION_PROTECTION_DISABLE_PASSWORD
```

把当前值 `CTF-SANDBOX` 改成新的确认密码即可。

### 方案 B：允许更多 sandbox host

优先不用改代码。直接在 UI 中：

1. 配置对应的 `登录页 URL`
2. 配置对应的 `邮箱 API URL`
3. Session URL 与这两个 host 之一保持一致

如果比赛环境的 Session URL 必须是第三个 sandbox host：

1. 取消勾选 `Session 保护`
2. 输入关闭密码
3. 保存设置

### 方案 C：调整硬拒绝域名列表

需要同时改两处，保持 background 和 content script 一致：

```text
shared/sandbox-session.js
content/sandbox-login-page.js
```

Background 层改：

```js
FORBIDDEN_SESSION_HOSTS
isForbiddenSessionHostname(hostname)
```

Content 层改：

```js
isForbiddenHost(hostname)
```

注意：如果只改一边，会出现 background 放行但 content script fetch 前又拒绝，或反过来。

### 方案 D：让关闭保护也关闭硬拒绝

不建议这样做。当前实现刻意把“sandbox allowlist”与“真实 OpenAI/ChatGPT 硬拒绝”拆开：

- allowlist 是可配置防误用保护
- OpenAI/ChatGPT 硬拒绝是防止跑到真实第三方服务的边界

如果确实要在纯本地 fork 中改，需要同时修改：

```text
shared/sandbox-session.js
content/sandbox-login-page.js
background.js
```

但这会改变当前项目的安全边界，也会让 README 和 spec 中的声明失效，需要同步更新文档。

## 流程图位置

已补充 Mermaid 时序图：

- `README.md`
- `docs/specs/2026-05-19-ctf-sandbox-registration-spec.md`

包含两张图：

1. 主注册流程时序图
2. Session 保护开关时序图

