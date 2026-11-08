# 切片：skill 展平命名（去掉 SKILL.md 后缀）

## 允许修改
- src/plan.js（技能 origin / id / reason）
- test/skill-flatten.mjs（可新建）
- test/memory-merge.mjs（可新建）

## 禁止
- 改 CLI flags、mappings、覆盖 settings.yaml
- 引入 npm 依赖

## 目标
1. skill 动作的 `id`、`origin`、`reason` 使用 skills 下的**目录相对路径**（如 `demo-skill`、`category/nested-demo`），**绝不**带 `SKILL.md`。
2. `flatName` 仍是直接含 SKILL.md 的目录名（展平 leaf）。
3. `--skill-conflict` skip|overwrite|rename 行为不变。

## 验收
```
node --test test/skill-flatten.mjs test/memory-merge.mjs
# 或
node test/skill-flatten.mjs && node test/memory-merge.mjs
npm run test:fixture
```
preview 冲突行应类似：`skill:demo-skill: ...`，不得出现 `demo-skill/SKILL.md`。
