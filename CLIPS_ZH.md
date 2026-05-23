# Clips 子系统中文说明

## 这次做了什么

这次没有把“代码同步”继续塞进原来的 `notes` 主流程里，而是在 `Echo` 里新增了一套独立的 `clips` 子系统，目标是解决：

- MacBook 和 Windows / Linux 之间同步代码片段
- 不依赖微信传输助手
- 保留代码缩进、换行和代码块格式
- 后续接桌面常驻小面板、开机自启和自动监听剪切板

当前仓库里已经完成了两部分：

1. `Echo Web` 端的 `Clips` 页面和数据流
2. `Tauri` 桌面端骨架

## 当前目录结构

### Web 端

- `src/app/clips/page.tsx`
- `src/components/clips/ClipsApp.tsx`
- `src/components/clips/types.ts`

这部分提供一个 Web 兜底入口，支持：

- Supabase Auth 登录
- 查看最近 `100` 条同步内容
- 查看置顶内容
- 一键复制到本机剪切板
- 置顶 / 取消置顶
- 软删除

### 数据库

- `supabase/schema.sql`

这里新增了 `clips` 表和相关索引、RLS、Realtime 发布配置。

`clips` 当前字段：

- `id`
- `user_id`
- `content`
- `kind`
- `content_hash`
- `source_device_id`
- `source_platform`
- `is_pinned`
- `created_at`
- `deleted_at`

当前策略是严格按 `auth.uid() = user_id` 隔离，和原先公开读写的 `notes` 原型逻辑分开。

### 桌面端骨架

- `clips-desktop/`

这是一个独立的 `Tauri v2` 工程，已经落了这些能力的骨架：

- Supabase Auth 登录态
- 托盘 / 菜单栏小窗
- 剪切板轮询监听
- `text` / `code` 分类
- `200 KB` 大小限制
- `10 秒` 上传去重窗口
- `15 秒` 本地写回忽略窗口
- 离线待发送队列
- 本地 JSON 状态持久化
- 开机自启开关

## 当前实现边界

第一版刻意收得很窄，只做：

- 纯文本
- 代码片段

暂时不做：

- 文件同步
- 图片同步
- 富文本编辑
- 多人共享
- 聊天室式会话

Web 端只是辅助入口，真正的目标入口仍然是桌面小面板。

## 目前已经验证过的部分

我在这台 Mac 上已经验证过：

- `npm run lint`
- `tsc --noEmit`
- `npm run build`

Web 端 `/clips` 路由已经能通过构建。

## 目前还没完成的部分

桌面端还没有在这台机器上做真实编译验证，原因不是代码没写，而是环境还不够：

- 当前机器磁盘空间偏紧
- 当前机器没有安装 Rust 工具链
- `clips-desktop` 还没有单独安装自己的前端依赖

所以现在的桌面端状态是：

- 结构完整
- 业务逻辑骨架完整
- 但还没在本机实际跑起来

## 你之后在游戏本继续做时，优先顺序

建议顺序：

1. 拉下这个仓库最新代码
2. 在 Supabase 后台执行最新 `supabase/schema.sql`
3. 配好 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. 先跑 `Echo Web`，确认 `/clips` 页面可用
5. 安装 Rust 工具链
6. 进入 `clips-desktop/` 安装依赖并跑 `tauri dev`
7. 再做多端联调

## 桌面端后续最该优先验证的点

到了游戏本以后，最应该优先验证的是：

1. Tauri 插件权限名是否和本机版本完全一致
2. 托盘图标和左键点击行为是否正常
3. 自动监听剪切板时会不会误回环
4. 收到远端 `clip` 后，通知和“一键复制回本机剪切板”是否正常
5. 断网后离线队列是否会在联网后顺序补发

## 备注

如果你以后想继续扩展，这套 `clips` 子系统最好继续保持独立，不要重新并回原来的 `notes` 体系。原因很简单：

- `notes` 更像“个人收件箱 / 轻笔记”
- `clips` 更像“跨设备剪切板接力”

这两个需求很接近，但交互目标不一样，拆开会更稳。
