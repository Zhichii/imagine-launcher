# 贡献指南

感谢你考虑为 ImagineLauncher 做出贡献！

## 开发环境设置

1. Fork 本仓库
2. 克隆你的 Fork:
   ```bash
   git clone https://github.com/Zhichii/imagine-launcher.git
   cd ImagineLauncher
   ```

3. 安装依赖:
   ```bash
   npm install
   ```

4. 配置环境变量:
   ```bash
   cp .env.example .env
   # 编辑 .env 文件（如果需要）
   ```

5. 运行开发模式:
   ```bash
   npm start
   ```

## 提交规范

### Commit Message 格式

```
<type>(<scope>): <subject>
```

**Type:**
- `feat`: 新功能
- `fix`: 修复 Bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建/工具相关

**示例:**
```
feat(auth): 添加微软账户自动登录
fix(ui): 修复主题切换时的显示问题
docs(readme): 更新安装说明
```

## Pull Request 流程

1. 创建新分支:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. 进行修改并提交:
   ```bash
   git add .
   git commit -m "feat: 你的功能描述"
   ```

3. 推送到你的 Fork:
   ```bash
   git push origin feature/your-feature-name
   ```

4. 在 GitHub 上创建 Pull Request

## 代码规范

- 使用 2 空格缩进
- 使用有意义的变量名
- 添加必要的注释
- 保持代码简洁清晰

## 测试

在提交 PR 前，请确保:
- [ ] 代码可以正常运行
- [ ] 没有明显的 Bug
- [ ] UI 显示正常
- [ ] 功能符合预期

## 问题反馈

如果你发现 Bug 或有功能建议，请:
1. 先搜索是否已有相关 Issue
2. 如果没有，创建新 Issue
3. 清晰描述问题或建议
4. 如果是 Bug，提供复现步骤

## 许可证

提交代码即表示你同意你的贡献将以 MIT 许可证发布。
