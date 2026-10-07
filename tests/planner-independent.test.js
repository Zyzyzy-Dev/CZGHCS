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
