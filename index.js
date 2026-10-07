import { getRequestHeaders, stopGeneration } from '/script.js';
import { defaults, validateSettings, planningMessages, writingMessages, extractPlan, eligibleRequest, unresolvedBaiBaiMacros } from './core.js';

const ID = 'czgh_external_planner';
const ctx = () => SillyTavern.getContext();
let apiKey = ''; // Session only; never written to extension settings or logs.
let pending = null;
let statusNode;
let previewNode;
let initialized = false;
let skipOnce = false;
const processed = new WeakSet();

function settings() { return ctx().extensionSettings[ID]; }
function status(text) { if (statusNode) statusNode.textContent = text; }
function chatIdentity() {
    const c = ctx();
    return JSON.stringify([c.chatId, c.characterId, c.groupId]);
}
function abortPending() { pending?.controller.abort(); }

async function requestPlan(messages, config, key, signal) {
    // Use ST's own backend proxy, without invoking Generate or emitting chat events.
    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST', headers: getRequestHeaders(), signal,
        body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: config.apiUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''),
            custom_include_headers: key ? `Authorization: ${JSON.stringify(`Bearer ${key}`)}` : '',
            model: config.model, messages, stream: false,
            max_tokens: Number(config.maxTokens),
        }),
    });
    if (!response.ok) throw new Error(`规划 API 请求失败（HTTP ${response.status}）。`);
    const result = await response.json();
    const choice = result?.choices?.[0];
    if (result.error || !choice) throw new Error('规划 API 返回错误或不支持的格式。');
    return extractPlan(choice.message?.content, config, choice.finish_reason);
}

async function onRequest(data) {
    if (!settings().enabled || !eligibleRequest(data) || processed.has(data)) return;
    processed.add(data);
    if (skipOnce) { skipOnce = false; status('本次已跳过外置规划，使用原始预设。'); return; }
    if (pending) {
        abortPending();
        stopGeneration();
        status('检测到重叠请求，已停止；请重新发送。');
        return;
    }
    const config = structuredClone(settings());
    const original = structuredClone(data.messages);
    const run = { controller: new AbortController(), identity: chatIdentity() };
    pending = run;
    const timer = setTimeout(() => run.controller.abort(), Number(config.timeoutSeconds) * 1000);
    previewNode.value = '';
    try {
        validateSettings(config);
        if (unresolvedBaiBaiMacros(original)) throw new Error('发现尚未展开的柏宝书宏，请检查宏设置后重试。');
        status('正在生成本轮规划；完成后自动继续正文…');
        const plan = await requestPlan(planningMessages(original, config), config, apiKey, run.controller.signal);
        if (run.controller.signal.aborted || run.identity !== chatIdentity()) throw new Error('本轮已取消或聊天已切换。');
        data.messages = writingMessages(original, plan, config);
        previewNode.value = plan;
        status(`规划已注入（${plan.length} 字符），正在生成正文。`);
    } catch (error) {
        // ST's event emitter swallows thrown errors. Explicitly abort main generation.
        stopGeneration();
        status(run.controller.signal.aborted
            ? '规划已停止或超时；未注入。可重新发送，或选择下次跳过。'
            : `${error.message} 正文已停止；可重新发送或选择下次跳过。`);
    } finally {
        clearTimeout(timer);
        if (pending === run) pending = null;
    }
}

function field(parent, label, key, kind = 'text') {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:block;margin:8px 0';
    const caption = document.createElement('div');
    caption.textContent = label;
    const input = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
    input.className = 'text_pole';
    if (kind !== 'textarea') input.type = kind;
    else input.rows = 4;
    input.value = settings()[key] ?? '';
    input.addEventListener('change', () => {
        settings()[key] = kind === 'number' ? Number(input.value) : input.value;
        ctx().saveSettingsDebounced();
    });
    wrap.append(caption, input); parent.append(wrap);
    return input;
}

function init() {
    if (initialized) return;
    const c = ctx();
    const mount = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!mount) return;
    initialized = true;
    c.extensionSettings[ID] = { ...defaults, ...c.extensionSettings[ID] };
    const panel = document.createElement('details');
    panel.id = ID;
    const title = document.createElement('summary');
    title.textContent = '外置写作规划 · 0.1.0 测试版';
    panel.append(title);
    const note = document.createElement('p');
    note.textContent = '开启后，本轮完整请求内容会发送给下方配置的独立规划 API。原预设要求的状态栏等附加内容照常保留。首次使用请预留规划注入后的上下文空间。';
    panel.append(note);
    const enableLabel = document.createElement('label');
    const enable = document.createElement('input');
    enable.type = 'checkbox'; enable.checked = settings().enabled;
    enable.addEventListener('change', () => {
        settings().enabled = enable.checked; c.saveSettingsDebounced();
        if (!enable.checked && pending) { abortPending(); stopGeneration(); }
    });
    enableLabel.append(enable, '启用外置规划'); panel.append(enableLabel);
    field(panel, '规划 API 基础地址（例如 https://服务地址/v1）', 'apiUrl');
    const key = document.createElement('input');
    key.type = 'password'; key.className = 'text_pole'; key.placeholder = 'API 密钥：仅保留在当前页面，刷新后重新填写'; key.autocomplete = 'off';
    key.addEventListener('input', () => { apiKey = key.value.trim(); }); panel.append(key);
    field(panel, '规划模型名称', 'model');
    field(panel, '规划最大输出 token', 'maxTokens', 'number');
    field(panel, '超时秒数', 'timeoutSeconds', 'number');
    field(panel, '规划开始标签', 'openTag'); field(panel, '规划结束标签', 'closeTag');
    field(panel, '规划阶段引导', 'plannerInstruction', 'textarea');
    field(panel, '正文阶段引导（保留所需附加内容）', 'writerInstruction', 'textarea');
    field(panel, '高级：正文阶段精确替换规则 JSON（仅 system/developer 消息）', 'rules', 'textarea');
    const cancel = document.createElement('button'); cancel.className = 'menu_button'; cancel.textContent = '停止本轮';
    cancel.addEventListener('click', () => { if (pending) { abortPending(); stopGeneration(); } });
    const skip = document.createElement('button'); skip.className = 'menu_button'; skip.textContent = '下次跳过规划 / 撤销跳过';
    skip.addEventListener('click', () => { skipOnce = !skipOnce; status(skipOnce ? '下次正文请求将使用原始预设，不调用规划 API。' : '已撤销跳过。'); });
    statusNode = document.createElement('p'); statusNode.setAttribute('role', 'status');
    previewNode = document.createElement('textarea'); previewNode.className = 'text_pole'; previewNode.rows = 8; previewNode.readOnly = true; previewNode.placeholder = '本轮规划预览（不写入聊天历史）';
    panel.append(cancel, skip, statusNode, previewNode); mount.append(panel);
    const event = c.eventTypes.CHAT_COMPLETION_SETTINGS_READY;
    if (!event) { enable.disabled = true; settings().enabled = false; status('此酒馆版本缺少请求事件，插件未启用。'); return; }
    c.eventSource.on(event, onRequest);
    c.eventSource.on(c.eventTypes.GENERATION_STOPPED, abortPending);
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => {
        if (pending) { abortPending(); stopGeneration(); }
        skipOnce = false; previewNode.value = ''; status('已切换聊天，规划已清空。');
    });
    status('就绪。默认关闭；填写独立 API 后启用。');
}

const context = ctx();
context.eventSource.on(context.eventTypes.APP_READY, init);
init();
