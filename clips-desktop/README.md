# Echo Clips Desktop

一个给 `echo-app` 的 `clips` 子系统配套的轻量桌面端。目标是长期常驻、自动监听剪切板、托盘交互、开机自启，并把同步逻辑和 Web 界面解耦。

## 现状

- 已落下 `Tauri v2` 工程骨架
- 已接入 `Supabase Auth`
- 已实现 `clips` 列表读取、置顶、软删除、复制回本机剪切板
- 已实现本地 JSON 状态持久化、离线队列、轮询式剪切板监听、托盘菜单和开机自启开关

## 启动前置

1. 先补足磁盘空间，再安装 Rust 工具链
2. 在这个目录安装依赖
3. 复用主项目同一套 Supabase 环境变量

建议环境变量：

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

如果你已经在父项目里使用：

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

这个桌面端也会兼容读取它们。

## 开发

```bash
npm install
npm run tauri dev
```

## 说明

当前仓库里还没有 Rust 工具链，所以这个桌面端骨架还没在本机完成编译验证。等 Rust 装好以后，优先验证：

- Tauri 插件权限是否与本地版本完全匹配
- 托盘图标在三端的显示行为
- Windows 开发态通知的实际表现
