// Kartei-independent "Unterschrift & Stempel" (signature & stamp) settings
// -- extracted out of doctor.html's own inline <script> into its own file,
// same reasoning/pattern as vendor/kartei-visits.js/kartei-mkp.js/
// kartei-documents.js/kartei-labor.js: doctor.html had grown into one huge
// script mixing dozens of unrelated features together. No behavior change
// here -- every function/state variable below is moved verbatim;
// doctor.html loads this file before its own inline <script> so
// sigDataUrl/stempelDataUrl/showSigPreview/showStempelPreview stay
// available exactly as before to the many PDF-building functions
// (buildRezeptPdf, buildUeberweisungPdf, buildPatientReportPdf, ...) and
// the settings-load code that still live in doctor.html itself.
// saveStaffSignature comes from vendor/staff-accounts.js; showToast/
// showToastSettings/currentDoctorUsername/currentStaffSession stay in
// doctor.html.

let stempelDataUrl = '';
let sigDataUrl = '';
let sigDrawing = false;
let sigLastX = 0, sigLastY = 0;

// Init canvas on first settings open
function initSigCanvas(){
  const canvas = document.getElementById('sigCanvas');
  if(!canvas || canvas._init) return;
  canvas._init = true;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function getPos(e){
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x:(src.clientX - r.left)*scaleX, y:(src.clientY - r.top)*scaleY };
  }

  function start(e){ e.preventDefault(); sigDrawing=true; const p=getPos(e); sigLastX=p.x; sigLastY=p.y; }
  function draw(e){ e.preventDefault(); if(!sigDrawing)return; const p=getPos(e); ctx.beginPath(); ctx.moveTo(sigLastX,sigLastY); ctx.lineTo(p.x,p.y); ctx.stroke(); sigLastX=p.x; sigLastY=p.y; }
  function stop(){ sigDrawing=false; }

  canvas.addEventListener('mousedown',start);
  canvas.addEventListener('mousemove',draw);
  canvas.addEventListener('mouseup',stop);
  canvas.addEventListener('mouseleave',stop);
  canvas.addEventListener('touchstart',start,{passive:false});
  canvas.addEventListener('touchmove',draw,{passive:false});
  canvas.addEventListener('touchend',stop);
}

function clearSig(){
  const canvas = document.getElementById('sigCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
}

async function persistSignature(fields){
  const me=currentDoctorUsername();
  if(!me) return false;
  const ok=await saveStaffSignature(me,fields);
  if(!ok) showToast('✗ Speichern fehlgeschlagen — bleibt nur für diese Sitzung aktiv: '+saveErrorMessage(getLastSaveError()),'error');
  return ok;
}
async function saveSig(){
  const canvas = document.getElementById('sigCanvas');
  const data = canvas.toDataURL('image/png');
  // Check if empty
  const blank = document.createElement('canvas');
  blank.width=canvas.width; blank.height=canvas.height;
  if(data === blank.toDataURL('image/png')){ alert('Bitte zuerst unterschreiben!'); return; }
  sigDataUrl = data;
  showSigPreview(data);
  if(await persistSignature({sig_data_url:data})) showToastSettings('✓ Unterschrift gespeichert');
}

function loadSigFromFile(e){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    sigDataUrl = ev.target.result; showSigPreview(ev.target.result);
    if(await persistSignature({sig_data_url:ev.target.result})) showToastSettings('✓ Unterschrift hochgeladen');
  };
  reader.readAsDataURL(file);
}

function showSigPreview(src){
  document.getElementById('sigPreview').src = src;
  document.getElementById('sigPreview').style.display = 'block';
  document.getElementById('sigEmpty').style.display = 'none';
  document.getElementById('sigDelete').style.display = 'block';
  document.getElementById('sigStatus').textContent = '✓ Unterschrift aktiv — wird auf PDFs gedruckt';
  document.getElementById('sigStatus').style.color = '#16a34a';
  // Update PDF preview
  const prev = document.getElementById('previewSig');
  const prevEmpty = document.getElementById('previewSigEmpty');
  if(prev){ prev.src=src; prev.style.display='block'; }
  if(prevEmpty) prevEmpty.style.display='none';
}

async function deleteSig(){
  sigDataUrl = '';
  document.getElementById('sigPreview').style.display='none';
  document.getElementById('sigEmpty').style.display='block';
  document.getElementById('sigDelete').style.display='none';
  document.getElementById('sigStatus').textContent='';
  const prev=document.getElementById('previewSig');
  const prevEmpty=document.getElementById('previewSigEmpty');
  if(prev) prev.style.display='none';
  if(prevEmpty) prevEmpty.style.display='block';
  clearSig();
  await persistSignature({sig_data_url:null});
}

// Stempel
// A photographed stamp is almost always dark ink on white/light paper -- a
// raw photo upload kept that whole paper rectangle as an opaque background,
// which then covered part of the PDF underneath it instead of just showing
// the ink. Since we can't rely on any external/ML background-removal
// service (CSP + no backend for this), fade near-white pixels to transparent
// client-side via canvas, with a soft band (not a hard cutoff) so
// anti-aliased ink edges don't turn jagged. This only helps when the stamp
// was photographed against a plain white/light surface with decent
// lighting -- it can't separate ink from a colored or shadowed background.
function removeStempelBackground(dataUrl){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const canvas=document.createElement('canvas');
        canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
        const ctx=canvas.getContext('2d');
        ctx.drawImage(img,0,0);
        const imgData=ctx.getImageData(0,0,canvas.width,canvas.height);
        const d=imgData.data;
        for(let i=0;i<d.length;i+=4){
          const brightness=(d[i]+d[i+1]+d[i+2])/3;
          if(brightness>235) d[i+3]=0;
          else if(brightness>190) d[i+3]=Math.round(d[i+3]*(235-brightness)/45);
        }
        ctx.putImageData(imgData,0,0);
        resolve(canvas.toDataURL('image/png'));
      }catch(err){ resolve(dataUrl); }
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}
async function loadStempel(e){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    const cleaned = await removeStempelBackground(ev.target.result);
    stempelDataUrl = cleaned; showStempelPreview(cleaned);
    if(await persistSignature({stempel_data_url:cleaned})) showToastSettings('✓ Stempel hochgeladen — Hintergrund automatisch entfernt');
  };
  reader.readAsDataURL(file);
}

function handleStempelDrop(e){
  e.preventDefault();
  document.getElementById('stempelDropzone').style.borderColor='#e2e8f0';
  document.getElementById('stempelDropzone').style.background='#fafbfc';
  const file = e.dataTransfer.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    const cleaned = await removeStempelBackground(ev.target.result);
    stempelDataUrl = cleaned; showStempelPreview(cleaned);
    if(await persistSignature({stempel_data_url:cleaned})) showToastSettings('✓ Stempel hochgeladen — Hintergrund automatisch entfernt');
  };
  reader.readAsDataURL(file);
}

function showStempelPreview(src){
  document.getElementById('stempelPreview').src = src;
  document.getElementById('stempelPreview').style.display = 'block';
  document.getElementById('stempelEmpty').style.display = 'none';
  document.getElementById('stempelDelete').style.display = 'block';
  document.getElementById('stempelStatus').textContent = '✓ Stempel aktiv — wird auf PDFs gedruckt';
  document.getElementById('stempelStatus').style.color = '#16a34a';
  // Update PDF preview
  const prev=document.getElementById('previewStempel');
  const prevEmpty=document.getElementById('previewStempelEmpty');
  if(prev){ prev.src=src; prev.style.display='block'; }
  if(prevEmpty) prevEmpty.style.display='none';
}

async function deleteStempel(){
  stempelDataUrl='';
  document.getElementById('stempelPreview').style.display='none';
  document.getElementById('stempelEmpty').style.display='block';
  document.getElementById('stempelDelete').style.display='none';
  document.getElementById('stempelStatus').textContent='';
  const prev=document.getElementById('previewStempel');
  const prevEmpty=document.getElementById('previewStempelEmpty');
  if(prev) prev.style.display='none';
  if(prevEmpty) prevEmpty.style.display='block';
  await persistSignature({stempel_data_url:null});
}
