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

test('BaiBai display follows first member in native order, retaining loose entries in place',()=>{
    const ids=['loose','b','a','middle','b2'];
    const preset={prompts:ids.map(identifier=>({identifier})),prompt_order:[{character_id:100001,order:ids.map(identifier=>({identifier,enabled:true}))}],extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'A',order:0},{id:'B',order:1}],prompts:{a:{groupId:'A'},b:{groupId:'B'},b2:{groupId:'B'}}}}}};
    const view=resolvePreset({presets:{P:preset},currentPreset:'P'});
    assert.deepEqual(view.display.map(x=>x.type==='group'?x.group.id:x.entry.identifier),['loose','B','A','middle']);
    assert.deepEqual(view.display[1].group.entries.map(x=>x.identifier),['b','b2']);
    assert.deepEqual(view.execution.map(x=>x.identifier),ids);
});

test('group gate suppresses reading without changing mixed member switches',()=>{
    const preset={prompts:[{identifier:'a'},{identifier:'b'}],prompt_order:[{character_id:100001,order:[{identifier:'a',enabled:true},{identifier:'b',enabled:false}]}],extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',enabled:true}],prompts:{a:{groupId:'g'},b:{groupId:'g'}}}}}};
    const snapshot={presets:{P:preset},currentPreset:'P'};
    const off=resolvePreset(snapshot,{groupOverrides:{g:false}});
    assert.deepEqual(off.execution,[]);
    assert.deepEqual(off.groups[0].entries.map(e=>e.enabled),[true,false]);
    const on=resolvePreset(snapshot,{groupOverrides:{g:true}});
    assert.deepEqual(on.execution.map(e=>e.identifier),['a']);
    assert.deepEqual(on.groups[0].entries.map(e=>e.enabled),[true,false]);
});
