/* 酒馆宿主入口：魔法棒面板、受限 RPC、规划请求和楼内 iframe 生命周期。 */
import { getRequestHeaders, stopGeneration, saveSettings } from '/script.js';
import { createPlanner } from './planner.js?v=0.4.0-dev.5';
import { createWorkbench } from './workbench.js?v=0.4.0-dev.5';
import { createMessagePlans } from './message-plans.js?v=0.4.0-dev.5';
import { createGenerationBinding } from './generation-binding.js?v=0.4.0-dev.5';
import { migrateSchemes } from '../planning/schemes.js?v=0.4.0-dev.5';
import { CHANNEL, acceptsMessage, validateRpc, themeSnapshot } from '../bridge/protocol.js?v=0.4.0-dev.5';
const ID='czgh_external_planner';
const ctx=()=>SillyTavern.getContext();
const chatId=()=>JSON.stringify([ctx().chatId,ctx().characterId,ctx().groupId]);
let initialized=false;
function init(){
    if(initialized)return;
    const menu=document.querySelector('#extensions_menu')||document.querySelector('#extensionsMenu');if(!menu)return;initialized=true;
    const dialog=document.createElement('dialog');dialog.id='czgh-planner-container';dialog.setAttribute('aria-label','创作规划');
    for(const [key,value] of Object.entries({padding:'0',margin:'auto',border:'0',background:'transparent',width:'min(460px,96vw)',height:'min(840px,92dvh)','max-width':'96vw','max-height':'92dvh',overflow:'hidden','box-shadow':'0 24px 80px #101d3540, 0 4px 16px #101d351f','border-radius':'14px','clip-path':'inset(0 round 14px)',transform:'none'}))dialog.style.setProperty(key,value,'important');
    const frame=document.createElement('iframe');frame.title='创作规划';frame.src=new URL('../ui/index.html?v=0.4.0-dev.5',import.meta.url).href;
    frame.style.cssText='display:block!important;width:100%!important;height:100%!important;border:0!important;margin:0!important;padding:0!important;background:transparent!important;border-radius:14px!important;clip-path:inset(0 round 14px)!important;';dialog.append(frame);document.body.append(dialog);
    const send=(type,payload)=>frame.contentWindow?.postMessage({channel:CHANNEL,type,payload},location.origin);
    const theme=()=>themeSnapshot(getComputedStyle(document.body));
    const workbench=createWorkbench({context:ctx,headers:getRequestHeaders,saveSettings});
    const panelFrames=new Map();
    const plans=createMessagePlans({chatId,messages:()=>ctx().chat||[],save:()=>ctx().saveChat(),display:()=>!!ctx().extensionSettings[ID]?.displayPlan,render:records=>{
        for(const [id,item] of panelFrames)if(!records.some(r=>r.messageId===id)||!item.frame.isConnected){item.frame.remove();panelFrames.delete(id);}
        for(const record of records){
            const parent=document.querySelector(`.mes[mesid="${record.messageId}"] .mes_block`);if(!parent)continue;
            let item=panelFrames.get(record.messageId);
            if(!item){const panel=document.createElement('iframe');panel.title='本楼创作规划';panel.src=new URL('../ui/message.html?v=0.4.0-dev.5',import.meta.url).href;panel.style.cssText='display:block!important;width:100%!important;height:42px!important;border:0!important;margin:8px 0!important;background:transparent!important;';parent.append(panel);item={frame:panel,record};panelFrames.set(record.messageId,item);panel.addEventListener('load',()=>panel.contentWindow?.postMessage({channel:CHANNEL,type:'plan',payload:{record:item.record,theme:theme()}},location.origin));}
            item.record=record;item.frame.contentWindow?.postMessage({channel:CHANNEL,type:'plan',payload:{record,theme:theme()}},location.origin);
        }
    }});
    const binding=createGenerationBinding({identity:chatId,isAborted:()=>!!ctx().streamingProcessor?.abortController?.signal?.aborted,discard:id=>plans.discard(id),bind:async(record,messageId)=>{
        const message=ctx().chat?.[messageId];if(!message)return;
        await plans.bind({requestId:record.requestId,messageId,swipeId:message.swipe_id??0});
        if(record.chatId===chatId()&&record.nextWorldState){ctx().chatMetadata.czghCreativePlanningWorld=record.nextWorldState;ctx().saveMetadataDebounced();}
    }});
    const planner=createPlanner({getContext:ctx,getRequestHeaders,stopGeneration,getYaml:()=>SillyTavern.libs?.yaml,onState:s=>send('state',s),prepare:args=>workbench.prepare(args),onPlanReady:record=>{binding.stage(record);plans.stage(record);},onDiscard:requestId=>plans.discard(requestId)});
    ctx().extensionSettings[ID]=migrateSchemes(ctx().extensionSettings[ID]);
    let rpcQueue=Promise.resolve();
    window.addEventListener('message',event=>{
        // Closing must not wait for source loading or any pending RPC operation.
        if(acceptsMessage(event,frame.contentWindow,location.origin)&&event.data.type==='close'){dialog.close();return;}
        for(const item of panelFrames.values())if(acceptsMessage(event,item.frame.contentWindow,location.origin)&&event.data.type==='height'){
            const height=Number(event.data.payload);if(Number.isFinite(height))item.frame.style.setProperty('height',`${Math.min(560,Math.max(42,height))}px`,'important');return;
        }
        if(!acceptsMessage(event,frame.contentWindow,location.origin)||event.data.type!=='request')return;
        rpcQueue=rpcQueue.then(async()=>{
            const requestId=event.data.requestId;
            try{const {method,payload}=validateRpc(event.data);let result;
                if(method==='ui.close'){dialog.close();result={};}
                else if(method==='planner.cancel'){planner.stop();binding.stopped();result={};}
                else{result=await workbench.execute(method,payload);planner.settingsChanged();plans.render();}
                frame.contentWindow?.postMessage({channel:CHANNEL,type:'response',requestId,ok:true,result},location.origin);send('theme',theme());send('state',planner.getState());
            }catch(error){frame.contentWindow?.postMessage({channel:CHANNEL,type:'response',requestId,ok:false,error:error.message},location.origin);}
        });
    });
    const button=document.createElement('button');button.id='czgh-planner-menu';button.type='button';button.className='list-group-item flex-container flexGap5 interactable';button.textContent='✎ 创作规划';
    button.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();send('theme',theme());send('refresh');});menu.append(button);
    const on=(name,fn)=>{if(ctx().eventTypes[name])ctx().eventSource.on(ctx().eventTypes[name],fn);};
    on('MESSAGE_RECEIVED',(messageId,type)=>binding.received(messageId,type));
    on('GENERATION_STARTED',()=>binding.started());
    on('GENERATION_STOPPED',()=>binding.stopped());
    on('GENERATION_ENDED',()=>{binding.ended();plans.render();});
    on('CHAT_CHANGED',()=>{binding.stopped();plans.dispose();plans.render();if(dialog.open)send('refresh');});
    for(const event of ['CHARACTER_MESSAGE_RENDERED','MESSAGE_SWIPED','MESSAGE_UPDATED','MESSAGE_DELETED','CHAT_LOADED'])on(event,()=>plans.render());
    let previous='';setInterval(()=>{const value=theme(),json=JSON.stringify(value);if(json===previous)return;previous=json;if(dialog.open)send('theme',value);for(const item of panelFrames.values())item.frame.contentWindow?.postMessage({channel:CHANNEL,type:'theme',payload:value},location.origin);},800);
    plans.render();
}
ctx().eventSource.on(ctx().eventTypes.APP_READY,init);init();
