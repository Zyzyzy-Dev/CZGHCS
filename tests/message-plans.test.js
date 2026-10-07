import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessagePlans } from '../src/host/message-plans.js';
test('plans persist per swipe without editing body and never bind a cancelled or foreign result',async()=>{
    const message={mes:'正文',swipe_id:0,extra:{},swipe_info:[{extra:{}}]};let saved=0,chatId='c';
    const view=[];
    const service=createMessagePlans({chatId:()=>chatId,messages:()=>[message],save:async()=>saved++,display:()=>true,render:records=>view.push(records)});
    service.stage({version:1,requestId:'r',chatId:'c',text:'<script>bad</script>',openTag:'<Think>',closeTag:'</Think>'});
    await service.bind({requestId:'r',messageId:0,swipeId:0});
    assert.equal(message.mes,'正文');assert.equal(saved,1);
    assert.equal(message.extra.czghCreativePlanning['0'].text,'<script>bad</script>');
    message.swipe_id=1;service.render();assert.equal(view.at(-1).length,0);
    message.swipe_id=0;message.mes='已编辑';service.render();assert.equal(view.at(-1)[0].stale,true);
    service.stage({requestId:'x',chatId:'c',text:'取消'});service.discard('x');await service.bind({requestId:'x',messageId:0,swipeId:0});assert.equal(saved,1);
    service.stage({requestId:'z',chatId:'c',text:'其他聊天'});chatId='other';await service.bind({requestId:'z',messageId:0,swipeId:0});assert.equal(saved,1);
});
