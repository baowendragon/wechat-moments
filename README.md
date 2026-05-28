# 医生 IP 朋友圈运营工作台

一个零依赖 MVP 网站，用于运营医生微信朋友圈内容：

- 运营上传图片/视频素材
- 维护医生人设和合规禁用表达
- 根据素材、人设、客户阶段生成朋友圈文案
- 自动生成发布排期
- 咨询师每天复制文案、下载素材、标记已发布

## 本地启动

当前项目不需要安装依赖，直接运行：

```bash
node server.js
```

默认访问：

```text
http://127.0.0.1:4173
```

如果要换端口：

```bash
PORT=5188 node server.js
```

## 给团队内网使用

把这个目录放到一台团队都能访问的电脑或服务器上，然后运行：

```bash
HOST=0.0.0.0 PORT=4173 node server.js
```

同一局域网里的咨询师可访问：

```text
http://服务器内网IP:4173
```

## 部署到 Render 公网

项目已包含 `render.yaml`，可以通过 Render Blueprint 直接部署。

推荐流程：

1. 把代码推送到 GitHub 仓库。
2. 登录 Render，选择 New > Blueprint。
3. 连接这个 GitHub 仓库。
4. Render 会读取 `render.yaml`，创建 Node Web Service。
5. 部署完成后，访问 Render 提供的 `onrender.com` 公网地址。

当前 `render.yaml` 做了这些配置：

- `startCommand: node server.js`
- `HOST=0.0.0.0`
- `plan: free`
- `OPENAI_MODEL=gpt-5-mini`
- `OPENAI_API_KEY` 作为 Render Secret 环境变量
- 健康检查路径 `/healthz`

注意：免费实例没有持久化磁盘，上传素材和排期数据在服务重启或重新部署后可能丢失。正式给团队长期使用时，建议升级到支持磁盘的付费 Web Service，并设置 `DATA_DIR=/var/data`。

## 配置 OpenAI 文案生成

系统会优先调用 OpenAI Responses API 生成朋友圈文案。如果没有配置 API Key，会自动降级为本地备用模板。

在 Render 里配置：

1. 进入 `wechat-moments-ops` 服务。
2. 打开 Environment。
3. 新增或确认这些环境变量：

```text
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_MODEL=gpt-5-mini
```

4. 保存后重新部署服务。

页面“生成朋友圈”区域会显示当前 AI 状态：

- `OpenAI 已启用`：说明正在调用 OpenAI 模型。
- `当前为本地备用生成`：说明还没有配置 API Key，或服务未读取到环境变量。

## 数据位置

- 医生、人设、素材信息、排期：`data/db.json`
- 上传的图片/视频：`data/uploads/`

建议定期备份整个 `data/` 目录。

## 使用流程

1. 到“医生人设”新增医生。
2. 到“素材库”上传可发布图片/视频，并填写素材说明。
3. 到“生成文案”选择医生、素材、发布目的和客户阶段。
4. 到“排期日历”批量生成后续 7-14 天任务。
5. 咨询师每天打开“今日发布”，复制文案、下载素材、发布朋友圈后标记完成。

完整团队使用说明见：`docs/user-manual.md`

## 下一步可扩展

- 增加账号/角色权限。
- 增加朋友圈发布反馈记录。
- 增加敏感词审核、案例授权提醒和项目转化数据统计。
