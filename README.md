# ManJyun Blog

轻量自托管个人博客系统，用来替代当前目录中的旧 Ghost 部署。旧的 `manjyun-theme/` 被保留为视觉参考，新系统不依赖 Ghost。

## 本地开发

```powershell
npm install
npm run dev
```

访问：

- 公共站点：`http://localhost:3000`
- 首次设置：`http://localhost:3000/admin/setup`

## Docker 部署

```powershell
docker compose up --build
```

访问：`http://localhost:4482`

持久化目录：

- `data/`：SQLite 数据库和本地认证 secret
- `uploads/`：上传的图片、音频和附件

## 写作语法

正文唯一源格式是 Markdown。除 GFM 基础语法外，支持：

```md
[audio:标题](/uploads/audio.mp3 "可选说明")
[bookmark:标题](https://example.com "可选说明")

::callout 标题
内容
::
```

## 主题接口

默认主题是 `ManJyun Console`，位于 `src/themes/manjyun-console`。主题通过 `theme.meta`、`theme.tokens` 和 `theme.slots` 注册，后续可以新增主题目录并加入 `src/themes/index.ts`。
