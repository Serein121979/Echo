# Echo — AI 开发上下文文档

> 本文件用于向 AI 编程助手说明项目背景、技术约束和开发原则。
> 每次开始新的开发任务前，请将本文件纳入上下文。

---

## 项目定位

Echo 是一个**面向个人的跨设备消息同步与整理工具**，灵感来自"给自己发消息"这个最朴素的需求。

**目标用户：只有作者自己（单用户工具）。**

它不是团队协作工具，不是笔记软件，不是 Todo App。
它就是一个更聪明的"文件传输助手"——收进来、找得到、清得掉。

---

## 核心功能（已实现）

- 跨设备实时同步（Supabase Realtime，轮询兜底）
- 文件夹管理（创建 / 切换 / 删除，默认收件箱）
- 标签系统（创建 / 筛选 / 删除，一条消息可多标签）
- 自动标签（数据库规则驱动，支持 UI 增删改）
- 附件消息（支持粘贴图片、选择文件、跨端下载）
- 消息编辑（编辑后自动刷新自动标签）
- 消息列表（自动滚动到底部，体验接近 IM）
- 收藏 / 归档（支持主列表、收藏、归档三种视图，字段为 `is_starred` / `is_archived`）
- 黑白极简界面（侧边栏默认收起，点击后抽屉展开）
- PWA 基础安装体验（manifest + 安装提示）
- PWA Share Target（系统分享直接写入收件箱）

---

## 技术栈（不要擅自替换）

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Next.js 16 | 使用 App Router，当前页面主要是 Client Component 驱动的交互式单页体验 |
| 运行时 | React 19 | 使用现代 Hooks 和客户端状态管理，不引入额外状态库 |
| 样式 | Tailwind CSS 4 | 仅用原子类和少量全局样式，界面保持黑白极简风 |
| 语言 | TypeScript | 严格类型，前端和数据库返回值都尽量显式建模 |
| 后端 / 数据库 | Supabase Postgres | `notes` / `folders` / `tags` / `note_tags` / `auto_tag_rules` 为核心数据表 |
| 实时同步 | Supabase Realtime | 监听 `notes`、`folders`、`tags`、`note_tags`、`auto_tag_rules` 的变更 |
| 文件存储 | Supabase Storage | 附件统一放在 `echo-files` 存储桶，前端使用公开下载链接 |
| 部署 | Vercel | 默认目标平台，兼容电脑端和手机端访问 |
| 图标 / PWA | Next.js 原生 metadata route | 使用 `manifest.ts`、`/share` 路由和 `sw.js` 提供安装与分享体验 |

### 当前前端依赖

- `date-fns`：消息时间格式化
- `lucide-react`：图标
- `@supabase/supabase-js`：数据库、实时和存储访问

### 当前开发约束

- 不引入额外 UI 组件库
- 不引入额外状态管理库
- 不引入 ORM 或数据库抽象层
- 不引入需要常驻服务的依赖

**不要引入以下内容（除非明确被要求）：**
- 额外的状态管理库（Redux、Zustand 等）
- 额外的 UI 组件库（shadcn/ui、MUI 等）
- 额外的 ORM 或数据库抽象层
- 任何需要服务端常驻进程的依赖

---

## 数据库结构

```
notes       → 消息主体（content, folder_id, created_at, updated_at, deleted_at, is_starred, is_archived, file_path, file_url, file_name, file_type, file_size）
folders     → 文件夹
tags        → 标签
note_tags   → 消息与标签的多对多关系
auto_tag_rules → 自动标签规则（match_type, match_value, tag_id, priority）
storage bucket echo-files → 附件存储
```

**软删除原则：** 删除操作只写 `deleted_at`，不物理删除。查询时默认过滤 `deleted_at IS NULL`。

---

## Roadmap（按优先级排列）

### 🔴 P0 — 补全基础功能
- [x] 删除消息（软删除）
- [x] 全文搜索（PostgreSQL FTS，`tsvector` + `gin` 索引）

### 🟠 P1 — 差异化核心体验
- [x] 收藏 / 归档（`is_starred` / `is_archived` 字段）
- [x] 自动标签规则可配置（UI 可增删改规则）

### 🟡 P2 — 体验打磨
- [x] PWA 安装体验（基础版 manifest + 安装提示）
- [x] PWA Share Target（系统分享直达收件箱）
- [x] 移动端体验优化（抽屉侧边栏、黑白极简 UI、`dvh` 单位）

### 🟢 P3 — AI 增强（基础稳定后再做）
- [ ] AI 自动分类（Supabase Edge Function → AI API → 写回 note）
- [ ] AI 自动摘要

---

## 专项：PWA Share Target

### 目标

让手机上任何 App（相册、浏览器、备忘录等）点击"分享"时，可以直接选择 Echo 作为目标，内容自动进入收件箱。效果等同于分享给微信，无需打开浏览器手动操作。

**支持的分享类型：**
- 纯文字 / URL
- 图片（单张）
- 任意文件

### 当前实现

这部分已经落地，相关文件如下：

- [`src/app/manifest.ts`](/Users/Zhuanz/echo-app/src/app/manifest.ts)
- [`src/app/share/route.ts`](/Users/Zhuanz/echo-app/src/app/share/route.ts)
- [`src/app/layout.tsx`](/Users/Zhuanz/echo-app/src/app/layout.tsx)
- [`src/components/pwa/PwaServiceWorker.tsx`](/Users/Zhuanz/echo-app/src/components/pwa/PwaServiceWorker.tsx)
- [`public/sw.js`](/Users/Zhuanz/echo-app/public/sw.js)

### 行为说明

```
POST /share
  ↓
读取 FormData（text / url / title / file）
  ↓
有文件 → 上传到 Supabase Storage echo-files 桶
  ↓
写入 notes 表（`content = text + url`，附件字段按需填写）
  ↓
303 重定向回 `/`（主界面）
```

**处理逻辑细节：**
- `text` 和 `url` 合并写入 `content`，格式为 `${text}\n${url}`（去掉空值）
- `title` 作为辅助信息，可附加在 content 末尾或忽略
- 有文件时：上传到 `echo-files`，写入 `file_path` / `file_url` / `file_name` / `file_type` / `file_size`
- 写入的 note 默认落在收件箱（`folder_id = null` 或默认收件箱 ID）
- 写入成功后 `redirect("/")` 跳回主界面

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/app/manifest.ts` | 修改 | 增加 `share_target` 字段 |
| `src/app/share/route.ts` | 新增 | 处理 POST /share 请求 |
| `public/sw.js` | 新增 | 最简 Service Worker |
| `src/app/layout.tsx` | 修改 | 挂载 Service Worker 注册组件 |
| `src/components/pwa/PwaServiceWorker.tsx` | 新增 | 客户端注册 `/sw.js` |

### 注意事项

- **仅 HTTPS 生效**：Share Target 要求 PWA 运行在 HTTPS 下，本地 `localhost` 也支持，但局域网 IP 不支持（除非配置证书）。
- **需先安装到主屏幕**：Share Target 只对已安装的 PWA 有效，用浏览器直接访问时不会出现在分享菜单。
- **iOS Safari 的限制**：iOS 16.4+ 支持 PWA Share Target，但仅支持文字和 URL，文件分享支持有限，需测试。
- **不要在 /share 路由中引入客户端组件**：这个路由纯粹是服务端 Route Handler，处理完直接 redirect，不渲染任何 UI。
- **文件大小限制**：Supabase Storage 默认单文件上传限制为 50MB，与现有附件逻辑保持一致。

### 测试方法

1. 本地启动后先确认 `manifest.webmanifest` 里包含 `share_target`
2. 电脑或手机浏览器访问站点，确认可以安装到桌面 / 主屏幕
3. 安装后从手机相册、浏览器或备忘录执行“分享”
4. 选择 Echo，确认消息写入收件箱并在主界面显示

---

## 开发原则

1. **单用户优先**：不要过度设计权限系统、团队功能、分享功能。
2. **数据库是真相来源**：业务逻辑尽量下沉到 SQL / Supabase RLS，不要在前端维护复杂状态。
3. **渐进增强**：先做能用，再做好用，最后做智能。不要跳过基础功能直接上 AI。
4. **不破坏已有功能**：每次修改前确认现有的实时同步、自动标签、文件夹逻辑不受影响。
5. **移动端同等重要**：所有新 UI 必须在 375px 宽度下可用，优先用 Tailwind 的响应式前缀处理。
6. **软删除**：任何涉及删除的功能，一律使用 `deleted_at` 软删除，不执行物理 `DELETE`。

---

## 当前已知问题 / 技术债

- 新环境需执行最新 `supabase/schema.sql` 才能启用 `auto_tag_rules`、附件字段和 `echo-files` 存储桶
- 当前开发环境如果要通过局域网 IP 访问，需要确认 `next.config.ts` 的 `allowedDevOrigins` 与本机 IP 一致
- 搜索目前已接入数据库全文搜索，旧表结构下会降级为前端内容匹配
- PWA Share Target 仅在 HTTPS + 已安装状态下生效，本地开发时需注意

---

## 不在范围内的功能（除非作者明确要求）

- 多用户 / 账号系统
- 消息分享给他人
- 第三方登录
- 消息加密

---

*最后更新：PWA Share Target 已实现并与 README 保持同步*
