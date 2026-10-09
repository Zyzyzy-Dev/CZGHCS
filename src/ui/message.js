/* 楼内规划视图：安全文本渲染、五项主题接收以及高度上报。 */
import {CHANNEL,THEME_KEYS,acceptsMessage} from '../bridge/protocol.js?v=0.4.0-dev.5';
const details=document.querySelector('details');
const resize=()=>parent.postMessage({channel:CHANNEL,type:'height',payload:document.body.scrollHeight+4},location.origin);
window.addEventListener('message',event=>{
    if(!acceptsMessage(event,parent,location.origin))return;
    const {type,payload}=event.data;
    const theme=type==='plan'?payload.theme:type==='theme'?payload:null;
    if(theme)for(const key of THEME_KEYS)if(typeof theme[key]==='string'&&theme[key])document.documentElement.style.setProperty(key,theme[key]);
    if(type==='plan') {document.querySelector('pre').textContent=`${payload.record.openTag}\n${payload.record.text}\n${payload.record.closeTag}`;document.querySelector('#stale').textContent=payload.record.stale?'· 历史规划（正文已编辑）':'';}
    requestAnimationFrame(resize);
});
details.addEventListener('toggle',resize);new ResizeObserver(resize).observe(document.body);
