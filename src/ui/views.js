/* 三页工作台视图：设置、预设开关、世界书开关与来源详情；所有操作交给宿主。 */
import { el, button, field, check, select, section, detail, ask } from './components.js?v=0.4.0-dev.4';
import { entryKey } from '../planning/world-info.js?v=0.4.0-dev.4';
export function renderView(root, state, ui, act) {
    const s=state.settings, selection=s.selection;
    root.replaceChildren();
    const toolbar=(kind)=>{
        const bar=el('div','scheme-bar');bar.append(el('span','muted','方案'));
        const options=[{id:'',name:'当前开关（未保存）'},...s.schemes[kind]];
        bar.append(select(`${kind==='preset'?'预设':'世界书'}方案`,options,ui.scheme[kind]||'',async id=>{ui.scheme[kind]=id;if(id)await act('scheme.save',{kind,applyId:id});}));
        bar.append(button('新建方案',async()=>{const name=await ask('新建方案','');if(name)await act('scheme.save',{kind,name});},'+'));
        const overwrite=button('覆盖方案',async()=>{const item=options.find(x=>x.id===ui.scheme[kind]);if(!item?.id)return;const name=await ask('覆盖方案',item.name);if(name)await act('scheme.save',{kind,id:item.id,name});},'↥');overwrite.disabled=!options.some(x=>x.id&&x.id===ui.scheme[kind]);bar.append(overwrite);
        const remove=button('删除方案',async()=>{if(await ask('删除选中的方案？','',true)){await act('scheme.remove',{kind,id:ui.scheme[kind]});ui.scheme[kind]='';}},'⌫');remove.disabled=!ui.scheme[kind];bar.append(remove);return bar;
    };
    const change=(key,id,value)=>act('selection.update',{[key]:{...selection[key],[id]:value}});
    const row=(label,content,checked,toggle)=>{const node=el('div','entry-row');node.append(check(label,checked,toggle),button('查看 '+label,()=>detail(label,content),'›'));return node;};
    if(ui.page==='settings'){
        root.append(check('启用创作规划',s.enabled,v=>act('settings.update',{enabled:v})));
        const api=el('div','section-body');
        const profile=state.profiles.find(p=>p.id===s.apiSelection);
        const apiOptions=profile?state.profiles:[{id:s.apiSelection||'',name:'原方案不可用，请重新选择',origin:'missing'},...state.profiles];
        const draft=ui.apiDraft;
        const bar=el('div','scheme-bar');bar.append(el('span','muted','方案'),select('API 方案',apiOptions.map(p=>({...p,name:`${p.origin==='external'?'编辑器 · ':p.origin==='local'?'本地 · ':''}${p.name}`})),s.apiSelection,async value=>{ui.apiDraft={};await act('settings.update',{apiSelection:value});}));
        const save=async overwrite=>{const name=await ask(overwrite?'覆盖 API 方案':'新建 API 方案',overwrite?profile?.name:'');if(name)await act('api.save',{id:overwrite?s.apiSelection:undefined,sourceId:s.apiSelection,name,apiUrl:draft.apiUrl,model:draft.model,key:draft.key});};
        bar.append(button('新建 API 方案',()=>save(false),'+'));
        const over=button('覆盖 API 方案',()=>save(true),'↥');over.disabled=profile?.origin!=='local';bar.append(over);
        const del=button('删除 API 方案',async()=>{if(await ask('删除此 API 方案？','',true))await act('api.remove',{id:s.apiSelection});},'⌫');del.disabled=profile?.origin!=='local';bar.append(del);api.append(bar);
        api.append(field('URL',draft.apiUrl??profile?.apiUrl,v=>draft.apiUrl=v));
        const key=field('Key',draft.key||'',v=>draft.key=v,'password');key.querySelector('input').placeholder=profile?.hasKey?'已保存，留空保留原密钥':'输入新密钥';key.append(button('显示或隐藏密钥',()=>{const input=key.querySelector('input');input.type=input.type==='password'?'text':'password';},'◉'));api.append(key);
        const model=field('模型',draft.model??profile?.model,v=>draft.model=v);model.querySelector('input').setAttribute('list','model-list');model.append(button('拉取模型',async()=>{ui.models=await act('api.models',{},false);renderView(root,state,ui,act);}));api.append(model);
        const list=el('datalist');list.id='model-list';for(const name of ui.models||[]){const o=el('option');o.value=name;list.append(o);}api.append(list);
        const numbers=el('div','two-fields');numbers.append(field('最大输出',s.maxTokens,v=>act('settings.update',{maxTokens:v}),'number'),field('超时秒数',s.timeoutSeconds,v=>act('settings.update',{timeoutSeconds:v}),'number'));api.append(numbers);
        api.append(el('p','hint','自动记住上次使用的方案。编辑器方案只读；新建和覆盖仅保存到创作规划。新密钥保存在当前浏览器，刷新后保留；清除网站数据会删除密钥，不自动同步到其他设备。'));
        root.append(section('通用设置',api));
        const compatibility=el('div','section-body');
        for(const [category,label] of [['memory','记忆插件'],['plot','剧情规划插件']]){compatibility.append(el('h3','',label));for(const plugin of state.compatibility.filter(p=>p.category===category)){const line=el('div','plugin-row');line.append(check(plugin.name,selection.compatibilityIds.includes(plugin.id),v=>act('selection.update',{compatibilityIds:v?[...selection.compatibilityIds,plugin.id]:selection.compatibilityIds.filter(x=>x!==plugin.id)})),el('small','muted',plugin.status));compatibility.append(line);}}
        root.append(section('插件兼容',compatibility));
        const display=el('div','section-body');display.append(check('楼内显示规划',s.displayPlan,v=>act('settings.update',{displayPlan:v})));root.append(section('显示设置',display));
        const advanced=el('div','section-body');advanced.append(select('规划标签',[{id:'auto',name:'自动跟随预设标签'},{id:'manual',name:'手动指定标签'}],s.tagMode,v=>act('settings.update',{tagMode:v})));
        if(s.tagMode==='manual')advanced.append(field('开始标签',s.openTag,v=>act('settings.update',{openTag:v})),field('结束标签',s.closeTag,v=>act('settings.update',{closeTag:v})));
        root.append(section('高级设置',advanced,true));
    } else if(ui.page==='preset') {
        const bar=toolbar('preset');const chooser=el('div','preset-choice');chooser.append(el('span','muted','选择预设'),select('选择预设',state.presets.map(id=>({id,name:id})),selection.presetId||state.preset?.id,id=>act('selection.update',{presetId:id,promptOverrides:{},groupOverrides:{}})));bar.append(chooser);root.append(bar);
        for(const item of state.preset?.display||[]){if(item.type==='prompt'){const entry=item.entry;root.append(row(entry.name||entry.identifier,entry.content,entry.enabled,v=>change('promptOverrides',entry.identifier,v)));continue;}const group=item.group;const content=el('div','section-body');content.append(check('启用 '+group.name,group.checked,async value=>{const promptOverrides={...selection.promptOverrides};for(const entry of group.entries)promptOverrides[entry.identifier]=value;await act('selection.update',{promptOverrides,groupOverrides:group.id?{...selection.groupOverrides,[group.id]:value}:selection.groupOverrides});},group.partial));for(const entry of group.entries)content.append(row(entry.name||entry.identifier,entry.content,entry.enabled,v=>change('promptOverrides',entry.identifier,v)));root.append(section(group.name,content,group.collapsed));}
    } else {
        root.append(toolbar('world'));
        const bindings=[['全局世界书',state.bindings.global],['角色世界书',state.bindings.character],['聊天世界书',state.bindings.chat],['用户角色世界书',state.bindings.persona],['插件开启的世界书',selection.extraBooks]];
        for(const [label,names] of bindings){if(!names?.length&& !['全局世界书','角色世界书','插件开启的世界书'].includes(label))continue;const content=el('div','section-body');
            if(!names?.length)content.append(el('p','hint','尚未挂载世界书'));
            for(const name of names||[]){const book=el('div','book');book.append(check(name,selection.bookOverrides[name]!==false,v=>change('bookOverrides',name,v)));for(const [uid,entry] of Object.entries(state.books[name]?.entries||{})){const key=entryKey(name,entry.uid??uid);book.append(row(entry.comment||`条目 ${uid}`,entry.content,selection.entryOverrides[key]??!entry.disable,v=>change('entryOverrides',key,v)));}content.append(book);}
            root.append(section(label,content));}
        const add=button('添加世界书',()=>{
            const dialog=el('dialog','detail-dialog');dialog.append(el('h2','','添加世界书'));const search=el('input');search.placeholder='搜索世界书';search.setAttribute('aria-label','搜索世界书');const list=el('div','book-picker');
            const draw=()=>{list.replaceChildren();for(const name of state.bookNames.filter(n=>n.toLowerCase().includes(search.value.toLowerCase()))){const selected=selection.extraBooks.includes(name);list.append(check(name,selected,async v=>{await act('selection.update',{extraBooks:v?[...selection.extraBooks,name]:selection.extraBooks.filter(x=>x!==name)});dialog.close();}));}};
            search.addEventListener('input',draw);dialog.append(search,list,button('完成',()=>dialog.close()));document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());draw();dialog.showModal();
        });add.className='primary add-book';root.append(add);
    }
    if(state.error)root.append(el('p','error',state.error));
}
