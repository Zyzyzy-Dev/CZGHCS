import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanningContext } from '../src/planning/context.js';
import { captureAuthorNote } from '../src/planning/author-note.js';
import { captureHelperVariables, createTemplateRenderer } from '../src/host/template-compat.js';
import { expandMacros } from '../src/planning/macros.js';
function fixture() {
    const ids=['main','dialogueExamples','chatHistory'];
    return { maxContext:5000,macroEnvironment:{user:'U',char:'C'},character:{mes_example:'U: E'},currentPreset:'P',presets:{P:{prompts:ids.map(identifier=>identifier==='main'?{identifier,content:'M'}:{identifier,marker:true}),prompt_order:[{character_id:100001,order:ids.map(identifier=>({identifier,enabled:true}))}]}},history:[{role:'user',content:'keyword'}],bindings:{global:['B']},books:{B:{entries:Object.fromEntries([2,3,5,6].map(position=>[position,{uid:position,position,constant:position!==3,key:['keyword'],content:position===5?'U: Before':position===6?'C: After':`N${position}`}]))}},authorNote:{enabled:true,value:'Note',position:1,depth:0,role:0} };
}
test('blue and green entries use AN and example positions; green requires keyword, note follows frequency',async()=>{
    const snapshot=fixture(), original=structuredClone(snapshot);
    const build=()=>buildPlanningContext({snapshot,selection:{},tokenize:async s=>s.length});
    assert.deepEqual((await build()).messages.map(m=>m.content),['M','Before','E','After','keyword','N2\nNote\nN3']);
    assert.deepEqual(snapshot,original);
    snapshot.history[0].content='miss';
    assert.equal((await build()).messages.at(-1).content,'N2\nNote');
    snapshot.authorNote.enabled=false;
    assert.equal((await build()).messages.at(-1).content,'miss');
    snapshot.authorNote={...original.authorNote,position:2};
    assert.equal((await build()).messages[0].content,'N2\nNote');
});
test('author note uses raw metadata and character setting, not native WI-contaminated slot',()=>{
    const context={chat:[{is_user:true}],chatMetadata:{note_prompt:'raw',note_interval:2},extensionPrompts:{'2_floating_prompt':{value:'unselected lore'}},extensionSettings:{note:{chara:[{name:'C',useChara:true,position:1,prompt:'char'}]}}};
    assert.equal(captureAuthorNote(context,{avatar:'C.png'}).enabled,false);
    context.chat.push({is_user:true});
    const note=captureAuthorNote(context,{avatar:'C.png'});
    assert.equal(note.value,'char\nraw');assert.equal(note.enabled,true);
});
test('helper reads latest eligible swipe variables once, preserves state, strips internal keys',async()=>{
    const snapshot={macroEnvironment:{},text:'{{get_message_variable::stat_data}} {{format_message_variable::stat_data}}'};
    const context={chat:[{variables:[{stat_data:{v:1}}]},{is_user:true},{variables:[{stat_data:{v:99}}]}]};
    const calls=[];
    await captureHelperVariables(snapshot,context,{getVariables:async options=>{calls.push(options);return {stat_data:{hp:4,$schema:'internal'}};}},'swipe');
    assert.deepEqual(calls,[{type:'message',message_id:0}]);
    const r=expandMacros('{{get_message_variable::stat_data}} {{get_message_variable::stat_data.hp}}',{snapshot});
    assert.equal(r.text,'{"hp":4} 4');assert.equal(r.diagnostics.length,0);
    assert.equal(expandMacros('{{get_message_variable::__proto__}}',{snapshot}).text,'null');
    assert.ok(expandMacros('{{get_global_variable::missing}}',{snapshot}).diagnostics.some(d=>d.blocking));
    assert.equal(expandMacros('  {{format_message_variable::stat_data}}',{snapshot,serializeYaml:()=> 'hp: 4\nmp: 2\n'}).text,'  hp: 4\n  mp: 2');
});
test('template opt-in, missing dependency, cancellation and post-render budget are enforced',async()=>{
    const source='<%= x %>';
    assert.equal(await createTemplateRenderer({enabled:false})(source),source);
    await assert.rejects(createTemplateRenderer({enabled:true})(source),/ST-Prompt-Template/);
    await assert.rejects(createTemplateRenderer({enabled:true})('@@if getvar("x")'),/尚未适配/);
    let prepared=0;
    const controller=new AbortController();
    const render=createTemplateRenderer({enabled:true,signal:controller.signal,api:{prepareContext:async()=>{prepared++;return {x:1};},evalTemplate:async()=> 'rendered'}});
    assert.equal(await render(source),'rendered');assert.equal(await render(source),'rendered');assert.equal(prepared,1);
    controller.abort();await assert.rejects(render(source),{name:'AbortError'});
    const snapshot=fixture();snapshot.maxContext=10;
    await assert.rejects(buildPlanningContext({snapshot,selection:{},tokenize:async s=>s.length,renderTemplate:async()=> 'X'.repeat(100)}),/预算/);
});
