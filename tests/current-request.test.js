import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeCurrentRequest } from '../src/planning/current-request.js';
test('current connection freezes key identity and cannot override independent messages through extra body',()=>{
    const data={chat_completion_source:'custom',model:'m',custom_url:'https://example.com/v1',messages:[{role:'system',content:'body'}],max_tokens:500,max_completion_tokens:10000,n:3,tools:[{}],stream:true};
    const before=structuredClone(data);
    const request=freezeCurrentRequest(data,{api_key_custom:[{id:'chosen',active:true}]},JSON.parse);
    assert.equal(request.secret_id,'chosen');assert.equal(request.n,1);assert.equal(request.max_completion_tokens,undefined);assert.equal(request.tools,undefined);assert.deepEqual(request.messages,[]);assert.deepEqual(data,before);
    assert.throws(()=>freezeCurrentRequest({...data,custom_include_body:'{"messages":[]}'},{},JSON.parse));
});
