import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { themeSnapshot, acceptsMessage, cleanSettings } from '../src/bridge/protocol.js';
test('theme transfers exactly five tokens; messages require origin, source and channel', () => {
    const theme = themeSnapshot({ getPropertyValue: name => name });
    assert.deepEqual(Object.keys(theme), ['--SmartThemeBorderColor', '--SmartThemeBlurTintColor', '--SmartThemeBodyColor', '--mainFontFamily', '--monoFontFamily']);
    const source = {}, origin = 'https://tavern.test';
    const event = { source, origin, data: { channel: 'creative-planning-v1', type: 'ready' } };
    assert.equal(acceptsMessage(event, source, origin), true);
    assert.equal(acceptsMessage({ ...event, source: {} }, source, origin), false);
    assert.equal(acceptsMessage({ ...event, origin: 'https://other.test' }, source, origin), false);
    assert.equal(acceptsMessage({ ...event, data: { channel: 'other' } }, source, origin), false);
    assert.deepEqual(cleanSettings({ enabled: true, apiKey: 'secret', profile: {}, maxTokens: 'bad' }), { enabled: true });
});
test('root loads host only; iframe owns stylesheet; all src files have purpose comments', async () => {
    const base = new URL('../', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
    assert.equal(manifest.css, undefined);
    assert.match(await readFile(new URL('index.js', base), 'utf8'), /src\/host\/index.js/);
    assert.match(await readFile(new URL('src/ui/index.html', base), 'utf8'), /rel="stylesheet"/);
    async function walk(url) {
        for (const entry of await readdir(url, { withFileTypes: true })) {
            const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
            if (entry.isDirectory()) await walk(child);
            else assert.match((await readFile(child, 'utf8')).trimStart(), /^(\/\*|<!--)/, entry.name);
        }
    }
    await walk(new URL('src/', base));
});
