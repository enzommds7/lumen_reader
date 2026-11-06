import {allBooks,getBook,getFile,getExtracted,saveExtracted,addBook,saveBook,deleteBook,annotationsFor,saveAnnotation,removeAnnotation} from './db.js';
import {openPdf,extractText,getPdfJS,pageForOffset} from './pdf.js';

const $=id=>document.getElementById(id);
const MAX_FILE=80*1024*1024;
const COLORS=['yellow','green','blue','pink'];
const state={book:null,pdf:null,pdfjs:null,extracted:null,annotations:[],mode:'text',textStart:0,textEnd:0,history:[],pdfPage:1,fontSize:19,theme:'sepia',renderKey:0,selectedColor:'yellow',selection:null,pendingNote:null,annotationFilter:'all',toastTimer:null};
const formatNum=n=>new Intl.NumberFormat('pt-BR').format(n);
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function toast(message){const t=$('toast');clearTimeout(state.toastTimer);t.textContent=message;t.classList.add('visible');state.toastTimer=setTimeout(()=>t.classList.remove('visible'),3500)}
function dlg(id){const el=$(id);if(!el.open)el.showModal()}
function closeDlg(id){if($(id).open)$(id).close()}
function loading(active,title='Preparando livro…',sub='Só um instante'){ $('readingLoading').hidden=!active;if(active){$('loadingTitle').textContent=title;$('loadingProgress').textContent=sub;} }
function warn(e,fallback){console.error(e);toast(fallback||e?.message||'Ocorreu um erro.');}
function safeName(s){return (s||'Livro sem título').trim().replace(/\.pdf$/i,'').slice(0,130)||'Livro sem título';}
function download(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function escapeMd(s){return String(s||'').replace(/[\\`*_{}\[\]<>]/g,'\\$&')}
function closeSelection(){state.selection=null;$('selectionTools').hidden=true;try{window.getSelection()?.removeAllRanges()}catch{}}
function showLibrary(){state.renderKey++;state.pdf=null;state.pdfjs=null;state.extracted=null;state.book=null;closeSelection();$('readerView').hidden=true;$('libraryView').hidden=false;renderLibrary().catch(warn);}
async function renderLibrary(){
  const books=(await allBooks()).sort((a,b)=>b.updatedAt-a.updatedAt);
  $('bookCount').textContent=String(books.length);$('booksGrid').replaceChildren();$('libraryEmpty').hidden=books.length!==0;
  for(const book of books){
    const b=document.createElement('button');b.type='button';b.className='book-card';
    const cover=document.createElement('div');cover.className='book-cover';
    const accent=document.createElement('span');accent.className='cover-accent';accent.textContent='✧';
    const title=document.createElement('span');title.className='cover-title';title.textContent=book.title;
    const sub=document.createElement('span');sub.className='cover-sub';sub.textContent='LÚMEN READER';cover.append(accent,title,sub);
    const name=document.createElement('span');name.className='book-title';name.textContent=book.title;
    const info=document.createElement('div');info.className='book-info';
    const pages=document.createElement('span');pages.textContent=(book.numPages||'—')+' páginas';
    const progress=document.createElement('span');const pct=book.textLength?100*(book.textOffset||0)/book.textLength:book.numPages?100*((book.pdfPage||1)-1)/book.numPages:0;progress.textContent=Math.round(pct)+'% lido';info.append(pages,progress);
    const line=document.createElement('div');line.className='book-line';const fill=document.createElement('i');fill.style.width=clamp(pct,0,100)+'%';line.append(fill);
    b.append(cover,name,info,line);b.addEventListener('click',()=>openBook(book.id).catch(warn));$('booksGrid').append(b);
  }
}
async function verifyPDF(blob){if(blob.size>MAX_FILE)throw Error('O limite desta versão é 80 MB por PDF.');if(blob.size<8)throw Error('O arquivo está vazio.');const start=await blob.slice(0,1024).text();if(!start.includes('%PDF-'))throw Error('Este arquivo não parece ser um PDF válido.');}
async function importFile(file,title=null,sourceUrl=null){
  await verifyPDF(file);
  const now=Date.now(), id=crypto.randomUUID();
  const book={id,title:safeName(title||file.name),numPages:0,size:file.size,createdAt:now,updatedAt:now,sourceUrl,mode:'text',theme:'sepia',fontSize:19,textOffset:0,textLength:0,pdfPage:1};
  try{await addBook(book,file);}catch(e){if(e?.name==='QuotaExceededError')throw Error('Sem espaço suficiente para salvar o PDF neste iPhone.');throw e;}
  closeDlg('importDialog');await renderLibrary();await openBook(id);toast('Livro adicionado à biblioteca!');
}
async function importUrl(url){
  const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw Error('Informe um endereço HTTP ou HTTPS.');
  const button=$('urlSubmit');button.disabled=true;button.textContent='Importando…';
  try{
    let blob, title;
    // Tenta primeiro URLs diretas que permitem CORS.
    if(/\.pdf(?:$|[?#])/i.test(parsed.pathname+parsed.search)){
      try{const r=await fetch(parsed.href);if(r.ok && (/pdf/i.test(r.headers.get('content-type')||'')||/\.pdf(?:$|[?#])/i.test(parsed.href))){if(Number(r.headers.get('content-length')||0)>MAX_FILE)throw Error('PDF muito grande.');blob=await r.blob();title=decodeURIComponent(parsed.pathname.split('/').pop()||'Livro');}}catch(e){console.info('Download direto indisponível, tentando servidor local',e.message)}
    }
    if(!blob){
      let response;
      try{response=await fetch('./api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:parsed.href})});}catch{throw Error('A importação por esta URL exige o servidor Node.js opcional. Se publicou no GitHub Pages, abra o PDF no Safari, salve em Arquivos e importe pelo botão “Escolher PDF”.');}
      if(!response.ok){if([404,405].includes(response.status))throw Error('Importar links de páginas requer o servidor Node.js. No GitHub Pages, baixe o PDF no Safari e importe do Arquivos.');let error;try{error=await response.json()}catch{}throw Error(error?.error||'Este link não pôde ser importado. Baixe o PDF pelo Safari e importe em Arquivos.');}
      if(Number(response.headers.get('content-length')||0)>MAX_FILE)throw Error('PDF muito grande.');
      blob=await response.blob();title=decodeURIComponent(response.headers.get('X-Book-Title')||'Livro importado');
    }
    await importFile(new File([blob],safeName(title)+'.pdf',{type:'application/pdf'}),title,parsed.href);
  }finally{button.disabled=false;button.textContent='Buscar e importar';}
}
async function openBook(id){
  const book=await getBook(id),fileEntry=await getFile(id);if(!book||!fileEntry)throw Error('Livro não encontrado no armazenamento.');
  state.book=book;state.mode=book.mode||'text';state.fontSize=book.fontSize||19;state.theme=book.theme||'sepia';state.textStart=book.textOffset||0;state.pdfPage=book.pdfPage||1;state.history=[];state.annotations=await annotationsFor(id);
  $('readerView').hidden=false;$('libraryView').hidden=true;loading(true,'Abrindo livro…','Lendo o PDF armazenado no aparelho');
  $('readerBookTitle').textContent=book.title;
  updateSettings();
  const key=++state.renderKey;
  try{
    const {pdfjs,document}=await openPdf(fileEntry.file);
    if(key!==state.renderKey)return;
    state.pdfjs=pdfjs;state.pdf=document;book.numPages=document.numPages;
    state.extracted=await getExtracted(book.id);
    await saveBook(book);
    await renderPage();
  }catch(e){loading(false);showLibrary();throw e;}
}
function updateSettings(){
  $('reflowMode').classList.toggle('active',state.mode==='text');$('pdfMode').classList.toggle('active',state.mode==='pdf');
  $('readerMeta').textContent=state.mode==='text'?'Leitura adaptável':'PDF original';
  $('fontValue').textContent=String(state.fontSize);
  for(const btn of document.querySelectorAll('.theme-option'))btn.classList.toggle('active',btn.dataset.theme===state.theme);
  $('annotationCount').textContent=String(state.annotations.length);
  const noteHere=state.annotations.some(a=>a.kind==='bookmark' && a.mode===state.mode && (a.mode==='pdf'?a.page===state.pdfPage:Math.abs(a.offset-state.textStart)<15));
  $('bookmarkButton').style.color=noteHere?'#e2ba80':'';
  $('bookmarkButton').setAttribute('aria-pressed',String(noteHere));
}
async function setMode(mode){if(!state.book||state.mode===mode)return;closeSelection();state.mode=mode;state.book.mode=mode;state.book.updatedAt=Date.now();await saveBook(state.book);updateSettings();await renderPage();}
async function ensureExtracted(){
  if(state.extracted)return;
  loading(true,'Preparando leitura adaptável','Extraindo o texto do PDF…');
  const result=await extractText(state.pdf,(done,total)=>{$('loadingProgress').textContent=`Processando página ${done} de ${total}`;});
  state.extracted={id:state.book.id,...result};state.book.textLength=result.text.length;
  await saveExtracted(state.extracted);await saveBook(state.book);
}
function segmentNodes(target,start,end){
  const content=state.extracted.text;
  const marks=state.annotations.filter(a=>a.kind==='highlight'&&a.mode==='text'&&a.start<end&&a.end>start).sort((a,b)=>a.start-b.start);
  let cursor=start;
  for(const m of marks){
    const s=Math.max(cursor,m.start,start),e=Math.min(m.end,end);
    if(s>=e)continue;
    if(s>cursor)target.append(document.createTextNode(content.slice(cursor,s)));
    const span=document.createElement('mark');span.className='mark-'+(COLORS.includes(m.color)?m.color:'yellow');span.textContent=content.slice(s,e);target.append(span);cursor=e;
  }
  if(cursor<end)target.append(document.createTextNode(content.slice(cursor,end)));
}
function fits(start,end){const el=$('measurePage');el.textContent=state.extracted.text.slice(start,end);return el.scrollHeight<=el.clientHeight+1;}
function fitEnd(start){
  const text=state.extracted.text,limit=text.length;
  if(start>=limit)return limit;
  let lo=start+1,hi=Math.min(limit,start+18000),best=lo;
  if(fits(start,hi))best=hi;
  else {while(lo<=hi){const m=(lo+hi)>>1;if(fits(start,m)){best=m;lo=m+1}else hi=m-1;}}
  if(best>=limit)return limit;
  let cut=best;
  while(cut>start+Math.max(20,(best-start)*.7)&&!/[\s\u00a0]/.test(text[cut-1]))cut--;
  return Math.max(start+1,cut<best?cut:best);
}
function prevStart(end){
  // Localizar o início de uma página anterior que caiba exatamente até o início atual.
  const lower=Math.max(0,end-18000);let lo=lower,hi=end-1,best=hi;
  while(lo<=hi){const mid=(lo+hi)>>1;if(fits(mid,end)){best=mid;hi=mid-1}else lo=mid+1;}
  const text=state.extracted.text;while(best<end-1&&best>0&&!/\s/.test(text[best-1]))best++;
  return Math.min(best,end-1);
}
async function renderPage(){
  if(!state.pdf||!state.book)return;
  const key=++state.renderKey;
  closeSelection();updateSettings();
  $('textPaper').hidden=state.mode!=='text';$('pdfPaper').hidden=state.mode!=='pdf';
  if(state.mode==='text'){
    if(!state.extracted){await ensureExtracted();if(key!==state.renderKey)return;}
    if(!state.extracted.text.trim()){
      loading(false);$('textPage').textContent='Não encontramos texto selecionável neste PDF. Se for um documento digitalizado, use o modo PDF original.';
      $('prevButton').disabled=true;$('nextButton').disabled=true;return;
    }
    $('textPaper').className='text-paper theme-'+state.theme;
    $('textPage').style.fontSize=state.fontSize+'px';$('measurePage').style.fontSize=state.fontSize+'px';
    const start=clamp(state.textStart,0,Math.max(0,state.extracted.text.length-1));
    state.textStart=start;
    // Medir depois que as fontes/layout estiverem prontos.
    await new Promise(resolve=>requestAnimationFrame(resolve));if(key!==state.renderKey)return;
    const end=fitEnd(start);state.textEnd=end;
    $('textPage').replaceChildren();segmentNodes($('textPage'),start,end);
    const p=pageForOffset(state.extracted.boundaries,start);const pct=100*start/Math.max(1,state.extracted.text.length);
    updateProgress(`Original: página ${p} de ${state.pdf.numPages}`,`${Math.round(pct)}%`,pct,`${formatNum(start+1)} / ${formatNum(state.extracted.text.length)} caracteres`);
    $('prevButton').disabled=start===0;$('nextButton').disabled=end>=state.extracted.text.length;
    state.book.textOffset=start;state.book.textLength=state.extracted.text.length;
  }else{
    state.pdfPage=clamp(state.pdfPage,1,state.pdf.numPages);
    loading(true,'Renderizando página…',`Página ${state.pdfPage} de ${state.pdf.numPages}`);
    await drawPDFPage(key);if(key!==state.renderKey)return;
    const pct=100*(state.pdfPage-1)/Math.max(1,state.pdf.numPages);
    updateProgress(`Página ${state.pdfPage} de ${state.pdf.numPages}`,`${Math.round(pct)}%`,pct,`${state.pdfPage} / ${state.pdf.numPages}`);
    $('prevButton').disabled=state.pdfPage<=1;$('nextButton').disabled=state.pdfPage>=state.pdf.numPages;
    state.book.pdfPage=state.pdfPage;
  }
  state.book.updatedAt=Date.now();saveBook(state.book).catch(warn);
  loading(false);updateSettings();
}
function updateProgress(label,pctText,pct,count){$('progressLabel').textContent=label;$('progressPercent').textContent=pctText;$('progressBar').style.width=clamp(pct,0,100)+'%';$('pageCounter').textContent=count;}
async function drawPDFPage(key){
  const page=await state.pdf.getPage(state.pdfPage);if(key!==state.renderKey)return;
  const stage=$('pdfPaper'),sheet=$('pdfSheet'),canvas=$('pdfCanvas');
  const unscaled=page.getViewport({scale:1});
  const logicalWidth=Math.max(200,Math.min(stage.clientWidth-4,800));
  const viewport=page.getViewport({scale:logicalWidth/unscaled.width});
  const dpr=Math.min(window.devicePixelRatio||1,2);
  sheet.style.width=viewport.width+'px';sheet.style.height=viewport.height+'px';
  canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);
  canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
  const ctx=canvas.getContext('2d',{alpha:false});
  await page.render({canvasContext:ctx,viewport,transform:[dpr,0,0,dpr,0,0]}).promise;
  if(key!==state.renderKey)return;
  const textLayer=$('pdfTextLayer');textLayer.replaceChildren();
  textLayer.style.setProperty('--scale-factor',String(viewport.scale));
  textLayer.style.setProperty('--total-scale-factor',String(viewport.scale));
  try{const source=await page.getTextContent();const layer=new state.pdfjs.TextLayer({textContentSource:source,container:textLayer,viewport});await layer.render();}catch(e){console.info('Camada de seleção do PDF indisponível:',e);}
  if(key!==state.renderKey)return;
  drawPdfHighlights();stage.scrollTop=0;
}
function drawPdfHighlights(){
  const box=$('pdfHighlights');box.replaceChildren();
  for(const a of state.annotations.filter(a=>a.kind==='highlight'&&a.mode==='pdf'&&a.page===state.pdfPage)){
    for(const r of a.rects||[]){const div=document.createElement('div');div.className='pdf-highlight '+(COLORS.includes(a.color)?a.color:'yellow');div.style.left=r.x*100+'%';div.style.top=r.y*100+'%';div.style.width=r.w*100+'%';div.style.height=r.h*100+'%';box.append(div);}
  }
}
async function stepPage(direction){if(!state.book)return;closeSelection();if(state.mode==='pdf')state.pdfPage+=direction;
  else if(direction===1){if(state.textEnd>=state.extracted.text.length)return;state.history.push(state.textStart);state.textStart=state.textEnd;}
  else{if(state.textStart<=0)return;state.textStart=state.history.length?state.history.pop():prevStart(state.textStart);}
  await renderPage();}
async function changeFont(delta){state.fontSize=clamp(state.fontSize+delta,13,31);state.book.fontSize=state.fontSize;state.history=[];updateSettings();await renderPage();}
async function changeTheme(theme){state.theme=theme;state.book.theme=theme;updateSettings();await renderPage();}
async function saveAnn(annotation){await saveAnnotation(annotation);state.annotations.push(annotation);updateSettings();}
async function toggleBookmark(){
  if(!state.book)return;
  const found=state.annotations.find(a=>a.kind==='bookmark'&&a.mode===state.mode&&(a.mode==='pdf'?a.page===state.pdfPage:Math.abs(a.offset-state.textStart)<15));
  if(found){await removeAnnotation(found.id);state.annotations=state.annotations.filter(a=>a.id!==found.id);toast('Marcador removido');}
  else{await saveAnn({id:crypto.randomUUID(),bookId:state.book.id,kind:'bookmark',mode:state.mode,page:state.mode==='pdf'?state.pdfPage:pageForOffset(state.extracted.boundaries,state.textStart),offset:state.textStart,createdAt:Date.now()});toast('Página salva nos favoritos');}
  updateSettings();
}
function selectionOffsets(){
  const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount||!state.book)return null;
  const range=selection.getRangeAt(0),quote=selection.toString().trim();if(quote.length<2)return null;
  if(state.mode==='text'){
    const root=$('textPage');if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
    const before=document.createRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);
    const from=state.textStart+before.toString().length;
    const end=from+range.toString().length;
    return {mode:'text',start:from,end,quote:state.extracted.text.slice(from,end).trim(),page:pageForOffset(state.extracted.boundaries,from),offset:from};
  }
  const layer=$('pdfTextLayer');if(!layer.contains(range.startContainer)||!layer.contains(range.endContainer))return null;
  const parent=$('pdfSheet').getBoundingClientRect(),rects=[];
  for(const r of range.getClientRects()){
    const x=clamp((r.left-parent.left)/parent.width,0,1),y=clamp((r.top-parent.top)/parent.height,0,1),w=clamp(r.width/parent.width,0,1-x),h=clamp(r.height/parent.height,0,1-y);
    if(w>.001&&h>.001)rects.push({x,y,w,h});
  }
  if(!rects.length)return null;
  return {mode:'pdf',page:state.pdfPage,offset:0,rects,quote};
}
function selectionChanged(){
  if(!state.book||$('readerView').hidden)return;
  const selected=selectionOffsets();
  if(selected){state.selection=selected;$('selectionTools').hidden=false;}
}
async function saveHighlightWithColor(withNote=false){
  const s=state.selection;if(!s||!state.book)return;
  const ann={id:crypto.randomUUID(),bookId:state.book.id,kind:'highlight',color:state.selectedColor,...s,note:'',createdAt:Date.now()};
  closeSelection();
  if(withNote){state.pendingNote=ann;openNoteDialog(ann.quote);return;}
  await saveAnn(ann);await renderPage();toast('Trecho destacado');
}
function openNoteDialog(quote=''){$('noteQuote').hidden=!quote;$('noteQuote').textContent=quote||'';$('noteInput').value='';closeDlg('settingsDialog');dlg('noteDialog');}
async function submitNote(note){
  if(!state.book)return;
  let ann=state.pendingNote;
  if(ann){ann.note=note;state.pendingNote=null;}
  else ann={id:crypto.randomUUID(),bookId:state.book.id,kind:'note',mode:state.mode,page:state.mode==='pdf'?state.pdfPage:pageForOffset(state.extracted.boundaries,state.textStart),offset:state.textStart,note,quote:'',createdAt:Date.now()};
  await saveAnn(ann);closeDlg('noteDialog');toast('Anotação salva');await renderPage();
}
function createAnnCard(a){
  const card=document.createElement('div');card.className='annotation-item';
  const top=document.createElement('div');top.className='top';const label=document.createElement('span');label.textContent=`${a.kind==='bookmark'?'♧ Favorito':a.kind==='highlight'?'▰ Destaque':'✎ Nota'} · Pág. ${a.page||1}`;const date=document.createElement('span');date.textContent=new Date(a.createdAt).toLocaleDateString('pt-BR');top.append(label,date);card.append(top);
  if(a.quote){const q=document.createElement('p');q.className='annotation-quote';q.textContent='“'+a.quote.slice(0,380)+(a.quote.length>380?'…':'')+'”';card.append(q);}
  if(a.note){const n=document.createElement('div');n.className='annotation-note';n.textContent=a.note;card.append(n);}
  const actions=document.createElement('div');actions.className='annotation-actions';const jump=document.createElement('button');jump.type='button';jump.textContent='Ir ao trecho';jump.addEventListener('click',async()=>{closeDlg('annotationsDialog');closeSelection();if(state.mode!==a.mode){state.mode=a.mode;state.book.mode=a.mode;}
    if(a.mode==='pdf')state.pdfPage=a.page;else{state.textStart=a.offset||a.start||0;state.history=[];}await renderPage();});
  const del=document.createElement('button');del.type='button';del.textContent='Excluir';del.className='delete-note';del.addEventListener('click',async()=>{await removeAnnotation(a.id);state.annotations=state.annotations.filter(x=>x.id!==a.id);renderAnnotationList();await renderPage();toast('Marcação removida');});
  actions.append(jump,del);card.append(actions);return card;
}
function renderAnnotationList(){
  const root=$('annotationList');root.replaceChildren();
  let anns=state.annotations.slice().sort((a,b)=>b.createdAt-a.createdAt);
  if(state.annotationFilter!=='all')anns=anns.filter(a=>state.annotationFilter==='note'?a.kind==='note'||Boolean(a.note):a.kind===state.annotationFilter);
  if(!anns.length){const p=document.createElement('p');p.className='empty';p.textContent='Nenhum registro por aqui. Selecione um trecho para destacar, ou toque no marcador para salvar a página.';root.append(p);}
  else for(const a of anns)root.append(createAnnCard(a));
  for(const b of document.querySelectorAll('[data-filter]'))b.classList.toggle('active',b.dataset.filter===state.annotationFilter);
}
function exportNotes(){if(!state.book)return;const lines=[`# ${state.book.title}`,`Exportado do Lúmen Reader em ${new Date().toLocaleDateString('pt-BR')}`,''];
  for(const a of state.annotations.slice().sort((a,b)=>a.page-b.page)){
    lines.push(`## ${a.kind==='highlight'?'Destaque':a.kind==='bookmark'?'Página favorita':'Anotação'} — página ${a.page||'?'}`);
    if(a.quote)lines.push(`> ${a.quote.replace(/\n/g,'\n> ')}`);
    if(a.note)lines.push('',escapeMd(a.note));lines.push('');
  }
  download(new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'}),safeName(state.book.title)+'-anotacoes.md');toast('Anotações exportadas');
}
async function makeBackup(){
  const books=await allBooks(),bundle={app:'Lúmen Reader',version:1,exportedAt:new Date().toISOString(),books:[]};
  if(books.reduce((total,b)=>total+(b.size||0),0)>85*1024*1024){toast('Backup maior que 85 MB. Use menos livros por vez ou mantenha os PDFs originais.');return;}
  dlg('aboutDialog');toast('Preparando backup completo…');
  for(const b of books){const f=await getFile(b.id),e=await getExtracted(b.id),anns=await annotationsFor(b.id);const data=new Uint8Array(await f.file.arrayBuffer());let binary='';for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));bundle.books.push({book:b,pdfBase64:btoa(binary),extracted:e||null,annotations:anns});await wait(0);}
  download(new Blob([JSON.stringify(bundle)],{type:'application/json'}),'lumen-backup-'+new Date().toISOString().slice(0,10)+'.json');toast('Backup gerado. Salve em Arquivos.');
}
async function restoreBackup(file){
  const bundle=JSON.parse(await file.text());if(bundle.app!=='Lúmen Reader'||!Array.isArray(bundle.books))throw Error('Não é um backup válido do Lúmen.');
  const prior=await allBooks(),priorIds=new Set(prior.map(b=>b.id));
  let count=0;
  for(const entry of bundle.books){if(!entry.book||!entry.pdfBase64)continue;if(priorIds.has(entry.book.id))continue;
    const binary=atob(entry.pdfBase64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const blob=new Blob([bytes],{type:'application/pdf'});await verifyPDF(blob);
    await addBook(entry.book,blob);
    if(entry.extracted)await saveExtracted(entry.extracted);
    for(const a of entry.annotations||[])await saveAnnotation(a);
    count++;
  }
  closeDlg('aboutDialog');await renderLibrary();toast(`${count} livro(s) restaurado(s)`);
}
let resizeTimer;
function handleResize(){clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!state.book||$('readerView').hidden)return;state.history=[];renderPage().catch(warn);},220)}
function setup(){
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDlg(b.dataset.close)));
  for(const id of ['importDialog','settingsDialog','noteDialog','annotationsDialog','aboutDialog'])$(id).addEventListener('click',e=>{if(e.target===$(id))closeDlg(id)});
  const showImport=()=>dlg('importDialog');
  for(const id of ['addBookBtn','libraryMenu','emptyAdd'])$(id).addEventListener('click',showImport);
  $('pickFileButton').addEventListener('click',()=>$('pdfFileInput').click());
  $('pdfFileInput').addEventListener('change',async e=>{const files=[...e.target.files];e.target.value='';for(const f of files){try{await importFile(f)}catch(err){warn(err)}}});
  $('urlForm').addEventListener('submit',async e=>{e.preventDefault();$('urlError').hidden=true;try{await importUrl($('urlInput').value.trim())}catch(err){$('urlError').textContent=err.message;$('urlError').hidden=false;warn(err)}});
  $('demoButton').addEventListener('click',async()=>{try{const response=await fetch('./demo/lumen-demonstracao.pdf');if(!response.ok)throw Error('Não foi possível abrir a demonstração.');const blob=await response.blob();await importFile(new File([blob],'Demonstração Lúmen.pdf',{type:'application/pdf'}),'Bem-vindo ao Lúmen')}catch(err){warn(err)}});
  $('backButton').addEventListener('click',showLibrary);
  $('readerMenuButton').addEventListener('click',()=>dlg('settingsDialog'));
  $('infoButton').addEventListener('click',()=>dlg('aboutDialog'));
  $('bookmarkButton').addEventListener('click',()=>toggleBookmark().catch(warn));
  $('showNotesButton').addEventListener('click',()=>{renderAnnotationList();dlg('annotationsDialog')});
  $('reflowMode').addEventListener('click',()=>setMode('text').catch(warn));
  $('pdfMode').addEventListener('click',()=>setMode('pdf').catch(warn));
  $('prevButton').addEventListener('click',()=>stepPage(-1).catch(warn));
  $('nextButton').addEventListener('click',()=>stepPage(1).catch(warn));
  $('fontSmaller').addEventListener('click',()=>changeFont(-2).catch(warn));
  $('fontLarger').addEventListener('click',()=>changeFont(2).catch(warn));
  document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>changeTheme(b.dataset.theme).catch(warn)));
  $('deleteBookButton').addEventListener('click',async()=>{if(!state.book||!confirm(`Excluir “${state.book.title}” e todas as suas anotações deste aparelho?`))return;await deleteBook(state.book.id);closeDlg('settingsDialog');showLibrary();toast('Livro removido')});
  $('addStandaloneNote').addEventListener('click',()=>{state.pendingNote=null;openNoteDialog()});
  $('noteForm').addEventListener('submit',async e=>{e.preventDefault();const note=$('noteInput').value.trim();if(note)try{await submitNote(note)}catch(err){warn(err)}});
  $('noteDialog').addEventListener('close',()=>{state.pendingNote=null;});
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.annotationFilter=b.dataset.filter;renderAnnotationList()}));
  $('exportMarkdown').addEventListener('click',exportNotes);
  for(const btn of document.querySelectorAll('[data-color]'))btn.addEventListener('click',()=>{state.selectedColor=btn.dataset.color;document.querySelectorAll('[data-color]').forEach(b=>b.classList.toggle('active',b===btn))});
  $('saveHighlight').addEventListener('click',()=>saveHighlightWithColor(false).catch(warn));
  $('highlightAndNote').addEventListener('click',()=>saveHighlightWithColor(true).catch(warn));
  $('closeSelection').addEventListener('click',closeSelection);
  document.addEventListener('selectionchange',()=>{if(!$('readerView').hidden)requestAnimationFrame(selectionChanged)});
  $('backupButton').addEventListener('click',()=>makeBackup().catch(warn));
  $('restoreButton').addEventListener('click',()=>$('backupInput').click());
  $('backupInput').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(file)try{await restoreBackup(file)}catch(err){warn(err)}});
  window.addEventListener('resize',handleResize);
  document.addEventListener('keydown',e=>{if($('readerView').hidden||document.querySelector('dialog[open]'))return;if(e.key==='ArrowRight'){stepPage(1).catch(warn)}else if(e.key==='ArrowLeft'){stepPage(-1).catch(warn)}});
  if('serviceWorker'in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW:',e));
  renderLibrary().catch(warn);
}
setup();
