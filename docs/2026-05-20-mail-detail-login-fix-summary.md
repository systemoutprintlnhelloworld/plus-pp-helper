# 2026-05-20 邮箱详情登录态修复总结

## 结论

本轮问题不是验证码正则问题，而是邮件列表 API 只返回截断预览，验证码位于完整 HTML 正文中；扩展读取完整正文时没有稳定复用邮箱后台的 Web 登录态，因此详情接口返回 `请先登录`。

已修改为：步骤 4 在后台直接读取详情失败后，会优先复用邮箱 API URL 对应的 Web 后台页，在页面主执行环境里同源请求 `/api/email/...`。最新流程会先打开邮箱后台并使用独立邮箱后台密码自动登录，默认 `admini123`；如果同源请求仍返回 `need_login`、`401` 或 `请先登录`，会将失败上下文写入日志。

## 历史实测证据

- 以下命令记录的是当时本地实例的历史实测，不代表当前扩展会硬编码该 host 或密码。
- 未登录直接访问当时的本地邮箱后台返回登录页。
- 使用 `POST /login` 携带当时实例密码后，服务端返回 `{"success":true}` 并设置 `session` Cookie。
- 带同一 Web session 请求：

```text
GET /api/email/AmyDurhamwjr%40outlook.com/30?folder=inbox&method=imap
```

服务端返回完整邮件 HTML，正文中包含：

```text
Enter this temporary verification code to continue:
875653
```

这证明本地邮箱后台可以返回完整正文，失败点在扩展读取详情时的登录态/执行上下文。

## 代码改动

- `background.js`
  - `fetchMailDetailThroughMailUi()` 优先使用配置的邮箱 API URL 对应后台。
  - fallback 请求切到页面主执行环境执行，降低隔离环境和页面状态不一致的风险。
  - 遇到 `请先登录` 时不再静默 POST `/login`，改为依赖流程开始前的可见邮箱后台自动登录。
  - 详情失败日志补充 base、status、page URL、request URL 和响应片段。
- `shared/sandbox-session.js`
  - 恢复真实 `chatgpt.com`、`*.chatgpt.com`、`openai.com`、`*.openai.com` session endpoint 硬拒绝规则。
- `docs/verification-code-debug-summary.md`
  - 补充本轮 401 修复说明。
- `docs/plans/2026-05-19-ctf-sandbox-registration-todo.md`
  - 更新执行清单。
- `docs/specs/2026-05-19-ctf-sandbox-registration-spec.md`
  - 明确 Web UI fallback 的顺序和重试规则。

## 验证

已运行：

```text
node --check background.js
node --check shared\sandbox-session.js
node --test tests\sandbox-session.test.js
npm test
```

结果：`npm test` 全量 161/161 通过。

## 仍需人工复测

我已验证本地邮箱后台接口能用 Web session 取到完整正文，并已验证代码语法和测试套件；但浏览器扩展需要用户重新加载后才能验证真实自动流程。请重新加载扩展后再跑一轮。如果仍失败，新日志应该会包含更具体的 base、page、request、status 和响应片段。

## 2026-05-20 HAR 与 API 文档复核

根据 `outlookEmail/docs/api.md#get-apiexternalemails`，对外邮件接口只有：

```text
GET /api/external/emails?email=<address>&folder=<folder>&top=<n>&skip=<n>&subject_contains=<text>&from_contains=<text>&keyword=<text>
```

HAR 中出现了不存在的详情路径：

```text
GET /api/external/emails/<messageId>?email=<address>
```

该请求返回 500/404，原因是文档没有定义 `/api/external/emails/<messageId>`。已删除 `shared/sandbox-mail-client.js` 中的 legacy fallback，内部详情失败后不再打这个错误路径，而是让 background 进入 Web UI 同源详情读取 fallback。

同时 external 请求头已按文档收敛为 `X-API-Key`，不再额外附带 `Authorization: Bearer ...`，GET 且无 body 时也不发送 `Content-Type: application/json`。

本地规范请求自测：

```text
GET /api/external/emails?email=amydurhamwjr%40outlook.com&folder=all&top=1&subject_contains=Your%20temporary%20ChatGPT%20verification%20code
```

结果：返回 1 封邮件，`body_preview` 长度 203，无完整正文。随后带 Web session 调用内部详情：

```text
GET /api/email/amydurhamwjr%40outlook.com/33?folder=inbox&method=imap
```

结果：返回完整正文，HTML 长度约 6436，包含 `temporary verification code`。

## 本轮偏好记录

- 需要生成总结性 Markdown 文档。
- 不生成额外测试脚本。
- 不执行编译，用户自己编译或重新加载扩展。
- 可以运行检查和测试命令。
