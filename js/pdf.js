// PDF.js hospedado no CDN da Mozilla/Cloudflare. O Service Worker guarda os módulos
// após o primeiro carregamento para uso offline subsequente.
const ROOT='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/';
export const pdfModuleURL=ROOT+'pdf.min.mjs';
export const pdfWorkerURL=ROOT+'pdf.worker.min.mjs';
let loading;
export async function getPdfJS(){
  if(!loading) loading=import(pdfModuleURL).then(module=>{
    module.GlobalWorkerOptions.workerSrc=pdfWorkerURL;
    return module;
  }).catch(e=>{loading=null;throw new Error('Não foi possível carregar o PDF.js. Conecte-se à internet na primeira abertura. '+e.message)});
  return loading;
}
export async function openPdf(blob){
  const pdfjs=await getPdfJS();
  const buffer=await blob.arrayBuffer();
  const document=await pdfjs.getDocument({data:new Uint8Array(buffer),useSystemFonts:true}).promise;
  return {pdfjs,document};
}
export async function extractText(pdf,onProgress){
  let text='';
  const boundaries=[0];
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const {items}=await page.getTextContent();
    const lines=[];let line='';let lastY=null;let lastEnd=0;let prevSize=0;
    for(const item of items){
      if(!item.str || !item.str.trim()) {if(item.hasEOL&&line.trim()){lines.push(line.trim());line='';}continue;}
      const y=item.transform?.[5]??0, x=item.transform?.[4]??0;
      const h=Math.max(8,Math.abs(item.height||item.transform?.[3]||12));
      if(lastY!==null && Math.abs(y-lastY)>Math.max(2,h*.43)){
        if(line.trim())lines.push(line.trim());
        if(Math.abs(y-lastY)>Math.max(h,prevSize)*1.65)lines.push('');
        line='';
      }else if(line && !/\s$/.test(line) && x-lastEnd>h*.12 && !/^[,.;:!?\]})]/.test(item.str))line+=' ';
      line+=item.str;
      lastEnd=x+(item.width||0);lastY=y;prevSize=h;
      if(item.hasEOL){if(line.trim())lines.push(line.trim());line='';}
    }
    if(line.trim())lines.push(line.trim());
    // Unir linhas contínuas (quebradas pelo PDF), preservar intervalos de parágrafo.
    const pageText=lines.join('\n').replace(/-\n(?=\p{L})/gu,'').replace(/([^\n])\n(?=[^\n])/g,'$1 ').replace(/[ \t]{2,}/g,' ').trim();
    text += pageText+'\n\n';
    boundaries.push(text.length);
    if(i===1||i%3===0||i===pdf.numPages){onProgress?.(i,pdf.numPages);await new Promise(resolve=>setTimeout(resolve,0));}
  }
  return {text:text.trimEnd(),boundaries};
}
export function pageForOffset(boundaries,offset){
  let lo=0,hi=boundaries.length-2;
  while(lo<=hi){const mid=(lo+hi)>>1;if(boundaries[mid]<=offset && offset<boundaries[mid+1])return mid+1;if(boundaries[mid]>offset)hi=mid-1;else lo=mid+1;}
  return Math.max(1,Math.min(boundaries.length-1,lo+1));
}
