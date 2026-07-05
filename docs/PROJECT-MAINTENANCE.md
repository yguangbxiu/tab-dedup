# Tab Dedup — 维护文档

面向维护者与 AI 助手的项目速查。用户向说明见 [README.md](../README.md)。

## 入口与运行

- **Manifest V3** Chrome 扩展，无构建步骤；根目录「加载已解压的扩展程序」即可
- 后台：`src/background/service-worker.js`
- 设置存储：`chrome.storage.sync`，默认值见 `src/utils/defaults.js`

## 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 查重与关闭 | `service-worker.js` | 导航监听、匹配、提示、关闭、复制 Tab 识别 |
| Tab 来源标记 | `tab-origin.js` | `document_start` 写入 sessionStorage，上报 `TAB_ORIGIN_CHECK` |
| 页面 UI | `overlay.js` / `overlay.css` | 横幅、Toast、键盘快捷键（按需注入） |
| 快捷设置 | `popup/*` | 超时、空 Tab、同站点阈值 |
| 完整设置 | `options/*` | 全部配置项 |
| URL 匹配 | `url-matcher.js` | 归一化、`isEmptyTabUrl` |
| 域名过滤 | `domain-list.js` | 白/黑名单 |

## 数据流摘要

1. 导航完成 → `handleDuplicateNavigation`
2. 过滤：debounce、已拒绝、复制 Tab（若开启）、域名、空 Tab 规则
3. 窗口内 `urlsMatchForDedup` 计数；`matches + 1 > sameSiteTabLimit` 才提示
4. 注入 overlay 或降级为系统通知
5. 用户选 close / 超时 → `closeMatchingTabs`（跳过被标记为复制的 Tab）

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

### 2026-07-05
- **[资源]** 图标改为极简线条：两个重叠 Tab 轮廓（SVG 源 + `generate-icons.mjs` 导出 PNG）；16px 使用加粗专用版
- **[文档]** 补全 README：复制 Tab 排除、tab-origin、popup、键盘快捷键、架构与测试清单；新增本维护文档、docs-sync / commit-messages 项目规则
- **[文档]** 确立双语提交规范（英文 subject + 中文说明）
- **[新增]** 快捷设置弹窗、复制 Tab 检测（`tab-origin.js`）、空 Tab 查重、同站点阈值、横幅键盘快捷键（Y/1、N/2）；默认自动关闭改为 5 秒
