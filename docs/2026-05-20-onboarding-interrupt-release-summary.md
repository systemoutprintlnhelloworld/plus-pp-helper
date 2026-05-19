# 2026-05-20 Onboarding 自动化、中断控制与 Release 流程总结

## 结论

本轮将资料页后的两个引导页改为后台自动处理：出现 `What brings you to ChatGPT?` 时点击 `Skip`，出现 `You're all set` 时点击 `Continue`。侧栏新增 `快速中断`，用于邮箱填写或跳转卡住时立即停止当前自动流程并进入可重试状态。

项目发布名调整为 `plus-pp-helper` / `Plus PP Helper`，并新增 GitHub Actions Release 工作流，自动产出 `plus-pp-helper.zip` 和 `plus-pp-helper.crx`。

## 关键变更

- `background.js`
  - `handlePostProfileOnboarding()` 从固定等待后单次检查，改为最多 45 秒持续监控并自动点击 `Skip` / `Continue`。
  - `waitForSandboxStepEvidence()` 轮询期间检查 `stopRequested`，让快速中断能更快生效。
  - 新增 `QUICK_INTERRUPT_AUTO_RUN`，会广播 `STOP_FLOW`、标记当前 running 步骤失败，并让 UI 保持可重试。

- `sidepanel/sidepanel.html` / `sidepanel/sidepanel.js`
  - 顶部新增 `快速中断` 按钮。
  - 自动流程运行中启用该按钮；点击后调用 `QUICK_INTERRUPT_AUTO_RUN`。
  - 日志工具栏新增 `Stick end` 开关，开启时每次刷新都滚动到最新日志。

- `.github/workflows/release.yml`
  - 任意分支 push、tag push 或手动触发时运行测试。
  - 整理扩展文件到 `dist/plus-pp-helper`。
  - 生成 ZIP 和 CRX，并上传到 workflow artifacts。
  - 分支 push 创建 `auto-<run_number>` 正式 Release 并标记为 latest；tag push 创建正式 Release，并把 ZIP / CRX 附加到 Release。
  - GitHub runner 中使用 `--no-sandbox` 执行 Chrome `--pack-extension`，避免 Ubuntu runner 因浏览器 sandbox 限制导致 CRX 打包崩溃。
  - Release metadata 改为独立 shell 步骤输出，避免 workflow 解析阶段受复杂表达式影响。

## Release 密钥说明

如需稳定 CRX extension id，在 GitHub 仓库 Secrets 配置：

```text
CRX_PRIVATE_KEY_B64
```

值为 CRX 私钥 PEM 文件内容的 base64。未配置时，Chrome 会临时生成打包密钥，适合测试发布但 extension id 不稳定。

## 验证

已运行：

```text
npm test
```

结果：`164/164` 通过。

GitHub 发布验证：

```text
Repository: https://github.com/systemoutprintlnhelloworld/plus-pp-helper
Workflow: Release Extension
Run: https://github.com/systemoutprintlnhelloworld/plus-pp-helper/actions/runs/26125247383
Release: https://github.com/systemoutprintlnhelloworld/plus-pp-helper/releases/tag/auto-3
Commit: 3622f8fa4c2f8e1daf9c5fc0ac8eaa96f8b44bb9
Artifacts:
- plus-pp-helper.zip
- plus-pp-helper.crx
```

补充：仓库首页右侧不会稳定展示 prerelease。为避免用户只看到 tags，后续自动发布改为普通 Release，并显式设置 `make_latest: true`。
