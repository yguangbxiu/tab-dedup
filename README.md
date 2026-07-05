# Tab Dedup — Chrome 重复 Tab 管理

Chrome 扩展（Manifest V3），用于在**当前窗口**内检测重复的 Tab。当你新开或导航到一个页面，且窗口内已有其他 Tab 与之匹配时，会在当前 Tab 顶部弹出询问横幅，询问是否关闭其余匹配的 Tab；默认保留当前 Tab，并在超时后自动执行关闭。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| 窗口内查重 | 仅在当前 Chrome 窗口内查找匹配 Tab，跨窗口不受影响 |
| 可配置匹配规则 | 支持按域名、完整 URL、忽略 hash、忽略 query+hash 四种模式 |
| 域名过滤 | 白名单 / 黑名单，限制哪些域名参与检测 |
| 交互式确认 | 页面顶部横幅询问「是 / 否」，可手动选择 |
| 自动关闭 | 可配置超时（默认 5 秒），无操作后自动关闭其他 Tab |
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
| 同站点 Tab 提醒阈值 | 1 | 范围 1–20；例如设为 3 表示 3 个以内不提醒，第 4 个才提醒 |

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
│  监听导航 → 查重 → 域名过滤 → 弹出提示 / 执行关闭              │
└──────────────┬──────────────────────────┬───────────────────┘
               │ chrome.scripting          │ chrome.notifications
               ▼                           ▼ (降级)
┌──────────────────────────┐    ┌─────────────────────┐
│  Content Script (注入)    │    │  系统通知            │
│  overlay.js + overlay.css │    │  (无法注入时使用)     │
│  顶部横幅 / Toast         │    └─────────────────────┘
└──────────────────────────┘

┌──────────────────────────┐
│  Options Page             │
│  options.html / options.js│
│  chrome.storage.sync      │
└──────────────────────────┘
```

扩展采用 **Manifest V3** 架构：后台逻辑运行在 Service Worker 中，UI 通过 `chrome.scripting` 按需注入到目标页面，设置持久化在 `chrome.storage.sync`。

### 触发流程

```mermaid
sequenceDiagram
    participant User as 用户
    participant Chrome as Chrome 导航
    participant SW as Service Worker
    participant Overlay as 页面横幅

    User->>Chrome: 新开 Tab / 导航到新 URL
    Chrome->>SW: tabs.onUpdated / webNavigation.onCommitted
    SW->>SW: 过滤（debounce / 已拒绝 / 域名 / 非 http）
    SW->>SW: 查询当前窗口其他 Tab，urlsMatch 比较
    alt 存在匹配 Tab
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

### 导航监听（双通道）

Service Worker 同时监听两个事件，以覆盖不同类型的页面跳转：

1. **`chrome.tabs.onUpdated`**：监听 `changeInfo.url` 变化，处理普通导航
2. **`chrome.webNavigation.onCommitted`**：监听 `frameId === 0` 的主框架提交，补充 SPA（单页应用）等场景

两者均只处理 `http://` 和 `https://` URL。

### 查重核心逻辑

`handleDuplicateNavigation(tabId, tab, url)` 是查重入口，按以下顺序执行：

1. **并发保护**：若该 Tab 正在处理关闭（`processingTabs`）或已有活跃提示（`activePrompts`），跳过
2. **防抖**：同一 `tabId + url` 在 800ms 内不重复检测（`recentChecks`）
3. **读取设置**：从 `chrome.storage.sync` 加载并 merge 默认值
4. **拒绝记忆**：若用户此前在该 Tab 上对当前归一化 URL 点了「否」（`dismissedPrompts`），跳过
5. **域名过滤**：调用 `shouldSkipByDomain()` 检查白名单 / 黑名单
6. **窗口内匹配**：`chrome.tabs.query({ windowId })` 获取当前窗口所有 Tab，排除自身后，用 `urlsMatch()` 逐一比较
7. **展示提示**：存在匹配 Tab 时调用 `showClosePrompt()`

### URL 匹配（`src/utils/url-matcher.js`）

`normalizeUrl(url, mode)` 将 URL 归一化为可比较的键：

| mode | 归一化结果 |
|------|-----------|
| `domainOnly` | 仅 hostname |
| `strict` | 完整 href（去除末尾 `/`） |
| `ignoreHash` | 去掉 hash 后的 href |
| `ignoreQueryHash` | 去掉 search 和 hash 后的 href |

`urlsMatch(urlA, urlB, mode)` 比较两个 URL 归一化后是否相等。

### 域名过滤（`src/utils/domain-list.js`）

`shouldSkipByDomain(hostname, whitelist, blacklist)`：

- 白名单非空 → 仅白名单内域名**不跳过**（即只检测白名单域名）
- 白名单为空且黑名单非空 → 仅黑名单内域名**不跳过**
- 两者均为空 → 检测所有 http/https 域名

域名匹配支持精确匹配和子域名后缀匹配（`host.endsWith('.' + entry)`）。

### 用户交互

#### 页面横幅（`src/content/overlay.js`）

- 通过 Shadow DOM 隔离样式（`overlay.css` 使用 `all: initial` 重置）
- 接收 `SHOW_DEDUP_PROMPT` 消息，渲染顶部横幅
- 倒计时结束后自动发送 `{ choice: 'close' }`
- 用户选择通过 `DEDUP_USER_CHOICE` 消息回传 Service Worker
- 关闭完成后接收 `SHOW_SWITCH_TOAST` 显示操作反馈

#### 系统通知降级

当 `chrome.scripting.executeScript` 注入失败（如 Chrome 内部页、受限页面）时：

- 创建 `chrome.notifications` 通知，带「是 / 否」按钮
- 同样支持超时自动关闭
- 点击通知本身视为「是」

### 状态管理

Service Worker 维护以下内存状态（Tab 关闭时自动清理）：

| 变量 | 用途 |
|------|------|
| `processingTabs` | 正在执行关闭操作的 Tab ID |
| `activePrompts` | 当前有活跃提示的 Tab 及其上下文 |
| `pendingNotifications` | 降级通知的待处理数据 |
| `recentChecks` | 防抖时间戳 |
| `dismissedPrompts` | 用户拒绝后不再提示的 Tab + URL 键 |

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
├── icons/                        # 扩展图标（16 / 48 / 128）
├── src/
│   ├── background/
│   │   └── service-worker.js     # 后台：导航监听、查重、关闭、消息路由
│   ├── content/
│   │   ├── overlay.js            # 注入脚本：横幅、Toast、用户选择
│   │   └── overlay.css           # 注入样式
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

---

## 开发与测试

### 运行单元测试

```bash
node tests/url-matcher.test.js
node tests/domain-list.test.js
```

### 手动测试清单

1. Tab A 打开 `https://example.com/page-a`，新开 Tab B 访问 `https://example.com/page-b` → B 顶部出现横幅，1s 后 A 自动关闭
2. 同上场景，点击「否」→ A、B 均保留，B 不再重复提示
3. 窗口内有 A、C 两个同域名 Tab，新开 B → 确认后 A 和 C 均被关闭，仅 B 保留
4. 在 Tab A 地址栏直接跳转到 `/page-b`（同 Tab）→ 不触发任何提示
5. 白名单加入 `example.com` 后，仅对该域名生效；其他域名不触发
6. 在另一个窗口打开相同 URL，当前窗口新开同域名 Tab → 不应拦截
7. 切换匹配模式为「完整 URL 一致」，仅完全相同 URL 才触发
8. 中键 / Ctrl+点击链接打开新 Tab → 正常触发检测

### 调试建议

- Service Worker 日志：扩展管理页 → 「Service Worker」→ 检查
- Content Script 日志：目标页面 DevTools Console（需过滤 `[Tab Dedup]`）
- 设置变更：修改后立即生效，无需重启扩展

---

## 版本

当前版本：**1.1.0**（见 `manifest.json`）
