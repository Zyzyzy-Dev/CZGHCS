/* 宿主面板交互：右下角缩放及遮罩关闭，不触碰生成生命周期。 */
export function attachPanelInteractions(dialog){
 const grip=document.createElement('button');grip.type='button';grip.setAttribute('aria-label','调整创作规划窗口大小');grip.title='拖动调整大小；方向键微调';
 for(const [key,value] of Object.entries({position:'absolute',right:'1px',bottom:'1px',width:'24px',height:'24px',padding:'0',margin:'0',border:'0',background:'transparent',color:'#7587a2',cursor:'nwse-resize','touch-action':'none','z-index':'2','min-width':'0','min-height':'0','box-shadow':'none','border-radius':'0'}))grip.style.setProperty(key,value,'important');
 grip.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" style="pointer-events:none"><path d="M9 19L19 9M14 19L19 14" fill="none" stroke="#7587a2" stroke-width="1.8" stroke-linecap="round"/></svg>';dialog.append(grip);
 let drag=null,outsideDown=false;
 const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
 const resize=(width,height)=>{
  const maxWidth=window.innerWidth*.96,maxHeight=window.innerHeight*.92;
  dialog.style.setProperty('width',`${Math.min(maxWidth,Math.max(Math.min(320,maxWidth),width))}px`,'important');
  dialog.style.setProperty('height',`${Math.min(maxHeight,Math.max(Math.min(280,maxHeight),height))}px`,'important');
 };
 grip.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();const r=dialog.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,width:r.width,height:r.height};grip.setPointerCapture(event.pointerId);});
 grip.addEventListener('pointermove',event=>{if(drag?.id===event.pointerId)resize(drag.width+2*(event.clientX-drag.x),drag.height+2*(event.clientY-drag.y));});
 const end=()=>{drag=null;};grip.addEventListener('pointerup',end);grip.addEventListener('pointercancel',end);grip.addEventListener('lostpointercapture',end);
 grip.addEventListener('keydown',event=>{const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];if(!delta)return;event.preventDefault();const r=dialog.getBoundingClientRect();resize(r.width+delta[0],r.height+delta[1]);});
 dialog.addEventListener('pointerdown',event=>{outsideDown=event.target===dialog&&outside(event);});
 dialog.addEventListener('pointerup',event=>{if(outsideDown&&event.target===dialog&&outside(event))dialog.close();outsideDown=false;});
 dialog.addEventListener('pointercancel',()=>{outsideDown=false;});
 dialog.addEventListener('close',()=>{outsideDown=false;if(drag&&grip.hasPointerCapture(drag.id))grip.releasePointerCapture(drag.id);drag=null;});
}
