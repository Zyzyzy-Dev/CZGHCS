# 创作规划 0.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按用户三张界面图实现独立 API、预设和世界书方案，以及可折叠楼内规划展示。

**Architecture:** 宿主负责酒馆读取、密钥引用、请求与消息绑定，iframe 只负责界面。以冻结的来源快照构建规划请求，使用私有预设覆盖、世界书扫描状态与宏环境；正文请求保留原配置，仅追加经校验的规划。

**Tech Stack:** 原生 JavaScript ES modules、HTML/CSS、postMessage、Node test runner；SillyTavern 1.18.0；现有 Playwright 浏览器回归脚本。

**Spec:** `docs/design/0.4.0-design.md`（用户已确认；实施前与本计划一同阅读）。

## Global Constraints

- 插件名“创作规划”，设置命名空间 `czgh_external_planner`，不引入 Jev 或新的运行时依赖。
- 不得通过短暂切换原生预设、世界书、当前 API 或活动密钥来实现独立选择。
- 五项主题白名单：`--SmartThemeBorderColor`、`--SmartThemeBlurTintColor`、`--SmartThemeBodyColor`、`--mainFontFamily`、`--monoFontFamily`。
- 功能文件位于 `src`，所有文件开头注明作用；JS 使用 import/export；测试只放 `tests`，不进入插件加载链。
- 世界书开启表示参与原生语义扫描，不能等同于直接发送全部条目。兼容插件只读取其本轮注入，不额外触发生成。
- 规划标签跟随规划预设；保留失败停止、取消、重生成和独立密钥引用。
- 方案不得回写预设更新编辑器、原生预设或世界书；楼内展示不得修改消息 `mes`。
- 私人预设、聊天和密钥不进入提交。开发仅在 CZGHCS 验证，未获正式发布指令不更新 CZGH。

## Review Focus

1. 来源在打开面板后被删除/更新：按稳定 ID 匹配，报告失效覆盖，不误套同名条目（任务 1、3）。
2. 取消后旧请求才返回、生成期间切聊天：丢弃旧结果，不注入或绑定到新聊天（任务 5、6）。
3. 未勾选插件仍被宏引用：不能绕过开关或修改共享宏变量（任务 2）。
4. 世界书重复挂载、递归与粘滞叠加：去重且只更新规划侧私有状态（任务 4）。
5. API 保存失败或恶意消息/模型文本：不丢旧方案、不泄露密钥、不执行 HTML（任务 1、6、7）。

## 文件与数据契约

保留 `index.js` 薄入口和 `src/host/index.js` 宿主入口。下列新增模块各自承担一个职责：

| 文件 | 职责 |
| --- | --- |
| `src/planning/schemes.js` | 三类本地方案、迁移、稳定 ID 覆盖 |
| `src/host/sources.js` | 读取酒馆 1.18.0 来源快照与能力信息 |
| `src/planning/compatibility.js` | 柏宝书/构画注入适配器注册表 |
| `src/planning/macros.js` | 隔离宏环境和插件宏依赖 |
| `src/planning/presets.js` | 预设执行顺序、分组与本地开关 |
| `src/planning/world-info.js` | 私有世界书扫描及状态 |
| `src/planning/context.js` | 由来源快照组装独立规划 messages |
| `src/host/api-schemes.js` | 当前连接/外部只读/自有方案及密钥存储 |
| `src/host/message-plans.js` | 每消息、每 swipe 的规划持久化与渲染绑定 |
| `src/ui/views.js`、`src/ui/components.js` | 三页布局、详情、选择器、图标控件 |
| `src/ui/message.html`、`src/ui/message.js`、`src/ui/message.css` | 楼内独立 iframe 文本展示 |

修改 `src/host/planner.js`、`src/planning/core.js`、`src/planning/profiles.js` 接入新流程；修改 `src/bridge/protocol.js` 和现有 UI 三文件承载界面状态与命令。测试名在各任务列出。

使用 JSDoc 记录以下共享类型（定义置于 `schemes.js`/`sources.js`，避免引入编译步骤）：
- `Message = {role:string, content:string|Array}`，保留原历史多模态内容。
- `Overrides = Record<string, boolean>`；预设键为 identifier，世界书键为书名与 uid 的无歧义组合。
- `Scheme = {id,name,kind:'api'|'preset'|'world',payload,updatedAt}`；API payload 只含密钥引用，不含明文。
- `Selection = {presetId,promptOverrides,groupOverrides,bookOverrides,entryOverrides,extraBooks,compatibilityIds}`。
- `Snapshot = {id,chatId,character,history,userInput,presets,books,bindings,injections,macroEnvironment,capabilities}`；宿主归一化，深拷贝并冻结，不含 API 密钥。
- `ScanResult = {entries,nextState,diagnostics}`；`ContextResult = {messages,sourceManifest,diagnostics,nextWorldState}`。
- `PlanRecord = {version:1,requestId,chatId,swipeId,text,openTag,closeTag,createdAt,bodyFingerprint}`。
- RPC 请求 `{channel,type:'request',requestId,method,payload}`；回复 `{channel,type:'response',requestId,ok,result?,error?}`。同源和 source 校验沿用；密钥仅在保存请求中单向传递，状态回包仅 `hasKey`/引用。

## Task 1：方案持久化与 API 隔离

**Files:** 新建 `src/planning/schemes.js`、`src/host/api-schemes.js`、`tests/schemes.test.js`、`tests/api-schemes.test.js`；修改 `src/planning/profiles.js`、`src/planning/core.js`。

**Interfaces:** `migrateSchemes(settings)` 返回迁移后的设置副本；`applySchemeOperation(state,{kind,operation,id,name,payload})` 返回新状态。`createApiSchemes(host)` 返回 `list()`、`save({id?,name,config,key?})`、`remove(id)`、`resolve(selection)`、`models(config)`；所有宿主 I/O 注入，resolve 返回请求配置，绝不写全局活动连接。

- [ ] 编写测试：迁移旧手动配置；外部方案覆盖/删除抛错；本地 CRUD 不改输入对象；存储失败后旧状态相等；普通设置中不存在明文 key；引用丢失有明确错误。
- [ ] 运行 `node --test tests/schemes.test.js tests/api-schemes.test.js`，确认缺失实现导致失败。
- [ ] 核对固定版本 secrets 与当前连接请求路径，在 `docs/design/0.4.0-compatibility.md` 记录来源/许可/能力；实现上述接口。新密钥必须证实可以非活动方式存储；若不具备此能力，停止该保存路径并报告限制，不采用切换再恢复。
- [ ] 重跑该两测试及 `tests/profiles.test.js`，预期全部通过，原活动 secret 和外部 profiles 深比较不变。
- [ ] 仅暂存本任务源码、测试和兼容记录，提交 `feat: isolate creative planning schemes and API profiles`。

## Task 2：来源快照、插件兼容与宏隔离

**Files:** 新建 `src/host/sources.js`、`src/planning/compatibility.js`、`src/planning/macros.js`、`tests/sources.test.js`、`tests/macros.test.js`；更新兼容记录。

**Interfaces:** `captureSources(host,{signal}) -> Promise<Snapshot>`；`selectInjections(snapshot,compatibilityIds) -> {items,diagnostics}`；`expandMacros(text,{snapshot,compatibilityIds,variables}) -> {text,variables,diagnostics}`。variables 为私有副本；无法安全展开的宏返回阻断诊断。

- [ ] 编写测试：冻结副本与宿主引用分离；柏宝书五类已知 slot 去重；构画只收实际已注入 slot；未勾选资料不进入结果；未勾选插件宏不能绕过过滤；变量写入不会影响宿主。
- [ ] 运行 `node --test tests/sources.test.js tests/macros.test.js`，预期先失败。
- [ ] 对照 1.18.0 来源组装时序和两插件源码核对完整 slot/宏集合，实现接口与注册表。不能从已混合的最终字符串删内容来恢复来源；不调用插件生成方法。记录未支持宏及阻断原因。
- [ ] 重跑测试，验证内容、role、position、depth 保留，以及取消中断快照读取。
- [ ] 提交 `feat: capture isolated sources and compatible plugin injections`。

## Task 3：独立预设选择与柏宝箱分组

**Files:** 新建 `src/planning/presets.js`、`tests/presets.test.js`。

**Interfaces:** `resolvePreset(snapshot,selection) -> {execution,groups,diagnostics}`；execution 保留 prompt_order 的顺序、marker 与位置语义；groups 为 UI 投影，不反向决定执行顺序。

- [ ] 编写测试：prompts 数组乱序时执行仍跟随 prompt_order；读取 `extensions.baibaiToolkit.presetPromptGroups`；组禁用和条目覆盖组合正确；无组条目不丢失；ID 删除/重建不套用同名覆盖；原预设对象不变。
- [ ] 运行 `node --test tests/presets.test.js`，预期先失败。
- [ ] 实现 resolvePreset，区分视觉组顺序与执行顺序，返回条目只读正文及组的全选/部分选中状态；使用任务 1 的本地方案存储。
- [ ] 重跑测试，预期全部通过。
- [ ] 提交 `feat: add independent preset switches and native groups`。

## Task 4：世界书的私有扫描

**Files:** 新建 `src/planning/world-info.js`、`tests/world-info.test.js`、`tests/fixtures/world-info-cases.js`；更新兼容记录。

**Interfaces:** `scanWorldInfo({snapshot,selection,previousState,tokenize,random,now}) -> Promise<ScanResult>`；外部 token 计算注入，随机源与时间可确定；nextState 仅用于当前聊天的规划侧状态。

- [ ] 写入常驻、主次关键词/选择逻辑、未命中、递归、概率边界、深度/位置、预算、冷却/粘滞用例；加入同书多来源挂载去重和本地开关覆盖断言。
- [ ] 运行 `node --test tests/world-info.test.js`，预期先失败。
- [ ] 核对 1.18.0 扫描实现，优先抽取可隔离的纯逻辑，记录所需状态/许可和行为差异；实现接口，不修改原书 disable 或原生计时状态。无法等价支持的字段须阻断受影响生成并具体提示，不能静默忽略。
- [ ] 运行确定性用例，并在兼容宿主中对照原生扫描结果；验证 planning nextState 变化而 native state 深比较不变。
- [ ] 提交 `feat: scan selected world books with private state`。

## Task 5：接入完整规划请求生命周期

**Files:** 新建 `src/planning/context.js`、`tests/context.test.js`；修改 `src/host/planner.js`、`src/planning/core.js`、`tests/runtime.test.js`。

**Interfaces:** `buildPlanningContext({snapshot,selection,worldState,tokenize,random,now}) -> Promise<ContextResult>`；planner 增加 `onPlanReady(record)` 回调，将已验证结果交给任务 6；生成 requestId 与 chatId 联合校验过期结果。

- [ ] 写测试捕获独立请求：仅选中预设/书/插件进入规划；角色、用户输入、历史及多模态保留；正文原请求保持相等前缀，仅追加规划与引导；标签取规划预设；取消/切聊天/迟到响应不触发 onPlanReady。
- [ ] 运行 `node --test tests/context.test.js tests/runtime.test.js`，预期新增用例失败。
- [ ] 使用任务 2–4 组装消息，按角色/位置/深度处理 marker 和资料；调用任务 1 的 API resolve。阻断诊断在网络请求前显示并停止正文生成；规划成功后提交私有扫描状态，失败不写入。
- [ ] 运行上述测试与 `tests/core.test.js`，预期通过；检查继续/quiet/工具轮次仍遵循已有过滤策略。
- [ ] 提交 `feat: build planning requests from independent source selections`。

## Task 6：每楼层、每 swipe 的规划显示

**Files:** 新建 `src/host/message-plans.js`、`src/ui/message.html`、`src/ui/message.js`、`src/ui/message.css`、`tests/message-plans.test.js`；修改宿主入口。

**Interfaces:** `createMessagePlans(host)` 返回 `stage(record)`、`bind({requestId,messageId,swipeId})`、`render()`、`discard(requestId)`、`dispose()`；存入 `message.extra.czghCreativePlanning`，内部按 swipe 保存 PlanRecord。

- [ ] 写测试：只有成功正文绑定；失败/取消不会显示上次规划；swipe 切换与刷新恢复对应记录；编辑后 bodyFingerprint 失配标记历史；关闭显示后数据仍在；mes 与随后生成历史不变。
- [ ] 运行 `node --test tests/message-plans.test.js`，预期先失败。
- [ ] 核对实际完成/滑动/编辑事件后实现绑定、持久化与卸载清理；iframe 用文本节点呈现规划，默认折叠，五项主题同步；不把模型文本插入 srcdoc 或 innerHTML。
- [ ] 重跑测试并加入 `<script>`/事件属性文本断言，预期只显示文字。
- [ ] 提交 `feat: render persistent planning panels per message swipe`。

## Task 7：三页界面、交互与 RPC

**Files:** 新建 `src/ui/views.js`、`src/ui/components.js`、`tests/bridge.test.js`；修改现有 UI 三文件、宿主入口、通信协议、`tests/browser-check.mjs`、`tests/isolation.test.js`。

**Interfaces:** RPC method 白名单为 `state.read`、`settings.update`、`api.save`、`api.remove`、`api.models`、`scheme.save`、`scheme.remove`、`selection.update`、`sources.refresh`、`planner.cancel`、`ui.close`。payload 在宿主逐项校验；UI 不直接读 parent DOM 或调用 ST。

- [ ] 增加失败测试：伪造来源/未知方法拒绝；密钥不出现在 state.read；图标按钮可键盘触达；三页切换、条目详情、添加世界书搜索、方案命名及删除确认能操作；外部方案不可覆盖删除。
- [ ] 运行 `node --test tests/bridge.test.js tests/isolation.test.js` 与浏览器脚本，确认新增断言先失败。
- [ ] 依照 p1/p2/p3 实现淡蓝紧凑卡片、设置返回、预设/世界书标签、独立明暗切换；兼容复选框分记忆/剧情两类；三类世界书及聊天专属来源明确呈现；控件接入任务 1–6，保留现有生成状态/取消入口。
- [ ] 浏览器检查宽屏和 390px 窄屏，截图后实际查看；验证恶意宿主 CSS 双向隔离、主题白名单、详情长文本、加载失败/空数据/方案删除状态以及楼内 iframe。
- [ ] 提交 `feat: redesign creative planning interface and controls`。

## Task 8：集成验收与测试仓库交付

**Files:** 修改 `README.md`、`tests/README.md`、`manifest.json`、`package.json`；补充 `tests/runtime.test.js`、`tests/browser-check.mjs` 真实缺口；更新兼容记录。

**Interfaces:** 安装入口不变；manifest 与 package 同步版本 `0.4.0`；迁移仍保留 `czgh_external_planner`。

- [ ] 对照已确认设计逐项记录验收结果；若发现集成缺口，先添加对应失败回归用例，再修实现。
- [ ] 在仓库运行 `npm test`、`npm run check`；扩大 check 到全部 src JS，要求全部通过。
- [ ] 设置 `PLAYWRIGHT_MODULE_PATH` 为本机已有 playwright 包、`BROWSER_EXECUTABLE` 为 Edge 后运行 `node tests/browser-check.mjs`；验证截图与交互，要求通过。
- [ ] 在可用的酒馆 1.18.0 环境对比规划/正文真实请求，检查活动连接、密钥、预设/世界书开关前后不变；无实机环境时明确列为未验证，不以 mock 测试代替实机结论。
- [ ] 完成独立代码审查并修复阻断问题；更新 README 功能、升级方式、明确的能力限制与测试证据，版本同步后提交。
- [ ] 检查 diff、工作区及敏感数据；仅推送已验证提交到 CZGHCS，报告提交号与实机待测点，保留 CZGH 不变。

## 自检记录

已覆盖三页视觉、三类方案、插件复选框与宏路径、原生世界书触发语义、柏宝箱分组、楼内独立展示和不污染正文。五项 Review Focus 均对应测试任务；接口按快照→选择→扫描/解析→请求→消息绑定顺序依赖。此文件是实施计划，尚不代表 0.4.0 已实现或测试通过。
