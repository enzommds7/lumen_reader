const DB_NAME = 'lumen-reader-v1';
const VERSION = 1;
let handle;
export function openDB() {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('books', {keyPath:'id'});
      db.createObjectStore('files', {keyPath:'id'});
      db.createObjectStore('extracted', {keyPath:'id'});
      const notes = db.createObjectStore('annotations', {keyPath:'id'});
      notes.createIndex('bookId', 'bookId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { handle = null; reject(req.error); };
  });
  return handle;
}
function request(req) { return new Promise((resolve,reject) => {req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }
async function transact(stores, mode, callback) {
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(stores,mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Falha no armazenamento.'));
    tx.onabort = () => reject(tx.error || new Error('Armazenamento cancelado.'));
    try { result = callback(tx); } catch(e) {tx.abort();reject(e);}
  });
}
export async function allBooks() { const db=await openDB();return request(db.transaction('books').objectStore('books').getAll()); }
export async function getBook(id) {const db=await openDB();return request(db.transaction('books').objectStore('books').get(id));}
export async function getFile(id) {const db=await openDB();return request(db.transaction('files').objectStore('files').get(id));}
export async function getExtracted(id) {const db=await openDB();return request(db.transaction('extracted').objectStore('extracted').get(id));}
export async function saveExtracted(data) {return transact(['extracted'],'readwrite',tx=>tx.objectStore('extracted').put(data));}
export async function addBook(book,file) {return transact(['books','files'],'readwrite',tx=>{tx.objectStore('books').put(book);tx.objectStore('files').put({id:book.id,file});});}
export async function saveBook(book) {return transact(['books'],'readwrite',tx=>tx.objectStore('books').put(book));}
export async function deleteBook(id) {const anns=await annotationsFor(id);return transact(['books','files','extracted','annotations'],'readwrite',tx=>{for(const store of ['books','files','extracted'])tx.objectStore(store).delete(id);for(const ann of anns)tx.objectStore('annotations').delete(ann.id);});}
export async function annotationsFor(bookId) {const db=await openDB();return request(db.transaction('annotations').objectStore('annotations').index('bookId').getAll(bookId));}
export async function saveAnnotation(ann) {return transact(['annotations'],'readwrite',tx=>tx.objectStore('annotations').put(ann));}
export async function removeAnnotation(id) {return transact(['annotations'],'readwrite',tx=>tx.objectStore('annotations').delete(id));}
export async function storageEstimate() {try{return await navigator.storage.estimate()}catch{return null}}
