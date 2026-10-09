import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner } from '../src/host/planner.js';
test('planner uses independent messages and preserves body request while publishing a validated result',async()=>{
    const listeners={}; const records=[];
    const context={chatId:'c',characterId:1,extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    const originalFetch=globalThis.fetch; let sent;
    globalThis.fetch=async(_,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{message:{content:'<Think>独立规划</Think>'},finish_reason:'stop'}]})};};
    try {
        createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{chat_completion_source:'custom',custom_url:'https://example.com/v1',model:'p'}}),onPlanReady:r=>records.push(r)});
        context.extensionSettings.czgh_external_planner.enabled=true;
        const data={type:'normal',messages:[{role:'system',content:'正文专用资料'}]};
        await listeners.request(data);
        assert.equal(sent.messages[0].content,'规划使用 <Think> 标签');
        assert.equal(data.messages[0].content,'正文专用资料');
        assert.equal(records.length,1); assert.equal(records[0].text,'独立规划');
    }finally{globalThis.fetch=originalFetch;}
});

for (const stream of [true, false]) test(`planning stream=${stream} leaves main streaming enabled and publishes progress`, async()=>{
    const listeners={}, progress=[];
    const context={chatId:'c',chat:[{is_user:true,mes:'hello'}],extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    const originalFetch=globalThis.fetch; let sent;
    globalThis.fetch=async(_,options)=>{
        sent=JSON.parse(options.body);
        return new Response('data: '+JSON.stringify({choices:[{delta:{content:'<Think>计划</Think>'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
    };
    try {
        createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{model:'planning-model'}}),onProgress:r=>progress.push(structuredClone(r))});
        Object.assign(context.extensionSettings.czgh_external_planner,{enabled:true,stream});
        const data={type:'normal',stream:true,model:'body-model',temperature:0.7,messages:[{role:'user',content:'hello'}]};
        await listeners.request(data);
        assert.equal(sent.stream,stream);
        assert.equal(data.stream,true); assert.equal(data.model,'body-model'); assert.equal(data.temperature,0.7);
        assert.equal(progress[0].phase,'preparing'); assert.equal(progress[0].expectedMessageId,1);
        assert.equal(progress.at(-1).phase,'streaming'); assert.match(progress.at(-1).text,/计划/);
        assert.match(data.messages.at(-1).content,/计划/);
    } finally {globalThis.fetch=originalFetch;}
});

test('planning failure is published to the floor without injecting a plan',async()=>{
    const listeners={},progress=[];let stopped=0;
    const context={chatId:'c',chat:[{is_user:true,mes:'hello'}],extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){stopped++;},prepare:async()=>{throw new Error('测试资料读取失败');},onProgress:r=>progress.push(structuredClone(r))});
    context.extensionSettings.czgh_external_planner.enabled=true;
    const data={type:'normal',stream:false,messages:[{role:'user',content:'hello'}]};
    await listeners.request(data);
    assert.equal(stopped,1); assert.equal(data.messages.length,1); assert.equal(data.stream,false);
    assert.equal(progress.at(-1).phase,'error'); assert.equal(progress.at(-1).error,'测试资料读取失败');
});
