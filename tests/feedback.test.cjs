const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
test('capture feedback accepts only extension messages and clears before screenshot selection',()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.com/',runScripts:'outside-only'}),w=dom.window;
 let receive;
 w.chrome={runtime:{id:'own-extension',onMessage:{addListener:fn=>receive=fn}}};
 try{
  w.eval(fs.readFileSync(path.join(__dirname,'../extension/content.js'),'utf8'));
  receive({type:'capture-feedback',message:'Foreign'},{id:'other'},()=>{});
  assert.equal(w.document.querySelector('[data-stf-feedback]'),null);
  receive({type:'capture-feedback',message:'Preparing'},{id:'own-extension'},()=>{});
  assert.ok(w.document.querySelector('[data-stf-feedback]'));
  receive({type:'capture-feedback',message:''},{id:'own-extension'},()=>{});
  assert.equal(w.document.querySelector('[data-stf-feedback]'),null);
 }finally{w.close()}
});
