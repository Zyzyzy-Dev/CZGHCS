import test from 'node:test';
import assert from 'node:assert/strict';
import { materializePluginMacros } from '../src/host/plugin-macros.js';
test('parameterized memory macros read only requested public data and unchecked plugins are untouched',async()=>{
    const calls=[];const api={getVar:(path,options)=>{calls.push([path,options]);return 42;},getSnapshot:()=>{throw Error('unrequested data');}};
    const snapshot={macroEnvironment:{},presets:{P:{prompts:[{identifier:'a',content:'{{bbsVar::好感::4::before}}'}],prompt_order:[{character_id:100001,order:[{identifier:'a',enabled:true}]}]}},currentPreset:'P',books:{},bindings:{}};
    const excluded=await materializePluginMacros(snapshot,{compatibilityIds:[]},api);
    assert.equal(calls.length,0);assert.deepEqual(excluded.macroEnvironment.pluginMacros,{});
    const included=await materializePluginMacros(snapshot,{compatibilityIds:['baibai']},api);
    assert.deepEqual(calls,[['好感',{floor:4,at:'before'}]]);
    assert.equal(included.macroEnvironment.pluginMacros['bbsVar::好感::4::before'],'42');
    assert.equal(snapshot.macroEnvironment.pluginMacros,undefined);
});
