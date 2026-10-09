/* iframe 工作台：通过受限 RPC 驱动视图，独立主题与导航，不访问宿主 DOM。 */
import { createId } from '../bridge/id.js?v=0.4.0-dev.12';
import { CHANNEL, THEME_KEYS, acceptsMessage } from '../bridge/protocol.js?v=0.4.0-dev.12';
import { button, el } from './components.js?v=0.4.0-dev.12';
import { renderView } from './views.js?v=0.4.0-dev.12';
import { setIcon, appearanceIcon, generationIcon } from './icons.js?v=0.4.0-dev.12';
setIcon(document.querySelector('#settings'),'settings');
setIcon(document.querySelector('#show-preview'),'preview');
generationIcon(document.querySelector('#cancel'),false);
const pending=new Map();let state;
const ui={page:'preset',previous:'preset',scheme:{},apiDraft:{},models:[]};
const app=document.querySelector('#app'),tabs=document.querySelector('#tabs'),status=document.querySelector('#status');
function rpc(method,payload={}) {
    const requestId=createId();
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('酒馆响应超时，请刷新后重试。'));},30000);
        pending.set(requestId,{resolve,reject,timer});
        parent.postMessage({channel:CHANNEL,type:'request',requestId,method,payload},location.origin);
    });
}
async function act(method,payload={},refresh=true) {
    try {const result=await rpc(method,payload);if(refresh&&result?.settings){
        if(method==='api.save'){ui.apiDraft={};}
        state=result;draw();
    }return result;}
    catch(error){status.textContent=error.message;status.classList.add('error');return undefined;}
}
function draw(){
    document.documentElement.dataset.appearance=state.settings.appearance||'auto';
    appearanceIcon(document.querySelector('#appearance'),state.settings.appearance||'auto');
    document.querySelector('#show-preview').setAttribute('aria-pressed',String(ui.page==='preview'));
    tabs.hidden=['settings','preview'].includes(ui.page);
    app.hidden=ui.page==='preview';
    document.querySelector('#preview-page').hidden=ui.page!=='preview';
    for(const tab of tabs.children)tab.setAttribute('aria-selected',String(tab.dataset.page===ui.page));
    document.querySelector('#settings').setAttribute('aria-label',ui.page==='settings'?'返回':'设置');
    document.querySelector('#settings').title=ui.page==='settings'?'返回':'设置';
    if(ui.page!=='preview')renderView(app,state,ui,act);
}
for(const [page,label] of [['preset','预设'],['world','世界书']]){const tab=button(label,()=>{ui.page=page;draw();});tab.dataset.page=page;tab.setAttribute('role','tab');tabs.append(tab);}
document.querySelector('#settings').addEventListener('click',()=>{if(ui.page==='settings')ui.page=ui.previous;else{ui.previous=ui.page;ui.page='settings';}if(state)draw();});
document.querySelector('#appearance').addEventListener('click',()=>{parent.postMessage({channel:CHANNEL,type:'appearance'},location.origin);});
const closePanel=()=>parent.postMessage({channel:CHANNEL,type:'close'},location.origin);
document.querySelector('#close').addEventListener('click',closePanel);
document.querySelector('#show-preview').addEventListener('click',()=>{if(ui.page==='preview')ui.page=ui.previewPrevious||'preset';else{ui.previewPrevious=ui.page;ui.page='preview';}if(state)draw();});

document.querySelector('#cancel').addEventListener('click',()=>parent.postMessage({channel:CHANNEL,type:'cancel'},location.origin));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))closePanel();});
window.addEventListener('message',event=>{
    if(!acceptsMessage(event,parent,location.origin))return;
    const data=event.data;
    if(data.type==='response') {const request=pending.get(data.requestId);if(!request)return;clearTimeout(request.timer);pending.delete(data.requestId);data.ok?request.resolve(data.result):request.reject(Error(data.error||'操作失败。'));}
    else if(data.type==='theme')for(const key of THEME_KEYS){const value=data.payload?.[key];if(typeof value==='string'){if(value)document.documentElement.style.setProperty(key,value);else document.documentElement.style.removeProperty(key);}}
    else if(data.type==='state'){generationIcon(document.querySelector('#cancel'),data.payload.busy);status.classList.remove('error');status.textContent=data.payload.status||'';document.querySelector('#preview').textContent=data.payload.preview||'';}
    else if(data.type==='appearance'){document.documentElement.dataset.appearance=data.payload;appearanceIcon(document.querySelector('#appearance'),data.payload);if(state)state.settings.appearance=data.payload;}
    else if(data.type==='refresh')act('sources.refresh');
});
act('state.read');
