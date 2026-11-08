# hermes2dsh 多角色研发流水线

原则：Grok Bot 只做编排与验收；**实现与大部分测试用例生成走 CodePlan（deepseek-v4.1-flash 等）**，省 Cursor token。

## 角色卡

| 角色 ID | 名称 | 职责 | 产出物 | 谁执行 |
| --- | --- | --- | --- | --- |
| R1 | **PM / 范围官** | 定版本目标、非目标、验收口令 | `dev/roadmap.md`、切片 backlog | Grok |
| R2 | **Architect** | 模块边界、数据流、错误语义、兼容 flags | `dev/ARCHITECTURE.md`、`dev/prompts/NN-*.md` 接口段 | Grok |
| R3 | **Coder** | 按切片改 `src/**` | `<<<FILE>>>` 代码块 | CodePlan |
| R4 | **Tester** | 写/扩 fixture + 断言脚本 | `test/*.mjs`、更多 `fixtures/` | CodePlan（用例）+ Grok（门禁） |
| R5 | **Reviewer** | 对照 Architect 契约审 diff：密钥、settings.yaml、CLI 兼容 | `dev/out/review-NN.md` | Grok（短）或 CodePlan |
| R6 | **Docs** | README / 迁移说明 / 中英 changelog | `README.md`、`CHANGELOG.md` | CodePlan 或 Grok |
| R7 | **Release** | 版本号、tag、npm pack、可选 GitHub push | `package.json` version、release notes | Grok（经你确认） |
| R8 | **Security** | 密钥路径、`--secrets` 默认关、日志脱敏、Weixin 重扫提醒 | checklist 勾选 | Grok |

可选后置：R9 **Plugin packager**（把 CLI 包成 `dsh plugin`）、R10 **Compat**（Hermes 版本矩阵）。

## 单切片流水线（强制顺序）

```
R1 选定切片 → R2 写/改 prompt + 验收命令
  → R3 codegen → R4 跑 test:fixture + 单测
  → R5 review → 不过则 R3 Repair 循环（最多 2 轮）
  → R8 安全勾选 → 通过则 commit
```

整版发布前：R6 文档 → R7 release（你点头）。

## 测试金字塔（hermes2dsh）

1. **Fixture preview/apply**（已有）：无 ~/.hermes、sample-hermes dry-run  
2. **单元**：memory 分段去重、skill 展平命名、conflict skip|overwrite|rename  
3. **契约**：CLI flags 帮助文本与 README 一致  
4. **安全**：默认不写出 `.env`；日志无 key  
5. **手工**：真实 `~/.hermes` → `~/.dsh` 一次（你机器）

## 当前 backlog（建议）

- ~~P0 修 skill 名带 `SKILL.md` 后缀~~  
- ~~P0 补 `test/memory-merge.mjs`、`test/skill-flatten.mjs`~~  
- ~~P1 cron full 映射说明 + 原始拷贝验收~~  
- ~~P1 Reviewer prompt 模板~~ → `dev/prompts/roles/reviewer.md` + `npm run role:review -- --slice NN`  
- ~~P2 dsh plugin 包装~~（`plugin.json` + skill + cordis bundle）  
- P2 GitHub 开源发布

## 角色怎么「定」到工具里

- 每个角色对应 `dev/prompts/roles/<role>.md` 系统提示  
- `dev/scripts/run-role.mjs --role coder|tester|reviewer --slice NN`  
- Grok 只调用 run-role，并读 exit code / report

## 你不需要做的

- 不必每个角色开一个 Bot；一个流水线脚本 + 多份 prompt 即可  
- Key 只走保险库 / Secure Form，不进 git、不进聊天
