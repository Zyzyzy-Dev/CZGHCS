/* 楼内规划视图：安全文本渲染、五项主题接收以及高度上报。 */
import {CHANNEL,THEME_KEYS,acceptsMessage} from '../bridge/protocol.js?v=0.4.0-dev.9';
const details=document.querySelector('details');
const resize=()=>parent.postMessage({channel:CHANNEL,type:'height',payload:document.body.scrollHeight+4},location.origin);
window.addEventListener('message',event=>{
    if(!acceptsMessage(event,parent,location.origin))return;
    const {type,payload}=event.data;
    const theme=type==='plan'?payload.theme:type==='theme'?payload:null;
    if(theme)for(const key of THEME_KEYS)if(typeof theme[key]==='string'&&theme[key])document.documentElement.style.setProperty(key,theme[key]);
    if(type==='plan') {
        const record=payload.record;
        const labels={waiting:'等待规划开始',preparing:'正在准备资料',streaming:'正在生成',error:'生成失败',cancelled:'已停止',skipped:'本轮未生成规划'};
        document.querySelector('#phase').textContent=record.phase?`· ${labels[record.phase]||record.phase}`:'';
        document.querySelector('pre').textContent=record.phase
            ? [record.text,record.error?`错误：${record.error}`:!record.text?labels[record.phase]:''].filter(Boolean).join('\n\n')
            : `${record.openTag}\n${record.text}\n${record.closeTag}`;
        document.querySelector('#stale').textContent=record.stale?'· 历史规划（正文已编辑）':'';
    }
    requestAnimationFrame(resize);
});
details.addEventListener('toggle',resize);new ResizeObserver(resize).observe(document.body);
