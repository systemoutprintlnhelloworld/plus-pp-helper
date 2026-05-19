# 验证码解析与调试日志增强总结

## 变更日期

2026-05-19

## 背景

步骤 4 在检测到新的注册验证码邮件后，可能因为 HTML 邮件正文、链接追踪参数、图片尺寸数字或正文 JSON 字段别名不一致，导致日志只显示“暂未提取出验证码”，缺少足够信息定位问题。

## 本次处理

- 验证码提取改为上下文优先：优先匹配 `verification code`、`temporary code`、`code`、`passcode`、`otp` 附近的 6 位数字。
- 删除旧的 `4-8` 位数字兜底猜测。若清洗后的邮件正文里存在多个无上下文 6 位数字，不再返回第一个，避免误取链接、尺寸或 ID。
- 新邮件提取失败时，步骤 4 日志会输出邮件调试快照，包含 messageId、from、subject、预览正文、HTML 正文和详情正文。
- 日志面板支持多行显示，邮件快照不会被压成一行。
- 邮箱客户端补充常见正文别名字段：`body`、`text`、`html`、`content`、`htmlBody`、`body_html`、`mail_body_html`、`content_html` 等。
- 按 outlookEmail API 文档修正详情读取：`/api/external/emails` 只返回列表预览；完整正文需走 `GET /api/email/<email_addr>/<message_id>`。Sandbox 客户端现在会用该内部详情端点，并携带浏览器登录态 cookie。
- 列表返回 `id_mode=sequence` 或 `uid` 时，详情请求会自动使用 `method=imap`；否则默认 `method=graph`。
- 验证码提取链路会解码 quoted-printable 正文，支持 `=3D`、软换行和 UTF-8 hex 编码片段。

## 验证

- noisy HTML 邮件样例中，正文提示 `Enter this temporary verification code to continue:` 后的 `547003` 可被正确提取。
- quoted-printable 详情正文中，验证码 `494136` 可被正确提取。
- 只有图片尺寸、SendGrid 链接数字而没有正文验证码时，不会误取数字，并会打印邮件调试快照。
- 相关 Node 测试与语法检查已通过。

## 实测结论

使用 API Key 调用 `GET /api/external/emails` 可以看到最新标题为 `Your temporary ChatGPT verification code` 的邮件，但响应只包含 203 字符的 `body_preview`，内容停在 HTML `<meta viewport...` 附近，未包含验证码所在正文段落。

使用同一 API Key 直接调用 `GET /api/email/<email_addr>/<message_id>` 返回 401，符合文档中“内部详情接口需要 Web 登录 session”的说明。因此扩展运行时若要读取完整正文，需要浏览器已登录本地邮箱后台，并允许请求携带 cookie。

当内部详情接口返回 401 时，运行日志会明确提示：external API Key 只能读取邮件列表预览，完整正文需要本地邮箱后台 Web session，或需要服务端开放包含完整正文的 external 详情接口。

步骤 4 现在会在开始轮询前检查 `mailApiBaseUrl` 对应的浏览器 Cookie：

- 检测到 Cookie：日志提示将尝试读取邮件完整正文。
- 未检测到 Cookie：日志提示 external API 如果只返回预览，可能无法读取验证码完整正文。

如果后台 service worker 直接请求内部详情接口仍然拿不到 Web session，扩展会进一步尝试复用已登录的邮箱 Web UI 页面，在该页面内同源执行 `fetch('/api/email/...')` 读取完整正文。这与 Web UI 能显示验证码的机制一致。

注意：浏览器会把 `localhost` 和 `127.0.0.1` 当成不同 Cookie 域。如果邮箱后台登录地址和插件配置的 `邮箱 API URL` host 不一致，登录态不会自动共享。步骤 4 现在会优先使用配置的 `mailApiBaseUrl` 对应 Web 后台，再尝试同端口的 loopback 对端，日志会显示命中的具体地址。

## 2026-05-19 回填与后台登录修正

- 自动流程开始时会先打开 `邮箱 API URL` 对应的 Web 后台，例如 `http://localhost:5000/`，用独立邮箱后台密码自动登录，默认密码为 `admini123`。
- 如果从失败步骤继续执行，步骤 4 轮询前也会再次检查邮箱后台登录态；若未登录，会重新尝试自动登录。
- 验证码页跳转后，原 content script 可能丢失，导致 `Receiving end does not exist`。现在步骤 3、步骤 4 回填、步骤 5、步骤 6 和重发验证码前都会先 ping 页面脚本；若没有接收端，会重新注入 `content/sandbox-login-page.js` 再发送命令。
- `content/sandbox-login-page.js` 新增 `RESEND_VERIFICATION_CODE` 处理，可点击验证码页的 `Resend email` 按钮。

## 2026-05-20 邮箱后台详情 401 修正

- 实测 `http://127.0.0.1:5000/login` 成功后，带同一 Web session 调用 `/api/email/AmyDurhamwjr%40outlook.com/<id>?folder=inbox&method=imap` 可返回完整 HTML 正文，验证码位于 `Enter this temporary verification code to continue:` 后的 6 位数字。
- 扩展读取邮件详情时现在优先使用配置中的 `mailApiBaseUrl` 对应邮箱后台，再尝试 loopback 对端，避免 `localhost` 与 `127.0.0.1` 的 Cookie 域不一致。
- Web UI 同源兜底改为在页面主执行环境中请求 `/api/email/...`；若详情接口仍返回 `请先登录`，不再静默 POST 登录，而是依赖前置可见邮箱后台登录态，日志会暴露 page/request/status/body 方便定位。
- 如果仍失败，错误信息会包含 base、HTTP status、page URL、request URL 和响应前 500 字符，便于继续定位是否跑到了错误 Host 或登录态被服务端拒绝。

## 2026-05-20 external emails 请求规范修正

- 按 `outlookEmail/docs/api.md#get-apiexternalemails` 复核后，`/api/external/emails` 只支持列表查询，不存在 `/api/external/emails/<messageId>` 详情路径。
- HAR 中的 `GET /api/external/emails/32?email=...`、`GET /api/external/emails/33?email=...` 返回 500/404，原因是旧 legacy fallback 使用了不存在的路径。
- 已删除 `shared/sandbox-mail-client.js` 中该 legacy fallback；内部详情 401 后由 background 的 Web UI 同源 fallback 处理。
- external API 请求头收敛为文档要求的 `X-API-Key`；GET 无 body 时不再发送 `Content-Type`，也不发送非文档要求的 `Authorization`。

## 2026-05-20 后续流程与 plus 标签修正

- 邮箱后台 URL 不再固定为 `127.0.0.1`，改为使用 `mailApiBaseUrl` 的 origin。
- 邮箱后台密码新增独立配置项 `mailUiPassword`，默认 `admini123`，与 external API Key 分离。
- 账号完成后通过内部标签 API 给邮箱打 `plus` 标签；后续选号会跳过已有 `plus`、`已注册` 或 `registered` 标签的账号。
- 基础资料提交后至少等待 25 秒；出现用途页时点击 `Skip`，出现完成页时点击 `Continue`。
- Session JSON 步骤改为打开 session endpoint 页面并复制页面里的完整 JSON。
- payurl 生成拆成独立手动步骤，便于单独补跑。
