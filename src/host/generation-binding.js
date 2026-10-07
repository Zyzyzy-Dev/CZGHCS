/* 生成事件关联：流式结束可能早于消息收到，按请求、聊天、楼号与生成类型绑定。 */
export function createGenerationBinding(host) {
    let staged;
    const discard=()=>{if(staged)host.discard(staged.requestId);staged=null;};
    return {
        stage(record){discard();staged=record;},
        started:discard,
        stopped:discard,
        ended(){ /* MESSAGE_RECEIVED follows GENERATION_ENDED in streaming finalization. */ },
        async received(id,type){
            if(!staged)return;
            if(staged.chatId!==host.identity()||host.isAborted?.()){discard();return;}
            if(!['normal','regenerate','swipe',undefined].includes(type)||id!==staged.expectedMessageId)return;
            const record=staged;staged=null;
            await host.bind(record,id);
        },
    };
}
