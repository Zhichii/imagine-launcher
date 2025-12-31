# ImagineLauncher

一个 Minecraft 启动器，支持微软账户登录和离线模式。

## 特性

- 支持微软账户登录（正版验证）
- 支持离线账户
- 现代化 UI 设计
- 多语言支持（中文/英文）
- 自动提取皮肤头像
- 可自定义主题和设置

## 安装

### 前置要求

- Node.js 16+ 
- npm 或 yarn

### 安装依赖

```bash
npm install
```

### 开发模式运行

```bash
npm start
```

### 打包应用

```bash
npm run build
```

## 配置

### 使用官方 Client ID（推荐）

默认配置使用 Minecraft 官方 Client ID，无需额外配置即可使用。

### 使用自定义 Client ID

如果你想使用自己的 Azure AD 应用：

1. 复制 `.env.example` 为 `.env`
2. 在 `.env` 中填入你的配置：
   ```
   AZURE_CLIENT_ID=你的ClientID
   REDIRECT_URI=你的重定向URI
   CUSTOM_PROTOCOL=你的自定义协议
   ```

**注意**: 使用自定义 Client ID 需要向 Microsoft 申请 Minecraft Services API 访问权限。（本项目不提供自己的ClientID）

## 项目结构

```
ImagineLauncher/
├── assets/              # 资源文件
│   └── resources/       # 图标、Logo 等
├── locales/             # 多语言文件
│   ├── en-US.json
│   └── zh-CN.json
├── pages/               # 页面组件
│   ├── home_page/       # 主页
│   ├── account_page/    # 账户管理
│   ├── settings_pages/  # 设置页面
│   └── about_page/      # 关于页面
├── main.js              # Electron 主进程
├── index.html           # 主窗口
├── script.js            # 主窗口脚本
├── styles.css           # 全局样式
├── config.json          # 应用配置
└── package.json         # 项目配置
```

## 功能说明

### 账户管理

- **微软账户登录**: 支持正版 Minecraft Java 版账户
- **离线账户**: 本地游玩，无需正版验证
- **账户切换**: 支持多账户管理和快速切换
- **皮肤管理**: 自动获取和显示玩家皮肤

### 设置

- **主题自定义**: 多种预设主题和自定义颜色
- **语言切换**: 中文/英文界面
- **窗口设置**: 自定义窗口大小和圆角
- **UI 选项**: 滚动条、动画等界面选项

## 安全说明

- Client ID 等敏感信息通过环境变量管理
- 不要将 `.env` 文件提交到 Git
- 账户数据本地加密存储

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

如有问题或建议，请提交 Issue。

---

**注意**: 本项目仅供学习交流使用，请支持正版游戏。
