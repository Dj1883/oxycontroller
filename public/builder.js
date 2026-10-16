(()=>{
const catalogs=[
 {name:'Heading',type:'heading',content:'## Section heading'},
 {name:'Paragraph',type:'paragraph',content:'Write a paragraph here.'},
 {name:'Bullet list',type:'list',content:'- First item\n- Second item'},
 {name:'Note callout',type:'note',content:':::note\nHelpful note text.\n:::'},
 {name:'Warning callout',type:'warning',content:':::warning\nImportant warning.\n:::'},
 {name:'Steps',type:'steps',content:':::steps\n1. First step\n2. Second step\n:::'},
 {name:'Code block',type:'code',content:'```js\n// Add code here\n```'},
 {name:'Divider',type:'divider',content:'---'},
 {name:'Quote',type:'quote',content:'> Add a quotation or key point.'}
];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parse(text){return String(text||'').split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean).map(s=>({type:/^#{1,3} /.test(s)?'heading':/^- /.test(s)?'list':/^:::warning/.test(s)?'warning':/^:::note/.test(s)?'note':/^```/.test(s)?'code':'paragraph',content:s}));}
function serialize(blocks){return blocks.map(b=>b.content.trim()).filter(Boolean).join('\n\n')+'\n';}
function htmlBlock(b,i){const title=b.type==='heading'?'Heading':b.type==='list'?'List':b.type[0].toUpperCase()+b.type.slice(1);return `<button type="button" class="builder-block" data-block-index="${i}"><small>${esc(title)}</small><div>${esc(b.content).slice(0,800)}</div></button>`;}
function init(root){if(root.dataset.builderReady)return;root.dataset.builderReady='1';const id=root.dataset.builderFor;const source=document.getElementById(id);if(!source)return;const palette=root.querySelector('[data-builder-palette]'),canvas=root.querySelector('[data-builder-canvas]'),inspect=root.querySelector('[data-builder-inspector]'),status=root.querySelector('[data-builder-status]');let blocks=parse(source.value),selected=0,mode='visual';
function paint(){canvas.innerHTML=blocks.length?blocks.map(htmlBlock).join(''):'<div class="empty">Canvas is empty. Add a block from the left.</div>';canvas.querySelectorAll('[data-block-index]').forEach(btn=>btn.addEventListener('click',()=>{selected=Number(btn.dataset.blockIndex);renderInspector();paintSelection();}));source.value=serialize(blocks);if(status)status.textContent='Visual content synced';}
function paintSelection(){canvas.querySelectorAll('[data-block-index]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.blockIndex)===selected));}
function renderInspector(){const b=blocks[selected];if(!b){inspect.innerHTML='<div class="builder-inspector-empty"><strong>Select a block</strong><span>Add or select a block to edit.</span></div>';return;}inspect.innerHTML=`<strong>Edit ${esc(b.type)}</strong><label>Markdown content<textarea rows="12" data-inspector-content>${esc(b.content)}</textarea></label><div class="action-row"><button type="button" class="button secondary" data-block-up>Move up</button><button type="button" class="button secondary" data-block-down>Move down</button><button type="button" class="button danger" data-block-remove>Remove</button></div>`;inspect.querySelector('[data-inspector-content]').addEventListener('input',e=>{blocks[selected].content=e.target.value;paint();paintSelection();});inspect.querySelector('[data-block-up]').addEventListener('click',()=>{if(selected>0){[blocks[selected-1],blocks[selected]]=[blocks[selected],blocks[selected-1]];selected--;paint();renderInspector();paintSelection();}});inspect.querySelector('[data-block-down]').addEventListener('click',()=>{if(selected<blocks.length-1){[blocks[selected+1],blocks[selected]]=[blocks[selected],blocks[selected+1]];selected++;paint();renderInspector();paintSelection();}});inspect.querySelector('[data-block-remove]').addEventListener('click',()=>{blocks.splice(selected,1);selected=Math.max(0,selected-1);paint();renderInspector();});}
function add(b){blocks.push({...b});selected=blocks.length-1;paint();renderInspector();paintSelection();}
function renderPalette(q=''){palette.innerHTML='';catalogs.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).forEach(item=>{const btn=document.createElement('button');btn.type='button';btn.className='builder-palette-item';btn.textContent=item.name;btn.addEventListener('click',()=>add(item));palette.appendChild(btn);});}
renderPalette();paint();renderInspector();
root.querySelector('[data-builder-search]')?.addEventListener('input',e=>renderPalette(e.target.value));
root.querySelector('[data-builder-preview]')?.addEventListener('click',()=>{inspect.innerHTML='<strong>Markdown preview</strong><div class="md-preview">'+blocks.map(b=>'<p>'+esc(b.content).replace(/\n/g,'<br>')+'</p>').join('')+'</div>';});
root.querySelector('[data-builder-toggle]')?.addEventListener('click',()=>{const hidden=source.style.display!=='block';source.style.display=hidden?'block':'none';root.querySelector('.builder-layout').style.display=hidden?'none':'';root.querySelector('[data-builder-toggle]').textContent=hidden?'Visual builder':'Markdown';if(hidden){source.focus();source.addEventListener('input',()=>{blocks=parse(source.value);paint();renderInspector();},{once:false});}});
root.querySelector('[data-builder-fullscreen]')?.addEventListener('click',()=>{if(!document.fullscreenElement)root.requestFullscreen?.();else document.exitFullscreen?.();});
root.querySelector('[data-builder-open]')?.addEventListener('click',()=>{root.querySelector('[data-builder-search]')?.focus();});
root.querySelector('[data-builder-device="desktop"]')?.addEventListener('click',()=>{root.querySelectorAll('[data-builder-device]').forEach(x=>x.classList.toggle('active',x.dataset.builderDevice==='desktop'));canvas.style.maxWidth='none';});
root.querySelector('[data-builder-device="mobile"]')?.addEventListener('click',()=>{root.querySelectorAll('[data-builder-device]').forEach(x=>x.classList.toggle('active',x.dataset.builderDevice==='mobile'));canvas.style.maxWidth='390px';});
root.querySelector('[data-builder-close]')?.addEventListener('click',()=>root.querySelector('[data-builder-sheet]')?.classList.remove('open'));
}
document.querySelectorAll('.builder-wrap').forEach(init);
})();