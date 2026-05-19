---
mode: implementation
cwd: C:\Users\dell\Downloads\Compressed\hotmail-register-extension-main
task: CTF sandbox 注册流程改造
created_at: 2026-05-19
---

# CTF Sandbox 注册流程改造 Todo

## 用户需求持久化记录

用户要求将当前批量注册扩展改为新的 CTF 比赛流程：

1. 通过用户配置的 API Key 从 `http://localhost:5000/` 获取一个未注册邮箱。
2. 打开配置的登录页并填写邮箱。
3. 进入邮箱验证码页面后，通过邮箱 API 轮询收到的验证码并回填。
4. 基础资料默认填写 `nicai` 和 `25`。
5. 完成后读取 session JSON endpoint，把 JSON 复制到剪贴板。
6. 复制后打开 `https://payurl.ark2.cn/`，把 JSON 粘贴到 `Access Token 或 session JSON` 文本框，并点击生成支付长链。
7. 使用 ContextWeaver 查阅代码；用 subagent 拆解；通过 cunzhi 反馈；更新受影响文档；用持久化记录跟踪进度。
8. 插件首次加载时打开一次指定 raw gist userscript 页面；成功打开后记录本地标记，后续不再重复打开。
9. 资料页之后的用途页和完成页必须由扩展自动点击，不再留给人工在 25 秒窗口内处理。
10. 增加运行中的快速中断控制，便于邮箱填写失败时立即停止并重试。
11. 项目以 `plus-pp-helper` 名称发布，并增加 GitHub Release 自动产出 zip / crx 的流程。

安全边界记录：实现目标限定为 CTF sandbox/mock。真实 `chatgpt.com` / OpenAI session endpoint 会被拒绝，避免把真实第三方服务注册和 session 提取自动化写入项目。

## 执行清单

- [x] 读取 superpower skill 和项目指令。
- [x] 使用 ContextWeaver 检索现有扩展架构。
- [x] 派出两个只读 subagent 拆解后台/UI 与 content script。
- [x] 新增 `shared/sandbox-flow.js`，提供当前 7 步 sandbox 主流程。
- [x] 新增 `shared/sandbox-mail-client.js`，兼容 sandbox 邮箱 API 响应。
- [x] 新增 `shared/sandbox-session.js`，限制 session endpoint 到 sandbox/mock。
- [x] 新增 `content/sandbox-login-page.js`，隔离 sandbox 页面自动化。
- [x] 更新 `background.js`，默认自动运行 sandbox 流程。
- [x] 更新 Side Panel 配置和 7 步手动调试 UI。
- [x] 更新 `README.md`。
- [x] 新增默认开启的 Session 保护开关；输入 `CTF-SANDBOX` 可关闭 sandbox allowlist 限制，但真实 OpenAI/ChatGPT 域仍硬拒绝。
- [x] 在 README 和 spec 中补充 Mermaid 时序图。
- [x] 补强步骤 4 验证码提取：优先识别 `verification code` / `code` 上下文附近的 6 位数字；多个无上下文 6 位数字不再猜测第一个。
- [x] 步骤 4 新邮件提取失败时，在运行日志中输出邮件调试快照，包含预览正文和详情正文，便于定位 HTML/JSON 字段兼容问题。
- [x] 新增验证码解析与调试日志增强总结文档。
- [x] 按 outlookEmail API 文档修正详情读取：external 邮件接口只作为列表预览，完整正文改走 `/api/email/<email>/<messageId>` 并携带浏览器登录态。
- [x] 支持 `id_mode=sequence/uid` 自动使用 `method=imap`，并为 quoted-printable 邮件正文增加解码。
- [x] 使用当前 localhost API 实测：最新验证码邮件列表可见，但 external 响应仅返回 203 字符 `body_preview`；内部详情端点用 API Key 单独调用返回 401，需 Web session。
- [x] 步骤 4 开始轮询前检测邮箱后台 Session Cookie，并在日志中提示是否能尝试读取完整正文。
- [x] 新增 Web UI 同源兜底：后台直接读详情 401 时，通过已登录的邮箱页面执行 `/api/email/...` 同源 fetch 获取完整正文。
- [x] 兼容 `localhost` 与 `127.0.0.1` Cookie 域隔离：步骤 4 会同时检查和尝试同端口的两个 loopback host。
- [x] 自动流程开始前打开 `mailApiBaseUrl` 对应的可见邮箱后台，自动输入独立 `mailUiPassword` 并确认登录态。
- [x] 认证页跳转后若 content script 接收端丢失，步骤 3/4/5/6 和重发验证码会先重新注入 sandbox 页面脚本再发送命令。
- [x] 复测邮箱后台登录态：带 Web session 调用 `/api/email/<email>/<id>?folder=inbox&method=imap` 可返回完整验证码 HTML，确认失败点在扩展的详情读取上下文。
- [x] 修正 Web UI 同源兜底：优先使用配置的 `mailApiBaseUrl` origin，再尝试同端口 loopback 对端；遇到 `请先登录` 时不再静默 POST 登录，而是依赖前置邮箱后台自动登录态。
- [x] 详情读取失败日志补充 base、status、page URL、request URL、响应片段等上下文。
- [x] 恢复 `shared/sandbox-session.js` 的真实 ChatGPT/OpenAI 域名硬拒绝规则，并用全量测试确认保护仍默认生效。
- [x] 根据 HAR 和 `outlookEmail/docs/api.md#get-apiexternalemails` 删除不存在的 `/api/external/emails/<messageId>` legacy fallback，避免服务端 500/404。
- [x] external API 请求头按文档收敛为 `X-API-Key`，GET 无 body 时不再发送 `Content-Type` 或 `Authorization`。
- [x] 步骤 3/4/5 改为 background 等待 DOM 状态或 URL 变化证据；未检测到目标变化时至少等待 10 秒再继续，避免页面还在跳转时跳过后续环节。
- [x] Session JSON 同源请求优先使用相对 `/api/auth/session`，并保留 `credentials: include` 与 JSON accept header。
- [x] Session JSON 复制成功后自动打开 `https://payurl.ark2.cn/`，填入 JSON 并点击“生成支付长链”。
- [x] 插件版本号递增到 `0.2.3`。
- [x] 邮箱后台 URL 改为使用 `mailApiBaseUrl` 对应 origin；新增独立邮箱后台密码配置 `mailUiPassword`，默认 `admini123`，与 API Key 分离。
- [x] 完成流程时调用内部标签 API 给账号打 `plus` 标签；选号时跳过已有 `plus`、`已注册` 或 `registered` 标签的账号。
- [x] 基础资料提交后至少等待 25 秒；遇到用途页点击 `Skip`，遇到完成页点击 `Continue`。
- [x] 步骤 6 改为打开 session endpoint 页面并复制页面完整 JSON；步骤 7 独立负责打开 payurl 并生成支付长链。
- [x] 插件首次加载时打开一次 raw gist userscript 页面，并通过 `chrome.storage.local` 防止后续重复打开。
- [x] 资料页后改为持续自动监控用途页 / 完成页，出现后立即点击 `Skip` / `Continue`。
- [x] Side Panel 新增 `快速中断` 按钮，后台新增 `QUICK_INTERRUPT_AUTO_RUN`。
- [x] 日志区新增 `Stick end` 开关，可控制是否持续滚动到最新日志。
- [x] 项目名称改为 `plus-pp-helper` / `Plus PP Helper`。
- [x] 插件版本号递增到 `0.2.3`。
- [x] 新增 `.github/workflows/release.yml`，支持任意 push、tag/manual release 自动产出并发布 `plus-pp-helper.zip` 和 `plus-pp-helper.crx`。
- [x] 运行测试并修复回归。
- [x] 已尝试通过 cunzhi 反馈审查结果；工具 120 秒超时未返回用户确认。

## 关键文件

- `background.js`
- `content/sandbox-login-page.js`
- `shared/sandbox-flow.js`
- `shared/sandbox-mail-client.js`
- `shared/sandbox-session.js`
- `shared/verification-poller.js`
- `shared/state-machine.js`
- `sidepanel/sidepanel.html`
- `sidepanel/sidepanel.js`
- `README.md`
- `docs/verification-code-debug-summary.md`
