const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../shared/diagnostics.js');
test('diagnostics omit payloads, names, addresses and pairing secrets',()=>{
 const token='c'.repeat(64),s={version:'1.3.0',pairingToken:token,targetId:'private-id',targetLabel:'Private file',receivers:[{targetId:'private-id',label:'Private file'}],pending:1,jobs:[{sequence:7,status:'failed',title:'Private title',pageUrl:'https://private.example/',data:'imagebytes',error:'Failed at https://private.example/?token='+token}]};
 const summary=D.summary(s),report=D.report('test','1.3.0',{helper:summary},[D.event('capture.failed','C:\\Users\\Private User\\secret.png '+token)]);
 for(const secret of [token,'Private file','Private title','private-id','private.example','imagebytes','Private User','secret.png'])assert.ok(!report.includes(secret),secret);
 assert.equal(summary.destinationConnected,true);assert.equal(summary.jobs[0].sequence,7);
});
test('clipboard fallback keeps a selectable report when both copy methods are unavailable',async()=>{
 const textarea={value:'',hidden:true,focus(){this.focused=true},select(){this.selected=true},ownerDocument:{defaultView:{navigator:{}}}};
 assert.equal(await D.copy('report',textarea),false);assert.equal(textarea.value,'report');assert.equal(textarea.hidden,false);assert.equal(textarea.selected,true);
 textarea.ownerDocument.execCommand=()=>true;
 assert.equal(await D.copy('report',textarea),true);assert.equal(textarea.hidden,true);
});
