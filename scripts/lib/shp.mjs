// Minimal shapefile reader with Z support (types 1/11 points, 3/13 lines, 5/15 polygons).
// Yields {i, type, coords} for points and {i, type, bbox, rings} otherwise; i is the record index.
import fs from 'node:fs';
import shapefile from 'shapefile';

export function* readShp(path, bbox){
  const buf=fs.readFileSync(path); let o=100; let idx=0;
  while(o<buf.length){
    const len=buf.readInt32BE(o+4)*2; const s=o+8; o=s+len; const i=idx++;
    const t=buf.readInt32LE(s); if(t===0) continue;
    if(t===1||t===11){const x=buf.readDoubleLE(s+4),y=buf.readDoubleLE(s+12),z=t===11?buf.readDoubleLE(s+20):0;
      if(bbox&&(x<bbox[0]||x>bbox[2]||y<bbox[1]||y>bbox[3]))continue; yield {i,type:'Point',coords:[x,y,z]}; continue;}
    const bx=[buf.readDoubleLE(s+4),buf.readDoubleLE(s+12),buf.readDoubleLE(s+20),buf.readDoubleLE(s+28)];
    if(bbox&&(bx[2]<bbox[0]||bx[0]>bbox[2]||bx[3]<bbox[1]||bx[1]>bbox[3]))continue;
    const np=buf.readInt32LE(s+36), n=buf.readInt32LE(s+40); const parts=[];
    for(let k=0;k<np;k++)parts.push(buf.readInt32LE(s+44+4*k));
    const p0=s+44+4*np; const hasZ=(t===13||t===15); const z0=p0+16*n+16;
    const rings=[];
    for(let k=0;k<np;k++){const a=parts[k],b=k+1<np?parts[k+1]:n; const r=[];
      for(let j=a;j<b;j++)r.push([buf.readDoubleLE(p0+16*j),buf.readDoubleLE(p0+16*j+8),hasZ?buf.readDoubleLE(z0+8*j):0]); rings.push(r);}
    yield {i,type:(t%10===3)?'Line':'Polygon',bbox:bx,rings};
  }
}

// Read records within bbox together with their DBF attributes.
export async function readLayer(base, bbox) {
  const hits = new Map();
  for (const g of readShp(base + '.shp', bbox)) hits.set(g.i, g);
  const dbf = await shapefile.openDbf(base + '.dbf', { encoding: 'utf-8' });
  let i = 0;
  for (;;) {
    const r = await dbf.read();
    if (r.done) break;
    const g = hits.get(i++);
    if (g) g.props = r.value;
  }
  return [...hits.values()];
}
