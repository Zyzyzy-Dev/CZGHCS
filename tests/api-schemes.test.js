import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiSchemes } from '../src/host/api-schemes.js';
import { migrateSchemes } from '../src/planning/schemes.js';

test('API schemes are independent and unsuccessful persistence leaves selection intact',async()=>{
    let state=migrateSchemes({}); let fail=false;
    const external=[{id:'e',name:'外部',source:'custom',model:'m',secretId:'s',connection:{custom_url:'https://example.com/v1'}}];
    const host={read:()=>state,write:async value=>{if(fail)throw Error('save failed');state=value;},external:()=>external,current:()=>({source:'custom',model:'current',secretId:'active',connection:{custom_url:'https://example.com/v1'}})};
    const api=createApiSchemes(host);
    assert.equal((await api.resolve('external:e')).secretId,'s');
    assert.equal((await api.resolve('current')).secretId,'active');
    await assert.rejects(api.save({id:'external:e',name:'x',config:external[0]}));
    await assert.rejects(api.remove('external:e'));
    const saved=await api.save({name:'本地',config:external[0]});
    assert.equal((await api.resolve('local:'+saved.id)).secretId,'s');
    const before=structuredClone(state); fail=true;
    await assert.rejects(api.save({id:'local:'+saved.id,name:'失败',config:{...external[0],model:'changed'}}));
    assert.deepEqual(state,before);
    assert.equal(external[0].name,'外部');
    assert.ok(!(await api.list()).some(p=>Object.hasOwn(p,'key')));
});
