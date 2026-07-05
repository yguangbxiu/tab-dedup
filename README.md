# Tab Dedup — Chrome 重复 Tab 管理

Chrome 扩展（Manifest V3），用于在**当前窗口**内检测重复的 Tab。当你新开或导航到一个页面，且窗口内已有其他 Tab 与之匹配时，会在当前 Tab 顶部弹出询问横幅，询问是否关闭其余匹配的 Tab；默认保留当前 Tab，并在超时后自动执行关闭。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| 窗口内查重 | 仅在当前 Chrome 窗口内查找匹配 Tab，跨窗口不受影响 |
| 可配置匹配规则 | 支持按域名、完整 URL、忽略 hash、忽略 query+hash 四种模式 |
| 域名过滤 | 白名单 / 黑名单，限制哪些域名参与检测 |
| 交互式确认 | 页面顶部横幅询问「是 / 否」，可手动选择或键盘快捷键 |
| 自动关闭 | 可配置超时（默认 5 秒），无操作后自动关闭其他 Tab |
| 快捷设置弹窗 | 左键点击扩展图标，快速调整常用选项 |
| 复制 Tab 排除 | 可配置：浏览器「复制标签页」打开的 Tab 不参与查重 |
| 同站点阈值 | 同站点 Tab 数量未超过设定值时不提醒 |
| 空 Tab 查重 | 可选：多个新标签页 / about:blank 也参与查重 |
| 降级通知 | 无法向页面注入 UI 时，回退为系统通知 |
| 关闭反馈 | 成功关闭后显示短暂 Toast 提示 |

---

## 安装（开发者模式）

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录

---

## 用户使用指南

### 典型场景

1. 窗口内已有 Tab A 打开 `https://example.com/page-a`
2. 新开 Tab B 并访问 `https://example.com/page-b`（同域名，默认匹配规则下视为重复）
3. Tab B 顶部出现蓝色询问横幅：「检测到 N 个相同域名的 Tab，是否关闭？」
4. 点击「是」或等待倒计时结束 → Tab A 被关闭，Tab B 保留，并显示「已关闭 N 个同域名 Tab」
5. 点击「否」→ 所有 Tab 均保留；同一 Tab 在同一 URL（按当前匹配规则归一化后）下不会再次弹出提示

### 不会触发的情况

- **同 Tab 内跳转**：在已有 Tab 的地址栏直接修改 URL，不会产生「其他 Tab」，因此不触发
- **跨窗口**：其他窗口中的同域名 Tab 不会被检测或关闭
- **非 HTTP(S) 页面**：`chrome://`、`about:`、`file://` 等内部页面不参与
- **用户已拒绝**：在当前 Tab 上对同一匹配键（归一化 URL）点击「否」后，该 Tab 不再重复询问
- **域名被过滤**：当前域名不在白名单内，或不在黑名单指定的检测范围内（见下方配置说明）
- **复制的 Tab**（默认开启排除）：通过浏览器「复制标签页」打开的 Tab 不触发查重；新 Tab 手动输入网址仍会正常查重
- **未达同站点阈值**：例如阈值为 3 时，窗口内同站点 Tab 总数 ≤ 3 不提醒，第 4 个才弹出横幅

### 打开设置

- 左键点击扩展图标 → 快捷设置弹窗
- 右键扩展图标 →「选项」→ 完整设置页
- 或在 `chrome://extensions/` 中找到本扩展 →「详细信息」→「扩展程序选项」

### 配置项

#### 关闭提示

| 选项 | 默认值 | 说明 |
|------|--------|------|
| 超时后自动关闭同域名 Tab | 开启 | 关闭后需手动点击「是」才会关闭 |
| 超时时间 | 5 秒 | 范围 1–30 秒，倒计时显示在「是」按钮上 |
| 空 Tab 查重 | 关闭 | 开启后，新标签页 / about:blank 也会参与查重 |
| 复制的 Tab 不参与查重 | 是 | 开启后，复制标签页打开的 Tab 不触发查重，也不会被当作重复目标关闭 |
| 同站点 Tab 提醒阈值 | 1 | 范围 1–20；例如设为 3 表示 3 个以内不提醒，第 4 个才提醒 |

快捷设置弹窗（左键扩展图标）可调整：超时时间、空 Tab 查重、同站点阈值。其余选项在完整设置页。

#### URL 匹配规则

| 模式 | 行为 | 示例 |
|------|------|------|
| **仅比较域名**（默认） | 同一 hostname 即视为重复 | `/login` 与 `/dashboard` 匹配 |
| **完整 URL 一致** | 协议、域名、路径、query、hash 全部相同 | 仅完全相同 URL 匹配 |
| **忽略 hash** | 去掉 `#` 后比较 | `#section-a` 与 `#section-b` 匹配 |
| **忽略 query 和 hash** | 仅比较协议 + 域名 + 路径 | `?id=1` 与 `?id=2` 匹配 |

路径末尾的 `/` 会在比较前统一去除（`/path` 与 `/path/` 视为相同）。

#### 域名过滤

- **白名单**：填写后，**仅**对白名单中的域名生效；留空表示不启用白名单
- **黑名单**：白名单为空时，**仅**对黑名单中的域名生效；留空表示对所有 http/https 页面生效
- 两者同时填写时，**白名单优先**
- 支持子域名匹配：`github.com` 也会匹配 `docs.github.com`
- 每行一个域名，也支持逗号分隔

---

## 架构与实现逻辑

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Service Worker                          │
│  (src/background/service-worker.js)                         │
│                                                             │
│  监听导航 → 查重 → 复制Tab过滤 → 域名过滤 → 提示 / 关闭      │
└──────┬───────────────────────┬──────────────────┬───────────┘
       │ chrome.scripting       │ chrome.notifications│ messages
       ▼                        ▼ (降级)              ▼
┌──────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ overlay (注入)    │   │ 系统通知         │   │ tab-origin.js    │
│ 横幅 / Toast     │   │ (无法注入时)     │   │ (manifest 注册)   │
└──────────────────┘   └─────────────────┘   │ sessionStorage   │
                                              │ TAB_ORIGIN_CHECK │
                                              └──────────────────┘

┌──────────────────────────┐   ┌──────────────────────────┐
│  Popup（快捷设置）         │   │  Options Page（完整设置）  │
│  popup.html / popup.js   │   │  options.html / options.js│
│  chrome.storage.sync     │   │  chrome.storage.sync      │
└──────────────────────────┘   └──────────────────────────┘
```

扩展采用 **Manifest V3** 架构：后台逻辑运行在 Service Worker 中；`tab-origin.js` 在 `document_start` 自动注入以识别复制 Tab；横幅与 Toast 通过 `chrome.scripting` 按需注入；设置持久化在 `chrome.storage.sync`。

### 触发流程

```mermaid
sequenceDiagram
    participant User as 用户
    participant Chrome as Chrome 导航
    participant SW as Service Worker
    participant Overlay as 页面横幅

    User->>Chrome: 新开 Tab / 导航到新 URL
    Chrome->>SW: tabs.onUpdated / webNavigation.onCommitted
    SW->>SW: 过滤（debounce / 已拒绝 / 复制Tab / 域名 / 阈值）
    SW->>SW: 查询当前窗口其他 Tab，urlsMatch 比较
    alt 匹配数超过同站点阈值
        SW->>Overlay: 注入 overlay.js，发送 SHOW_DEDUP_PROMPT
        Overlay->>User: 显示询问横幅 + 倒计时
        alt 用户点「是」或超时
            User->>Overlay: 选择 close
            Overlay->>SW: DEDUP_USER_CHOICE
            SW->>Chrome: tabs.remove(其他匹配 Tab)
            SW->>Overlay: SHOW_SWITCH_TOAST
        else 用户点「否」
            User->>Overlay: 选择 keep
            Overlay->>SW: DEDUP_USER_CHOICE
            SW->>SW: 记录 dismissedPrompts，不再询问
        end
    end
```

### 导航监听

Service Worker 监听以下事件以覆盖不同类型的页面跳转：

1. **`chrome.tabs.onUpdated`**：`status === 'complete'` 时触发查重；`changeInfo.url` 变化时清除该 Tab 的提示状态
2. **`chrome.webNavigation.onCompleted`**：主框架（`frameId === 0`）加载完成时触发查重
3. **`chrome.webNavigation.onCommitted`**：主框架提交时清除提示状态（避免 SPA 路由切换残留旧横幅）
4. **`chrome.tabs.onCreated`**：辅助识别复制 Tab（无 `openerTabId` 且左侧 Tab URL 相同）

查重入口仅处理可检测 URL：`http(s)://`，或在开启空 Tab 查重时的 `chrome://newtab/`、`about:blank` 等。

### 查重核心逻辑

`handleDuplicateNavigation(tabId, tab, url)` 是查重入口，按以下顺序执行：

1. **并发保护**：若该 Tab 正在处理关闭（`processingTabs`）或已有活跃提示（`activePrompts`），跳过
2. **防抖**：同一 `tabId + url` 在 800ms 内不重复检测（`recentChecks`）
3. **读取设置**：从 `chrome.storage.sync` 加载并 merge 默认值
4. **拒绝记忆**：若用户此前在该 Tab 上对当前归一化 URL 点了「否」（`dismissedPrompts`），跳过
5. **复制 Tab 排除**：若开启 `excludeDuplicatedTabs`，等待 `tab-origin.js` 上报或相邻 Tab 探测完成；已标记为复制的 Tab 跳过
6. **域名过滤**：非空 Tab 时调用 `shouldSkipByDomain()` 检查白名单 / 黑名单
7. **窗口内匹配**：`chrome.tabs.query({ windowId })` 获取当前窗口所有 Tab，排除自身与复制 Tab 后，用 `urlsMatchForDedup()` 逐一比较
8. **同站点阈值**：`matches.length + 1 > sameSiteTabLimit` 时才继续（默认阈值为 1，即有一个重复即提醒）
9. **展示提示**：调用 `showClosePrompt()`

### URL 匹配（`src/utils/url-matcher.js`）

`normalizeUrl(url, mode)` 将 URL 归一化为可比较的键：

| mode | 归一化结果 |
|------|-----------|
| `domainOnly` | 仅 hostname |
| `strict` | 完整 href（去除末尾 `/`） |
| `ignoreHash` | 去掉 hash 后的 href |
| `ignoreQueryHash` | 去掉 search 和 hash 后的 href |

`urlsMatch(urlA, urlB, mode)` 比较两个 URL 归一化后是否相等。

`isEmptyTabUrl(url)` 判断新标签页 / about:blank 等空 Tab URL；开启空 Tab 查重时，两个空 Tab 视为匹配。

### 复制 Tab 识别（`src/content/tab-origin.js`）

`manifest.json` 在 `document_start` 注册 `tab-origin.js`，在所有 http(s) 页面自动运行：

1. 每个 Tab 在 `sessionStorage` 写入 `__tab_dedup_origin_tab_id__`（首次为当前 tabId）
2. 页面加载时发送 `TAB_ORIGIN_CHECK`，Service Worker 对比 storedTabId 与当前 tabId
3. 结合**左侧相邻 Tab**、**strict URL 相同**、**无 openerTabId** 判定是否为浏览器「复制标签页」
4. 扩展安装/更新时，Service Worker 对已有 Tab 补写 sessionStorage

### 域名过滤（`src/utils/domain-list.js`）

`shouldSkipByDomain(hostname, whitelist, blacklist)`：

- 白名单非空 → 仅白名单内域名**不跳过**（即只检测白名单域名）
- 白名单为空且黑名单非空 → 仅黑名单内域名**不跳过**
- 两者均为空 → 检测所有 http/https 域名

域名匹配支持精确匹配和子域名后缀匹配（`host.endsWith('.' + entry)`）。

### 用户交互

#### 页面横幅（`src/content/overlay.js`）

- 通过独立 host 元素 + `all: initial` 样式重置，减少对页面样式的干扰
- 接收 `SHOW_DEDUP_PROMPT` 消息，渲染顶部横幅
- **键盘快捷键**（仅页面横幅）：`Y` / `1` → 关闭其他 Tab；`N` / `2` → 保留
- 倒计时结束后自动发送 `{ choice: 'close' }`
- 用户选择通过 `DEDUP_USER_CHOICE` 消息回传 Service Worker
- 关闭完成后接收 `SHOW_SWITCH_TOAST` 显示操作反馈

#### 系统通知降级

当 `chrome.scripting.executeScript` 注入失败（如 Chrome 内部页、受限页面）时：

- 创建 `chrome.notifications` 通知，带「是 / 否」按钮
- 同样支持超时自动关闭
- 点击通知本身视为「是」
- **不支持键盘快捷键**（系统通知限制）

### 状态管理

Service Worker 维护以下内存状态（Tab 关闭时自动清理）：

| 变量 | 用途 |
|------|------|
| `processingTabs` | 正在执行关闭操作的 Tab ID |
| `activePrompts` | 当前有活跃提示的 Tab 及其上下文 |
| `pendingNotifications` | 降级通知的待处理数据 |
| `recentChecks` | 防抖时间戳 |
| `dismissedPrompts` | 用户拒绝后不再提示的 Tab + URL 键 |
| `duplicatedTabIds` | 被识别为「复制标签页」的 Tab ID |
| `originCheckCompleted` | 已完成来源检测的 Tab ID（含复制 Tab 判定结果） |

### 设置与迁移

- 默认设置定义在 `src/utils/defaults.js`
- 首次安装时写入 `chrome.storage.sync`
- 从旧版本升级时，若 `matchMode` 为 `ignoreHash` 或未设置，自动迁移为 `domainOnly`
- 兼容旧字段名 `askAutoSwitchEnabled` / `askAutoSwitchSeconds`

---

## 目录结构

```
chrome-tab-dedup/
├── manifest.json                 # 扩展清单（MV3）
├── icons/                        # 扩展图标（SVG 源 + 16/48/128 PNG；双 Tab 线条轮廓）
├── src/
│   ├── background/
│   │   └── service-worker.js     # 后台：导航监听、查重、关闭、消息路由
│   ├── content/
│   │   ├── tab-origin.js         # 自动注入：复制 Tab 识别（sessionStorage）
│   │   ├── overlay.js            # 按需注入：横幅、Toast、键盘快捷键
│   │   └── overlay.css           # 注入样式
│   ├── popup/
│   │   ├── popup.html            # 快捷设置弹窗
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/
│   │   ├── options.html          # 设置页
│   │   ├── options.js            # 设置读写
│   │   └── options.css           # 设置页样式
│   └── utils/
│       ├── defaults.js           # 默认配置与 merge 逻辑
│       ├── url-matcher.js        # URL 归一化与匹配（扩展环境）
│       ├── url-matcher.node.js   # 同上（Node 测试用）
│       ├── domain-list.js        # 域名白/黑名单解析与匹配
│       └── domain-list.node.js   # 同上（Node 测试用）
├── docs/
│   └── PROJECT-MAINTENANCE.md    # 维护者文档与变更记录
└── tests/
    ├── url-matcher.test.js       # URL 匹配单元测试
    └── domain-list.test.js       # 域名列表单元测试
```

### 权限说明

| 权限 | 用途 |
|------|------|
| `tabs` | 查询、关闭 Tab |
| `storage` | 持久化用户设置 |
| `scripting` | 向页面注入横幅和 Toast |
| `notifications` | 注入失败时的系统通知降级 |
| `webNavigation` | 捕获 SPA 导航 |
| `<all_urls>` | 在所有 http/https 页面上运行 |

`manifest.json` 还通过 `content_scripts` 在 http(s) 页面 `document_start` 自动注入 `tab-origin.js`（复制 Tab 识别）。

---

## 开发与测试

### 运行单元测试

```bash
node tests/url-matcher.test.js
node tests/domain-list.test.js
```

### 手动测试清单

1. Tab A 打开 `https://example.com/page-a`，新开 Tab B 访问 `https://example.com/page-b` → B 顶部出现横幅，5s 后 A 自动关闭
2. 同上场景，点击「否」或按 `N` / `2` → A、B 均保留，B 不再重复提示
3. 窗口内有 A、C 两个同域名 Tab，新开 B → 确认后 A 和 C 均被关闭，仅 B 保留
4. 在 Tab A 地址栏直接跳转到 `/page-b`（同 Tab）→ 不触发任何提示
5. 白名单加入 `example.com` 后，仅对该域名生效；其他域名不触发
6. 在另一个窗口打开相同 URL，当前窗口新开同域名 Tab → 不应拦截
7. 切换匹配模式为「完整 URL 一致」，仅完全相同 URL 才触发
8. 中键 / Ctrl+点击链接打开新 Tab → 正常触发检测
9. 复制 Tab A（右键「复制标签页」）→ 复制的 Tab 不触发查重；新 Tab 手动输入同域名 URL 仍触发
10. 同站点阈值设为 3 → 第 1–3 个同站点 Tab 不提醒，第 4 个才出现横幅
11. 开启空 Tab 查重 → 多个新标签页之间触发提醒

### 调试建议

- Service Worker 日志：扩展管理页 → 「Service Worker」→ 检查
- Content Script 日志：目标页面 DevTools Console（需过滤 `[Tab Dedup]`）
- 设置变更：修改后立即生效，无需重启扩展

---

## 版本

当前版本：**1.1.0**（见 `manifest.json`）

维护者文档与变更记录见 [docs/PROJECT-MAINTENANCE.md](docs/PROJECT-MAINTENANCE.md)。
