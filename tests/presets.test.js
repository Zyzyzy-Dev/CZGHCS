import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePreset } from '../src/planning/presets.js';
test('visual groups never reorder prompt execution and switches remain private',()=>{
    const preset={prompts:[{identifier:'b',name:'B',content:'B'},{identifier:'a',name:'A',content:'A'},{identifier:'c',name:'C',content:'C'}],prompt_order:[{character_id:100001,order:[{identifier:'a',enabled:true},{identifier:'b',enabled:true},{identifier:'c',enabled:false}]}],extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',name:'组',order:0,enabled:true}],prompts:{b:{groupId:'g'}}}}}};
    const snapshot={presets:{P:preset},currentPreset:'P'}; const before=structuredClone(preset);
    const view=resolvePreset(snapshot,{presetId:'P',promptOverrides:{a:false,c:true,deleted:false},groupOverrides:{g:false}});
    assert.deepEqual(view.execution.map(x=>x.identifier),['c']);
    assert.equal(view.groups[0].name,'组');
    assert.equal(view.groups[0].entries[0].identifier,'b');
    assert.ok(view.diagnostics.some(d=>d.code==='missing-entry'));
    assert.deepEqual(preset,before);
    assert.deepEqual(resolvePreset(snapshot,{presetId:'P'}).execution.map(x=>x.identifier),['a','b']);
});
