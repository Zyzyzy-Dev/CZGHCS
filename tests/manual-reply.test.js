import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner} from '../src/host/planner.js';
for(const action of ['resume','cancel','chat','edited'])test(`manual planning waits, then ${action} is isolated`,async()=>{
 const listeners={},records=[];let stops=0,fetches=0;const originalFetch=globalThis.fetch;
 const context={chatId:'a',chat:[],extensionSettings:{czgh_external_planner:{enabled:true,autoReply:false,timeoutSeconds:60,maxTokens:6000}},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(e,f)=>listeners[e]=f}};
 globalThis.fetch=async()=>{fetches++;return new Response(JSON.stringify({choices:[{message:{content:'<Think>plan</Think>'},finish_reason:'stop'}]}));};
 try{
 const planner=createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){stops++;listeners.stop();},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{model:'test'}}),onPlanReady:r=>records.push(r)});
 const data={type:'normal',messages:[{role:'user',content:'hello'}]},original=structuredClone(data);let done=false;
 const task=listeners.request(data).then(()=>done=true);
 for(let n=0;n<10;n++)await new Promise(r=>setTimeout(r,5));
 assert.equal(done,false);assert.deepEqual(data,original);assert.equal(planner.getState().awaitingReply,true);
 if(action==='resume'){assert.equal(planner.resume(),true);assert.equal(planner.resume(),false);}else if(action==='edited'){context.chat.push({is_user:true,mes:'changed'});planner.resume();}else if(action==='cancel')planner.stop();else{context.chatId='b';listeners.chat();}
 await task;assert.equal(fetches,1);assert.equal(records.length,action==='resume'?1:0);assert.equal(stops,action==='resume'?0:1);
 }finally{globalThis.fetch=originalFetch;}
});
