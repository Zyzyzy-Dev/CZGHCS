/* 主页面规划控制器：调用独立 API、监听生成、维护取消状态；不操作 UI DOM。 */
import { createId } from '../bridge/id.js?v=0.4.0-dev.6';
import { migrateSettings, resolvePlanningTags, validateSettings, planningMessages, writingMessages, extractPlan, eligibleRequest, unresolvedBaiBaiMacros } from '../planning/core.js?v=0.4.0-dev.6';
import { resolveProfile, profileRequest } from '../planning/profiles.js?v=0.4.0-dev.6';
export function createPlanner({ getContext, getRequestHeaders, stopGeneration, getYaml = () => null, onState = () => {}, prepare, onPlanReady = () => {}, onDiscard = () => {} }) {
const state = {status: '', preview: ''};
const ID = 'czgh_external_planner';
const ctx = getContext;
let apiKey = ''; // Session only; never written to extension settings or logs.
let pending = null;
const statusNode = { set textContent(value) { state.status = value; onState({ ...state }); } };
const previewNode = { set value(value) { state.preview = value; onState({ ...state }); } };

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
    if (config.request) {
        body = { ...structuredClone(config.request), messages, stream: false, max_tokens: Number(config.maxTokens) };
        delete body.tools; delete body.tool_choice; delete body.functions; delete body.function_call;
    } else if (config.profile) {
        const yaml = getYaml();
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
    const run = { controller: new AbortController(), identity: chatIdentity(), requestId: createId() };
    pending = run;
    const timer = setTimeout(() => run.controller.abort(), Number(config.timeoutSeconds) * 1000);
    previewNode.value = '';
    try {
        let contextMessages = original;
        let prepared;
        if (prepare) {
            prepared = await prepare({ data: structuredClone(data), config, signal: run.controller.signal });
            contextMessages = prepared.messages;
            config.request = prepared.request;
            config.profile = prepared.profile;
            config.apiUrl = prepared.apiUrl || prepared.request?.custom_url || prepared.profile?.connection?.custom_url || 'https://api.openai.com/v1';
            config.model = prepared.request?.model || prepared.profile?.model || prepared.model || config.model;
        } else if (config.profileId) {
            config.profile = resolveProfile(ctx().extensionSettings, config.profileId);
            config.apiUrl = config.profile.connection.custom_url;
            config.model = config.profile.model;
        }
        Object.assign(config, resolvePlanningTags(contextMessages, config));
        validateSettings(config);
        if (unresolvedBaiBaiMacros(contextMessages)) throw new Error('发现尚未展开的柏宝书宏，请检查宏设置后重试。');
        status(`正在按 ${config.openTag}…${config.closeTag} 生成本轮规划；完成后自动继续正文…`);
        const plan = await requestPlan(planningMessages(contextMessages, config), config, apiKey, run.controller.signal);
        if (run.controller.signal.aborted || run.identity !== chatIdentity()) throw new Error('本轮已取消或聊天已切换。');
        // Independent mode may not rewrite any original instruction via legacy replacement rules.
        data.messages = writingMessages(original, plan, prepare ? { ...config, rules: '[]' } : config);
        onPlanReady({ version: 1, requestId: run.requestId, chatId: run.identity, text: plan, openTag: config.openTag, closeTag: config.closeTag, createdAt: Date.now(), generationType: data.type || 'normal', expectedMessageId: data.type === 'swipe' ? (ctx().chat?.length || 1) - 1 : (ctx().chat?.length || 0), nextWorldState: prepared?.nextWorldState });
        previewNode.value = `${config.openTag}\n${plan}\n${config.closeTag}`;
        status(`规划已注入（${plan.length} 字符），正在生成正文。`);
    } catch (error) {
        // ST's event emitter swallows thrown errors. Explicitly abort main generation.
        const wasAborted = run.controller.signal.aborted;
        onDiscard(run.requestId);
        stopGeneration();
        status(wasAborted
            ? '规划已停止或超时；未注入。可重新发送，或选择下次跳过。'
            : `${error.message} 正文已停止；可重新发送或选择下次跳过。`);
    } finally {
        clearTimeout(timer);
        if (pending === run) pending = null;
    }
}


const c = ctx();
c.extensionSettings[ID] = migrateSettings(c.extensionSettings[ID]);
const event = c.eventTypes.CHAT_COMPLETION_SETTINGS_READY;
if (event) c.eventSource.on(event, onRequest);
else { settings().enabled = false; status('当前酒馆缺少请求事件，插件未启用。'); }
c.eventSource.on(c.eventTypes.GENERATION_STOPPED, abortPending);
c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => {
 if (pending) { abortPending(); stopGeneration(); }
 skipOnce = false; previewNode.value = ''; status('已切换聊天，规划已清空。');
});
return {
 getState: () => ({...state}),
 setKey: value => { apiKey = value.trim(); },
 stop: () => { if (pending) { abortPending(); stopGeneration(); } },
 settingsChanged: () => { if (!settings().enabled && pending) { abortPending(); stopGeneration(); } },
 skip: () => { skipOnce = !skipOnce; status(skipOnce ? '下次正文请求将跳过规划。' : '已撤销跳过。'); },
};
}
