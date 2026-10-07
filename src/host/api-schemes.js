/* API 方案宿主服务：外部只读、自有方案副本持久化、禁止改变活动密钥。 */
import { applySchemeOperation, migrateSchemes } from '../planning/schemes.js';

export function createApiSchemes(host) {
    let queue = Promise.resolve();
    const serial = action => { const result = queue.then(action); queue = result.catch(() => {}); return result; };
    const localId = id => {
        if (typeof id !== 'string' || !id.startsWith('local:')) throw new Error('当前连接和外部方案只读，请新建本地方案。');
        return id.slice(6);
    };
    const read = () => migrateSchemes(host.read());
    return {
        async list() {
            return [{ id: 'current', name: '酒馆当前连接', origin: 'current' }, ...host.external().map(p => ({ id: `external:${p.id}`, name: p.name, origin: 'external', model: p.model, apiUrl: p.connection?.custom_url || '' })), ...read().schemes.api.map(p => ({ id: `local:${p.id}`, name: p.name, origin: 'local', model: p.payload.model, apiUrl: p.payload.connection?.custom_url || p.payload.apiUrl || '', hasKey: !!p.payload.secretId }))];
        },
        async resolve(selection) {
            let config;
            if (selection === 'current') config = await host.current();
            else if (selection?.startsWith('external:')) config = host.external().find(p => p.id === selection.slice(9));
            else config = read().schemes.api.find(p => p.id === localId(selection))?.payload;
            if (!config) throw new Error('API 方案已删除或当前连接不可用。');
            return structuredClone(config);
        },
        save({ id, name, config, key }) {
            return serial(async () => {
                if (id) localId(id);
                // 1.18.0 /secrets/write activates a new key. Never use it behind the user's back.
                if (key) throw new Error('当前酒馆不支持在保持活动密钥不变的情况下保存新密钥。');
                const state = read();
                const next = applySchemeOperation(state, { kind: 'api', operation: id ? 'overwrite' : 'create', id: id ? localId(id) : undefined, name, payload: config });
                const saved = id ? next.schemes.api.find(p => p.id === localId(id)) : next.schemes.api.at(-1);
                next.apiSelection = `local:${saved.id}`;
                await host.write(next);
                return structuredClone(saved);
            });
        },
        remove(id) {
            return serial(async () => {
                const next = applySchemeOperation(read(), { kind: 'api', operation: 'delete', id: localId(id) });
                if (next.apiSelection === id) next.apiSelection = 'current';
                await host.write(next);
            });
        },
        async models(config) {
            if (!host.models) throw new Error('当前连接不支持拉取模型，可手动输入。');
            return host.models(structuredClone(config));
        },
    };
}
