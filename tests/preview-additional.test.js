import test from 'node:test';
import assert from 'node:assert/strict';
import {previewMessages,estimateTokens} from '../src/ui/diagnostics.js';
import {profileRequest} from '../src/planning/profiles.js';
test('preview compression retains order and content without mutating real request or merging named messages',()=>{
 const messages=[{role:'system',content:'甲'},{role:'system',content:'乙'},{role:'user',content:'问题'},{role:'system',content:'丙',name:'special'},{role:'system',content:'丁'}],before=structuredClone(messages);
 const view=previewMessages(messages,true);assert.equal(view.length,4);assert.equal(view[0].content,'甲\n\n乙');assert.deepEqual(messages,before);assert.deepEqual(previewMessages(messages),messages);assert.ok(estimateTokens(messages)>0);
});
test('additional parameters preserve supported fields and reject overriding message or auth fields',()=>{
 const base={source:'custom',keyRef:'test',model:'m',connection:{custom_url:'https://example.com'}};
 const additional={custom_include_body:'{"temperature":0.7}',custom_exclude_body:'["frequency_penalty"]',custom_include_headers:'{"X-Test":"a"}'};
 const body=profileRequest({...base,additional},[],100,JSON.parse);for(const k of Object.keys(additional))assert.equal(body[k],additional[k]);
 for(const additional of [{custom_include_body:'{"messages":[]}'},{custom_include_headers:'{"Authorization":"secret"}'},{custom_include_body:123}])assert.throws(()=>profileRequest({...base,additional},[],100,JSON.parse));
});
