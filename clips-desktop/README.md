# Echo Desktop

Echo 的 Windows/macOS 桌面伴侣。目标是长期常驻、检测剪切板后询问是否发送、托盘交互、开机自启，并与 Web/PWA 共用私有 `notes` 数据流。

## 现状

- 已落下 `Tauri v2` 工程骨架
- 已接入 `Supabase Auth`
- 已实现统一 `notes` 列表读取、收藏、软删除、复制回本机剪切板
- 已实现多文件选择与 500MB TUS 可恢复直传
- 已实现本地状态、离线队列、剪切板发送确认、托盘菜单和开机自启开关

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

当前机器没有 Rust 工具链，因此已通过 TypeScript/Vite 构建，但还需安装 Rust 后执行 `npm run tauri build` 验证原生壳：

- Tauri 插件权限是否与本地版本完全匹配
- 托盘图标在三端的显示行为
- Windows 开发态通知的实际表现
