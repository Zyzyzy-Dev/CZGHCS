/* 规划标签识别、提示构建、结果校验和配置迁移。 */
export const defaults = Object.freeze({
    enabled: false,
    stream: false,
    templateCompat: false,
    apiUrl: '',
    model: '',
    profileId: '',
    maxTokens: 6000,
    timeoutSeconds: 180,
    tagMode: 'auto',
    openTag: '',
    closeTag: '',
    rules: '[]',
    plannerInstruction: '按当前预设已启用条目完成其指定规划标签内的全部写作准备内容，保留原有顺序、标题、编号与子问题，区分已发生事实与本轮拟写安排。',
    writerInstruction: '本轮写作规划已在下方提供。将预设中要求生成、展示或再次回答规划的问题视为已经完成，不重复输出规划区块。从规划之后的实际成品开始，按规划完成本轮回复。继续遵守原预设的人设、文风、正文、顶栏、状态栏、时间戳、摘要及其他附加内容要求：原本要求生成的照常生成，原本未要求或禁止的不要新增。规划中的拟写安排不是已发生的历史事实；与用户最新输入或已知事实冲突时以原始资料为准。',
});

// Conservative recognition of explicit format instructions, not past assistant output.
// Ambiguous/unsupported layouts require a manual override; never silently guess Abstract.
export function resolvePlanningTags(messages, settings) {
    if (settings.tagMode === 'manual') return { openTag: settings.openTag, closeTag: settings.closeTag };
    const candidates = new Map();
    const cue = /思维链|写作准备|创作准备|规划|思考|推演|reasoning|planning|thinking/i;
    const forbidden = /^(?:content|body|status.*|bbs_.*|details|summary|div|span|p|script|style|system|user|assistant)$/i;
    for (const message of messages) {
        if (!['system', 'developer'].includes(message.role) || typeof message.content !== 'string') continue;
        const lines = message.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const tokens = [...line.matchAll(/<(\/?)([\p{L}_][\p{L}\p{N}_.:-]*)\s*>/gu)];
            for (let j = 0; j < tokens.length; j++) {
                const token = tokens[j];
                const name = token[2];
                if (forbidden.test(name)) continue;
                const before = line.slice(Math.max(0, token.index - 90), token.index);
                const after = line.slice(token.index + token[0].length, tokens[j + 1]?.index ?? token.index + token[0].length + 70);
                const previous = lines[i - 1] || '';
                // Never interpret an explicit ban, a legacy alternative or quoted negative example as selection.
                if (/(?:不要|不得|禁止|不使用|不再|而非|不是|旧版|旧标签|错误示例|do not|don't|instead of)[^。；;\n]*$/i.test(before)) continue;
                const close = tokens[j + 1];
                const enclosesCue = !token[1] && close?.[1] === '/' && close[2] === name && cue.test(after);
                const directive = cue.test(before) && /标签|包裹|放在|输出|关闭|格式|使用|tag|wrap|output|close/i.test(before);
                const standalone = tokens.length === 1 && line.trim() === token[0] && cue.test(previous) && /标签|输出|使用|tag|output/i.test(previous);
                if (enclosesCue || directive || standalone) {
                    candidates.set(name, { openTag: `<${name}>`, closeTag: `</${name}>` });
                }
            }
        }
    }
    if (candidates.size === 1) return [...candidates.values()][0];
    if (candidates.size > 1) throw new Error(`预设中有多个可能的规划标签：${[...candidates.keys()].join('、')}。请在扩展中手动指定本轮预设使用的标签。`);
    throw new Error('未能从已生效指令中明确识别规划标签。请在扩展中选择手动指定；不会使用固定默认标签。');
}

export function migrateSettings(saved = {}) {
    const merged = { ...defaults, ...saved };
    if (saved.plannerInstruction === '按当前预设已启用的写作准备问题逐项完成本轮公开创作规划。保留主题、编号、具体依据和创作要求；区分已发生事实与本轮拟写安排。只输出规划，不生成正文、状态栏、时间戳或其他附加成品。') merged.plannerInstruction = defaults.plannerInstruction;
    if (!saved.tagMode) {
        // Preserve an explicit non-default override from 0.1.0; migrate its default to auto.
        merged.tagMode = saved.openTag && saved.closeTag
            && (saved.openTag !== '<Abstract>' || saved.closeTag !== '</Abstract>') ? 'manual' : 'auto';
        if (merged.tagMode === 'auto') { merged.openTag = ''; merged.closeTag = ''; }
    }
    return merged;
}

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
        `${settings.plannerInstruction}\n输出范围以预设指定的规划区块为准：逐项回答已启用步骤及子问题，不得省略、合并或用总括性结论代替后续步骤。条件不成立时只按预设要求跳过；资料缺失时说明缺失，不编造事实。包括预设要求的信息读取、召回、核算、例句、预写片段和格式确认。读取本次上下文中的已有资料，与生成新的成品分别处理；不得因本阶段仅输出规划而跳过资料读取或召回。不得新增预设未要求的自我评价、总结、检查报告或结束宣言。\n结果必须仅包含一个完整区块：${settings.openTag}规划内容${settings.closeTag}。闭合标签后立即结束。` }];
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
