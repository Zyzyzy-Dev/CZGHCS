/* 规划消息持久化：按聊天与 swipe 绑定记录，不改变正文，不复用取消或过期结果。 */
export function fingerprint(text) {
    let hash = 2166136261;
    for (const char of String(text || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `${String(text || '').length}:${hash >>> 0}`;
}
export function createMessagePlans(host) {
    const pending = new Map();
    function render() {
        const records = [];
        if (host.display()) host.messages().forEach((message, messageId) => {
            const swipeId = message.swipe_id ?? 0;
            const record = message.extra?.czghCreativePlanning?.[swipeId];
            if (record) records.push({ ...record, messageId, swipeId, stale: record.bodyFingerprint !== fingerprint(message.mes) });
        });
        host.render(records);
    }
    return {
        stage(record) { pending.clear(); pending.set(record.requestId, structuredClone(record)); },
        async bind({ requestId, messageId, swipeId }) {
            const record = pending.get(requestId); pending.delete(requestId);
            const message = host.messages()[messageId];
            if (!record || record.chatId !== host.chatId() || !message || message.is_user || message.is_system || !message.mes) return;
            record.swipeId = swipeId;
            record.bodyFingerprint = fingerprint(message.mes);
            delete record.nextWorldState;
            message.extra ??= {};
            message.extra.czghCreativePlanning ??= {};
            message.extra.czghCreativePlanning[swipeId] = record;
            if (message.swipe_info?.[swipeId]) {
                message.swipe_info[swipeId].extra ??= {};
                message.swipe_info[swipeId].extra.czghCreativePlanning = structuredClone(message.extra.czghCreativePlanning);
            }
            await host.save(); render();
        },
        render,
        discard(requestId) { if (requestId) pending.delete(requestId); else pending.clear(); },
        dispose() { pending.clear(); host.render([]); },
    };
}
