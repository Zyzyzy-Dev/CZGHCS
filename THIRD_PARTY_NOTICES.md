# 第三方代码

`src/planning/native-world-scan.js` 包含来自 SillyTavern 1.18.0 的世界书缓冲、计时、扫描与分组选择实现，版权归 SillyTavern contributors 所有，使用 GNU Affero General Public License v3.0，全文见 `LICENSE-SillyTavern-AGPL-3.0.txt`。

来源：https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/world-info.js

本项目于 2026-10-07 的修改：函数封装成每次调用独立的词法作用域；宿主依赖改为显式注入；不分发酒馆全局扫描事件、不更新原生 metadata；日志关闭，随机源可注入；宏和来源在独立适配层处理。包含该模块的组合分发须遵循 AGPL-3.0，并提供对应源码。本仓库提供对应可编辑源码。
