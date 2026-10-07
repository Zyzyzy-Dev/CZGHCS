/* 酒馆主页面适配：魔法棒入口、iframe 容器、主题白名单与消息桥；不加载 UI 样式。 */
import { getRequestHeaders, stopGeneration } from '/script.js';
import { createPlanner } from './planner.js';
import { listProfiles } from '../planning/profiles.js';
import { CHANNEL, acceptsMessage, cleanSettings, themeSnapshot } from '../bridge/protocol.js';

const ID = 'czgh_external_planner';
const ctx = () => SillyTavern.getContext();
let initialized = false;
function init() {
    if (initialized) return;
    const menu = document.querySelector('#extensions_menu') || document.querySelector('#extensionsMenu');
    if (!menu) return;
    initialized = true;
    const dialog = document.createElement('dialog');
    dialog.id = 'czgh-planner-container';
    dialog.setAttribute('aria-label', '创作规划');
    // Only geometry/reset on the host. No stylesheet or theme rules are injected here.
    for (const [key, value] of Object.entries({ padding: '0', margin: 'auto', border: '0', background: 'transparent', width: 'min(800px, 96vw)', height: 'min(900px, 92dvh)', 'max-width': '96vw', 'max-height': '92dvh', overflow: 'hidden', 'box-shadow': 'none', transform: 'none' })) dialog.style.setProperty(key, value, 'important');
    const frame = document.createElement('iframe');
    frame.title = '创作规划';
    frame.src = new URL('../ui/index.html', import.meta.url).href;
    frame.style.cssText = 'display:block!important;width:100%!important;height:100%!important;border:0!important;margin:0!important;padding:0!important;background:transparent!important;';
    dialog.append(frame); document.body.append(dialog);
    const send = (type, payload) => frame.contentWindow?.postMessage({ channel: CHANNEL, type, payload }, location.origin);
    const planner = createPlanner({ getContext: ctx, getRequestHeaders, stopGeneration, getYaml: () => SillyTavern.libs?.yaml, onState: state => send('state', state) });
    function sync() {
        let profiles = [], error = '';
        try { profiles = listProfiles(ctx().extensionSettings); } catch (e) { error = e.message; }
        send('snapshot', { settings: cleanSettings(ctx().extensionSettings[ID]), profiles, error, state: planner.getState() });
        send('theme', themeSnapshot(getComputedStyle(document.body)));
    }
    window.addEventListener('message', event => {
        if (!acceptsMessage(event, frame.contentWindow, location.origin)) return;
        const { type, payload } = event.data;
        if (type === 'ready' || type === 'refresh') sync();
        else if (type === 'settings') {
            Object.assign(ctx().extensionSettings[ID], cleanSettings(payload));
            ctx().saveSettingsDebounced(); planner.settingsChanged();
        } else if (type === 'key' && typeof payload === 'string') planner.setKey(payload);
        else if (type === 'stop') planner.stop();
        else if (type === 'skip') planner.skip();
        else if (type === 'close') dialog.close();
    });
    const button = document.createElement('button');
    button.id = 'czgh-planner-menu'; button.type = 'button';
    button.className = 'list-group-item flex-container flexGap5 interactable'; button.textContent = '✎ 创作规划';
    button.addEventListener('click', () => { if (!dialog.open) dialog.showModal(); sync(); });
    menu.append(button);
    // Sample only the five allowed tokens while open; also catches stylesheet-driven theme changes.
    let previousTheme = '';
    setInterval(() => {
        if (!dialog.open) return;
        const theme = themeSnapshot(getComputedStyle(document.body));
        const serialized = JSON.stringify(theme);
        if (serialized !== previousTheme) { previousTheme = serialized; send('theme', theme); }
    }, 800);
}
ctx().eventSource.on(ctx().eventTypes.APP_READY, init);
init();
