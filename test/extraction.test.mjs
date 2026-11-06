import test from 'node:test';
import assert from 'node:assert/strict';
import {extractText,pageForOffset} from '../js/pdf.js';

test('extração preserva páginas e texto para leitura adaptável',async()=>{
 const pdf={numPages:3,async getPage(n){return {async getTextContent(){return {items:[{str:`Capítulo ${n}.`,transform:[1,0,0,14,50,650],width:85,height:14,hasEOL:true},{str:'Um parágrafo para testar.',transform:[1,0,0,14,50,625],width:200,height:14,hasEOL:true}]}}}}};
 const x=await extractText(pdf);
 assert.match(x.text,/Capítulo 1/);
 assert.match(x.text,/Capítulo 3/);
 assert.equal(x.boundaries.length,4);
 assert.equal(pageForOffset(x.boundaries,x.boundaries[1]),2);
 assert.equal(pageForOffset(x.boundaries,x.boundaries[2]),3);
});
