export const defaults = Object.freeze({
    enabled: false,
    apiUrl: '',
    model: '',
    maxTokens: 6000,
    timeoutSeconds: 180,
    openTag: '<Abstract>',
    closeTag: '</Abstract>',
    rules: '[]',
    plannerInstruction: '按当前预设已启用的写作准备问题逐项完成本轮公开创作规划。保留主题、编号、具体依据和创作要求；区分已发生事实与本轮拟写安排。只输出规划，不生成正文、状态栏、时间戳或其他附加成品。',
    writerInstruction: '本轮写作规划已在下方提供。将预设中要求生成、展示或再次回答规划的问题视为已经完成，不重复输出规划区块。从规划之后的实际成品开始，按规划完成本轮回复。继续遵守原预设的人设、文风、正文、顶栏、状态栏、时间戳、摘要及其他附加内容要求：原本要求生成的照常生成，原本未要求或禁止的不要新增。规划中的拟写安排不是已发生的历史事实；与用户最新输入或已知事实冲突时以原始资料为准。',
});

export function validateSettings(settings) {
    const url = new URL(settings.apiUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('API 地址须为不含凭据、查询参数的 HTTP(S) 基础地址。');
    }
    if (!settings.model.trim()) throw new Error('请填写规划模型名称。');
    if (!settings.openTag.trim() || !settings.closeTag.trim() || settings.openTag === settings.closeTag) {
        throw new Error('请设置不同且非空的规划开始、结束标签。');
    }
    for (const [field, min, max] of [['maxTokens', 256, 100000], ['timeoutSeconds', 10, 1800]]) {
        if (!Number.isInteger(Number(settings[field])) || Number(settings[field]) < min || Number(settings[field]) > max) {
            throw new Error(`${field} 须为 ${min}–${max} 之间的整数。`);
        }
    }
    parseRules(settings.rules);
}

// Exact, opt-in edits to instructions only. History and user input are never rewritten.
export function parseRules(raw) {
    const rules = JSON.parse(raw || '[]');
    if (!Array.isArray(rules) || rules.some(r => !r || typeof r.find !== 'string' || !r.find || typeof r.replace !== 'string')) {
        throw new Error('适配规则须为 [{"find":"原文","replace":"替换文字"}]。');
    }
    return rules;
}

export function planningMessages(messages, settings) {
    return [...structuredClone(messages), { role: 'system', content:
        `${settings.plannerInstruction}\n结果必须仅包含一个完整区块：${settings.openTag}规划内容${settings.closeTag}。闭合标签后立即结束。` }];
}

export function extractPlan(text, settings, finishReason) {
    if (finishReason === 'length') throw new Error('规划被输出额度截断，请提高额度后重试。');
    if (typeof text !== 'string') throw new Error('规划 API 未返回文本。');
    const start = text.indexOf(settings.openTag);
    const end = text.indexOf(settings.closeTag, start + settings.openTag.length);
    if (start < 0 || end < 0 || text.slice(0, start).trim() || text.slice(end + settings.closeTag.length).trim()) {
        throw new Error('规划标签缺失，或规划之外出现额外输出；本次不注入。');
    }
    const plan = text.slice(start + settings.openTag.length, end).trim();
    if (!plan || plan.includes(settings.openTag) || plan.includes(settings.closeTag)) throw new Error('规划为空或存在重复嵌套标签。');
    return plan;
}

export function writingMessages(messages, plan, settings) {
    const result = structuredClone(messages);
    const rules = parseRules(settings.rules);
    for (const message of result) {
        if (!['system', 'developer'].includes(message.role) || typeof message.content !== 'string') continue;
        for (const rule of rules) message.content = message.content.split(rule.find).join(rule.replace);
    }
    result.push({ role: 'system', content: `${settings.writerInstruction}\n\n【本轮已完成的写作规划】\n${settings.openTag}\n${plan}\n${settings.closeTag}` });
    return result;
}

export function eligibleRequest(data) {
    return [undefined, 'normal', 'regenerate', 'swipe'].includes(data?.type)
        && Array.isArray(data?.messages) && data.messages.length > 0
        && !data.messages.some(m => m.role === 'tool' || m.tool_calls?.length);
}

export function unresolvedBaiBaiMacros(messages) {
    return /\{\{\s*bbs\w*(?:::|\s*\}\})/i.test(JSON.stringify(messages));
}
