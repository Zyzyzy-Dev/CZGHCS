/* 模板兼容适配：冻结酒馆助手变量；可选调用已安装的 EJS 模板插件，不执行 MVU 回写。 */
export async function captureHelperVariables(snapshot, context, helper, generationType) {
    const scopes = new Set([...JSON.stringify(snapshot).matchAll(/(?:get|format)_(message|chat|character|preset|global)_variable::/gi)].map(m => m[1].toLowerCase()));
    snapshot.helperVariables = {};
    if (!scopes.size || typeof helper?.getVariables !== 'function') return;
    const chat = context.chat || [];
    let end = chat.length;
    if (generationType === 'swipe' && !chat.at(-1)?.is_user) end--;
    let messageId = -1;
    for (let i = end - 1; i >= 0; i--) if (chat[i]?.variables?.[chat[i].swipe_id ?? 0]) { messageId = i; break; }
    for (const type of scopes) {
        if (type === 'message' && messageId < 0) { snapshot.helperVariables[type] = {}; continue; }
        const options = type === 'message' ? { type, message_id: messageId } : { type };
        snapshot.helperVariables[type] = structuredClone(await helper.getVariables(options));
    }
}
export function createTemplateRenderer({ enabled, api, signal }) {
    let context;
    return async text => {
        signal?.throwIfAborted();
        if (/^\s*@@(?:if|else|end|activate|generate)\b/m.test(text)) throw Error('当前资料含有尚未适配的模板世界书激活指令（@@）。请关闭相关条目后重试；不会把指令原样发送给模型。');
        if (!enabled || !text.includes('<%')) return text;
        if (typeof api?.prepareContext !== 'function' || typeof api?.evalTemplate !== 'function') throw Error('EJS 模板兼容已开启，但未检测到 ST-Prompt-Template 公开接口。');
        context ??= await api.prepareContext();
        signal?.throwIfAborted();
        const result = String(await api.evalTemplate(text, context));
        signal?.throwIfAborted();
        return result;
    };
}
