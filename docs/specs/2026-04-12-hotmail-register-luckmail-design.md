# Hotmail Register Luckmail Design

**状态**: 已确认方案，待用户复核书面 spec  
**日期**: 2026-04-12  
**范围**: 新建独立 Chrome MV3 扩展仓库，不修改旧扩展实现

## 1. 目标

构建一个新的独立浏览器扩展，用于自动执行基于 Hotmail/Outlook 邮箱的 OpenAI OAuth 注册流程。新扩展复用旧项目中已经验证过的“步骤编排 + 注册页自动化”思路，但不复用旧扩展的 Duck、163、QQ、2925、Inbucket 邮箱来源逻辑。

新扩展的验证码来源统一切换为 Luckmail HTTP API，邮箱来源统一切换为用户提供的固定账号池，每条账号记录格式为：

```txt
邮箱----密码----clientid----refresh_token
```

## 2. 非目标

以下内容不在本次范围内：

- 修改旧扩展目录中的 `background.js`、`manifest.json`、`sidepanel/`、`content/` 等实现
- 兼容 Duck、163、QQ、2925、Inbucket 等旧验证码来源
- 依赖 Luckmail 页面抓取方案作为主实现
- 在正式运行时依赖 Luckmail Node SDK

## 3. 推荐方案

采用“独立扩展 + 直接调用 Luckmail HTTP API”的方案。

原因：

- 目标运行时是 Chrome MV3 service worker，直接使用 `fetch` 调 API 最稳
- Luckmail API 已覆盖所需能力：导入邮箱、查询用户私有邮箱列表、查询指定邮箱的邮件列表与邮件详情
- Node SDK 虽然可作为验证参考，但会引入 bundling/runtime 兼容风险
- 页面抓取比 API 更脆弱，不适合长期维护

## 4. 仓库与目录设计

新扩展单独放在：

```txt
hotmail-register-extension/
```

建议结构：

```txt
hotmail-register-extension/
  manifest.json
  background.js
  README.md
  .gitignore
  content/
    signup-page.js
    utils.js
  sidepanel/
    sidepanel.html
    sidepanel.css
    sidepanel.js
  shared/
    account-pool.js
    luckmail-client.js
    oauth-step-helpers.js
    state-machine.js
    verification-poller.js
  docs/
    specs/
    plans/
  tests/
    account-pool.test.js
    luckmail-client.test.js
    verification-poller.test.js
```

## 5. 模块职责

### 5.1 `shared/account-pool.js`

职责：

- 解析多行账号文本
- 校验每行是否符合 `邮箱----密码----clientid----refresh_token`
- 输出标准化账号对象：

```js
{
  address,
  password,
  clientId,
  refreshToken
}
```

- 管理当前轮次取号、跳过、去重与耗尽状态

### 5.2 `shared/luckmail-client.js`

职责：

- 封装 Luckmail HTTP API 调用
- 统一处理 API Key、请求头、错误码与返回结构
- 提供最小必要接口：
  - `importEmails(type, emails)`
  - `listUserEmails({ keyword, page, pageSize, status })`
  - `findUserEmailByAddress(address)`
  - `listUserEmailMails(id)`
  - `getUserEmailMail(id, messageId)`

设计约束：

- 正式实现使用原生 `fetch`
- 不依赖 Node SDK 作为扩展正式运行时的一部分
- 若 Luckmail 文档或接口实际字段与预期不一致，优先在这里做兼容层，不向上游泄漏差异

### 5.3 `shared/verification-poller.js`

职责：

- 对 Step 4 / Step 7 提供统一验证码轮询
- 轮询间隔默认 3 到 5 秒，可配置
- 统一处理超时、排除重复验证码、按时间筛选“新邮件”
- 返回结构尽量简单：

```js
{
  code,
  mail,
  receivedAt
}
```

优先取值顺序：

1. API 已提取的 `verification_code`
2. 邮件详情正文中的 6 位验证码正则兜底提取

### 5.4 `content/signup-page.js`

职责：

- 运行在 OpenAI/Auth 页面
- 负责和注册页交互
- 仅保留和 Hotmail 流程相关的步骤：
  - 打开注册页
  - 填邮箱/密码
  - 填验证码
  - 填姓名/生日
  - 登录/OAuth 确认

来源策略：

- 可以参考旧扩展里已验证的通用逻辑
- 但应复制到新目录内，避免与旧扩展耦合

### 5.5 `background.js`

职责：

- 扩展主流程编排
- sidepanel 消息路由
- tab 管理与步骤推进
- 自动运行状态维护
- 每轮账号切换
- 对接 `account-pool` 与 `verification-poller`

### 5.6 `sidepanel/sidepanel.js`

职责：

- 提供运行配置 UI
- 保存 API Key、目标入口、账号池文本、轮询参数等
- 展示当前轮次、当前账号、步骤状态和日志

## 6. 数据流设计

单轮自动执行流程如下：

1. 用户在 sidepanel 输入 Luckmail API Key、账号池文本、目标入口等配置
2. background 解析账号池，取出当前账号
3. 若启用“导入前同步”，调用 `importEmails("ms_graph", [account])`
4. 通过 `findUserEmailByAddress(address)` 找到该邮箱在 Luckmail 的用户邮箱记录
5. 打开 OAuth / 注册页面并执行 Step 2、Step 3
6. Step 4 时调用 `verification-poller`，通过用户私有邮箱接口查找最新验证码邮件
7. 将验证码回填到注册页
8. Step 5/6 继续推进注册/登录流程
9. Step 7 再次使用相同邮箱记录轮询登录验证码
10. 流程成功后记录结果并切换下一轮

## 7. 配置项

sidepanel 最小配置集合：

- `Luckmail API Key`
- `目标 OAuth/入口 URL`
- `账号池文本`
- `运行轮数`
- `失败自动跳过`
- `导入前自动同步到 Luckmail`
- `轮询间隔（秒）`
- `轮询超时（秒）`

可选扩展配置：

- `邮件关键词/发件人过滤`
- `是否删除成功使用后的验证码邮件`
- `是否记录成功账号结果`

## 8. 错误处理

需要显式处理以下错误：

- 账号文本格式错误
- 账号池为空
- Luckmail API Key 缺失或无效
- 目标邮箱未导入 Luckmail 或查询不到
- 指定邮箱邮件列表为空
- 轮询超时仍未收到新验证码邮件
- 页面结构变化导致步骤执行失败
- 同一个验证码重复使用
- 账号异常或被平台标记不可用

处理原则：

- 单轮失败可重试
- 达到重试阈值后可根据配置跳过当前账号
- 错误文案要能区分“账号无效”“未收到邮件”“页面变更”“API 失败”

## 9. 状态与结果记录

建议维护以下运行态：

- 当前账号
- 当前轮次/目标轮次
- 当前步骤
- 各步骤状态
- 最近一次验证码
- 最近一次错误
- 成功结果列表

成功结果最小记录结构：

```js
{
  address,
  password,
  createdAt,
  oauthUrl,
  status
}
```

## 10. 复用策略

允许复用的内容：

- OpenAI/Auth 页面自动化通用逻辑
- 通用等待、点击、输入、验证码输入框识别逻辑
- 步骤状态展示模式

禁止复用的内容：

- 旧扩展中的邮箱来源逻辑
- 旧扩展中与 163 / QQ / 2925 / Inbucket / Duck 强绑定的状态字段与 UI
- 直接引用旧目录文件作为运行时依赖

原因：

- 新扩展要保持真正独立
- 后续可单独加载、单独维护、单独发版

## 11. 测试与验证

最小测试集合：

- `account-pool.test.js`
  - 正确解析一行
  - 跳过空行
  - 拒绝字段不足/过多的行

- `luckmail-client.test.js`
  - 正确解析邮箱列表响应
  - 按邮箱地址定位记录
  - 正确处理 API 错误响应

- `verification-poller.test.js`
  - 优先返回 `verification_code`
  - 验证码缺失时可从正文兜底提取
  - 能按时间过滤旧邮件
  - 超时后返回明确错误

定向手工验证：

- 导入单个 Hotmail 账号
- 用一个已知能收到验证码的流程跑通 Step 3 -> Step 4
- 再跑通 Step 6 -> Step 7

## 12. 实施顺序

建议实施顺序：

1. 搭建独立扩展骨架
2. 实现账号池解析
3. 实现 Luckmail API client
4. 实现验证码轮询
5. 接入 OpenAI 注册页步骤
6. 接入 sidepanel 状态与配置
7. 完成基础测试
8. 做一次真实账号 smoke 验证

## 13. 风险与权衡

主要风险：

- Luckmail 用户私有邮箱接口字段与文档存在差异
- OpenAI 页面 DOM 可能变化
- 部分 Hotmail 账号实际状态异常，导致“能导入但不能收码”

对应策略：

- Luckmail 兼容逻辑集中在 `shared/luckmail-client.js`
- 页面自动化逻辑与邮箱逻辑严格分层
- 用 `alive`/邮件列表可读性作为额外预检能力（若后续确有必要）

## 14. 验收标准

当满足以下条件时视为一期可用：

- 新扩展以独立目录形式存在
- 不修改旧扩展运行路径
- 可以读取账号池并选取当前账号
- 可以通过 Luckmail API 查询指定邮箱的验证码邮件
- 可以把注册验证码和登录验证码自动回填到页面
- 至少完成一条端到端手工验证路径
