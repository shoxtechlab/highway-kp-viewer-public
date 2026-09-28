const params = new URLSearchParams(location.search);
const icId = params.get('ic') || 'tsuna-ichinomiya';
const knownColors = { A: '#2672c3', B: '#b76812', C: '#198764', D: '#8060b2' };
// 本四高速のランプ記号は A/D が上り、C/B が下り。
const knownLabels = { A: '上り・入口', B: '下り・出口', C: '下り・入口', D: '上り・出口' };
const $ = id => document.getElementById(id);
try {
  const back = new URL(params.get('returnTo') || '/viewer.html?route=e28', location.origin);
  if (back.origin === location.origin && /^\/viewer(?:\.html)?$/.test(back.pathname)) $('back-link').href = back.href;
} catch {}

function distance(a, b) {
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad, lat2 = b[1] * toRad;
  const h = Math.sin((lat2-lat1)/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin((b[0]-a[0])*toRad/2)**2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
  const r = Math.PI / 180, dl = (b[0]-a[0])*r;
  return (Math.atan2(Math.sin(dl)*Math.cos(b[1]*r), Math.cos(a[1]*r)*Math.sin(b[1]*r)-Math.sin(a[1]*r)*Math.cos(b[1]*r)*Math.cos(dl))/r+360)%360;
}
function pointAt(ramp, fraction) {
  const target = ramp.length * fraction;
  let traveled = 0;
  for (let i=1;i<ramp.coordinates.length;i++) {
    const a=ramp.coordinates[i-1], b=ramp.coordinates[i], len=distance(a,b);
    if (len === 0) continue;
    if (traveled+len >= target || i===ramp.coordinates.length-1) {
      const t=Math.min(1,Math.max(0,(target-traveled)/len));
      return {coord:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],heading:bearing(a,b)};
    }
    traveled += len;
  }
  return {coord:ramp.coordinates[0],heading:0};
}
function svUrl(point) {
  const url = new URL('https://www.google.com/maps/@');
  url.search = new URLSearchParams({api:'1',map_action:'pano',viewpoint:`${point.coord[1]},${point.coord[0]}`,heading:point.heading.toFixed(1),pitch:'0'});
  return url.href;
}
function fractionAt(ramp, latlng) {
  const scale = Math.cos(latlng.lat * Math.PI/180);
  let walked=0, bestDistance=Infinity, position=0;
  for(let i=1;i<ramp.coordinates.length;i++) {
    const a=ramp.coordinates[i-1],b=ramp.coordinates[i],len=distance(a,b);
    const dx=(b[0]-a[0])*scale,dy=b[1]-a[1],denom=dx*dx+dy*dy;
    const t=denom ? Math.min(1,Math.max(0,(((latlng.lng-a[0])*scale)*dx+(latlng.lat-a[1])*dy)/denom)) : 0;
    const d=((latlng.lng-a[0])*scale-dx*t)**2+(latlng.lat-a[1]-dy*t)**2;
    if(d<bestDistance) {bestDistance=d;position=walked+len*t;}
    walked+=len;
  }
  return ramp.length ? position/ramp.length : .5;
}
async function init() {
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icId)) throw new Error('このIC・JCTのランプ図は準備中です。');
  const response = await fetch(`./${icId}.json`);
  if (!response.ok) throw new Error('ランプデータを読み込めませんでした。');
  const data = await response.json();
  if(!window.L) throw new Error('地図ライブラリを読み込めませんでした。インターネット接続を確認して再読み込みしてください。');
  $('ic-name').textContent=data.name;
  $('route-shield').textContent=data.routeId?.toUpperCase() || 'JCT';
  $('route-label').textContent=data.routeLabel || '';
  if(Number.isFinite(data.kp)) $('ic-kp').innerHTML=`${Number(data.kp).toFixed(1)} <small>KP</small>`;
  else $('ic-kp').hidden=true;
  document.title=`${data.name} ランプ図 · KP Viewer`;
  const automatic=data.extractionMode==='automatic-link-segments';
  const ramps=data.ramps.map((r,index)=>({...r,
    length:r.coordinates.slice(1).reduce((sum,c,i)=>sum+distance(r.coordinates[i],c),0),
    color:knownColors[r.id] || (r.connectsMainlineAtStart || r.connectsMainlineAtEnd ? '#177657' : `hsl(${205 + index % 5 * 9} 34% ${43 + index % 3 * 6}%)`),
    label:knownLabels[r.id] || `ランプ区間 ${r.id}`
  })).sort((a,b)=>a.id.localeCompare(b.id, 'ja', { numeric:true }));
  if(automatic) {
    $('page-subtitle').textContent='OSMの分岐・合流間を自動分割した結果です。';
    $('section-title').textContent='抽出したランプ区間';
    $('ramp-count').textContent=`${ramps.length} 区間 / 本線接続 ${data.statistics?.mainlineConnectedSegments || 0}`;
    $('selection-kicker').textContent='選択中の区間';
    $('method-note').textContent='AIによる経路判断やABCD名称を使わず、OSMのmotorway_link・trunk_linkを走行方向へたどり、分岐・合流・本線接続ノード間で機械的に分割しています。';
  }
  const map=L.map('map',{zoomControl:false,attributionControl:true}).setView([data.center[1],data.center[0]],16);
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  let tileFailures=0;
  tiles.on('tileerror',()=>{if(++tileFailures>=4){$('map-error').hidden=false;$('map-error').textContent='背景地図を取得できません。ランプ線形はそのまま操作できます。';}});
  map.attributionControl.addAttribution('ランプ線形: OpenStreetMap');
  const context=L.layerGroup().addTo(map);
  for(const way of data.contextWays || []) {
    L.polyline(way.coordinates.map(c=>[c[1],c[0]]),{color:'#fff',weight:9,opacity:.9,interactive:false}).addTo(context);
    L.polyline(way.coordinates.map(c=>[c[1],c[0]]),{color:way.highway==='motorway'?'#74877b':'#a4afa5',weight:way.highway==='motorway'?5:3,opacity:.9,interactive:false}).addTo(context);
  }
  const layers = new Map(), cards=new Map();
  const allBounds=L.latLngBounds(ramps.flatMap(r=>r.coordinates.map(c=>[c[1],c[0]])));
  const fit=()=>map.fitBounds(allBounds,{paddingTopLeft:[42,65],paddingBottomRight:[42,65],maxZoom:17});
  $('fit-map').onclick=fit;
  let selected=ramps[0];
  const marker=L.marker([0,0],{interactive:false,keyboard:false,icon:L.divIcon({className:'view-marker',html:'<span></span>',iconSize:[19,19],iconAnchor:[9.5,9.5]})});
  function setPosition(fraction) {
    const point=pointAt(selected,fraction);
    const traveled=selected.length*fraction;
    const meterPost=selected.mpOrigin==='end' ? selected.length-traveled : traveled;
    $('ramp-position').value=Math.round(fraction*100);
    $('position-label').textContent=selected.mpOrigin
      ? `MP ${Math.max(0,Math.round(meterPost))} m`
      : `始まりから ${Math.round(traveled)} m`;
    $('streetview').href=svUrl(point);
    $('streetview').setAttribute('aria-disabled','false');
    marker.setLatLng([point.coord[1],point.coord[0]]).addTo(map);
    return point;
  }
  function select(ramp, fraction=.5) {
    selected=ramp;document.documentElement.style.setProperty('--active',ramp.color);
    $('selected-letter').textContent=ramp.id;$('selected-letter').classList.toggle('segment-id',automatic);$('selected-name').textContent=ramp.label;
    $('selected-length').textContent=`約 ${Math.round(ramp.length)} m`;
    $('selected-path').textContent=automatic
      ? `${ramp.connectsMainlineAtStart?'本線接続 → ':''}分岐・合流ノード間${ramp.connectsMainlineAtEnd?' → 本線接続':''}`
      : ramp.movement==='entry' ? `一般道 → ${ramp.towards}方面の本線` : `${ramp.direction==='up'?'上り':'下り'}本線 → 一般道`;
    for (const r of ramps) {
      const isActive=r.id===ramp.id;
      cards.get(r.id).classList.toggle('selected',isActive);
      cards.get(r.id).querySelector('button').setAttribute('aria-pressed',String(isActive));
      layers.get(r.id).setStyle({weight:isActive?8:5,opacity:isActive?1:.75});
    }
    layers.get(ramp.id).bringToFront();
    return setPosition(fraction);
  }
  for(const ramp of ramps) {
    const color=ramp.color, latlngs=ramp.coordinates.map(c=>[c[1],c[0]]);
    const casing=L.polyline(latlngs,{color:'#fff',weight:11,opacity:.9,interactive:false}).addTo(map);
    const line=L.polyline(latlngs,{color,weight:5,opacity:.75,bubblingMouseEvents:false}).addTo(map);
    const hit=L.polyline(latlngs,{color,weight:23,opacity:0,bubblingMouseEvents:false}).addTo(map);
    layers.set(ramp.id,line);
    function pick(event) {
      const point=select(ramp,fractionAt(ramp,event.latlng));
      L.popup({autoPan:false}).setLatLng([point.coord[1],point.coord[0]]).setContent(`<span class="popup-title">${ramp.label}</span><br>選択した位置から現地を見る<a class="popup-link" href="${svUrl(point)}" target="_blank" rel="noopener noreferrer">ストリートビュー ↗</a>`).openOn(map);
    }
    line.on('click',pick);hit.on('click',pick);
    const midpoint=pointAt(ramp,.5);
    // A/B run close to one another; offset their labels, not the road geometry.
    const labelOffset={A:[24,39],B:[26,-3],C:[18,16],D:[-2,16]}[ramp.id] || [22,22];
    if(!automatic) L.marker([midpoint.coord[1],midpoint.coord[0]],{icon:L.divIcon({className:'ramp-map-marker',html:`<a href="${svUrl(midpoint)}" target="_blank" rel="noopener noreferrer" style="--ramp:${color}" aria-label="${ramp.label}のストリートビュー">${ramp.id}</a>`,iconSize:[44,44],iconAnchor:labelOffset}),keyboard:false}).addTo(map);
    for(const f of (automatic ? [.5] : [.23,.77])) {
      const pt=pointAt(ramp,f);
      L.marker([pt.coord[1],pt.coord[0]],{interactive:false,keyboard:false,icon:L.divIcon({className:'heading-marker',html:`<span style="--angle:${pt.heading-45}deg"></span>`,iconSize:[12,12],iconAnchor:[6,6]})}).addTo(map);
    }
    if(!automatic) {
      const card=document.createElement('div');card.className='ramp-card';card.style.setProperty('--ramp',color);
      card.innerHTML=`<button class="ramp-select" aria-pressed="false" aria-label="${ramp.label}を選択"><span class="ramp-letter">${ramp.id}</span><span class="ramp-copy"><strong>${ramp.label}</strong><small>${ramp.towards}方面</small></span></button><a class="ramp-direct" href="${svUrl(midpoint)}" target="_blank" rel="noopener noreferrer" aria-label="${ramp.label}のストリートビュー">↗</a>`;
      card.querySelector('button').onclick=()=>{map.closePopup();select(ramp);};
      cards.set(ramp.id,card);$('ramp-list').append(card);
    }
  }
  if(automatic) {
    const picker=document.createElement('select');picker.className='segment-picker';picker.setAttribute('aria-label','ランプ区間を選択');
    for(const ramp of ramps) picker.add(new Option(`${ramp.id}　約${Math.round(ramp.length)}m${ramp.connectsMainlineAtStart||ramp.connectsMainlineAtEnd?'　本線接続':''}`,ramp.id));
    picker.onchange=()=>{map.closePopup();select(ramps.find(ramp=>ramp.id===picker.value));};
    $('ramp-list').append(picker);
    for(const ramp of ramps) cards.set(ramp.id,{classList:{toggle(){}},querySelector(){return {setAttribute(){}};}});
  }
  $('ramp-position').oninput=event=>{map.closePopup();setPosition(Number(event.target.value)/100);};
  function setBase(enabled) {
    if(enabled) tiles.addTo(map); else map.removeLayer(tiles);
    for(const [id,active] of [['map-base',enabled],['map-lines',!enabled]]) {$ (id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));}
  }
  $('map-base').onclick=()=>setBase(true);$('map-lines').onclick=()=>setBase(false);
  $('source-note').textContent=automatic ? `抽出統計：OSMリンクway ${data.statistics.sourceLinkWays}、分割後 ${ramps.length}区間。` : `${data.name}周辺のOSM線形を使用。ABCDは本試作内の分類です。`;
  new ResizeObserver(()=>{map.invalidateSize({pan:false});}).observe($('map'));
  // Leaflet materializes SVG paths only after the first view is set.
  // Fit before select(), which raises the selected path above the other ramps.
  fit();select(ramps[0]);
}
init().catch(error=>{$('map-error').hidden=false;$('map-error').textContent=error.message;$('selected-name').textContent='読み込みできませんでした';console.error(error);});
