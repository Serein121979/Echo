# Echo

Echo 是一个面向个人使用的跨设备同步消息工具，灵感来自“给自己发消息”的文件传输助手，但更强调整理能力。

它适合用来：
- 在电脑和手机之间快速同步文本
- 把临时信息先收进一个统一入口
- 通过文件夹和标签逐步整理内容
- 用自动标签做轻量分类

## 功能特性

- 跨设备同步消息
- Supabase Realtime + 轮询兜底
- 文件夹创建、切换、删除
- 标签创建、筛选、删除
- 单条消息移动到文件夹
- 单条消息手动绑定标签
- 自动标签
- 编辑消息内容
- 编辑后自动刷新自动标签
- 消息区自动滚动到底部

当前内置的自动标签规则包括：
- `链接`
- `待办`
- `代码`
- `清单`
- `长文`
- `电话`

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase

## 开源说明

这个仓库 **不包含任何可直接使用的线上数据库凭据**。

你需要自己准备一套 Supabase 项目，然后把你自己的环境变量写进本地或部署平台。

仓库中提供的是：
- [supabase/schema.sql](./supabase/schema.sql)：数据库初始化脚本
- [.env.example](./.env.example)：环境变量模板

## 安全说明

### 1. 这个仓库不会上传你的 `.env.local`

`.gitignore` 已经忽略了所有 `.env*` 文件，因此：
- 你的 `.env.local` 默认不会被提交到 GitHub
- 仓库里不应该出现真实的 Supabase URL 和 Key

### 2. 即使是 `NEXT_PUBLIC_...`，也不要直接公开你自己的项目配置

这里用的是：
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

它们虽然是前端可见的“公开变量”，但依然是 **你自己的 Supabase 项目入口**。  
如果你把自己的这一套直接放进公开仓库，而你的数据库策略又比较宽松，别人就可能直接访问你的项目数据。

所以开源时的正确做法是：
- 只提交 `.env.example`
- 不提交 `.env.local`
- 让每个使用者自己创建自己的 Supabase 项目

## 如何自己部署

下面是一套从零开始的完整流程。

### 第一步：Fork 或下载本仓库

你可以：
- Fork 到自己的 GitHub
- 或者直接 `git clone`

```bash
git clone <your-repo-url>
cd echo-app
```

### 第二步：安装依赖

```bash
npm install
```

### 第三步：创建 Supabase 项目

1. 打开 [Supabase](https://supabase.com/)
2. 新建一个项目
3. 等数据库初始化完成

### 第四步：初始化数据库

1. 打开 Supabase 项目的 `SQL Editor`
2. 复制 [supabase/schema.sql](./supabase/schema.sql) 的全部内容
3. 执行一次

这一步会创建并配置：
- `notes`
- `folders`
- `tags`
- `note_tags`

还会顺手完成：
- 为 `notes` 增加 `folder_id`
- 为 `notes` 增加 `updated_at`
- 创建默认文件夹 `收件箱`
- 配置 RLS policy
- 把相关表加入 `supabase_realtime`

### 第五步：获取你自己的 Supabase 环境变量

在 Supabase 项目后台找到：

`Project Settings -> API`

你需要这两个值：
- `Project URL`
- `anon public / publishable key`

### 第六步：创建你自己的 `.env.local`

复制 `.env.example`：

```bash
cp .env.example .env.local
```

然后把你自己的值填进去：

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_publishable_anon_key
```

### 第七步：本地启动

```bash
npm run dev
```

打开：

```bash
http://localhost:3000
```

如果你要在同一局域网下让手机访问：
- 电脑访问：`http://localhost:3000`
- 手机访问：`http://你的电脑局域网IP:3000`

## 如何部署到线上

你可以部署到任何支持 Node.js 的平台。

常见方案：
- Vercel
- Railway
- Render
- 自己的服务器

### 以 Vercel 为例

1. 把代码推到你自己的 GitHub 仓库
2. 在 Vercel 导入这个仓库
3. 在项目环境变量里填写：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. 点击部署

部署完成后，电脑和手机都可以直接访问这个线上地址，不再依赖你的本地电脑持续开机。

## 本地开发命令

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## 数据结构

当前采用的是可扩展结构，方便后续继续长功能：

- `notes`
  - 消息主体
- `folders`
  - 文件夹
- `tags`
  - 标签
- `note_tags`
  - 消息和标签的多对多关系

这能为后续这些能力留好空间：
- 搜索
- 收藏 / 归档
- 自动标签增强
- 智能分类
- AI 摘要 / AI 整理

## 常见问题

### 1. 为什么仓库里没有 `.env.local`？

因为 `.env.local` 属于本地私有配置，不应该进入版本库。  
仓库里只保留 `.env.example` 作为模板。

### 2. 我能直接用作者的 Supabase 吗？

不能，也不应该。  
开源使用者应该自己创建 Supabase 项目，并填写自己的环境变量。

### 3. 为什么我启动后一直加载中？

常见原因有：
- `.env.local` 没填
- Supabase SQL 没执行
- Supabase 表结构没初始化好
- Realtime 没接通

### 4. 自动标签是 AI 吗？

不是。  
当前版本是规则型自动标签，优点是简单、透明、成本低。

## Roadmap

- 删除消息
- 全文搜索
- 收藏 / 归档
- 自动标签规则可配置
- AI 自动分类
- AI 自动总结
- PWA 安装体验

## 贡献

欢迎提 issue、提建议、提 PR。

如果你准备参与开发，推荐从这些方向入手：
- 搜索和筛选增强
- 自动标签规则设计
- 更好的移动端体验
- PWA / 部署体验优化

## License

这个仓库开源前，建议补一个 `LICENSE` 文件。

常见选择：
- `MIT`
- `Apache-2.0`
- `GPL-3.0`

如果你愿意，我下一步可以直接帮你补一个 `MIT LICENSE`。 
