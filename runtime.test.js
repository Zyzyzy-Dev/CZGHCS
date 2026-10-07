import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('request hook: inject only after success, preserve panels, abort on error/cancel, skip quiet, clear between chats', async () => {
    const listeners = new Map();
    const elements = [];
    class Element {
        constructor() { this.value = ''; this.style = {}; this.children = []; this.handlers = {}; elements.push(this); }
        append(...children) { this.children.push(...children); }
        addEventListener(name, fn) { this.handlers[name] = fn; }
        setAttribute() {}
    }
    const mount = new Element();
    const events = Object.fromEntries(['APP_READY', 'CHAT_COMPLETION_SETTINGS_READY', 'GENERATION_STOPPED', 'CHAT_CHANGED'].map(s => [s, s]));
    const emit = async (name, ...args) => { for (const fn of listeners.get(name) || []) await fn(...args); };
    const c = {
        extensionSettings: {}, chatId: 'a', characterId: 1, eventTypes: events,
        saveSettingsDebounced() {},
        eventSource: { on(name, fn) { listeners.set(name, [...(listeners.get(name) || []), fn]); } },
    };
    let stopped = 0;
    let calls = 0;
    let sent;
    let mainAborted = false;
    const old = { document: globalThis.document, SillyTavern: globalThis.SillyTavern, fetch: globalThis.fetch };
    globalThis.document = { createElement: () => new Element(), querySelector: () => mount };
    globalThis.SillyTavern = { getContext: () => c };
    globalThis.__czghTestHost = {
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' }),
        stopGeneration: () => { stopped++; mainAborted = true; void emit(events.GENERATION_STOPPED); },
    };
    globalThis.fetch = async (url, options) => {
        calls++; sent = JSON.parse(options.body);
        assert.equal(url, '/api/backends/chat-completions/generate');
        return { ok: true, json: async () => ({ choices: [{ message: { content: '<Abstract>已完成计划</Abstract>' }, finish_reason: 'stop' }] }) };
    };
    try {
        const source = (await readFile(new URL('./index.js', import.meta.url), 'utf8'))
            .replace("import { getRequestHeaders, stopGeneration } from '/script.js';", 'const { getRequestHeaders, stopGeneration } = globalThis.__czghTestHost;')
            .replace("from './core.js'", `from '${new URL('./core.js', import.meta.url).href}'`);
        await import(`data:text/javascript;base64,${Buffer.from(source + '\n//# sourceURL=czgh-runtime-under-test.js').toString('base64')}`);
        const config = c.extensionSettings.czgh_external_planner;
        Object.assign(config, { enabled: true, apiUrl: 'https://example.org/v1', model: 'p' });
        const messages = [{ role: 'system', content: '<Abstract>写作准备</Abstract>；展开的记忆；生成状态栏' }, { role: 'user', content: '用户输入' }];
        const data = { type: 'normal', messages: structuredClone(messages) };
        await emit(events.CHAT_COMPLETION_SETTINGS_READY, data);
        assert.deepEqual(sent.messages.slice(0, -1), messages);
        assert.deepEqual(data.messages.slice(0, -1), messages);
        assert.match(data.messages.at(-1).content, /已完成计划/);
        assert.equal(stopped, 0);
        assert.equal(calls, 1);
        await emit(events.CHAT_COMPLETION_SETTINGS_READY, data);
        await emit(events.CHAT_COMPLETION_SETTINGS_READY, { type: 'quiet', messages });
        assert.equal(calls, 1);
        assert.ok(!JSON.stringify(config).includes('apiKey'));

        globalThis.fetch = async (_, options) => {
            const body = JSON.parse(options.body);
            assert.match(body.messages.at(-1).content, /<Think>规划内容<\/Think>/);
            assert.ok(!body.messages.at(-1).content.includes('<Abstract>'));
            return { ok: true, json: async () => ({ choices: [{ message: { content: '<Think>切换后的计划</Think>' }, finish_reason: 'stop' }] }) };
        };
        const switched = { type: 'normal', messages: [{ role: 'system', content: '<Think>思维链</Think>，随后生成正文和状态栏' }] };
        await emit(events.CHAT_COMPLETION_SETTINGS_READY, switched);
        assert.match(switched.messages.at(-1).content, /<Think>\n切换后的计划\n<\/Think>/);
        assert.match(elements.find(e => e.readOnly).value, /^<Think>/);

        globalThis.fetch = async () => { throw new Error('ambiguous tags must not reach API'); };
        const ambiguous = { type: 'normal', messages: [{ role: 'system', content: '<Think>思维链</Think>\n<Abstract>写作准备</Abstract>' }] };
        await emit(events.CHAT_COMPLETION_SETTINGS_READY, ambiguous);
        assert.equal(ambiguous.messages.length, 1);
        assert.ok(elements.some(e => typeof e.textContent === 'string' && e.textContent.includes('多个可能的规划标签')));

        globalThis.fetch = async () => ({ ok: false, status: 503 });
        const failed = { type: 'swipe', messages: structuredClone(messages) };
        await emit(events.CHAT_COMPLETION_SETTINGS_READY, failed);
        assert.deepEqual(failed.messages, messages);
        assert.equal(mainAborted, true);

        globalThis.fetch = (_, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        });
        const cancelled = { type: 'regenerate', messages: structuredClone(messages) };
        const running = emit(events.CHAT_COMPLETION_SETTINGS_READY, cancelled);
        c.chatId = 'b';
        await emit(events.CHAT_CHANGED);
        await running;
        assert.deepEqual(cancelled.messages, messages);
        const preview = elements.find(e => e.readOnly);
        assert.equal(preview.value, '');

        const skip = elements.find(e => e.textContent === '下次跳过规划 / 撤销跳过');
        skip.handlers.click();
        globalThis.fetch = async () => { throw new Error('should not call'); };
        const skipped = { type: 'normal', messages: structuredClone(messages) };
        const previousStops = stopped;
        await emit(events.CHAT_COMPLETION_SETTINGS_READY, skipped);
        assert.equal(stopped, previousStops);
        assert.deepEqual(skipped.messages, messages);
    } finally {
        Object.assign(globalThis, old);
        delete globalThis.__czghTestHost;
    }
});
