import test from 'node:test';
import assert from 'node:assert/strict';
import { createId } from '../src/bridge/id.js';

test('identifiers work without randomUUID or crypto and do not collide in a batch',()=>{
    const compatible={getRandomValues:values=>crypto.getRandomValues(values)};
    const ids=Array.from({length:1000},()=>createId(compatible));
    assert.equal(new Set(ids).size,1000);
    assert.match(ids[0],/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(createId(null),createId(null));
    assert.equal(createId({randomUUID:()=> 'native-id'}),'native-id');
});
