// Folio front end: renders with pdf.js, edits in SVG, saves through the local server.
{
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const I={select:'M6 3l13 8-6 1.5L10 19z',text:'M5 7V4h14v3M12 4v16M9 20h6',pen:'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',hl:'M9 14l-3 3 2 2 3-3M9 14l8-10 3 3-8 10zM4 21h8',box:'M4 5h16v14H4z',ellipse:'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',arrow:'M5 19L19 5M10 5h9v9',white:'M4 20h16M6 15l8-10 5 4-7 9H8z',sign:'M3 16c2-4 4-8 5.5-7S7 17 9 17s3-5 5-5-.5 4 1.5 4 2.5-2 5.5-2M3 20h18',image:'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9h.01',undo:'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',redo:'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',open:'M3 6h6l2 2h10v11H3z',add:'M6 3h8l4 4v14H6zM12 10v7M8.5 13.5h7',save:'M12 4v11M7 10l5 5 5-5M5 20h14',rotr:'M19 12a7 7 0 11-2.5-5.4M19 4v4h-4',rotl:'M5 12a7 7 0 102.5-5.4M5 4v4h4',up:'M12 19V5M6 11l6-6 6 6',down:'M12 5v14M6 13l6 6 6-6',dup:'M9 9h11v11H9zM5 15V4h11',blank:'M6 3h9l4 4v14H6zM15 3v4h4',extract:'M6 3h9l4 4v14H6zM12 9v7M9 13l3 3 3-3',trash:'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',search:'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4'};
$$('[data-ic]').forEach(b=>b.insertAdjacentHTML('afterbegin',`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${I[b.dataset.ic]}"/></svg>`));
const toast=m=>{const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),2800)};
const L=window.pdfjsLib;
if(!L){$('#fname').textContent='The PDF engine did not load. Is the Folio server running?'}
else{
L.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.js';
const view=$('#view'),pagesEl=$('#pages'),thumbsEl=$('#thumbs');
let docs=[],pages=[],zoom=1,fit=true,tool='select',sel=null,selPages=new Set(),cur=null,uid=1,hist=[],fut=[],hits=[],hitI=-1,lastQ='',sig=null,pendingImg=null,fileName='document.pdf',isSample=false,drag=null,editing=null,gm=false;
const imgs={},ratio={},pdfPages=new Map(),tcache=new Map();
const opt={width:3,size:16,font:'sans'};
const colors={text:'#10131a',pen:'#0b4f8a',box:'#c1121f',ellipse:'#c1121f',arrow:'#c1121f',hl:'#ffd400'};
const INK=['#10131a','#c1121f','#0b4f8a','#1d7a46','#7b3fa0','#ffffff'],HLP=['#ffd400','#7ee081','#ff9ad5','#80cfff'];
const FAM={sans:'Helvetica, Arial, sans-serif',serif:'"Times New Roman", Times, serif',mono:'"Courier New", Courier, monospace'};
const nid=()=>'k'+(uid++),r1=v=>Math.round(v*10)/10;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const snap=()=>JSON.stringify(pages);
const getPg=(d,i)=>{const k=d+':'+i;if(!pdfPages.has(k))pdfPages.set(k,docs[d].pdf.getPage(i+1));return pdfPages.get(k)};
const dims=p=>p.rot%180?{w:p.h0,h:p.w0}:{w:p.w0,h:p.h0};
const pageById=id=>pages.find(q=>q.id===id);
function blankVP(p){const W=p.w0,H=p.h0,r=p.rot;return{convertToPdfPoint:(x,y)=>r===0?[x,H-y]:r===90?[y,x]:r===180?[W-x,y]:[W-y,H-x]}}
async function vpOf(p){if(p.doc<0)return blankVP(p);const pg=await getPg(p.doc,p.idx);return pg.getViewport({scale:1,rotation:(pg.rotate+p.rot)%360})}
const mctx=document.createElement('canvas').getContext('2d');
const tw=a=>{mctx.font=`${a.size}px ${FAM[a.f]}`;return Math.max(a.size*.5,...a.text.split('\n').map(l=>mctx.measureText(l).width))};
function bb(a){
 if(a.t==='pen'){const xs=a.pts.map(p=>p[0]),ys=a.pts.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);return{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y}}
 if(a.t==='arrow')return{x:Math.min(a.x1,a.x2),y:Math.min(a.y1,a.y2),w:Math.abs(a.x2-a.x1),h:Math.abs(a.y2-a.y1)};
 if(a.t==='text')return{x:a.x,y:a.y,w:tw(a),h:a.text.split('\n').length*a.size*1.2};
 return{x:a.x,y:a.y,w:a.w,h:a.h}}
function moveA(a,dx,dy){if(a.t==='pen')a.pts=a.pts.map(([x,y])=>[r1(x+dx),r1(y+dy)]);else if(a.t==='arrow'){a.x1+=dx;a.y1+=dy;a.x2+=dx;a.y2+=dy}else{a.x+=dx;a.y+=dy}}
const head=a=>{const g=Math.atan2(a.y2-a.y1,a.x2-a.x1),l=Math.max(10,a.sw*4),s=.45;return[[a.x2-l*Math.cos(g-s),a.y2-l*Math.sin(g-s)],[a.x2-l*Math.cos(g+s),a.y2-l*Math.sin(g+s)]]};
function annSVG(a){
 const id=`data-a="${a.id}"`,xywh=`x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}"`;
 switch(a.t){
 case 'box':return `<rect ${id} ${xywh} fill="none" stroke="${a.c}" stroke-width="${a.sw}" pointer-events="all"/>`;
 case 'ellipse':return `<ellipse ${id} cx="${a.x+a.w/2}" cy="${a.y+a.h/2}" rx="${a.w/2}" ry="${a.h/2}" fill="none" stroke="${a.c}" stroke-width="${a.sw}" pointer-events="all"/>`;
 case 'hl':return `<rect ${id} ${xywh} fill="${a.c}" fill-opacity=".4" style="mix-blend-mode:multiply"/>`;
 case 'white':return `<rect ${id} ${xywh} fill="#fff"/>`;
 case 'pen':{const pts=a.pts.map(p=>p.join(',')).join(' ');return `<g ${id}><polyline points="${pts}" fill="none" stroke="${a.c}" stroke-width="${a.sw}" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${pts}" fill="none" stroke="transparent" stroke-width="${a.sw+10}"/></g>`}
 case 'arrow':{const[h1,h2]=head(a),d=`M${a.x1},${a.y1}L${a.x2},${a.y2}M${h1}L${a.x2},${a.y2}L${h2}`;return `<g ${id}><path d="${d}" fill="none" stroke="${a.c}" stroke-width="${a.sw}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="transparent" stroke-width="${a.sw+10}"/></g>`}
 case 'text':{const b=bb(a);return `<g ${id}><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="transparent"/><text font-family='${FAM[a.f]}' font-size="${a.size}" fill="${a.c}" style="white-space:pre">${a.text.split('\n').map((l,i)=>`<tspan x="${a.x}" y="${a.y+a.size*(1+1.2*i)}">${esc(l)||' '}</tspan>`).join('')}</text></g>`}
 case 'img':return `<image ${id} href="${imgs[a.img]}" ${xywh} preserveAspectRatio="none"/>`}
 return ''}
function selSVG(p){
 const a=sel&&sel.pid===p.id&&p.anns.find(q=>q.id===sel.aid);if(!a)return '';
 const b=bb(a),g=3/zoom,hs=14/zoom,rz=['box','ellipse','hl','white','img'].includes(a.t);
 return `<rect x="${b.x-g}" y="${b.y-g}" width="${b.w+2*g}" height="${b.h+2*g}" fill="none" stroke="#0b4f8a" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none"/>`+(rz?`<rect data-h="1" x="${b.x+b.w-hs/2}" y="${b.y+b.h-hs/2}" width="${hs}" height="${hs}" fill="#0b4f8a" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" style="cursor:nwse-resize"/>`:'')}
const hitSVG=p=>hits.map((h,i)=>h.pid!==p.id?'':`<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" fill="#c1121f" fill-opacity="${i===hitI?.28:.12}" stroke="#c1121f" stroke-width="${i===hitI?2:1}" vector-effect="non-scaling-stroke" pointer-events="none"/>`).join('');
function draw(p){
 const el=pagesEl.querySelector(`.pg[data-id="${p.id}"]`);
 if(el)el.querySelector('svg').innerHTML=p.anns.filter(a=>!(editing&&editing.a.id===a.id)).map(annSVG).join('')+hitSVG(p)+selSVG(p);
 const th=thumbsEl.querySelector(`.th[data-id="${p.id}"] svg`);if(th)th.innerHTML=p.anns.map(annSVG).join('')}
const drawAll=()=>pages.forEach(draw);

/* history */
function ubtn(){$('#bUndo').disabled=!hist.length;$('#bRedo').disabled=!fut.length}
function mark(){hist.push(snap());if(hist.length>150)hist.shift();fut=[];ubtn()}
const gmark=()=>{if(!gm){mark();gm=true}};
function undo(){closeEditor();if(!hist.length)return;fut.push(snap());pages=JSON.parse(hist.pop());sel=null;hits=[];layout();ubtn()}
function redo(){closeEditor();if(!fut.length)return;hist.push(snap());pages=JSON.parse(fut.pop());sel=null;hits=[];layout();ubtn()}

/* layout and painting */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)paint(e.target)}),{root:view,rootMargin:'800px 0px'});
const tio=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)paintThumb(e.target)}),{root:thumbsEl,rootMargin:'400px'});
function fitZoom(){if(!pages.length)return 1;const pad=parseFloat(getComputedStyle(view).paddingLeft)*2;return Math.min(2.5,Math.max(.25,(view.clientWidth-pad)/Math.max(...pages.map(p=>dims(p).w))))}
const key=p=>p.id+':'+p.rot+':'+zoom;
function pageEl(p){const{w,h}=dims(p),el=document.createElement('div');el.className='pg';el.dataset.id=p.id;el.dataset.key=key(p);el.style.width=w*zoom+'px';el.style.height=h*zoom+'px';el.innerHTML=`<canvas></canvas><svg viewBox="0 0 ${w} ${h}"></svg>`;io.observe(el);return el}
async function paint(el){
 if(el.dataset.done)return;el.dataset.done=1;const p=pageById(el.dataset.id);if(!p)return;
 const c=el.querySelector('canvas'),{w,h}=dims(p),k=Math.min(4,zoom*Math.min(devicePixelRatio||1,2));
 c.width=Math.round(w*k);c.height=Math.round(h*k);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 if(p.doc<0)return;const pg=await getPg(p.doc,p.idx);
 try{await pg.render({canvasContext:ctx,viewport:pg.getViewport({scale:k,rotation:(pg.rotate+p.rot)%360})}).promise}catch(e){}}
async function paintThumb(el){
 if(el.dataset.done)return;el.dataset.done=1;const p=pageById(el.dataset.id);if(!p)return;
 const c=el.querySelector('canvas'),{w,h}=dims(p),s=236/w;c.width=Math.round(w*s);c.height=Math.round(h*s);
 const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);if(p.doc<0)return;
 const pg=await getPg(p.doc,p.idx);try{await pg.render({canvasContext:ctx,viewport:pg.getViewport({scale:s,rotation:(pg.rotate+p.rot)%360})}).promise}catch(e){}}
function mkThumb(p){const{w,h}=dims(p),el=document.createElement('div');el.className='th';el.dataset.id=p.id;el.dataset.key=p.id+':'+p.rot;el.draggable=true;el.tabIndex=0;el.innerHTML=`<div class="tw" style="aspect-ratio:${w}/${h}"><canvas></canvas><svg viewBox="0 0 ${w} ${h}"></svg></div><span></span>`;tio.observe(el);return el}
function thumbs(){
 const old=new Map([...thumbsEl.children].map(e=>[e.dataset.id,e]));
 thumbsEl.replaceChildren(...pages.map((p,i)=>{let el=old.get(p.id);if(el&&el.dataset.key!==p.id+':'+p.rot){tio.unobserve(el);el=null}if(!el)el=mkThumb(p);
  el.querySelector('span').textContent=i+1;el.setAttribute('aria-label','Page '+(i+1));el.classList.toggle('sel',selPages.has(p.id));el.classList.toggle('cur',p.id===cur);return el}));
 old.forEach(e=>{if(!e.isConnected)tio.unobserve(e)})}
function layout(){
 if(editing)closeEditor();
 if(fit)zoom=fitZoom();
 const old=new Map([...pagesEl.children].map(e=>[e.dataset.id,e]));
 pagesEl.replaceChildren(...pages.map(p=>{let el=old.get(p.id);if(el&&el.dataset.key!==key(p))el=null;return el||pageEl(p)}));
 old.forEach(e=>{if(!e.isConnected)io.unobserve(e)});
 selPages.forEach(id=>{if(!pageById(id))selPages.delete(id)});
 if(!pageById(cur))cur=pages[0]?pages[0].id:null;
 thumbs();drawAll();
 $('#empty').hidden=pages.length>0;
 $('#fname').textContent=isSample?'Sample: studio-rental-agreement.pdf · open your own to start':`${fileName} · ${pages.length} page${pages.length===1?'':'s'}`;
 $('#zoom').value=fit?'fit':String(zoom);setInd();refreshProps()}
function setInd(){
 const i=pages.findIndex(p=>p.id===cur);$('#ind').textContent=pages.length?`Page ${i+1} of ${pages.length}`:'';
 $$('.th').forEach(t=>t.classList.toggle('cur',t.dataset.id===cur))}
function keepSpot(fn){
 const el=cur&&pagesEl.querySelector(`.pg[data-id="${cur}"]`),frac=el?(view.scrollTop-el.offsetTop)/el.offsetHeight:0,id=cur;
 fn();const n=id&&pagesEl.querySelector(`.pg[data-id="${id}"]`);if(n)view.scrollTop=n.offsetTop+frac*n.offsetHeight}
function setZoom(z){fit=false;keepSpot(()=>{zoom=z;layout()})}
function zoomStep(d){const Z=[.5,.75,1,1.25,1.5,2,3];const z=d>0?Z.find(v=>v>zoom+.01):[...Z].reverse().find(v=>v<zoom-.01);if(z)setZoom(z)}
function goto(id){const el=pagesEl.querySelector(`.pg[data-id="${id}"]`);if(el)view.scrollTo({top:el.offsetTop-16});cur=id;setInd()}
let sr=0;
view.addEventListener('scroll',()=>{cancelAnimationFrame(sr);sr=requestAnimationFrame(()=>{
 const mid=view.getBoundingClientRect().top+view.clientHeight*.35;let best=pagesEl.firstElementChild;
 for(const el of pagesEl.children){if(el.getBoundingClientRect().top<=mid)best=el;else break}
 if(best&&best.dataset.id!==cur){cur=best.dataset.id;setInd();const t=thumbsEl.querySelector(`.th[data-id="${cur}"]`);if(t){const r=t.getBoundingClientRect(),R=thumbsEl.getBoundingClientRect();if(r.top<R.top||r.bottom>R.bottom||r.left<R.left||r.right>R.right)t.scrollIntoView({block:'nearest',inline:'nearest'})}}})});
let rz=0;new ResizeObserver(()=>{cancelAnimationFrame(rz);rz=requestAnimationFrame(()=>{if(fit&&pages.length&&Math.abs(fitZoom()-zoom)>.02)keepSpot(layout)})}).observe(view);

/* tools and properties */
const selA=()=>{if(!sel)return null;const p=pageById(sel.pid);return p&&p.anns.find(a=>a.id===sel.aid)||null};
const selP=()=>sel&&pageById(sel.pid);
function setTool(t){
 closeEditor();tool=t;$$('.tl').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===t||(t==='place'&&b.dataset.tool==='image')));
 view.dataset.tool=t;if(t!=='select'&&sel){const p=selP();sel=null;if(p)draw(p)}refreshProps()}
function refreshProps(){
 const a=selA(),ct=a?a.t:tool,colorable=['text','pen','hl','box','ellipse','arrow'].includes(ct),sized=['text','pen','box','ellipse','arrow'].includes(ct);
 const curC=a?a.c:colors[ct];
 $('#sws').hidden=$('#colorIn').hidden=!colorable;
 if(colorable){$('#sws').innerHTML=(ct==='hl'?HLP:INK).map(c=>`<button class="sw" data-c="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${c===curC}"></button>`).join('');$('#colorIn').value=curC}
 $('#sizeL').hidden=!sized;
 if(sized){const isT=ct==='text',s=$('#size');s.min=isT?6:1;s.max=isT?72:24;s.value=a?(isT?a.size:a.sw):(isT?opt.size:opt.width);$('#sizeName').textContent=isT?'Size':'Width';$('#sizeOut').textContent=s.value}
 $('#fontSel').hidden=ct!=='text';if(ct==='text')$('#fontSel').value=a?a.f:opt.font;
 $('#delA').hidden=!a;$('#newSig').hidden=tool!=='sign';
 $('#hint').textContent=a?(a.t==='text'?'Double-click to retype':a.t==='white'?'Covers visually; text underneath stays in the file':''):({select:'Click a mark to edit it',text:'Click a page to type',sign:'Click a page to place it',place:'Click a page to place the image',white:'Covers visually; text underneath stays in the file',hl:'Drag across text'}[tool]||'')}
function applyColor(c,live){const a=selA(),ct=a?a.t:tool;if(a){live?gmark():mark();a.c=c;draw(selP())}colors[ct]=c;if(!live)refreshProps()}
$('#sws').addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(b)applyColor(b.dataset.c,false)});
$('#colorIn').addEventListener('input',e=>applyColor(e.target.value,true));
$('#colorIn').addEventListener('change',()=>{gm=false;refreshProps()});
$('#size').addEventListener('input',e=>{const v=+e.target.value,a=selA(),isT=(a?a.t:tool)==='text';$('#sizeOut').textContent=v;
 if(a){gmark();if(isT)a.size=v;else a.sw=v;draw(selP())}if(isT)opt.size=v;else opt.width=v});
$('#size').addEventListener('change',()=>{gm=false});
$('#fontSel').addEventListener('change',e=>{const a=selA();if(a&&a.t==='text'){mark();a.f=e.target.value;draw(selP())}opt.font=e.target.value});
function delSel(){const p=selP();if(!p)return;mark();p.anns=p.anns.filter(a=>a.id!==sel.aid);sel=null;draw(p);refreshProps()}
$('#delA').onclick=delSel;
$$('.tl').forEach(b=>b.onclick=()=>{const t=b.dataset.tool;if(t==='sign')sig?setTool('sign'):openSig();else if(t==='image')$('#fImg').click();else setTool(t)});
$('#newSig').onclick=openSig;

/* pointer editing */
const ptOf=(el,e)=>{const r=el.getBoundingClientRect();return[r1((e.clientX-r.left)/zoom),r1((e.clientY-r.top)/zoom)]};
pagesEl.addEventListener('pointerdown',e=>{
 if(e.button>0||e.target.closest('textarea'))return;const el=e.target.closest('.pg');if(!el)return;const p=pageById(el.dataset.id);if(!p)return;
 closeEditor();const pt=ptOf(el,e);if(cur!==p.id){cur=p.id;setInd()}
 const aEl=e.target.closest('[data-a]'),a=aEl&&p.anns.find(q=>q.id===aEl.dataset.a);
 if(tool==='select'){
  const s=selA();
  if(e.target.closest('[data-h]')&&s)drag={k:'resize',p,a:s,pt,ar:s.h/s.w};
  else if(a){const prev=selP();sel={pid:p.id,aid:a.id};if(prev&&prev!==p)draw(prev);drag={k:'move',p,a,pt,last:pt};draw(p);refreshProps()}
  else{if(sel){const prev=selP();sel=null;if(prev)draw(prev);refreshProps()}return}
 }else if(tool==='text'){
  e.preventDefault();
  if(a&&a.t==='text')openEditor(p,a,el,false);
  else openEditor(p,{id:nid(),t:'text',x:pt[0],y:r1(pt[1]-opt.size*.6),text:'',size:opt.size,c:colors.text,f:opt.font},el,true);
  return;
 }else if(tool==='sign'||tool==='place'){
  const id=tool==='sign'?sig&&sig.id:pendingImg;if(!id)return;e.preventDefault();
  const w=tool==='sign'?170:Math.min(240,dims(p).w*.5),h=w*ratio[id];mark();
  const n={id:nid(),t:'img',img:id,x:r1(pt[0]-w/2),y:r1(pt[1]-h/2),w,h};p.anns.push(n);
  if(tool==='place'){pendingImg=null;setTool('select')}sel={pid:p.id,aid:n.id};draw(p);refreshProps();return;
 }else{
  e.preventDefault();mark();let n;
  if(tool==='pen')n={id:nid(),t:'pen',pts:[pt],c:colors.pen,sw:opt.width};
  else if(tool==='arrow')n={id:nid(),t:'arrow',x1:pt[0],y1:pt[1],x2:pt[0],y2:pt[1],c:colors.arrow,sw:opt.width};
  else n={id:nid(),t:tool,x:pt[0],y:pt[1],w:0,h:0,c:colors[tool]||'#ffffff',sw:opt.width};
  p.anns.push(n);drag={k:'new',p,a:n,pt};
 }
 try{el.setPointerCapture(e.pointerId)}catch(err){}
});
pagesEl.addEventListener('pointermove',e=>{
 if(!drag)return;const el=pagesEl.querySelector(`.pg[data-id="${drag.p.id}"]`);if(!el)return;const pt=ptOf(el,e),a=drag.a;
 if(drag.k==='new'){
  if(a.t==='pen'){const l=a.pts[a.pts.length-1];if(Math.hypot(pt[0]-l[0],pt[1]-l[1])>1.2/zoom)a.pts.push(pt)}
  else if(a.t==='arrow'){a.x2=pt[0];a.y2=pt[1]}
  else{a.x=Math.min(pt[0],drag.pt[0]);a.y=Math.min(pt[1],drag.pt[1]);a.w=r1(Math.abs(pt[0]-drag.pt[0]));a.h=r1(Math.abs(pt[1]-drag.pt[1]))}
 }else if(drag.k==='move'){
  if(!drag.moved){if(Math.hypot(pt[0]-drag.pt[0],pt[1]-drag.pt[1])<2)return;mark();drag.moved=1}
  moveA(a,pt[0]-drag.last[0],pt[1]-drag.last[1]);drag.last=pt;
 }else{
  if(!drag.moved){mark();drag.moved=1}
  a.w=Math.max(6,r1(pt[0]-a.x));a.h=a.t==='img'?r1(a.w*drag.ar):Math.max(6,r1(pt[1]-a.y));
 }
 draw(drag.p)});
const endDrag=()=>{
 if(!drag)return;const{p,a,k}=drag;drag=null;
 if(k==='new'){
  const b=bb(a),tiny=a.t==='pen'?false:a.t==='arrow'?Math.hypot(b.w,b.h)<4:b.w<3||b.h<3;
  if(a.t==='pen'&&a.pts.length===1)a.pts.push([a.pts[0][0]+.1,a.pts[0][1]]);
  if(tiny){p.anns=p.anns.filter(q=>q!==a);hist.pop();ubtn()}
 }
 draw(p)};
pagesEl.addEventListener('pointerup',endDrag);pagesEl.addEventListener('pointercancel',endDrag);
pagesEl.addEventListener('dblclick',e=>{
 if(tool!=='select')return;const aEl=e.target.closest('[data-a]'),el=e.target.closest('.pg');if(!aEl||!el)return;
 const p=pageById(el.dataset.id),a=p&&p.anns.find(q=>q.id===aEl.dataset.a);if(a&&a.t==='text'){drag=null;openEditor(p,a,el,false)}});

/* text editing */
function openEditor(p,a,el,isNew){
 const ta=document.createElement('textarea');ta.className='ted';ta.value=a.text;ta.setAttribute('aria-label','Text');
 Object.assign(ta.style,{left:a.x*zoom+'px',top:a.y*zoom+'px',fontSize:a.size*zoom+'px',fontFamily:FAM[a.f],color:a.c});
 el.appendChild(ta);editing={p,a,ta,isNew,before:snap()};
 const fitTA=()=>{ta.style.width='0';ta.style.height='0';ta.style.width=Math.max(60,ta.scrollWidth+a.size*zoom)+'px';ta.style.height=ta.scrollHeight+'px'};
 ta.addEventListener('input',fitTA);ta.addEventListener('blur',()=>closeEditor());
 ta.addEventListener('keydown',ev=>{if(ev.key==='Escape'||(ev.key==='Enter'&&(ev.metaKey||ev.ctrlKey)))ta.blur();ev.stopPropagation()});
 fitTA();draw(p);ta.focus();setTimeout(()=>{if(editing&&editing.ta===ta&&document.activeElement!==ta)ta.focus()},0)}
function closeEditor(){
 if(!editing)return;const{p,a,ta,isNew,before}=editing;editing=null;const v=ta.value.replace(/\s+$/,'');ta.remove();
 if(isNew){if(v){hist.push(before);fut=[];a.text=v;p.anns.push(a)}}
 else if(v!==a.text){hist.push(before);fut=[];if(v)a.text=v;else p.anns=p.anns.filter(q=>q!==a)}
 draw(p);refreshProps();ubtn()}

/* keyboard */
addEventListener('keydown',e=>{
 if($('#sigM').classList.contains('on')){if(e.key==='Escape')closeSig();return}
 if(e.target.closest('input,textarea,select'))return;const m=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
 if(m&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
 if(m&&k==='y'){e.preventDefault();redo();return}
 if(m&&k==='s'){e.preventDefault();save(pages,'-edited');return}
 if(m&&k==='f'){e.preventDefault();$('#q').focus();return}
 if(m||e.altKey)return;
 if(e.key==='Delete'||e.key==='Backspace'){if(sel){e.preventDefault();delSel()}else if(e.target.closest('.th')){e.preventDefault();pageAct('del')}return}
 if(e.key==='Escape'){pendingImg=null;setTool('select');return}
 if(sel&&e.key.startsWith('Arrow')){e.preventDefault();const d=e.shiftKey?10:1,a=selA();mark();moveA(a,e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0);draw(selP());return}
 if(e.key==='+'||e.key==='='){zoomStep(1);return}if(e.key==='-'){zoomStep(-1);return}
 const t={v:'select',t:'text',p:'pen',h:'hl',r:'box',o:'ellipse',a:'arrow',w:'white'}[k];if(t)setTool(t)});

/* page operations */
function rotCW(p){
 const{h}=dims(p),f=([x,y])=>[r1(h-y),r1(x)];
 for(const a of p.anns){
  if(a.t==='pen')a.pts=a.pts.map(f);
  else if(a.t==='arrow'){[a.x1,a.y1]=f([a.x1,a.y1]);[a.x2,a.y2]=f([a.x2,a.y2])}
  else if(a.t==='text'||a.t==='img'){const b=bb(a),[cx,cy]=f([b.x+b.w/2,b.y+b.h/2]);a.x=r1(cx-b.w/2);a.y=r1(cy-b.h/2)}
  else{const nx=h-(a.y+a.h),ny=a.x;[a.w,a.h]=[a.h,a.w];a.x=r1(nx);a.y=r1(ny)}}
 p.rot=(p.rot+90)%360}
const tgtPages=()=>{const s=pages.filter(p=>selPages.has(p.id));return s.length?s:pages.filter(p=>p.id===cur)};
const clone=o=>JSON.parse(JSON.stringify(o));
function pageAct(k){
 closeEditor();const T=tgtPages();if(!T.length)return;
 if(k==='extract'){save(T,'-pages');return}
 mark();hits=[];lastQ='';hitLab();
 if(k==='rotr')T.forEach(rotCW);
 if(k==='rotl')T.forEach(p=>{rotCW(p);rotCW(p);rotCW(p)});
 if(k==='del'){const ids=new Set(T.map(p=>p.id));pages=pages.filter(p=>!ids.has(p.id));selPages.clear();sel=null;toast(`Deleted ${T.length} page${T.length>1?'s':''}. Ctrl+Z brings ${T.length>1?'them':'it'} back`)}
 if(k==='dup'){const at=pages.indexOf(T[T.length-1])+1;pages.splice(at,0,...T.map(p=>({...clone(p),id:nid(),anns:p.anns.map(a=>({...clone(a),id:nid()}))})))}
 if(k==='blank'){const ref=T[T.length-1],{w,h}=dims(ref),n={id:nid(),doc:-1,idx:0,rot:0,w0:w,h0:h,base:0,view:[0,0,w,h],anns:[]};pages.splice(pages.indexOf(ref)+1,0,n);cur=n.id}
 if(k==='up'||k==='down'){const ids=new Set(T.map(p=>p.id)),idx=pages.map((p,i)=>ids.has(p.id)?i:-1).filter(i=>i>=0);if(k==='down')idx.reverse();
  for(const i of idx){const j=k==='up'?i-1:i+1;if(j<0||j>=pages.length||ids.has(pages[j].id))continue;[pages[i],pages[j]]=[pages[j],pages[i]]}}
 layout();if(k==='blank'||k==='up'||k==='down')goto(cur)}
$$('[data-pa]').forEach(b=>b.onclick=()=>pageAct(b.dataset.pa));
thumbsEl.addEventListener('click',e=>{
 const t=e.target.closest('.th');if(!t)return;const id=t.dataset.id;
 if(e.metaKey||e.ctrlKey){selPages.has(id)?selPages.delete(id):selPages.add(id)}
 else if(e.shiftKey&&cur){const a=pages.findIndex(p=>p.id===cur),b=pages.findIndex(p=>p.id===id);selPages=new Set(pages.slice(Math.min(a,b),Math.max(a,b)+1).map(p=>p.id))}
 else{selPages=new Set([id]);goto(id)}
 thumbs()});
thumbsEl.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const t=e.target.closest('.th');if(t){e.preventDefault();t.click()}}});
let dragId=null;
thumbsEl.addEventListener('dragstart',e=>{const t=e.target.closest('.th');if(!t)return;dragId=t.dataset.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId)});
thumbsEl.addEventListener('dragover',e=>{if(!dragId)return;e.preventDefault();const t=e.target.closest('.th');$$('.th.over').forEach(x=>x!==t&&x.classList.remove('over'));if(t)t.classList.add('over')});
thumbsEl.addEventListener('drop',e=>{
 if(!dragId)return;e.preventDefault();e.stopPropagation();const t=e.target.closest('.th');$$('.th.over').forEach(x=>x.classList.remove('over'));
 if(t&&t.dataset.id!==dragId){
  const moving=selPages.has(dragId)?pages.filter(p=>selPages.has(p.id)):[pageById(dragId)],rest=pages.filter(p=>!moving.includes(p));
  let i=rest.findIndex(p=>p.id===t.dataset.id);
  if(i>=0){const r=t.getBoundingClientRect(),horiz=getComputedStyle(thumbsEl).flexDirection==='row';if(horiz?e.clientX>r.left+r.width/2:e.clientY>r.top+r.height/2)i++;mark();rest.splice(i,0,...moving);pages=rest;hits=[];layout()}}
 dragId=null});
thumbsEl.addEventListener('dragend',()=>{dragId=null;$$('.th.over').forEach(x=>x.classList.remove('over'))});

/* search */
let sTok=0;
function hitLab(){$('#hitlab').textContent=lastQ?(hits.length?`${hitI+1}/${hits.length}`:'none'):''}
function hitBox(it,i,n,len,vp){
 const[a,b,c,d,e,f]=it.transform,l=Math.hypot(a,b)||1,dx=a/l,dy=b/l,h=Math.hypot(c,d)||it.height||10,s0=it.width*i/len,s1=it.width*(i+n)/len,ux=-dy,uy=dx;
 const pts=[];for(const s of[s0,s1])for(const k of[-.22,1])pts.push(vp.convertToViewportPoint(e+dx*s+ux*h*k,f+dy*s+uy*h*k));
 const xs=pts.map(q=>q[0]),ys=pts.map(q=>q[1]),x=Math.min(...xs),y=Math.min(...ys);return{x:r1(x-1),y:r1(y-1),w:r1(Math.max(...xs)-x+2),h:r1(Math.max(...ys)-y+2)}}
async function runSearch(q){
 const tok=++sTok;hits=[];hitI=-1;lastQ=q;const ql=q.toLowerCase();if(!q){hitLab();drawAll();return}
 $('#hitlab').textContent='…';
 for(const p of pages){
  if(p.doc<0)continue;const k=p.doc+':'+p.idx;if(!tcache.has(k))tcache.set(k,getPg(p.doc,p.idx).then(pg=>pg.getTextContent()));
  const tc=await tcache.get(k),vp=await vpOf(p);if(tok!==sTok)return;
  for(const it of tc.items){const s=(it.str||'').toLowerCase();if(!s)continue;let i=s.indexOf(ql);while(i>=0){hits.push({pid:p.id,...hitBox(it,i,ql.length,s.length,vp)});i=s.indexOf(ql,i+ql.length)}}}
 hitI=hits.length?0:-1;hitLab();drawAll();showHit()}
function showHit(){const h=hits[hitI];if(!h)return;const el=pagesEl.querySelector(`.pg[data-id="${h.pid}"]`);if(el)view.scrollTo({top:el.offsetTop+h.y*zoom-view.clientHeight/3});cur=h.pid;setInd()}
function nextHit(){if(!hits.length)return;hitI=(hitI+1)%hits.length;hitLab();drawAll();showHit()}
$('#sform').addEventListener('submit',e=>{e.preventDefault();const q=$('#q').value.trim();q===lastQ&&hits.length?nextHit():runSearch(q)});
$('#q').addEventListener('input',()=>{if(!$('#q').value){sTok++;hits=[];lastQ='';hitLab();drawAll()}});
$('#hitNext').onclick=()=>{const q=$('#q').value.trim();q===lastQ?nextHit():runSearch(q)};
$('#hitMark').onclick=()=>{
 if(!hits.length){toast('Search for some text first');return}mark();
 for(const h of hits){const p=pageById(h.pid);if(p)p.anns.push({id:nid(),t:'hl',x:h.x,y:h.y,w:h.w,h:h.h,c:colors.hl})}
 toast(`Highlighted ${hits.length} match${hits.length>1?'es':''}`);hits=[];lastQ='';$('#q').value='';hitLab();drawAll()};

/* files */
async function api(url,o){const r=await fetch(url,o);if(!r.ok){let m='Server error '+r.status;try{m=(await r.json()).error||m}catch(e){}throw new Error(m)}return r}
async function upload(file){return(await(await api('/api/files',{method:'POST',headers:{'Content-Type':'application/pdf'},body:file})).json()).id}
async function loadBytes(bytes,name,fid){
 const pdf=await L.getDocument({data:bytes.slice(0),isEvalSupported:false}).promise,d=docs.push({name,fid,pdf})-1,np=[];
 for(let i=0;i<pdf.numPages;i++){const pg=await getPg(d,i),v=pg.getViewport({scale:1,rotation:pg.rotate});np.push({id:nid(),doc:d,idx:i,rot:0,w0:v.width,h0:v.height,base:pg.rotate,view:[...pg.view],anns:[]})}
 return np}
async function openFiles(files,append){
 const pdfs=[...files].filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name));
 if(!pdfs.length){toast('That isn’t a PDF');return}
 const oldDocs=docs;if(!append){docs=[];pdfPages.clear()}
 try{
  const np=[];for(const f of pdfs){const bytes=new Uint8Array(await f.arrayBuffer()),fid=await upload(f);np.push(...await loadBytes(bytes,f.name,fid))}
  if(append){mark();pages.push(...np);toast(`Added ${np.length} page${np.length>1?'s':''} at the end`);layout();goto(np[0].id)}
  else{tcache.clear();pages=np;hist=[];fut=[];sel=null;selPages.clear();hits=[];lastQ='';$('#q').value='';hitLab();fileName=pdfs[0].name;isSample=false;cur=pages[0]&&pages[0].id;fit=true;ubtn();layout();view.scrollTop=0;if(pdfs.length>1)toast(`Merged ${pdfs.length} files`)}
 }catch(err){if(!append){docs=oldDocs;pdfPages.clear()}toast(err&&err.name==='PasswordException'?'That PDF is password protected':'Could not open that file'+(err&&err.message?': '+err.message:''))}}
$('#bOpen').onclick=$('#bOpen2').onclick=()=>$('#fOpen').click();
$('#bAdd').onclick=()=>$('#fAdd').click();
$('#fOpen').onchange=e=>{if(e.target.files.length)openFiles(e.target.files,false);e.target.value=''};
$('#fAdd').onchange=e=>{if(e.target.files.length)openFiles(e.target.files,pages.length>0);e.target.value=''};
function addImg(c){const id='i'+(uid++);imgs[id]=c.toDataURL('image/png');ratio[id]=c.height/c.width;return id}
$('#fImg').onchange=e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const u=URL.createObjectURL(f),im=new Image();
 im.onload=()=>{const s=Math.min(1,1600/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.width*s));c.height=Math.max(1,Math.round(im.height*s));c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);pendingImg=addImg(c);setTool('place');toast('Click a page to place the image')};
 im.onerror=()=>toast('Could not read that image');im.src=u};
const isFiles=e=>e.dataTransfer&&[...e.dataTransfer.types].includes('Files');
addEventListener('dragover',e=>{if(isFiles(e)){e.preventDefault();view.classList.add('drop')}});
addEventListener('dragleave',e=>{if(!e.relatedTarget)view.classList.remove('drop')});
addEventListener('drop',e=>{if(!isFiles(e))return;e.preventDefault();view.classList.remove('drop');const add=pages.length>0&&!isSample;openFiles(e.dataTransfer.files,add)});

/* signature */
const M=$('#sigM'),pad=$('#pad'),pc=pad.getContext('2d');let ink='#10131a',sm='draw',pd=null;
function openSig(){M.classList.add('on');requestAnimationFrame(()=>{const r=pad.getBoundingClientRect();pad.width=Math.round(r.width*2);pad.height=Math.round(r.height*2);setSm(sm)})}
function closeSig(){M.classList.remove('on')}
function typeSig(){pc.clearRect(0,0,pad.width,pad.height);const n=$('#sigName').value.trim();if(!n)return;let s=pad.height*.6;const set=()=>pc.font=`600 ${s}px Caveat, cursive`;set();while(pc.measureText(n).width>pad.width*.9&&s>20){s-=4;set()}pc.fillStyle=ink;pc.textBaseline='middle';pc.fillText(n,pad.width*.05,pad.height*.55)}
function setSm(m){sm=m;$$('[data-sm]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.sm===m));$('#sigName').hidden=m!=='type';pc.clearRect(0,0,pad.width,pad.height);
 if(m==='type'){typeSig();if(document.fonts)document.fonts.load('600 40px Caveat').then(typeSig,()=>{});$('#sigName').focus()}}
$$('[data-sm]').forEach(b=>b.onclick=()=>setSm(b.dataset.sm));
$$('[data-ink]').forEach(b=>b.onclick=()=>{ink=b.dataset.ink;$$('[data-ink]').forEach(x=>x.setAttribute('aria-pressed',x===b));if(sm==='type')typeSig()});
$('#sigName').addEventListener('input',typeSig);
$('#sigClear').onclick=()=>{pc.clearRect(0,0,pad.width,pad.height);$('#sigName').value=''};
$('#sigCancel').onclick=closeSig;M.addEventListener('pointerdown',e=>{if(e.target===M)closeSig()});
pad.addEventListener('pointerdown',e=>{if(sm!=='draw')return;pad.setPointerCapture(e.pointerId);const r=pad.getBoundingClientRect(),k=pad.width/r.width,x=(e.clientX-r.left)*k,y=(e.clientY-r.top)*k;pd={r,k};
 pc.strokeStyle=ink;pc.lineWidth=5;pc.lineCap=pc.lineJoin='round';pc.beginPath();pc.moveTo(x,y);pc.lineTo(x+.1,y);pc.stroke()});
pad.addEventListener('pointermove',e=>{if(!pd)return;const{r,k}=pd;pc.lineTo((e.clientX-r.left)*k,(e.clientY-r.top)*k);pc.stroke()});
pad.addEventListener('pointerup',()=>pd=null);pad.addEventListener('pointercancel',()=>pd=null);
function trimPad(){
 const w=pad.width,h=pad.height,d=pc.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=-1,y1=-1;
 for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2)if(d[(y*w+x)*4+3]>8){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
 if(x1<0)return null;x0=Math.max(0,x0-10);y0=Math.max(0,y0-10);x1=Math.min(w,x1+10);y1=Math.min(h,y1+10);
 const c=document.createElement('canvas');c.width=x1-x0;c.height=y1-y0;c.getContext('2d').drawImage(pad,x0,y0,c.width,c.height,0,0,c.width,c.height);return c}
$('#sigUse').onclick=()=>{const c=trimPad();if(!c){toast('Draw or type a signature first');return}sig={id:addImg(c)};closeSig();setTool('sign');toast('Click a page to place your signature')};

/* export: the server builds the PDF, the browser downloads it */
async function save(list,suffix){
 closeEditor();if(!list.length){toast('No pages to save');return}
 const btn=$('#save');btn.disabled=true;toast('Building your PDF');
 try{
  const used=new Set();list.forEach(p=>p.anns.forEach(a=>{if(a.t==='img')used.add(a.img)}));
  const name=fileName.replace(/\.pdf$/i,'')+suffix+'.pdf';
  const r=await api('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:name,docs:docs.map(d=>d.fid),imgs:Object.fromEntries([...used].map(k=>[k,imgs[k]])),pages:list})});
  const u=URL.createObjectURL(await r.blob()),link=document.createElement('a');
  link.href=u;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);
  toast('Saved '+name+' to your downloads')
 }catch(err){toast('Could not save: '+(err&&err.message||err))}
 finally{btn.disabled=false}}
$('#save').onclick=()=>save(pages,'-edited');
window.__folio={get pages(){return pages},save:()=>save(pages,'-edited')};

/* zoom controls */
$('#zoom').onchange=e=>{const v=e.target.value;if(v==='fit'){fit=true;keepSpot(layout)}else setZoom(+v)};
$('#zIn').onclick=()=>zoomStep(1);$('#zOut').onclick=()=>zoomStep(-1);
$('#bUndo').onclick=undo;$('#bRedo').onclick=redo;

/* autosave: the server keeps your open files, pages and marks */
let lastSig='',saving=false;
const sessionSig=()=>snap()+'|'+docs.map(d=>d.fid).join(',')+'|'+Object.keys(imgs).length+'|'+fileName+'|'+isSample;
function setStat(t){$('#sstat').textContent=t}
async function persist(){
 if(saving||!docs.length)return;const sig=sessionSig();if(sig===lastSig)return;saving=true;setStat('Saving…');
 try{await api('/api/session',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({v:1,fileName,isSample,docs:docs.map(d=>({id:d.fid,name:d.name})),pages,imgs,ratio,sig:sig.length})});lastSig=sig;setStat('Autosaved')}
 catch(e){setStat('Not saved: server offline?')}
 finally{saving=false}}
setInterval(persist,1200);
addEventListener('beforeunload',e=>{if(sessionSig()!==lastSig&&docs.length){persist();e.preventDefault();e.returnValue=''}});
async function restore(){
 const s=await(await api('/api/session')).json();if(!s||!s.docs||!s.docs.length)return false;
 for(const d of s.docs){const bytes=new Uint8Array(await(await api('/api/files/'+d.id)).arrayBuffer());const pdf=await L.getDocument({data:bytes,isEvalSupported:false}).promise;docs.push({name:d.name,fid:d.id,pdf})}
 Object.assign(imgs,s.imgs||{});Object.assign(ratio,s.ratio||{});
 pages=s.pages;fileName=s.fileName||'document.pdf';isSample=!!s.isSample;
 let mx=0;const bump=v=>{const n=parseInt(String(v).slice(1),10);if(n>mx)mx=n};pages.forEach(p=>{bump(p.id);p.anns.forEach(a=>bump(a.id))});Object.keys(imgs).forEach(bump);uid=mx+1;
 cur=pages[0]&&pages[0].id;lastSig=sessionSig();setStat('Restored your last session');return true}
async function sample(){
 const s=await(await api('/api/sample',{method:'POST'})).json();
 const bytes=new Uint8Array(await(await api('/api/files/'+s.id)).arrayBuffer());
 const np=await loadBytes(bytes,s.name,s.id);np[0].anns.push(...s.anns.map(a=>({...a,id:nid()})));return{np,name:s.name}}
$('#bNew').onclick=async()=>{closeEditor();docs=[];pdfPages.clear();tcache.clear();hist=[];fut=[];sel=null;selPages.clear();hits=[];lastQ='';$('#q').value='';hitLab();
 try{const{np,name}=await sample();pages=np;isSample=true;fileName=name;cur=pages[0].id;fit=true;ubtn();layout();view.scrollTop=0;toast('Started fresh with the sample')}catch(e){toast('Could not reach the server')}};
setTool('select');ubtn();
(async()=>{
 try{if(await restore()){layout();return}}catch(e){docs=[];pages=[];console.warn('Could not restore session',e)}
 try{const{np,name}=await sample();pages=np;isSample=true;fileName=name;cur=pages[0].id;layout()}
 catch(e){isSample=false;layout();$('#fname').textContent='Open a PDF to start';setStat('Server offline?')}
})();
}
}
