// Actual emitted main/UI and native stdio/HTTP/WebSocket; Figma scene API is a fixture.
const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), os = require("node:os"),
  cp = require("node:child_process"), vm = require("node:vm");
const {JSDOM} = require("jsdom"), WebSocket = require("ws");
const {fixture, pluginSource} = require("./figma-fixture.cjs"),
  {binary, freePort, waitFor, nativeProcess} = require("./native-fixture.cjs");
const root = path.join(__dirname, ".."),
  release = path.join(root,"release","Send-to-Figma-"+require("../package.json").version);

function openPlugin(f, token, port) {
  let dom;
  const requests = [], copies = [];
  f.figma.showUI = html => {
    f.figma.shownHTML = html;
    dom = new JSDOM(html, {url:"https://fixture.local/", runScripts:"dangerously", beforeParse(w) {
      w.WebSocket = class extends WebSocket {
        constructor(url) {
          assert.equal(url,"ws://localhost:47821/receiver");
          // Isolate test servers; the shipped URL itself is asserted above.
          super("ws://localhost:"+port+"/receiver", {origin:"null"});
        }
      };
      w.postMessage = envelope => {
        requests.push(envelope.pluginMessage);
        queueMicrotask(() => f.figma.ui.onmessage(envelope.pluginMessage));
      };
      Object.defineProperty(w.navigator,"clipboard",{value:{writeText:async text => copies.push(text)}});
    }});
  };
  f.figma.ui.postMessage = message => {
    f.messages.push(message);
    queueMicrotask(() => dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      source:null, data:{pluginMessage:message},
    })));
  };
  const context = vm.createContext({figma:f.figma,
    __html__:fs.readFileSync(path.join(release,"figma-plugin/ui.html"),"utf8"),
    Uint8Array, console, Math, Date, JSON, Promise});
  vm.runInContext(pluginSource().replace("__STF_INSTALL_TOKEN__",token), context);
  return {dom,requests,copies,close() { dom.window.document.getElementById("start").click(); dom.window.close(); }};
}

test("installed receiver auto-connects through a null-source host relay, drains first-use captures and restores on reopen", async () => {
  assert.ok(fs.existsSync(binary),"Build the helper before integration tests");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"stf-receiver-")), port=await freePort(),
    server=cp.spawn(binary,["--serve","--data-dir",dir,"--port",String(port)],{stdio:"ignore"}),
    exited=new Promise(r=>server.once("exit",r));
  let native, plugin;
  try {
    await waitFor(async()=>{try{return(await fetch("http://127.0.0.1:"+port+"/health")).ok}catch{return false}});
    native=nativeProcess(dir,port);
    const status=await native.call("status"), png=fs.readFileSync(path.join(__dirname,"fixtures/transparent.png")).toString("base64");
    await native.call("reserve",{id:"request-before-receiver",title:"Private image title",pageUrl:"https://private.example/?token=private"});
    await native.call("upload",{id:"request-before-receiver",data:png,mime:"image/png",width:12,height:8});
    const f=fixture();
    f.figma.createImage=bytes=>({hash:"image-hash",getSizeAsync:async()=>({width:Buffer.from(bytes).readUInt32BE(16),height:Buffer.from(bytes).readUInt32BE(20)})});
    f.storage.set("stf-settings-v1",{version:1,layout:{},appearance:{},pairingToken:"a".repeat(64)});
    plugin=openPlugin(f,status.pairingToken,port);
    try { await waitFor(async()=> (await native.call("status")).done===1); } catch(e) {
      console.error({phase:plugin.dom.window.document.getElementById("connection-text").textContent,error:plugin.dom.window.document.getElementById("notice").textContent,requests:plugin.requests.map(m=>m.type),host:f.messages.map(m=>({type:m.type,error:m.error}))}); throw e; }
    assert.equal(plugin.requests.filter(m=>m.type==="pair").length,0,"No manual pairing action");
    assert.equal(plugin.requests.filter(m=>m.type==="start").length,1,"Duplicate init must not create twice");
    assert.equal(plugin.dom.window.document.getElementById("connection-text").textContent,"Приёмник подключён");
    const collection=f.messages.find(m=>m.type==="target").target.targetId;
    assert.equal([...f.nodes.values()].filter(n=>n.getPluginData("stf-collection")).length,1);
    plugin.dom.window.document.getElementById("copy-report").click();
    await waitFor(()=>plugin.copies.length);
    const report=plugin.copies[0];
    assert.equal(JSON.parse(report).hostReady,true);
    for(const secret of [status.pairingToken,"private.example","Private image title",collection]) assert.ok(!report.includes(secret));
    plugin.close();plugin=null;
    await waitFor(async()=>!(await native.call("status")).receivers.length);
    await native.call("reserve",{id:"request-after-reopen",title:"Second"});
    await native.call("upload",{id:"request-after-reopen",data:png,mime:"image/png",width:12,height:8});
    plugin=openPlugin(f,status.pairingToken,port);
    await waitFor(async()=> (await native.call("status")).done===2);
    assert.equal([...f.nodes.values()].filter(n=>n.getPluginData("stf-collection")).length,1,"Reopening duplicated the collection");
    assert.equal([...f.nodes.values()].filter(n=>n.getPluginData("stf-job")).length,2);
  } finally {
    plugin?.close();native?.process.kill();server.kill();await exited;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
