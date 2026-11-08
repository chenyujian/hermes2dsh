# 切片：cron full 原始拷贝 + 验收

## 允许修改
- src/plan.js（cron 段）
- src/apply.js（write-text）
- mappings/paths.yaml（cron note）
- test/cron-full.mjs
- fixtures/sample-hermes/cron/**

## 目标
1. `--preset mvp`：跳过 cron，listed 列出文件
2. `--preset full`：原样拷到 `hermes-imports/cron/`（保留嵌套），写 README 说明不自动映射 DSH schedule
3. 目标已存在时遵循 `--skill-conflict`
4. apply 真写盘可验收

## 验收
```
node test/cron-full.mjs
npm run test:fixture
node ./bin/hermes2dsh.js preview --hermes-home ./fixtures/sample-hermes --dsh-home /tmp/dsh-cron --preset full
```
