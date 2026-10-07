/* iframe UI：渲染表单与规划预览，通过 postMessage 交换有限数据，不访问宿主 DOM/API。 */
import { CHANNEL, THEME_KEYS, acceptsMessage } from '../bridge/protocol.js';
const send = (type, payload) => parent.postMessage({ channel: CHANNEL, type, payload }, location.origin);
let settings = {}, profiles = [], mounted = false;
const controls = new Map();
const app = document.querySelector('#app');
let profileInfo, status, preview;
document.querySelector('#close').addEventListener('click', () => send('close'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') send('close'); });

function field(parentNode, key, label, type = 'text', options = []) {
    const wrap = document.createElement('label');
    const caption = document.createElement('span'); caption.textContent = label;
    const input = document.createElement(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
    if (type !== 'textarea' && type !== 'select') input.type = type;
    for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
    input.addEventListener('change', () => {
        if (key === 'apiKey') { send('key', input.value); return; }
        settings[key] = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value;
        send('settings', { [key]: settings[key] }); updateDisabled();
    });
    if (key === 'apiKey') { input.autocomplete = 'off'; input.addEventListener('input', () => send('key', input.value)); }
    wrap.append(caption, input); parentNode.append(wrap); controls.set(key, input);
    return input;
}
function action(parentNode, text, type) { const b = document.createElement('button'); b.textContent = text; b.type = 'button'; b.addEventListener('click', () => send(type)); parentNode.append(b); }
function build() {
    app.replaceChildren();
    const note = document.createElement('p'); note.textContent = '启用后，本轮上下文会发送给指定的规划 API；正文的状态栏等输出要求继续由预设决定。'; app.append(note);
    field(app, 'enabled', '启用创作规划', 'checkbox');
    field(app, 'profileId', '规划 API 方案（预设更新编辑器）', 'select');
    action(app, '刷新 API 方案', 'refresh'); profileInfo = document.createElement('p'); app.append(profileInfo);
    field(app, 'apiUrl', '手动：API 基础地址');
    field(app, 'apiKey', '手动：密钥（仅本页面内存）', 'password');
    field(app, 'model', '手动：模型名称');
    field(app, 'maxTokens', '规划最大输出 token', 'number');
    field(app, 'timeoutSeconds', '超时秒数', 'number');
    field(app, 'tagMode', '规划标签来源', 'select', [['auto', '自动跟随本轮预设'], ['manual', '手动指定']]);
    field(app, 'openTag', '手动：规划开始标签'); field(app, 'closeTag', '手动：规划结束标签');
    const advanced = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '高级引导与适配'; advanced.append(summary); app.append(advanced);
    field(advanced, 'plannerInstruction', '规划阶段引导', 'textarea'); field(advanced, 'writerInstruction', '正文阶段引导', 'textarea'); field(advanced, 'rules', '精确替换规则 JSON', 'textarea');
    const actions = document.createElement('div'); actions.className = 'actions'; app.append(actions);
    action(actions, '停止本轮', 'stop'); action(actions, '下次跳过 / 撤销跳过', 'skip');
    status = document.createElement('p'); status.setAttribute('role', 'status');
    preview = document.createElement('textarea'); preview.id = 'preview'; preview.readOnly = true; preview.setAttribute('aria-label', '本轮规划预览');
    app.append(status, preview); mounted = true;
}
function updateDisabled() {
    for (const key of ['apiUrl', 'apiKey', 'model']) controls.get(key).disabled = Boolean(settings.profileId);
    for (const key of ['openTag', 'closeTag']) controls.get(key).disabled = settings.tagMode !== 'manual';
    const p = profiles.find(p => p.id === settings.profileId);
    profileInfo.textContent = settings.profileId ? (p ? `${p.name} · ${p.model} · ${p.apiUrl}` : '所选方案已不存在，请重新选择。') : '手动配置独立 API；也可读取已保存方案。';
}
window.addEventListener('message', event => {
    if (!acceptsMessage(event, parent, location.origin)) return;
    const { type, payload } = event.data;
    if (type === 'theme') {
        for (const key of THEME_KEYS) {
            if (typeof payload?.[key] !== 'string') continue;
            if (payload[key]) document.documentElement.style.setProperty(key, payload[key]);
            else document.documentElement.style.removeProperty(key);
        }
    } else if (type === 'snapshot') {
        settings = payload.settings; profiles = payload.profiles;
        if (!mounted) build();
        const selector = controls.get('profileId'); selector.replaceChildren();
        for (const p of [{ id: '', name: '手动配置独立 API' }, ...profiles, ...(settings.profileId && !profiles.some(p => p.id === settings.profileId) ? [{ id: settings.profileId, name: '所选方案已不存在' }] : [])]) {
            const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; selector.append(option);
        }
        for (const [key, input] of controls) { if (key === 'apiKey') continue; if (input.type === 'checkbox') input.checked = settings[key]; else input.value = settings[key] ?? ''; }
        updateDisabled(); if (payload.error) profileInfo.textContent = payload.error;
        status.textContent = payload.state.status; preview.value = payload.state.preview;
    } else if (type === 'state' && mounted) { status.textContent = payload.status; preview.value = payload.preview; }
});
send('ready');
