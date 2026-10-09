import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlanResponse } from '../src/host/stream.js';

test('detects SSE from body when proxy labels it JSON or omits its content type',async()=>{
    const data=': heartbeat\r\n\r\ndata: {"choices":[{"delta":{"content":"<Think>规划</Think>"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    for (const type of ['application/json','text/plain','']) {
        const previews=[];
        const result=await readPlanResponse(new Response(data,{headers:type?{'content-type':type}:{}}),text=>previews.push(text));
        assert.equal(result.message.content,'<Think>规划</Think>');assert.equal(previews.length,1);
    }
    const json=JSON.stringify({choices:[{message:{content:'plain'},finish_reason:'stop'}]});
    assert.equal((await readPlanResponse(new Response(json,{headers:{'content-type':'text/event-stream'}}))).message.content,'plain');
});
test('SSE handles split UTF-8 and events, exposes previews and preserves finish reason',async()=>{
    const data=['<Think>','规划','</Think>'].map(content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\r\n\r\n').join('')+'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const bytes=new TextEncoder().encode(data);let offset=0;const previews=[];
    const response=new Response(new ReadableStream({pull(controller){if(offset===bytes.length)controller.close();else controller.enqueue(bytes.slice(offset,++offset));}}),{headers:{'content-type':'text/event-stream'}});
    const result=await readPlanResponse(response,text=>previews.push(text));
    assert.equal(result.message.content,'<Think>规划</Think>');assert.equal(result.finish_reason,'stop');assert.equal(previews.length,3);
});
test('truncated or error streams fail, JSON responses still work',async()=>{
    const s=text=>new Response(text,{headers:{'content-type':'text/event-stream'}});
    await assert.rejects(readPlanResponse(s('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')),/中断/);
    await assert.rejects(readPlanResponse(s('data: {"error":true}\n\n')),/错误/);
    const result=await readPlanResponse(new Response(JSON.stringify({choices:[{message:{content:'complete'},finish_reason:'stop'}]})));
    assert.equal(result.message.content,'complete');
});
