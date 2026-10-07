import test from 'node:test';
import assert from 'node:assert/strict';
import { expandMacros } from '../src/planning/macros.js';
import { selectInjections } from '../src/planning/compatibility.js';
test('isolated variables expand without writing back and unchecked memory macros are excluded',()=>{
    const snapshot={macroEnvironment:{user:'玩家',char:'角色',bbs:{vars:{好感:5},state:{time:'早晨'}}},injections:{baibai_book_memory_history:{value:'旧事',position:1,depth:2},sp_outline_step:{value:'大纲',position:1,depth:3},foreign:{value:'其他'}}};
    const variables={local:{a:'原值'},global:{}};
    const result=expandMacros('{{setvar::a::新值}}{{getvar::a}} {{user}} {{bbsVars}}',{snapshot,compatibilityIds:[],variables});
    assert.equal(result.text,'新值 玩家 ');
    assert.equal(variables.local.a,'原值');
    assert.equal(result.variables.local.a,'新值');
    assert.ok(result.diagnostics.some(d=>d.code==='excluded-macro'));
    assert.equal(expandMacros('{{bbsVar::好感}}',{snapshot,compatibilityIds:['baibai'],variables}).text,'5');
    assert.deepEqual(selectInjections(snapshot,['seven-days']).items.map(x=>x.key),['sp_outline_step']);
    assert.equal(selectInjections(snapshot,['baibai']).items[0].depth,2);
    assert.ok(expandMacros('{{unknown::x}}',{snapshot,compatibilityIds:[],variables}).diagnostics.some(d=>d.blocking));
});
test('variable values may contain literal single braces and nested macros',()=>{
    const result=expandMacros('{{setvar::panel::<date>{YYYY/MM/DD}</date> {{user}}}}{{getvar::panel}}',{snapshot:{macroEnvironment:{user:'玩家'}},variables:{local:{},global:{}}});
    assert.equal(result.text,'<date>{YYYY/MM/DD}</date> 玩家');
    assert.equal(result.diagnostics.filter(d=>d.blocking).length,0);
});
