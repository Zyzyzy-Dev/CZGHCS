/* 独立方案存储：迁移旧设置、校验可持久化数据，以副本执行增删改。 */
import { createId } from '../bridge/id.js?v=0.4.0-dev.9';
const KINDS = ['api', 'preset', 'world'];
export function assertSafeData(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (/^(?:__proto__|prototype|constructor|key|apiKey|api_key|authorization|password)$/i.test(key)) throw new Error('方案不能保存明文凭据或不安全字段。');
        assertSafeData(child);
    }
}
export function migrateSchemes(settings = {}) {
    const result = structuredClone(settings);
    if (result.schemes && result.schemes.version !== 1) throw new Error('方案数据版本不支持，请保留原数据。');
    if (!result.schemes) {
        result.schemes = { version: 1, api: [], preset: [], world: [] };
        if (result.apiUrl && !result.profileId) result.schemes.api.push({ id: 'legacy-manual', kind: 'api', name: '原手动配置', payload: { apiUrl: result.apiUrl, model: result.model || '', source: 'custom', connection: { custom_url: result.apiUrl } }, updatedAt: 0 });
    }
    for (const kind of KINDS) if (!Array.isArray(result.schemes[kind])) throw new Error('方案数据损坏，请保留原数据。');
    result.selection ??= { presetId: '', promptOverrides: {}, groupOverrides: {}, bookOverrides: {}, entryOverrides: {}, extraBooks: [], compatibilityIds: ['baibai', 'seven-days'] };
    result.apiSelection ??= result.profileId ? `external:${result.profileId}` : result.schemes.api.length ? 'local:legacy-manual' : 'current';
    result.displayPlan ??= false;
    result.appearance ??= 'auto';
    return result;
}
export function applySchemeOperation(state, { kind, operation, id, name, payload }) {
    if (!KINDS.includes(kind) || !['create', 'overwrite', 'delete'].includes(operation)) throw new Error('无效的方案操作。');
    const next = migrateSchemes(state);
    const list = next.schemes[kind];
    const index = list.findIndex(item => item.id === id);
    if (operation !== 'create' && index < 0) throw new Error('仅可修改创作规划中仍存在的方案。');
    if (operation === 'delete') list.splice(index, 1);
    else {
        if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('请输入不超过 100 字的方案名称。');
        assertSafeData(payload);
        const item = { id: operation === 'create' ? createId() : id, name: name.trim(), kind, payload: structuredClone(payload), updatedAt: Date.now() };
        if (index < 0) list.push(item); else list[index] = item;
    }
    return next;
}
