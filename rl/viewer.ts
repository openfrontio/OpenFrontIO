/**
 * Tiny live spectator for one env: `http://localhost:<port>`. Shows the territory map,
 * the agent (white outline) and a leaderboard, polled ~4x/s. Purely read-only.
 */
import http from "node:http";
import type { OpenFrontEnv } from "./OpenFrontEnv";

const PAGE = `<!doctype html><meta charset=utf-8><title>OpenFront RL viewer</title>
<style>
  body{margin:0;background:#0b1220;color:#dbe4f3;font:14px system-ui,sans-serif;display:flex;gap:16px;padding:16px}
  canvas{image-rendering:pixelated;width:min(72vw,1100px);background:#0e2238;border:1px solid #243a57}
  #side{min-width:240px} h1{font-size:15px;margin:0 0 8px} .you{color:#ffd54a;font-weight:600}
  table{border-collapse:collapse;width:100%} td{padding:2px 6px} td:last-child{text-align:right}
  .sw{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:2px}
</style>
<canvas id=c></canvas>
<div id=side><h1 id=hdr>connecting…</h1><div id=you></div><table id=lb></table></div>
<script>
const cv=document.getElementById('c'),ctx=cv.getContext('2d');
function color(id,agent){
  if(id===65535)return [14,34,56];
  if(id===0)return [58,72,52];
  if(id===agent)return [255,213,74];
  const h=(id*137.508)%360,s=55+((id*53)%30),l=45+((id*29)%15);
  return hsl(h,s/100,l/100);
}
function hsl(h,s,l){const a=s*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,Math.min(9-k,1)))};return [f(0)*255,f(8)*255,f(4)*255]}
async function tick(){
  try{
    const r=await fetch('/frame');const buf=await r.arrayBuffer();
    const n=new DataView(buf).getUint32(0,true);
    const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,n)));
    const off=(4+n+1)&~1;const data=new Uint16Array(buf,off,meta.w*meta.h);
    cv.width=meta.w;cv.height=meta.h;
    const img=ctx.createImageData(meta.w,meta.h);
    for(let i=0;i<data.length;i++){const c=color(data[i],meta.agent);img.data[i*4]=c[0];img.data[i*4+1]=c[1];img.data[i*4+2]=c[2];img.data[i*4+3]=255}
    ctx.putImageData(img,0,0);
    document.getElementById('hdr').textContent='tick '+meta.tick+' · decision '+meta.decisions+' · '+meta.alive+' alive';
    document.getElementById('you').innerHTML=meta.you?'<p class=you>Agent: '+meta.you.tiles+' tiles · '+meta.you.troops+' troops · '+meta.you.gold+' gold</p>':'<p>Agent eliminated / not spawned</p>';
    document.getElementById('lb').innerHTML=meta.leaders.map(p=>{const c=color(p.id,meta.agent);return '<tr class='+(p.you?'you':'')+'><td><span class=sw style="background:rgb('+c.map(Math.round)+')"></span>'+p.name.replace(/</g,'&lt;')+'</td><td>'+p.tiles+'</td></tr>'}).join('');
  }catch(e){document.getElementById('hdr').textContent='waiting for game…'}
  setTimeout(tick,250);
}
tick();
</script>`;

export function startViewer(env: OpenFrontEnv, port: number): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/frame") {
      try {
        const f = env.frame();
        const metaBuf = Buffer.from(JSON.stringify(f.meta));
        const off = (4 + metaBuf.length + 1) & ~1;
        const out = Buffer.alloc(off + f.data.byteLength);
        out.writeUInt32LE(metaBuf.length, 0);
        metaBuf.copy(out, 4);
        Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength).copy(out, off);
        res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
        res.end(out);
      } catch {
        res.writeHead(503).end();
      }
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });
  server.on("error", (e) => console.error("viewer error:", e));
  server.listen(port, () => console.error(`Viewer: http://localhost:${port}`));
}
