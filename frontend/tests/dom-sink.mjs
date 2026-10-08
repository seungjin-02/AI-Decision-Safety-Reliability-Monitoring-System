// Minimal HTML sink for source renderer/event regressions. Browser QA separately
// verifies actual DOM identity, native submission, focus, caret and scrolling.
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function documentSink(fixtureText = null) {
  const root = {innerHTML:''}, handlers = new Map(), nodes = new Map();
  let fixtureReads = 0;
  function bounds(key) {
    const match = [...root.innerHTML.matchAll(/<([\w-]+)\b[^>]*>/g)].find(m=>m[0].includes(key));
    if (!match) return null;
    const start=match.index, inner=start+match[0].length, tag=match[1];
    if (['input','img','br','meta','link'].includes(tag)) return {start,inner,end:inner,after:inner};
    const re=new RegExp(`<\\/?${tag}\\b[^>]*>`, 'g');re.lastIndex=inner;let depth=1, token;
    while ((token=re.exec(root.innerHTML))) {
      depth+=token[0].startsWith('</')?-1:1;
      if (!depth) return {start,inner,end:token.index,after:re.lastIndex};
    }
    throw Error(`Unclosed sink element ${key}`);
  }
  function node(id, key=`id="${id}"`) {
    if (!bounds(key)) return null;
    if (nodes.has(id)) return nodes.get(id);
    function attr(name,value) {
      const b=bounds(key);let opening=root.innerHTML.slice(b.start,b.inner);
      const re=new RegExp(` ${name}="[^"]*"`, 'g');opening=opening.replace(re,'');
      if(value!==null)opening=opening.slice(0,-1)+` ${name}="${escape(value)}">`;
      root.innerHTML=root.innerHTML.slice(0,b.start)+opening+root.innerHTML.slice(b.inner);
    }
    const result={id,dataset:id.startsWith('select-')?{select:id.slice(7)}:{},
      addEventListener(type,fn){handlers.set(`${id}:${type}`,fn);handlers.set(id,fn);},
      setAttribute:attr,removeAttribute:name=>attr(name,null),
      getAttribute(name){const b=bounds(key);return root.innerHTML.slice(b.start,b.inner).match(new RegExp(` ${name}="([^"]*)"`))?.[1]??null;},
      focus(){document.activeElement=result;},
      classList:{toggle(name,enabled){const current=result.getAttribute('class')?.split(' ').filter(v=>v&&v!==name)||[];if(enabled)current.push(name);attr('class',current.join(' '));}},
      insertAdjacentHTML(_,html){const b=bounds(key);root.innerHTML=root.innerHTML.slice(0,b.end)+html+root.innerHTML.slice(b.end);}
    };
    Object.defineProperties(result,{
      innerHTML:{get(){const b=bounds(key);return root.innerHTML.slice(b.inner,b.end);},set(html){const b=bounds(key);root.innerHTML=root.innerHTML.slice(0,b.inner)+html+root.innerHTML.slice(b.end);}},
      textContent:{set(text){result.innerHTML=escape(text);}},
      value:{get(){return result.getAttribute('value')||'';},set(value){attr('value',value);}}
    });
    nodes.set(id,result);return result;
  }
  const document={activeElement:null,getElementById(id){
    if(id==='app')return root;
    if(id==='fixtures'){fixtureReads++;if(fixtureText===null)throw Error('No fixtures in API mode');return {textContent:fixtureText};}
    return node(id);
  },querySelectorAll(){return [...root.innerHTML.matchAll(/data-select="(\d+)"/g)].map(m=>node(`select-${m[1]}`,`data-select="${m[1]}"`));}};
  return {document,root,handlers,fixtureReads:()=>fixtureReads,event(id,type,value){
    const fn=handlers.get(`${id}:${type}`);if(!fn)throw Error(`Missing handler ${id}:${type}`);
    const target=id.startsWith('select-')?node(id,`data-select="${id.slice(7)}"`):document.getElementById(id);
    if(value!==undefined)target.value=value;
    return fn({target,preventDefault(){}});
  }};
}
