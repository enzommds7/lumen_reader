// Servidor opcional do Lúmen Reader: serve o PWA e resolve URLs públicas de PDFs.
// Node.js >= 20. Sem cookies, login, scraping de conteúdo protegido ou Playwright.
// Segurança: hosts permitidos explicitamente, limite de tamanho e redirects verificados.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PORT=Number(process.env.PORT||8000);
const HOST=process.env.HOST||'127.0.0.1';
const allowed=(process.env.ALLOWED_HOSTS||'www.literamundo.com.br,literamundo.com.br').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const LIMIT=80*1024*1024;
function validate(input){
  let url;try{url=new URL(input)}catch{throw Error('URL inválida.');}
  if(!['https:','http:'].includes(url.protocol))throw Error('Use um endereço HTTP/HTTPS.');
  if(url.username||url.password)throw Error('URLs com credenciais não são permitidas.');
  if(!allowed.includes(url.hostname.toLowerCase()))throw Error(`Domínio não permitido pelo servidor: ${url.hostname}. Configure ALLOWED_HOSTS se tiver autorização para acessar este site.`);
  if(url.port && !['80','443'].includes(url.port))throw Error('Porta não permitida.');
  return url;
}
async function fetchAllowed(input){
  let url=validate(input);
  for(let n=0;n<5;n++){
    const response=await fetch(url,{redirect:'manual',headers:{'User-Agent':'LumenReader/1.0 (+public-pdf-importer)','Accept':'application/pdf,text/html;q=0.9,*/*;q=0.3'},signal:AbortSignal.timeout(18000)});
    if(response.status>=300 && response.status<400){const redirect=response.headers.get('location');await response.body?.cancel();if(!redirect)throw Error('Redirecionamento sem destino.');url=validate(new URL(redirect,url).href);continue;}
    if(!response.ok)throw Error('Site respondeu com HTTP '+response.status);
    const cl=Number(response.headers.get('content-length')||0);
    if(cl>LIMIT)throw Error('PDF maior que 80 MB.');
    return {response,url};
  }
  throw Error('Muitos redirecionamentos.');
}
function decodeHtml(s){return s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function plainTitle(s){return decodeHtml(s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()).slice(0,120)||'Livro importado';}
function candidates(html,base){
  const found=[];
  const tagRegex=/<(?:a|iframe|embed|object|source)\b[^>]*>/gi;
  for(const match of html.matchAll(tagRegex)){
    const tag=match[0];
    const attr=/(?:href|src|data)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
    if(!attr)continue;
    const value=decodeHtml(attr[1]||attr[2]||attr[3]);
    try{
      const url=new URL(value,base).href;
      if(/\.pdf(?:[?#]|$)/i.test(url))found.push(url);
    }catch{}
  }
  // URLs de PDF literais em scripts/JSON estáticos da página.
  for(const match of html.matchAll(/(?:https?:\/\/|\/)[^\s"'<>\\]{1,550}?\.pdf(?:\?[^\s"'<>\\]*)?/gi)){
    try{found.push(new URL(decodeHtml(match[0]),base).href)}catch{}
  }
  return [...new Set(found)];
}
async function limitedBuffer(response,max=LIMIT){
  const reader=response.body?.getReader();if(!reader)throw Error('Resposta vazia.');
  const chunks=[];let len=0;
  while(true){const {done,value}=await reader.read();if(done)break;len+=value.byteLength;if(len>max){reader.cancel();throw Error('Arquivo excede o limite permitido.');}chunks.push(value);}
  return Buffer.concat(chunks.map(b=>Buffer.from(b)),len);
}
async function resolvePDF(url){
  const initial=await fetchAllowed(url);
  const ct=initial.response.headers.get('content-type')||'';
  const isPdf=/application\/pdf/i.test(ct)||/\.pdf(?:$|[?#])/i.test(initial.url.href);
  if(isPdf){const bytes=await limitedBuffer(initial.response);if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('O link não retornou um PDF válido.');return {bytes,title:decodeURIComponent(initial.url.pathname.split('/').pop()||'Livro').replace(/\.pdf$/i,'')};}
  if(!/text\/html/i.test(ct))throw Error('Esse link não é PDF nem página HTML.');
  const html=(await limitedBuffer(initial.response,2*1024*1024)).toString('utf8');
  const title=plainTitle((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)||[])[1]||'Livro importado').split('|')[0].trim();
  const pdfLinks=candidates(html,initial.url);
  if(!pdfLinks.length)throw Error('Nenhum link público de PDF foi identificado nessa página. Abra o PDF no Safari e salve em Arquivos.');
  for(const link of pdfLinks.slice(0,12)){
    try{const fetched=await fetchAllowed(link);const buffer=await limitedBuffer(fetched.response);if(buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))return {bytes:buffer,title};}catch(e){console.log('[lumen] link candidato ignorado:',e.message)}
  }
  throw Error('Os PDFs encontrados não estão acessíveis publicamente por este servidor.');
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function bodyJSON(req){let b='';for await(const chunk of req){b+=chunk.toString();if(b.length>10_000)throw Error('Solicitação grande demais.');}return JSON.parse(b);}
async function handler(req,res){
  try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/api/import'){
      if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
      const input=await bodyJSON(req);if(typeof input.url!=='string'||input.url.length>2048)return json(res,400,{error:'Informe uma URL válida.'});
      const data=await resolvePDF(input.url);
      const title=encodeURIComponent(data.title.replace(/[\r\n]/g,' ').slice(0,100));
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':String(data.bytes.length),'X-Book-Title':title,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(data.bytes);
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Método não suportado.'});
    const relative=decodeURIComponent(u.pathname).replace(/^\/+/, '')||'index.html';
    const filepath=path.resolve(ROOT,relative);
    if(!filepath.startsWith(ROOT+path.sep)||filepath.includes(`${path.sep}server${path.sep}`))return json(res,403,{error:'Acesso não permitido.'});
    const file=await stat(filepath).catch(()=>null);if(!file||!file.isFile()){res.writeHead(404);return res.end('Não encontrado');}
    const type=MIME[path.extname(filepath).toLowerCase()]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Content-Length':file.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')return res.end();return res.end(await readFile(filepath));
  }catch(e){console.warn('[lumen]',e.message);return json(res,400,{error:e.message||'Não foi possível importar o livro.'});}
}
http.createServer(handler).listen(PORT,HOST,()=>console.log(`Lúmen: http://${HOST}:${PORT}\nHosts para importação por link: ${allowed.join(', ')}`));
