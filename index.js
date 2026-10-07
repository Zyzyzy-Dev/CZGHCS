import { getRequestHeaders, stopGeneration } from '/script.js';
import { migrateSettings, resolvePlanningTags, validateSettings, planningMessages, writingMessages, extractPlan, eligibleRequest, unresolvedBaiBaiMacros } from './core.js';
import { listProfiles, resolveProfile, profileRequest } from './profiles.js';

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
    let body;
    if (config.profile) {
        const yaml = SillyTavern.libs?.yaml;
        body = profileRequest(config.profile, messages, config.maxTokens, text => {
            if (yaml?.parse) return yaml.parse(text);
            return JSON.parse(text);
        });
        const keysResponse = await fetch('/api/secrets/read', { method: 'POST', headers: getRequestHeaders(), body: '{}', signal });
        if (!keysResponse.ok) throw new Error('无法核对方案密钥引用，请检查酒馆密钥管理器。');
        const keys = (await keysResponse.json()).api_key_custom;
        if (!Array.isArray(keys) || !keys.some(item => item.id === config.profile.secretId)) throw new Error('方案引用的密钥已不存在；未使用其他密钥。');
    } else {
        body = {
            chat_completion_source: 'custom',
            custom_url: config.apiUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''),
            custom_include_headers: key ? `Authorization: ${JSON.stringify(`Bearer ${key}`)}` : '',
            model: config.model, messages, stream: false, max_tokens: Number(config.maxTokens),
        };
    }
    // Use ST's own backend proxy, without invoking Generate or emitting chat events.
    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST', headers: getRequestHeaders(), signal,
        body: JSON.stringify(body),
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
        if (config.profileId) {
            config.profile = resolveProfile(ctx().extensionSettings, config.profileId);
            config.apiUrl = config.profile.connection.custom_url;
            config.model = config.profile.model;
        }
        Object.assign(config, resolvePlanningTags(original, config));
        validateSettings(config);
        if (unresolvedBaiBaiMacros(original)) throw new Error('发现尚未展开的柏宝书宏，请检查宏设置后重试。');
        status(`正在按 ${config.openTag}…${config.closeTag} 生成本轮规划；完成后自动继续正文…`);
        const plan = await requestPlan(planningMessages(original, config), config, apiKey, run.controller.signal);
        if (run.controller.signal.aborted || run.identity !== chatIdentity()) throw new Error('本轮已取消或聊天已切换。');
        data.messages = writingMessages(original, plan, config);
        previewNode.value = `${config.openTag}\n${plan}\n${config.closeTag}`;
        status(`规划已注入（${plan.length} 字符），正在生成正文。`);
    } catch (error) {
        // ST's event emitter swallows thrown errors. Explicitly abort main generation.
        const wasAborted = run.controller.signal.aborted;
        stopGeneration();
        status(wasAborted
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
    const mount = document.querySelector('#extensions_menu') || document.querySelector('#extensionsMenu');
    if (!mount) return;
    initialized = true;
    c.extensionSettings[ID] = migrateSettings(c.extensionSettings[ID]);
    const panel = document.createElement('dialog');
    panel.id = ID;
    panel.setAttribute('aria-label', '创作规划');
    const title = document.createElement('h2');
    title.textContent = '创作规划';
    const close = document.createElement('button'); close.className = 'menu_button'; close.textContent = '关闭';
    close.addEventListener('click', () => panel.close());
    panel.append(title, close);
    const menuButton = document.createElement('button');
    menuButton.id = 'czgh-planner-menu'; menuButton.type = 'button';
    menuButton.className = 'list-group-item flex-container flexGap5 interactable';
    menuButton.textContent = '✎ 创作规划';
    menuButton.addEventListener('click', () => { refreshProfiles(); if (!panel.open) panel.showModal(); });
    mount.append(menuButton);
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
    enableLabel.append(enable, '启用创作规划'); panel.append(enableLabel);
    const profileLabel = document.createElement('label'); profileLabel.textContent = '规划 API 方案（预设更新编辑器）';
    const profileSelect = document.createElement('select'); profileSelect.className = 'text_pole';
    profileSelect.id = 'czgh-profile-select'; profileLabel.append(profileSelect); panel.append(profileLabel);
    const profileInfo = document.createElement('p'); panel.append(profileInfo);
    const refresh = document.createElement('button'); refresh.className = 'menu_button'; refresh.textContent = '刷新 API 方案'; panel.append(refresh);
    const apiInput = field(panel, '手动：规划 API 基础地址（例如 https://服务地址/v1）', 'apiUrl');
    const key = document.createElement('input');
    key.type = 'password'; key.className = 'text_pole'; key.placeholder = 'API 密钥：仅保留在当前页面，刷新后重新填写'; key.autocomplete = 'off';
    key.addEventListener('input', () => { apiKey = key.value.trim(); }); panel.append(key);
    const modelInput = field(panel, '手动：规划模型名称', 'model');
    function showProfile() {
        const selected = settings().profileId;
        apiInput.disabled = key.disabled = modelInput.disabled = Boolean(selected);
        if (!selected) { profileInfo.textContent = '使用手动配置。方案模式不会切换酒馆正文 API。'; return; }
        try {
            const p = resolveProfile(c.extensionSettings, selected);
            profileInfo.textContent = `${p.name} · ${p.model} · ${p.connection.custom_url}（使用酒馆密钥引用）`;
        } catch (error) { profileInfo.textContent = error.message; }
    }
    function refreshProfiles() {
        profileSelect.replaceChildren();
        const add = (id, name) => { const option = document.createElement('option'); option.value = id; option.textContent = name; profileSelect.append(option); };
        add('', '手动配置独立 API');
        try {
            const profiles = listProfiles(c.extensionSettings);
            for (const p of profiles) add(p.id, p.name);
            if (settings().profileId && !profiles.some(p => p.id === settings().profileId)) add(settings().profileId, '所选方案已不存在，请重新选择');
            profileSelect.value = settings().profileId; showProfile();
            if (!profiles.length && !settings().profileId) profileInfo.textContent = '尚未找到已保存方案。请在预设更新编辑器中保存后刷新，也可手动填写。';
        } catch (error) { profileInfo.textContent = error.message; }
    }
    profileSelect.addEventListener('change', () => { settings().profileId = profileSelect.value; c.saveSettingsDebounced(); showProfile(); });
    refresh.addEventListener('click', refreshProfiles);
    refreshProfiles();
    field(panel, '规划最大输出 token', 'maxTokens', 'number');
    field(panel, '超时秒数', 'timeoutSeconds', 'number');
    const tagLabel = document.createElement('label');
    tagLabel.textContent = '规划标签来源';
    const tagMode = document.createElement('select');
    tagMode.className = 'text_pole';
    for (const [value, text] of [['auto', '自动跟随本轮预设'], ['manual', '手动指定（无法识别时使用）']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; tagMode.append(option);
    }
    tagMode.value = settings().tagMode;
    tagLabel.append(tagMode); panel.append(tagLabel);
    const openInput = field(panel, '手动：规划开始标签', 'openTag');
    const closeInput = field(panel, '手动：规划结束标签', 'closeTag');
    const updateTagMode = () => {
        openInput.disabled = closeInput.disabled = tagMode.value !== 'manual';
    };
    tagMode.addEventListener('change', () => { settings().tagMode = tagMode.value; c.saveSettingsDebounced(); updateTagMode(); });
    updateTagMode();
    field(panel, '规划阶段引导', 'plannerInstruction', 'textarea');
    field(panel, '正文阶段引导（保留所需附加内容）', 'writerInstruction', 'textarea');
    field(panel, '高级：正文阶段精确替换规则 JSON（仅 system/developer 消息）', 'rules', 'textarea');
    const cancel = document.createElement('button'); cancel.className = 'menu_button'; cancel.textContent = '停止本轮';
    cancel.addEventListener('click', () => { if (pending) { abortPending(); stopGeneration(); } });
    const skip = document.createElement('button'); skip.className = 'menu_button'; skip.textContent = '下次跳过规划 / 撤销跳过';
    skip.addEventListener('click', () => { skipOnce = !skipOnce; status(skipOnce ? '下次正文请求将使用原始预设，不调用规划 API。' : '已撤销跳过。'); });
    statusNode = document.createElement('p'); statusNode.setAttribute('role', 'status');
    previewNode = document.createElement('textarea'); previewNode.className = 'text_pole'; previewNode.rows = 8; previewNode.readOnly = true; previewNode.placeholder = '本轮规划预览（不写入聊天历史）';
    panel.append(cancel, skip, statusNode, previewNode); document.body.append(panel);
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
