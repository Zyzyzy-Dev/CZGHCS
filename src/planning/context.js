/* 独立规划消息组装：预设标记、私有宏、世界书扫描和指定插件的注入位置。 */
import { resolvePreset } from './presets.js?v=0.4.0-dev.12';
import { scanWorldInfo } from './world-info.js?v=0.4.0-dev.12';
import { expandMacros } from './macros.js?v=0.4.0-dev.12';
import { selectInjections } from './compatibility.js?v=0.4.0-dev.12';
const roles = ['system', 'user', 'assistant'];
export async function buildPlanningContext({ snapshot, selection, worldState = {}, tokenize, random = Math.random }) {
    if (snapshot.capabilities?.groupChat) throw new Error('当前独立上下文暂未验证群聊角色轮换，请在单角色聊天中使用。');
    if (snapshot.capabilities?.media) throw new Error('当前聊天包含附件，尚未实现附件的独立来源组装；正文已停止以避免丢失附件。');
    const preset = resolvePreset(snapshot, selection);
    const scan = await scanWorldInfo({ snapshot, selection, previousState: worldState, tokenize, random });
    const injected = selectInjections(snapshot, selection.compatibilityIds);
    const diagnostics = [...preset.diagnostics, ...scan.diagnostics, ...injected.diagnostics];
    let variables = scan.variables;
    const expand = text => { const r = expandMacros(text, { snapshot, compatibilityIds: selection.compatibilityIds, variables }); variables = r.variables; diagnostics.push(...r.diagnostics); return r.text; };
    const c = snapshot.character || {};
    const fields = { charDescription: c.description || c.data?.description || '', charPersonality: c.personality || c.data?.personality || '', scenario: c.scenario || c.data?.scenario || '', personaDescription: snapshot.macroEnvironment.persona || '', worldInfoBefore: scan.native.worldInfoBefore, worldInfoAfter: scan.native.worldInfoAfter };
    const history = snapshot.history.map(m => ({ role: m.role, content: structuredClone(m.content) }));
    const depthItems = [], start = [], end = [], messages = [];
    for (const item of injected.items) {
        const message = { role: roles[item.role ?? 0] || 'system', content: expand(item.value) };
        if (item.position === 1) depthItems.push({ depth: Number(item.depth) || 0, message });
        else if (item.position === 2) start.push(message);
        else if (item.position === 0) end.push(message);
    }
    for (const item of scan.native.WIDepthEntries) depthItems.push({ depth: item.depth ?? 4, message: { role: roles[item.role ?? 0] || 'system', content: item.entries.join('\n') } });
    if (scan.native.ANBeforeEntries.length || scan.native.ANAfterEntries.length || scan.native.EMEntries.length || Object.keys(scan.native.outletEntries).length) throw new Error('选中世界书使用作者注释、示例或 outlet 位置，尚未验证这些位置的隔离组装，请先关闭对应条目。');
    let usedHistory = false;
    for (const entry of preset.execution) {
        if (entry.identifier === 'chatHistory') { messages.push(...history); usedHistory = true; continue; }
        let content;
        if (entry.marker) {
            if (Object.hasOwn(fields, entry.identifier)) content = expand(fields[entry.identifier]);
            else if (entry.identifier === 'dialogueExamples') {
                content = expand(c.mes_example || c.data?.mes_example || '');
                let example;
                const flush = () => { if(example?.content.trim())messages.push({...example,content:example.content.trim()});example=null; };
                for (const line of content.split(/\r?\n/)) {
                    if (line.trim() === '<START>') { flush(); continue; }
                    const userPrefix = `${snapshot.macroEnvironment.user}:`, charPrefix = `${snapshot.macroEnvironment.char}:`;
                    if (line.startsWith(userPrefix) || line.startsWith(charPrefix)) {
                        flush(); const isUser=line.startsWith(userPrefix);
                        example={role:'system',name:isUser?'example_user':'example_assistant',content:line.slice((isUser?userPrefix:charPrefix).length)};
                    } else if(example)example.content+='\n'+line;
                    else if(line.trim())diagnostics.push({code:'unparsed-example',message:'角色示例存在未标明说话人的文本。',blocking:true});
                }
                flush();continue;
            } else diagnostics.push({ code: 'unknown-marker', message: `尚未支持预设标记 ${entry.identifier}。`, blocking: true });
        } else content = expand(entry.content || '');
        if (!content) continue;
        const message = { role: entry.role || 'system', content };
        if (Number(entry.injection_position) === 1) depthItems.push({ depth: Number(entry.injection_depth) || 0, message });
        else if(entry.identifier==='main')messages.push(...start,message,...end);
        else messages.push(message);
    }
    if (!usedHistory) throw new Error('规划预设未启用聊天历史标记，无法确定本轮输入位置。');
    // Locate depth relative to history messages, not trailing system instructions.
    const historyEnd = messages.indexOf(history.at(-1)) + 1, historyStart=messages.indexOf(history[0]);
    const buckets=new Map();
    for(const item of depthItems){const anchor=Math.max(historyStart,historyEnd-item.depth);if(!buckets.has(anchor))buckets.set(anchor,[]);buckets.get(anchor).push(item.message);}
    for(const [anchor,items] of [...buckets].sort((a,b)=>b[0]-a[0])) {
        messages.splice(Math.max(0,anchor),0,...items);
    }
    const blocked = diagnostics.filter(d => d.blocking);
    if (blocked.length) throw new Error(blocked.map(d => d.message).join('\n'));
    const total = await tokenize(messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n'));
    if (total > (snapshot.inputBudget ?? snapshot.maxContext)) throw new Error('独立规划上下文超过扣除输出后的预算，请减少选择的资料。');
    return { messages, sourceManifest: { preset: preset.id, entries: preset.execution.map(e => e.identifier), world: scan.entries.map(e => [e.world, e.uid]), plugins: injected.items.map(i => i.key) }, diagnostics, nextWorldState: scan.nextState };
}
