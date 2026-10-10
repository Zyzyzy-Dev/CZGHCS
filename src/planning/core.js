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
    plannerInstruction: '你正在参与一次分阶段的协作写作。本轮由你完成当前预设要求的写作准备，随后由写作同事结合原始资料与你的规划完成正文及其他要求的成品。请沿用预设指定的身份、语言和创作方式。',
    writerInstruction: '你的规划同事已经完成了本轮写作准备，以下是供你接续使用的创作规划。请结合原始上下文、用户最新输入及当前预设，继续完成正文和预设要求的其他成品，无需重新输出规划区块。',
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
    if (saved.plannerInstruction === '按当前预设已启用条目完成其指定规划标签内的全部写作准备内容，保留原有顺序、标题、编号与子问题，区分已发生事实与本轮拟写安排。') merged.plannerInstruction = defaults.plannerInstruction;
    if (saved.plannerInstruction === "按当前预设已启用条目完成其指定规划标签内的全部写作准备内容，保留原有顺序、标题、编号、子问题及声明式要求，区分已发生事实与本轮拟写安排。") merged.plannerInstruction = defaults.plannerInstruction;
    if (saved.writerInstruction === "本轮写作规划已在下方提供。将预设中要求生成、展示或再次回答规划的问题视为已经完成，不重复输出规划区块。从规划之后的实际成品开始，按规划完成本轮回复。继续遵守原预设的人设、文风、正文、顶栏、状态栏、时间戳、摘要及其他附加内容要求：原本要求生成的照常生成，原本未要求或禁止的不要新增。规划中的拟写安排不是已发生的历史事实；与用户最新输入或已知事实冲突时以原始资料为准。") merged.writerInstruction = defaults.writerInstruction;
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
        `${settings.plannerInstruction}\n请按当前预设已启用的规划步骤及顺序完成交接，保留原有标题、层级及编号：
1. 问题式引导逐项回答；非问题式引导逐字复述原文，再在同一子项下另起“本轮安排：”说明执行方式。直接写在预设条目中的非问题式引导照录原文；涉及变量宏时使用展开后的实际文本，与是否使用宏无关。原文与安排必须分开，安排不能替代原文。一个子项同时包含指导与问题时，指导原样保留，问题另行回答。
2. 原文保留措辞、否定词、数值及标签，不概括、不改写、不替换为执行说明。安排遵循原要求的作用对象、单位、范围、强度、条件及否定关系，并参考预设已启用条目的具体定义；不自行增加硬性数值或规则。
3. 完整处理各步骤及子项，不用笼统总结替代后续步骤。条件步骤按预设条件处理；资料缺失时说明缺失，区分已发生事实与本轮拟写安排。列举、信息读取、召回、核算、例句和预写片段等明确任务仍需完成，不仅复制任务指令。
4. 预设中涉及正文与附加成品的要求，是后续写作同事需要执行的交付要求，请在相关规划步骤中准确保留。格式确认按该步骤原文指定的对象作答，不用本插件的规划外层标签替代正文成品格式。本轮交付规划，正文及其他成品由下一阶段完成；这不影响读取已有资料或完成预设要求的召回，也不影响规划内的例句、预写片段和核算。
5. 交接内容以预设指定的规划区块为范围，不复制整个预设或区块外的成品模板，不增加预设未要求的自我评价、总结、检查报告或结束宣言。
请将完整规划放入当前预设指定的标签中：${settings.openTag}规划内容${settings.closeTag}。` }];
}

export function extractPlan(text, settings, finishReason) {
    if (finishReason === 'length') throw new Error('规划被输出额度截断，请提高额度后重试。');
    if (typeof text !== 'string') throw new Error('规划 API 未返回文本。');
    // Inline code quoting an exact delimiter is documentation, not a boundary.
    // Preserve offsets and original text; do not exempt arbitrary code blocks.
    let boundaries = text;
    for (const tag of [settings.openTag, settings.closeTag]) {
        const quoted = '`' + tag + '`';
        boundaries = boundaries.split(quoted).join(' '.repeat(quoted.length));
    }
    const start = boundaries.indexOf(settings.openTag);
    const end = boundaries.indexOf(settings.closeTag, start + settings.openTag.length);
    if (start < 0 || end < 0) {
        throw new Error('未找到完整的规划标签区块；本次不注入。');
    }
    const plan = text.slice(start + settings.openTag.length, end).trim();
    const inner = boundaries.slice(start + settings.openTag.length, end);
    if (!plan || inner.includes(settings.openTag) || inner.includes(settings.closeTag)) throw new Error('规划为空或存在重复嵌套标签。');
    return plan;
}

export function writingMessages(messages, plan, settings) {
    const result = structuredClone(messages);
    const rules = parseRules(settings.rules);
    for (const message of result) {
        if (!['system', 'developer'].includes(message.role) || typeof message.content !== 'string') continue;
        for (const rule of rules) message.content = message.content.split(rule.find).join(rule.replace);
    }
    result.push({ role: 'system', content: `${settings.writerInstruction}\n将规划中的安排落实到创作中，同时继续遵守原预设的具体要求，包括声明式指导、必须项、禁止项、节奏、篇幅、比例和格式。规划属于辅助材料，不替代原始资料；规划未复述某项要求不代表该要求失效，原预设要求生成的成品照常生成，未要求或禁止的不要新增。拟写安排不应当作已经发生的事实；与用户最新输入或已知事实冲突时以原始资料为准。无需额外展示预设未要求的执行说明或检查清单。\n\n【本轮创作规划】\n${settings.openTag}\n${plan}\n${settings.closeTag}` });
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
