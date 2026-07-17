# Echo

Echo 是一个只供个人使用的跨设备信息收件箱。手机使用可安装的 PWA，Windows 与 macOS 使用 Tauri 桌面伴侣；所有内容通过 Supabase Realtime 同步，并可用 DeepSeek 检索和整理。

## 已实现

- Supabase 邮箱密码登录，所有业务表按 `auth.uid()` 强制隔离
- 私有 Storage 附件桶与 5 分钟签名下载链接
- 文字、链接及多附件消息，单文件最大 500MB
- 基于 TUS 的分片、重试、断点续传和上传取消
- 收件箱、收藏、归档、文件夹、标签、软删除和设备来源
- 普通搜索覆盖正文、摘要、标签与文件名
- DeepSeek 流式历史问答，回答附原消息引用
- AI 摘要、标签和文件夹建议，确认后才写入
- 图片 OCR；PDF、DOCX、XLSX、PPTX 与文本文件内容提取（最大 25MB）
- PWA manifest、系统分享目标和离线 Service Worker
- Tauri 托盘、开机启动、离线队列、远端通知和剪切板确认发送

音视频和其他文件可以正常传输，但首版不做语音转写。`/clips` 仅保留兼容重定向，数据已经统一到 `notes`。

## 初始化（会清空旧 Echo 数据）

`supabase/schema.sql` 是有意设计为破坏性重建的脚本：它会删除旧的 Echo/Clips 业务表和 `echo-files` 中的旧对象，然后创建私有模型。请只在确认不需要旧数据后执行。

1. 在 Supabase Dashboard 的 Authentication 中创建你的邮箱密码用户。
2. 在 SQL Editor 执行 [`supabase/schema.sql`](./supabase/schema.sql)。
3. 在 Authentication 设置中关闭公开注册（Allow new users to sign up）。
4. 复制环境变量模板：

```bash
cp .env.example .env.local
```

填写：

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-v4-flash
```

DeepSeek Key 只用于 Next.js 服务端路由，不要添加 `NEXT_PUBLIC_` 前缀。

## Web / PWA

```bash
npm install
npm run dev
```

打开 `http://localhost:3000` 登录。部署到 Vercel 时添加上面的四个环境变量，然后使用同一网址在手机和电脑安装 PWA。

500MB 文件通过浏览器直接上传 Supabase Storage，不经过 Vercel。系统分享目标依赖平台支持；不支持时可直接打开 Echo 粘贴或选择文件。

## Windows / macOS 桌面端

桌面工程位于 `clips-desktop/`（目录名暂时保留，产品名已经改为 Echo Desktop）。

```bash
cd clips-desktop
npm install
npm run build
npm run tauri dev
```

原生构建需要先安装 Rust 与平台对应的 Tauri 系统依赖。桌面端读取以下变量：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

桌面端检测到新剪切板文本后只显示发送确认，不会自动上传；8 秒未确认会自动忽略。离线时，已确认的文本进入本地队列，恢复网络后补发。

## 安全边界

- 匿名用户无法读取或写入业务数据。
- 所有表同时使用 RLS 与用户复合外键，避免跨账户关联。
- 附件路径必须以当前用户 ID 开头，Storage bucket 不公开。
- Web API 同时接受 Supabase Cookie 会话和桌面端 Bearer JWT。
- AI 只能生成建议和答案，不能删除、归档或直接移动消息。
- AI 没有检索到证据时必须回答“没有找到”。

## 验证

```bash
npm run lint
npm run build
cd clips-desktop && npm run build
```

建议部署前另建第二个测试账号，验证 RLS 无法跨用户读取 `notes`、`attachments`、`ai_suggestions` 和 Storage 对象。
