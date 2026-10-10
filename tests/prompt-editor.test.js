import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSettings, planningMessages, writingMessages } from '../src/planning/core.js';
import { cleanSettings } from '../src/bridge/protocol.js';

test('editable prompts include all instructions and replace them without hidden fixed rules',()=>{
    const initial=migrateSettings({});
    assert.match(initial.plannerPrompt,/6\. 交接内容/);
    assert.match(initial.writerPrompt,/规划未复述某项要求不代表该要求失效/);
    const custom=migrateSettings({...initial,...cleanSettings({plannerPrompt:'规划自定义',writerPrompt:'正文自定义'})});
    const config={...custom,openTag:'<Think>',closeTag:'</Think>'};
    assert.equal(planningMessages([],config).at(-1).content,'规划自定义\n请将完整规划放入当前预设指定的标签中：<Think>规划内容</Think>。');
    assert.equal(writingMessages([],'测试规划',config).at(-1).content,'正文自定义\n\n【本轮创作规划】\n<Think>\n测试规划\n</Think>');
    assert.equal(migrateSettings(custom).plannerPrompt,'规划自定义');
    const legacy=migrateSettings({plannerInstruction:'旧自定义开头',writerInstruction:'旧正文开头'});
    assert.ok(legacy.plannerPrompt.startsWith('旧自定义开头\n'));
    assert.ok(legacy.writerPrompt.startsWith('旧正文开头\n'));
});

test('empty editable prompts are preserved and RPC rejects non-string prompt fields',()=>{
    assert.deepEqual(cleanSettings({plannerPrompt:123,writerPrompt:[]}),{});
    const state=migrateSettings({...migrateSettings({}),plannerPrompt:'',writerPrompt:''});
    assert.equal(state.plannerPrompt,'');assert.equal(state.writerPrompt,'');
});
