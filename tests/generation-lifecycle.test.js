import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationBinding } from '../src/host/generation-binding.js';
test('streaming end before message received retains plan; next generation and stop invalidate it',async()=>{
    const calls=[];let identity='c',aborted=false;
    const binding=createGenerationBinding({identity:()=>identity,isAborted:()=>aborted,bind:async(record,id)=>calls.push([record.requestId,id]),discard:id=>calls.push(['discard',id])});
    binding.stage({requestId:'a',chatId:'c',generationType:'normal',expectedMessageId:2});
    binding.ended();await binding.received(2,'normal');assert.deepEqual(calls,[['a',2]]);
    binding.stage({requestId:'b',chatId:'c',generationType:'normal',expectedMessageId:2});binding.started();await binding.received(2,'normal');assert.deepEqual(calls.at(-1),['discard','b']);
    binding.stage({requestId:'d',chatId:'c',generationType:'swipe',expectedMessageId:2});await binding.received(2,'quiet');assert.notEqual(calls.at(-1)[0],'d');
    identity='other';await binding.received(2,'swipe');assert.equal(calls.at(-1)[0],'discard');
    identity='c';aborted=true;binding.stage({requestId:'error',chatId:'c',expectedMessageId:2});binding.ended();await binding.received(2,'normal');assert.deepEqual(calls.at(-1),['discard','error']);
});
