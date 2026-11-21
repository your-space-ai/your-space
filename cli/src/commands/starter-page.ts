/** A self-contained editable Home app. The parent brokers reads only while this
 * exact frame is the selected Home. No agent key or provider secret goes here. */
export function starterPage(title: string) {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark;font:17px/1.5 system-ui}body{max-width:46rem;margin:0 auto;padding:clamp(1.4rem,5vw,4rem)}h1{font:normal clamp(2.2rem,6vw,4rem)/1.05 Georgia,serif;margin:0 0 1.5rem}label{display:grid;gap:.35rem;margin:1rem 0}button,select,textarea{font:inherit;padding:.55rem .75rem}textarea{min-height:3rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}button:not(:disabled){cursor:pointer}
</style>
<main><h1>${title}</h1><p id="status" role="status">Connecting to Your Space…</p>
<form hidden><label>Data source<select id="actions"></select></label>
<details><summary>Request fields</summary><label>JSON input<textarea id="input">{}</textarea></label></details>
<button type="submit">Show data</button></form><pre id="output" aria-live="polite"></pre></main>
<script>
const form=document.querySelector('form'), choices=document.querySelector('#actions'), statusLine=document.querySelector('#status');
const requests=new Map();
let parentOrigin='';
const ready=new Promise((resolve,reject)=>{
  if (parent===window) {reject(Error('Open this app as Home in Your Space.')); return;}
  const timer=setTimeout(()=>{removeEventListener('message',welcome);reject(Error('Choose this app in Home settings to connect a data source.'));},10000);
  function welcome(event){
    if(event.source!==parent || !/^https?:/.test(event.origin) || event.data?.type!=='your-space:home:ready' || event.data.version!==1) return;
    clearTimeout(timer);removeEventListener('message',welcome);parentOrigin=event.origin;resolve();
  }
  addEventListener('message',welcome);
});
function call(type, fields={}) {
  return new Promise((resolve,reject)=>{
    if(parent===window || !parentOrigin) return reject(Error('Choose this app as Home in Your Space to connect a data source.'));
    const requestId=crypto.randomUUID();
    const timer=setTimeout(()=>{requests.delete(requestId); reject(Error('Open this app as your workspace Home to read connected data.'));},8000);
    requests.set(requestId, message=>{clearTimeout(timer); message.ok ? resolve(message.result) : reject(Error(message.error?.message || 'The read is unavailable.'));});
    parent.postMessage({type,version:1,requestId,...fields},parentOrigin);
  });
}
addEventListener('message',event=>{
  const m=event.data;
  if(event.origin!==parentOrigin || event.source!==parent || m?.type!=='your-space:home:result' || m.version!==1) return;
  const finish=requests.get(m.requestId);
  if(finish){requests.delete(m.requestId);finish(m);}
});
let actions=[];
ready.then(()=>call('your-space:home:actions')).then(result=>{
  actions=result.actions;
  for(const [i,action] of actions.entries()){
    const option=document.createElement('option');option.value=i;
    option.textContent=(action.appName||action.installationId)+' · '+(action.title||action.actionId);
    choices.append(option);
  }
  form.hidden=!actions.length;
  statusLine.textContent=actions.length ? 'Choose the data you want to see.' : 'Choose an app and read role in the workspace Home settings.';
}).catch(e=>{statusLine.textContent=e.message;});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const {installationId,actionId}=actions[Number(choices.value)];
    const result=await call('your-space:home:read',{installationId,actionId,input:JSON.parse(document.querySelector('#input').value)});
    document.querySelector('#output').textContent=JSON.stringify(result,null,2);statusLine.textContent='Updated';
  }catch(e){document.querySelector('#output').textContent='';statusLine.textContent=e.message;}
});
</script></html>`;
}
