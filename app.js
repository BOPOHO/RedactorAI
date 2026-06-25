/* ======================================================================
   МОНТАЖ — Этап 1
   Импорт + таймлайн (3 дорожки) + разрезать/обрезать/склеить/дублировать/удалить
   Работает офлайн после первой загрузки (см. sw.js)
   ====================================================================== */

(function(){
"use strict";

// ---------- STATE ----------
const state = {
  clips: [],          // {id, track, type, file, url, start, duration, trimIn, trimOut, name, thumb}
  selectedId: null,
  pxPerSec: 40,
  playhead: 0,
  nextId: 1,
};

const el = (id)=>document.getElementById(id);
const trackEls = { v2: el('trackV2'), v1: el('trackV1'), a1: el('trackA1') };

function toast(msg, ms=1800){
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove('show'), ms);
}

function fmtTime(s){
  s = Math.max(0,s);
  const m = Math.floor(s/60);
  const sec = (s%60).toFixed(1).padStart(4,'0');
  return String(m).padStart(2,'0')+':'+sec;
}

// ---------- IMPORT ----------
el('addVideoBtn').addEventListener('click', ()=>el('fileVideo').click());
el('addAudioBtn').addEventListener('click', ()=>el('fileAudio').click());
el('addImgBtn').addEventListener('click', ()=>el('fileImg').click());

el('fileVideo').addEventListener('change', e=>handleFiles(e.target.files, 'video', 'v1'));
el('fileAudio').addEventListener('change', e=>handleFiles(e.target.files, 'audio', 'a1'));
el('fileImg').addEventListener('change', e=>handleFiles(e.target.files, 'image', 'v1'));

function handleFiles(fileList, type, track){
  const files = Array.from(fileList);
  if(!files.length) return;
  let chain = Promise.resolve();
  files.forEach(file=>{
    chain = chain.then(()=>addClip(file, type, track));
  });
  chain.then(()=>{ toast('Импортировано: '+files.length); render(); });
}

function addClip(file, type, track){
  return new Promise(resolve=>{
    const url = URL.createObjectURL(file);
    const clip = {
      id: state.nextId++,
      track, type, file, url,
      name: file.name,
      start: lastEndOnTrack(track),
      duration: 3,      // default for images, replaced for video/audio
      trimIn: 0,
      trimOut: 3,
    };
    if(type === 'image'){
      clip.duration = 3; clip.trimOut = 3;
      state.clips.push(clip);
      resolve();
    } else {
      const probe = document.createElement(type === 'video' ? 'video' : 'audio');
      probe.preload = 'metadata';
      probe.src = url;
      probe.onloadedmetadata = ()=>{
        const dur = isFinite(probe.duration) ? probe.duration : 5;
        clip.duration = dur;
        clip.trimOut = dur;
        state.clips.push(clip);
        resolve();
      };
      probe.onerror = ()=>{
        clip.duration = 5; clip.trimOut = 5;
        state.clips.push(clip);
        resolve();
      };
    }
  });
}

function lastEndOnTrack(track){
  const onTrack = state.clips.filter(c=>c.track===track);
  if(!onTrack.length) return 0;
  return Math.max(...onTrack.map(c=>c.start + (c.trimOut - c.trimIn)));
}

// ---------- RENDER TIMELINE ----------
function render(){
  Object.values(trackEls).forEach(t=>t.querySelectorAll('.clip').forEach(n=>n.remove()));

  let maxEnd = 0;
  state.clips.forEach(clip=>{
    const len = clip.trimOut - clip.trimIn;
    maxEnd = Math.max(maxEnd, clip.start + len);
    const node = document.createElement('div');
    node.className = 'clip ' + (clip.type==='audio' ? 'audio' : 'video');
    if(clip.id === state.selectedId) node.classList.add('selected');
    node.style.left = (clip.start * state.pxPerSec) + 'px';
    node.style.width = Math.max(20, len * state.pxPerSec) + 'px';
    node.dataset.id = clip.id;
    node.innerHTML = '<div class="handle l"></div>' +
                      '<span style="position:relative;z-index:1;overflow:hidden;text-overflow:ellipsis;">'+
                      escapeHtml(clip.name)+'</span>' +
                      '<div class="handle r"></div>';
    attachDrag(node, clip);
    trackEls[clip.track].appendChild(node);
  });

  const totalWidth = Math.max(window.innerWidth, (maxEnd+5) * state.pxPerSec);
  el('timeline-inner').style.width = totalWidth + 'px';
  updatePlayheadPos();
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function selectClip(id){
  state.selectedId = id;
  render();
  const clip = state.clips.find(c=>c.id===id);
  if(clip) loadPreviewClip(clip);
}

document.getElementById('timeline-inner').addEventListener('click', (ev)=>{
  // клик по пустому месту таймлайна — снимаем выделение клипа
  if(ev.target.closest('.clip')) return;
  state.selectedId = null;
  render();
});

// ---------- ДВИЖЕНИЕ КРАСНОЙ ПАЛКИ (плейхеда) ----------
const timelineInner = el('timeline-inner');
const timelineScroll = el('timeline-scroll');

function setPlayheadFromClientX(clientX){
  const rect = timelineInner.getBoundingClientRect();
  const x = clientX - rect.left;
  state.playhead = Math.max(0, x / state.pxPerSec);
  updatePlayheadPos();
  syncPreviewToPlayhead();
}

function syncPreviewToPlayhead(){
  // находим клип на любой видео-дорожке, который сейчас "под палкой"
  const clip = state.clips.find(c=>{
    const len = c.trimOut - c.trimIn;
    return c.track !== 'a1' && state.playhead >= c.start && state.playhead < c.start + len;
  });
  if(!clip) return;
  if(clip.id !== state.selectedId){
    state.selectedId = clip.id;
    render();
  }
  if(clip.type === 'video'){
    const v = el('previewVideo');
    if(v.src !== clip.url) v.src = clip.url;
    v.currentTime = clip.trimIn + (state.playhead - clip.start);
    el('previewImg').style.display='none';
    v.style.display='block';
    el('emptyState').style.display='none';
  } else if(clip.type === 'image'){
    const img = el('previewImg');
    if(img.src !== clip.url) img.src = clip.url;
    el('previewVideo').style.display='none';
    img.style.display='block';
    el('emptyState').style.display='none';
  }
}

let scrubbing = false;
let dragStartedOnClip = false;

timelineScroll.addEventListener('mousedown', (ev)=>{
  dragStartedOnClip = !!ev.target.closest('.clip');
  if(dragStartedOnClip) return; // клипы сами обрабатывают свой драг в attachDrag
  scrubbing = true;
  setPlayheadFromClientX(ev.clientX);
});
timelineScroll.addEventListener('touchstart', (ev)=>{
  dragStartedOnClip = !!ev.target.closest('.clip');
  if(dragStartedOnClip) return;
  scrubbing = true;
  setPlayheadFromClientX(ev.touches[0].clientX);
}, {passive:true});
window.addEventListener('mousemove', (ev)=>{
  if(scrubbing) setPlayheadFromClientX(ev.clientX);
});
window.addEventListener('touchmove', (ev)=>{
  if(scrubbing) setPlayheadFromClientX(ev.touches[0].clientX);
}, {passive:true});
window.addEventListener('mouseup', ()=>scrubbing=false);
window.addEventListener('touchend', ()=>scrubbing=false);

// тоже даём двигать палку, таская сам треугольник плейхеда
const playheadEl = el('playhead');
playheadEl.style.cursor = 'ew-resize';
playheadEl.style.pointerEvents = 'auto';
playheadEl.addEventListener('mousedown', (ev)=>{ scrubbing = true; ev.stopPropagation(); });
playheadEl.addEventListener('touchstart', (ev)=>{ scrubbing = true; ev.stopPropagation(); }, {passive:true});

// ---------- DRAG TO MOVE / TRIM ----------
function attachDrag(node, clip){
  let mode = null, startX = 0, origStart = 0, origIn = 0, origOut = 0;
  let moved = false;

  function onDown(ev){
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX);
    const rect = node.getBoundingClientRect();
    const relX = x - rect.left;
    if(relX < 14) mode = 'trimL';
    else if(relX > rect.width - 14) mode = 'trimR';
    else mode = 'move';
    startX = x;
    moved = false;
    origStart = clip.start; origIn = clip.trimIn; origOut = clip.trimOut;
    ev.stopPropagation();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, {passive:false});
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  function onMove(ev){
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX);
    if(Math.abs(x - startX) > 4) moved = true;
    if(!moved) return; // меньше 4px — считаем это тапом, а не перетаскиванием
    if(ev.cancelable) ev.preventDefault();
    const dx = (x - startX) / state.pxPerSec;
    if(mode === 'move'){
      clip.start = Math.max(0, origStart + dx);
    } else if(mode === 'trimL'){
      let newIn = origIn + dx;
      newIn = Math.max(0, Math.min(newIn, origOut - 0.2));
      clip.trimIn = newIn;
      clip.start = Math.max(0, origStart + (newIn - origIn));
    } else if(mode === 'trimR'){
      let newOut = origOut + dx;
      newOut = Math.max(origIn + 0.2, Math.min(newOut, clip.duration));
      clip.trimOut = newOut;
    }
    render();
  }

  function onUp(ev){
    if(!moved){
      // это был просто тап по клипу — двигаем палку в это место
      const x = (ev.changedTouches ? ev.changedTouches[0].clientX : ev.clientX);
      setPlayheadFromClientX(x);
    }
    mode = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchend', onUp);
  }

  node.addEventListener('mousedown', onDown);
  node.addEventListener('touchstart', onDown, {passive:false});
}

// ---------- PREVIEW ----------
function loadPreviewClip(clip){
  const v = el('previewVideo'), img = el('previewImg'), empty = el('emptyState');
  empty.style.display = 'none';
  if(clip.type === 'image'){
    v.style.display = 'none'; v.pause();
    img.style.display = 'block';
    img.src = clip.url;
  } else {
    img.style.display = 'none';
    v.style.display = 'block';
    if(v.src !== clip.url) v.src = clip.url;
    v.currentTime = clip.trimIn;
  }
}

el('previewVideo').addEventListener('click', function(){
  if(this.paused) this.play(); else this.pause();
});

// ---------- PLAYHEAD ----------
function updatePlayheadPos(){
  el('playhead').style.left = (state.playhead * state.pxPerSec) + 'px';
  el('playhead-time').textContent = fmtTime(state.playhead);
}

// ---------- TOOLBAR ACTIONS ----------
el('toolrow').addEventListener('click', (ev)=>{
  const tool = ev.target.closest('.tool');
  if(!tool) return;
  const action = tool.dataset.tool;
  const clip = state.clips.find(c=>c.id===state.selectedId);
  if(!clip){ toast('Нажми на клип или поставь красную палку на него'); return; }
  runTool(action, clip);
});

function runTool(action, clip){
  switch(action){
    case 'split': doSplit(clip); break;
    case 'duplicate': doDuplicate(clip); break;
    case 'delete': doDelete(clip); break;
    case 'trim': toast('Тяни края клипа на таймлайне ↔️'); break;
    case 'crop': toast('Кадрирование — будет на Этапе 2'); break;
    case 'speed': toast('Скорость — будет на Этапе 2'); break;
  }
}

function doSplit(clip){
  const len = clip.trimOut - clip.trimIn;
  let splitAt = state.playhead - clip.start; // позиция реза внутри клипа, в секундах от начала клипа

  if(splitAt <= 0.1 || splitAt >= len - 0.1){
    toast('Поставь красную палку внутри клипа, потом жми "Разрезать"');
    return;
  }

  const GAP = 0.12; // небольшой видимый зазор между получившимися частями, чтобы было видно что их 2

  const newClip = Object.assign({}, clip, {
    id: state.nextId++,
    start: clip.start + splitAt + GAP,
    trimIn: clip.trimIn + splitAt,
    trimOut: clip.trimOut,
  });
  clip.trimOut = clip.trimIn + splitAt;

  state.clips.push(newClip);
  state.selectedId = newClip.id;
  render();
  toast('Готово: было 1 клип — стало 2 ✂️');
}

function doDuplicate(clip){
  const len = clip.trimOut - clip.trimIn;
  const copy = Object.assign({}, clip, {
    id: state.nextId++,
    start: clip.start + len,
    name: clip.name,
  });
  state.clips.push(copy);
  state.selectedId = copy.id;
  render();
  toast('Клип дублирован 📋');
}

function doDelete(clip){
  state.clips = state.clips.filter(c=>c.id!==clip.id);
  state.selectedId = null;
  render();
  el('emptyState').style.display = state.clips.length ? 'none' : 'block';
  toast('Клип удалён 🗑️');
}

el('undoBtn').addEventListener('click', ()=>toast('Undo появится на следующем этапе'));
el('exportBtn').addEventListener('click', ()=>toast('Экспорт появится в конце — после всех функций'));

// ---------- ENGINE STATUS (FFmpeg.wasm placeholder for Stage 1) ----------
function setEngineStatus(ready, label){
  el('engineDot').classList.toggle('ready', ready);
  el('engineLabel').textContent = label;
}
setEngineStatus(false, 'Этап 1: монтаж без движка экспорта');

// register service worker for offline caching (if present)
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

render();

})();
