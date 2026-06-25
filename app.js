/* ======================================================================
   МОНТАЖ — Этап 1 (исправленная версия)
   Импорт + таймлайн (3 дорожки) + разрезать/обрезать/дублировать/удалить
   + рабочий ЭКСПОРТ в MP4 через FFmpeg.wasm (движок грузится 1 раз, потом офлайн)
   + звук аудио-дорожки слышен при просмотре
   ====================================================================== */

(function(){
"use strict";

// ---------- STATE ----------
const state = {
  clips: [],
  selectedId: null,
  pxPerSec: 40,
  playhead: 0,
  nextId: 1,
};

const el = (id)=>document.getElementById(id);
const trackEls = { v2: el('trackV2'), v1: el('trackV1'), a1: el('trackA1') };

function toast(msg, ms=2200){
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
      duration: 3,
      trimIn: 0,
      trimOut: 3,
      volume: 1,
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
  el('emptyState').style.display = state.clips.length ? 'none' : 'block';
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

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

// текущий звучащий аудио-клип (отдельный Audio-объект, играет параллельно с превью-видео)
let activeAudioEl = null;
let activeAudioClipId = null;

function syncPreviewToPlayhead(){
  const visualClip = state.clips.find(c=>{
    const len = c.trimOut - c.trimIn;
    return c.track !== 'a1' && state.playhead >= c.start && state.playhead < c.start + len;
  });
  if(visualClip){
    if(visualClip.id !== state.selectedId){
      state.selectedId = visualClip.id;
      render();
    }
    if(visualClip.type === 'video'){
      const v = el('previewVideo');
      if(v.src !== visualClip.url) v.src = visualClip.url;
      v.currentTime = visualClip.trimIn + (state.playhead - visualClip.start);
      el('previewImg').style.display='none';
      v.style.display='block';
    } else if(visualClip.type === 'image'){
      const img = el('previewImg');
      if(img.src !== visualClip.url) img.src = visualClip.url;
      el('previewVideo').style.display='none';
      img.style.display='block';
    }
  }

  // звук аудио-дорожки
  const audioClip = state.clips.find(c=>{
    const len = c.trimOut - c.trimIn;
    return c.track === 'a1' && state.playhead >= c.start && state.playhead < c.start + len;
  });
  if(audioClip){
    if(activeAudioClipId !== audioClip.id){
      if(activeAudioEl){ activeAudioEl.pause(); }
      activeAudioEl = new Audio(audioClip.url);
      activeAudioClipId = audioClip.id;
    }
    if(activeAudioEl){
      activeAudioEl.currentTime = audioClip.trimIn + (state.playhead - audioClip.start);
    }
  } else if(activeAudioEl){
    activeAudioEl.pause();
    activeAudioEl = null;
    activeAudioClipId = null;
  }
}

function playAllFromPlayhead(){
  const v = el('previewVideo');
  if(v.style.display === 'block') v.play().catch(()=>{});
  if(activeAudioEl) activeAudioEl.play().catch(()=>{});
}
function pauseAll(){
  el('previewVideo').pause();
  if(activeAudioEl) activeAudioEl.pause();
}

let scrubbing = false;

timelineScroll.addEventListener('mousedown', (ev)=>{
  if(ev.target.closest('.clip')) return;
  scrubbing = true;
  setPlayheadFromClientX(ev.clientX);
});
timelineScroll.addEventListener('touchstart', (ev)=>{
  if(ev.target.closest('.clip')) return;
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

const playheadEl = el('playhead');
playheadEl.style.cursor = 'ew-resize';
playheadEl.style.pointerEvents = 'auto';
playheadEl.addEventListener('mousedown', (ev)=>{ scrubbing = true; ev.stopPropagation(); });
playheadEl.addEventListener('touchstart', (ev)=>{ scrubbing = true; ev.stopPropagation(); }, {passive:true});

// ---------- DRAG TO MOVE / TRIM CLIPS ----------
function attachDrag(node, clip){
  let mode = null, startX = 0, origStart = 0, origIn = 0, origOut = 0, moved = false;

  function onDown(ev){
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX);
    const rect = node.getBoundingClientRect();
    const relX = x - rect.left;
    if(relX < 14) mode = 'trimL';
    else if(relX > rect.width - 14) mode = 'trimR';
    else mode = 'move';
    startX = x; moved = false;
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
    if(!moved) return;
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
      const x = (ev.changedTouches ? ev.changedTouches[0].clientX : ev.clientX);
      setPlayheadFromClientX(x);
    } else if(mode !== 'move'){
      toast('Края обрезаны');
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

// ---------- PREVIEW PLAY/PAUSE ----------
el('previewVideo').addEventListener('click', function(){
  if(this.paused) playAllFromPlayhead(); else pauseAll();
});

// ---------- PLAYHEAD LABEL ----------
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
    case 'trim': toast('Тяни за края клипа на таймлайне ↔️'); break;
    case 'crop': toast('Кадрирование появится на Этапе 2'); break;
    case 'speed': toast('Скорость появится на Этапе 2'); break;
  }
}

function doSplit(clip){
  const len = clip.trimOut - clip.trimIn;
  let splitAt = state.playhead - clip.start;

  if(splitAt <= 0.1 || splitAt >= len - 0.1){
    toast('Поставь красную палку внутри клипа, потом жми "Разрезать"');
    return;
  }

  const GAP = 0.12;
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
  const copy = Object.assign({}, clip, { id: state.nextId++, start: clip.start + len });
  state.clips.push(copy);
  state.selectedId = copy.id;
  render();
  toast('Клип дублирован 📋');
}

function doDelete(clip){
  state.clips = state.clips.filter(c=>c.id!==clip.id);
  state.selectedId = null;
  render();
  toast('Клип удалён 🗑️');
}

// ======================================================================
//  ЭКСПОРТ ВИДЕО — реальный движок FFmpeg.wasm
// ======================================================================

let ffmpeg = null;
let engineReady = false;

function setEngineStatus(mode, label){
  const dot = el('engineDot');
  dot.classList.remove('ready','busy');
  if(mode) dot.classList.add(mode);
  el('engineLabel').textContent = label;
}

async function ensureEngineLoaded(){
  if(engineReady) return true;
  if(typeof FFmpegWASM === 'undefined' && typeof FFmpeg === 'undefined'){
    toast('Файлы движка не найдены — проверь папку engine рядом с index.html');
    setEngineStatus(null, 'Движок не найден');
    return false;
  }
  try{
    setEngineStatus('busy', 'Загрузка движка… (нужен интернет один раз)');
    const FF = (typeof FFmpegWASM !== 'undefined') ? FFmpegWASM.FFmpeg : FFmpeg.FFmpeg;
    ffmpeg = new FF();
    ffmpeg.on('log', ({message})=>{ /* console.log(message); */ });
    await ffmpeg.load({
      coreURL: './engine/ffmpeg-core.js',
      wasmURL: './engine/ffmpeg-core.wasm',
    });
    engineReady = true;
    setEngineStatus('ready', 'Движок готов (работает офлайн)');
    return true;
  } catch(err){
    console.error(err);
    setEngineStatus(null, 'Ошибка загрузки движка');
    toast('Не получилось загрузить движок экспорта. Проверь, что папка engine загружена рядом с index.html, и что есть интернет (нужен один раз).');
    return false;
  }
}

function fileExtFromName(name){
  const m = /\.([a-zA-Z0-9]+)$/.exec(name||'');
  return m ? m[1].toLowerCase() : 'mp4';
}

async function fetchFileAsUint8(url){
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// Экспорт: берём клипы видео-дорожки V1 (основная), режем по trimIn/trimOut,
// конкатенируем по порядку start. Аудио-дорожка добавляется отдельным шагом.
async function runExport(onProgress){
  const v1Clips = state.clips
    .filter(c=>c.track==='v1' && c.type==='video')
    .sort((a,b)=>a.start-b.start);

  if(!v1Clips.length){
    throw new Error('Нет видео на дорожке "Видео 1" — добавь хотя бы один видеоклип');
  }

  const segmentFiles = [];
  for(let i=0;i<v1Clips.length;i++){
    const clip = v1Clips[i];
    const inName = `in_${i}.${fileExtFromName(clip.name)}`;
    const outName = `seg_${i}.mp4`;
    const data = await fetchFileAsUint8(clip.url);
    await ffmpeg.writeFile(inName, data);

    const dur = (clip.trimOut - clip.trimIn).toFixed(3);
    const start = clip.trimIn.toFixed(3);

    await ffmpeg.exec([
      '-y','-ss', start, '-i', inName, '-t', dur,
      '-vf','scale=1280:-2',
      '-c:v','libx264','-preset','ultrafast','-crf','23',
      '-c:a','aac','-b:a','128k',
      outName
    ]);
    segmentFiles.push(outName);
    onProgress && onProgress(0.1 + 0.6 * ((i+1)/v1Clips.length));
  }

  // список для конкатенации
  const listContent = segmentFiles.map(f=>`file '${f}'`).join('\n');
  await ffmpeg.writeFile('list.txt', new TextEncoder().encode(listContent));

  await ffmpeg.exec(['-y','-f','concat','-safe','0','-i','list.txt','-c','copy','concat_video.mp4']);
  onProgress && onProgress(0.75);

  // аудио-дорожка (берём первый аудио-клип целиком для Этапа 1 — упрощённая версия)
  const a1Clips = state.clips.filter(c=>c.track==='a1' && c.type==='audio').sort((a,b)=>a.start-b.start);
  let finalName = 'concat_video.mp4';

  if(a1Clips.length){
    const aClip = a1Clips[0];
    const audioInName = `aud_in.${fileExtFromName(aClip.name)}`;
    const audioData = await fetchFileAsUint8(aClip.url);
    await ffmpeg.writeFile(audioInName, audioData);
    const aDur = (aClip.trimOut - aClip.trimIn).toFixed(3);
    const aStart = aClip.trimIn.toFixed(3);

    await ffmpeg.exec([
      '-y','-i','concat_video.mp4',
      '-ss', aStart, '-t', aDur, '-i', audioInName,
      '-map','0:v:0','-map','1:a:0',
      '-c:v','copy','-c:a','aac','-b:a','128k',
      '-shortest',
      'final_output.mp4'
    ]);
    finalName = 'final_output.mp4';
  }
  onProgress && onProgress(0.95);

  const resultData = await ffmpeg.readFile(finalName);
  onProgress && onProgress(1);
  return new Blob([resultData.buffer], {type:'video/mp4'});
}

// ---------- EXPORT UI ----------
const exportSheet = el('exportSheet');
const exportBody = el('exportBody');
const exportProgress = el('exportProgress');
const exportDone = el('exportDone');
const exportProgressBar = el('exportProgressBar');
const exportProgressLabel = el('exportProgressLabel');

el('exportBtn').addEventListener('click', ()=>{
  exportBody.style.display = 'block';
  exportProgress.style.display = 'none';
  exportDone.style.display = 'none';
  exportSheet.classList.add('show');
});
el('exportCloseBtn').addEventListener('click', ()=>exportSheet.classList.remove('show'));
el('exportDoneCloseBtn').addEventListener('click', ()=>exportSheet.classList.remove('show'));

el('exportStartBtn').addEventListener('click', async ()=>{
  pauseAll();
  exportBody.style.display = 'none';
  exportProgress.style.display = 'block';
  exportProgressBar.style.width = '0%';
  exportProgressLabel.textContent = 'Загрузка движка…';

  const ok = await ensureEngineLoaded();
  if(!ok){
    exportProgress.style.display = 'none';
    exportBody.style.display = 'block';
    return;
  }

  try{
    const blob = await runExport((p)=>{
      const pct = Math.round(p*100);
      exportProgressBar.style.width = pct + '%';
      exportProgressLabel.textContent = 'Обработка… ' + pct + '%';
    });
    const url = URL.createObjectURL(blob);
    el('exportDownloadLink').href = url;
    exportProgress.style.display = 'none';
    exportDone.style.display = 'block';
    toast('Видео готово!');
  } catch(err){
    console.error(err);
    exportProgress.style.display = 'none';
    exportBody.style.display = 'block';
    toast('Ошибка экспорта: ' + (err.message || 'неизвестная ошибка'));
  }
});

// register service worker for offline caching (if present)
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

setEngineStatus(null, 'Движок загрузится при экспорте');
render();

})();
