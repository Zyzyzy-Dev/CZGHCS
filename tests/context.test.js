import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanningContext } from '../src/planning/context.js';
test('independent context follows selected preset and world switches with ordered history',async()=>{
    const snapshot={id:'s',chatId:'c',maxContext:2000,worldSettings:{},character:{description:'人设'},macroEnvironment:{user:'玩家',char:'角色'},variables:{local:{},global:{}},currentPreset:'P',presets:{P:{prompts:[{identifier:'main',role:'system',content:'规划用 <Think> 标签'},{identifier:'charDescription',marker:true},{identifier:'worldInfoBefore',marker:true},{identifier:'chatHistory',marker:true}],prompt_order:[{character_id:100001,order:['main','charDescription','worldInfoBefore','chatHistory'].map(identifier=>({identifier,enabled:true}))}]}},bindings:{global:['B']},books:{B:{entries:{1:{uid:1,constant:true,content:'常驻资料',position:0}}}},history:[{role:'user',content:'你好'}],injections:{sp_outline_step:{value:'大纲',position:1,depth:0,role:0}}};
    const before=structuredClone(snapshot);
    const result=await buildPlanningContext({snapshot,selection:{presetId:'P',compatibilityIds:['seven-days']},worldState:{},tokenize:async s=>s.length});
    assert.deepEqual(result.messages.map(m=>m.content),['规划用 <Think> 标签','人设','常驻资料','你好','大纲']);
    assert.deepEqual(snapshot,before);
    const excluded=await buildPlanningContext({snapshot,selection:{presetId:'P',bookOverrides:{B:false},compatibilityIds:[]},worldState:{},tokenize:async s=>s.length});
    assert.deepEqual(excluded.messages.map(m=>m.content),['规划用 <Think> 标签','人设','你好']);
});
test('multiple depth injections stay relative to history and examples preserve speaker roles',async()=>{
    const snapshot={id:'s',chatId:'c',maxContext:2000,worldSettings:{},character:{mes_example:'<START>\n玩家: 示例问\n角色: 示例答'},macroEnvironment:{user:'玩家',char:'角色'},currentPreset:'P',presets:{P:{prompts:[{identifier:'main',role:'system',content:'M'},{identifier:'dialogueExamples',marker:true},{identifier:'chatHistory',marker:true},{identifier:'tail',role:'system',content:'T'}],prompt_order:[{character_id:100001,order:['main','dialogueExamples','chatHistory','tail'].map(identifier=>({identifier,enabled:true}))}]}},bindings:{},books:{},history:[{role:'user',content:'U'},{role:'assistant',content:'A'}],injections:{sp_outline_step:{value:'D0',position:1,depth:0,role:0},sp_lines_latent:{value:'D1',position:1,depth:1,role:0}}};
    const result=await buildPlanningContext({snapshot,selection:{compatibilityIds:['seven-days']},tokenize:async s=>s.length});
    assert.deepEqual(result.messages.map(m=>m.content),['M','示例问','示例答','U','D1','A','D0','T']);
    assert.equal(result.messages[1].name,'example_user');
});
