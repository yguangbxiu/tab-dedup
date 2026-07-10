# Tab Dedup — 维护文档

面向维护者与 AI 助手的项目速查。用户向说明见 [README.md](../README.md)。

## 入口与运行

- **Manifest V3** Chrome 扩展，无构建步骤；根目录「加载已解压的扩展程序」即可
- 后台：`src/background/service-worker.js`
- 设置存储：`chrome.storage.sync`，默认值见 `src/utils/defaults.js`

## 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 查重与操作 | `service-worker.js` | 导航监听、匹配、提示、清理、整理、复制 Tab 识别、双击批量扫描 |
| Tab 来源标记 | `tab-origin.js` | `document_start` 写入 sessionStorage，上报 `TAB_ORIGIN_CHECK` |
| 页面 UI | `overlay.js` / `overlay.css` | 浮动卡片、Toast、键盘快捷键（按需注入） |
| 快捷设置 | `popup/*` | 一键取消分组 / 去重 / 分组；超时、空 Tab、同站点阈值 |
| 完整设置 | `options/*` | 全部配置项 |
| URL 匹配 | `url-matcher.js` | 归一化、`isEmptyTabUrl` |
| 域名过滤 | `domain-list.js` | 白/黑名单、自动分组域名、per-domain 阈值；`parseDomainList` 将裸域名或完整 URL 规范化为 hostname |

## 数据流摘要

1. 导航完成 → `handleDuplicateNavigation`
2. 过滤：debounce、已拒绝、Tab 分组内、复制 Tab（若开启）、域名、空 Tab 规则
3. 自动分组域名：`shouldAutoGroupByDomain` → `handleAutoGroupNavigation`（静默分组，跳过提示）；允许匹配分组内 Tab 以并入已有分组
4. 窗口内 `urlsMatchForDedup` 计数；`getSameSiteTabLimitForHostname()` 查找 per-domain 阈值（`domainTabLimits`），未命中则用全局 `sameSiteTabLimit`；`matches + 1 > limit` 才提示
5. 注入 overlay 或降级为系统通知
6. 用户选 close / organize / keep，或超时按 `autoActionOnTimeout` 自动执行

**双击图标批量扫描**：`handleBulkDuplicateScan` → `findWindowDuplicates` 返回 `duplicateGroups` → `showBulkScanPrompt` / 通知降级 → 用户选清理（`closeDuplicateTabIds`）、整理（`organizeBulkDuplicateGroups`）或忽略。不受全局 `sameSiteTabLimit` 与 `checkEmptyTabs` 限制；**已配置 per-domain 阈值的域名**在 `findWindowDuplicates` 中按 `getBulkScanTabLimitForHostname()` 过滤（未配置 fallback 1，即 2 个 Tab 即视为重复）。

**Popup 快捷一键操作**（`QUICK_ACTION` 消息）：`popup.js` 发送 `action` → `handleQuickAction` → `handleQuickUngroupAll` / `handleQuickDedupClose` / `handleQuickDedupOrganize`。去重与分组复用 `findWindowDuplicates` 逻辑，**跳过** `showBulkScanPrompt`，直接执行；取消分组对当前窗口所有已分组 Tab 调用 `chrome.tabs.ungroup`（不写入 `pendingOrganizeUndo`）。

**Tab 分组整理**：`chrome.tabs.group` + `chrome.tabGroups.update`；导航模式将当前 Tab 与匹配 Tab 归入一组；批量模式每组独立分组。需 `tabGroups` 权限。整理成功后 Toast 约 8 秒内可点「取消」撤销（`chrome.tabs.ungroup`，内存状态 `pendingOrganizeUndo`）。

**Tab 分组排除**：`isTabInGroup(tab)` 为 true 的 Tab 不参与查重（当前 Tab 在分组内直接跳过；匹配候选与批量扫描均排除分组内 Tab）。

## 复制 Tab 识别

- `tab-origin.js` 在 sessionStorage 存 `__tab_dedup_origin_tab_id__`
- 新 Tab 加载时对比 storedTabId 与当前 tabId；结合左侧相邻 Tab、同 URL、`openerTabId` 判定
- `tabs.onCreated` 辅助：无 opener、左侧 strict URL 相同 → 标记复制
- `excludeDuplicatedTabs`（默认 true）：复制的 Tab 不触发查重，也不作为关闭目标

## 扩展新功能时

1. 在 `defaults.js` 增加默认值与 `mergeSettings` 校验
2. 在 `options.html/js` 暴露配置；常用项可同步到 `popup`
3. 在 `service-worker.js` 实现逻辑
4. **同步**更新 `README.md` 与本文件「变更记录」

## 扩展图标

- **源文件**：`icons/icon-master.svg`（48/128）、`icons/icon-16.svg`（16px 加粗线条）
- **导出**：`node scripts/generate-icons.mjs` → `icon16.png` / `icon48.png` / `icon128.png`
- **设计**：蓝色底 `#1a56db` + 两个重叠 Tab 线条轮廓，表达「重复 Tab」

## Git 提交规范

提交信息**英文在前、中文在后**（同一 commit message 内）：

1. **Subject**：英文祈使句，≤72 字符（可用 `feat:` / `fix:` / `docs:` 等前缀）
2. **Body**（可选）：英文说明做了什么、为什么
3. **空一行**：中文对应摘要

示例：

```
docs: complete README and add maintenance documentation

Sync v1.1.0 features into README and add change log in PROJECT-MAINTENANCE.md.

文档：补全 README 与维护文档，新增变更记录。
```

## 变更记录

### 2026-07-10
- **[新增]** 配置项 `domainTabLimits`：按行 `域名或URL,阈值` 为指定域名自定义同站点 Tab 提醒阈值，覆盖全局 `sameSiteTabLimit`；导航查重、自动分组与批量扫描均尊重 per-domain 阈值（批量扫描未配置域名 fallback 1）
- **[优化]** 域名名单输入格式兼容：白名单、黑名单、自动分组域名均支持裸域名（`github.com`）与完整 http/https URL（含路径、query、hash）；`parseDomainList` 通过 URL API 提取 hostname，与 Tab 比对方式一致
- **[新增]** 配置项 `autoGroupDomains`：指定域名超过同站点阈值时静默自动归入 Tab 分组，不弹出查重提示；新 Tab 并入同窗口已有同域名分组；不参与双击扫描与一键去重/分组；黑名单优先于自动分组名单
- **[新增]** 快捷设置弹窗顶部新增「一键取消分组 / 一键去重 / 一键分组」；`popup.js` 发送 `QUICK_ACTION` 消息，service worker 直接执行（跳过确认卡片）；取消分组作用于当前窗口所有已分组 Tab
- **[新增]** 整理到分组后 Toast 提供约 8 秒「取消」按钮，点击后 `chrome.tabs.ungroup` 重新展开 Tab；消息类型 `DEDUP_UNDO_ORGANIZE`，内存状态 `pendingOrganizeUndo`

### 2026-07-07
- **[优化]** 已在 Chrome Tab 分组内的 Tab 不参与重复检测（导航查重、批量扫描、清理目标均排除）
- **[新增]** 重复 Tab 三选项：清理 / 整理到 Tab 分组 / 忽略；导航检测与双击批量扫描均适用
- **[新增]** 配置项 `autoActionOnTimeout`（`close` / `organize` / `none`），控制超时默认操作；`manifest.json` 新增 `tabGroups` 权限，版本 1.2.0
- **[新增]** 双击扩展图标：扫描当前窗口全部重复 Tab，询问是否批量关闭（每组保留 1 个）；单击仍打开快捷设置弹窗（`chrome.action.onClicked` + 临时 `openPopup`）
- **[修复]** 批量扫描空 Tab：扩展 `isEmptyTabUrl` 覆盖 `chrome-untrusted://new-tab-page` 等 URL；空 Tab 始终参与批量扫描；批量关闭不再跳过「复制 Tab」标记

### 2026-07-06
- **[修复]** 关闭提示位置配置不生效：移除卡片 `width: 100%`，位置样式改为 ID+class 选择器并在 JS 内联对齐，修复脚本重复注入时未更新逻辑
- **[修复]** 黑名单改为排除逻辑：填写后忽略名单内域名的重复检测；白/黑名单可同时生效（先白名单限定范围，再黑名单排除）
- **[修复]** `domainOnly` 模式下 IP 与 `localhost` 按 host（含端口）区分查重，普通域名仍仅比较 hostname

### 2026-07-05
- **[资源]** 图标改为极简线条：两个重叠 Tab 轮廓（SVG 源 + `generate-icons.mjs` 导出 PNG）；16px 使用加粗专用版
- **[文档]** 补全 README：复制 Tab 排除、tab-origin、popup、键盘快捷键、架构与测试清单；新增本维护文档、docs-sync / commit-messages 项目规则
- **[文档]** 确立双语提交规范（英文 subject + 中文说明）
- **[新增]** 快捷设置弹窗、复制 Tab 检测（`tab-origin.js`）、空 Tab 查重、同站点阈值、横幅键盘快捷键（Y/1、N/2）；默认自动关闭改为 5 秒
