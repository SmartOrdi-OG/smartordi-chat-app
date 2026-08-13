// doctor.html's mobile-only navigation glue -- extracted out of its own
// inline <script> into its own file, same reasoning/pattern as
// vendor/kartei-visits.js and the other vendor/kartei-*.js files:
// doctor.html had grown into one huge script mixing dozens of unrelated
// features together. No behavior change here -- every function below is
// moved verbatim; doctor.html loads this file before its own inline
// <script> so every global here (isMobile, mnavActive, etc.) is still
// available exactly as before to onclick="..." attributes and other code
// in doctor.html itself (karteiOpen/toggleKartei/resetKarteiToSearch stay
// in doctor.html; renderTagesuhr comes from vendor/kartei-tagesuhr.js).
function isMobile(){ return window.innerWidth <= 768; }

function mnavActive(id){
  document.querySelectorAll('.mobile-nav-item').forEach(function(el){el.classList.remove('active');});
  var el = document.getElementById(id);
  if(el) el.classList.add('active');
  // Every other mobile nav button ends up here as its last step -- ride
  // that to close the Kalender overlay whenever any real tab is opened,
  // instead of patching each individual nav function.
  if(id!=='mnav-kalender') document.body.classList.remove('mobile-tuhome-active');
}

// Entry point for the Tagesuhr calendar tab, used by both mobile's
// bottom-nav "Kalender" button and desktop's own nav-tab. Hides every real
// .view directly rather than going through switchView(), since #tuHome
// isn't a .view itself (no nav-tab-mirrored id to look up).
function showKalender(btn){
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.querySelectorAll('.nav-tab').forEach(function(t){t.classList.remove('active');});
  if(btn) btn.classList.add('active');
  if(typeof karteiOpen!=='undefined' && karteiOpen) toggleKartei();
  document.body.classList.add('mobile-tuhome-active');
  renderTagesuhr();
}

function mobileOpenChat(name){
  if(!isMobile()) return;
  var sidebar = document.querySelector('.clinic-sidebar');
  if(sidebar) sidebar.classList.add('mobile-hidden');
  var chatBack = document.getElementById('mobileChatBack');
  var chatHeader = document.getElementById('desktopChatHeader');
  var actionsRow = document.getElementById('chatActionsRow');
  if(chatBack) chatBack.style.display='flex';
  if(chatHeader) chatHeader.style.display='none';
  if(actionsRow) actionsRow.style.display='none';
  var nm = document.getElementById('mobileChatName');
  if(nm) nm.textContent = name;
}

function mobileOpenKartei(){
  if(!isMobile()){toggleKartei();return;}
  // Switch to clinic view first
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const clinicView=document.getElementById('view-clinic');
  if(clinicView)clinicView.classList.add('active');
  // Show chat area (hide sidebar)
  const sidebar=document.querySelector('.clinic-sidebar');
  if(sidebar)sidebar.classList.add('mobile-hidden');
  const chatBack=document.getElementById('mobileChatBack');
  const chatHeader=document.getElementById('desktopChatHeader');
  if(chatBack)chatBack.style.display='flex';
  if(chatHeader)chatHeader.style.display='none';
  // Keep the compact header's name in sync with whichever chat is actually
  // behind it (selectPatient only updates #chat-name, not #mobileChatName).
  const nm=document.getElementById('mobileChatName');
  const currentChatName=document.getElementById('chat-name');
  if(nm && currentChatName) nm.textContent=currentChatName.textContent;
  // Open kartei -- this is a general entry point (bottom-nav icon), not tied
  // to a specific patient, so land on the empty Suche tab like the desktop
  // top-nav icon does, instead of showing whichever patient was last chatted.
  if(!karteiOpen)toggleKartei();
  resetKarteiToSearch();
}

function mobileBackToList(){
  var sidebar=document.querySelector('.clinic-sidebar');
  if(sidebar)sidebar.classList.remove('mobile-hidden');
  var chatBack=document.getElementById('mobileChatBack');
  var chatHeader=document.getElementById('desktopChatHeader');
  var actionsRow=document.getElementById('chatActionsRow');
  if(chatBack)chatBack.style.display='none';
  if(chatHeader)chatHeader.style.display='flex';
  if(actionsRow)actionsRow.style.display='flex';
  if(typeof karteiOpen!=='undefined'&&karteiOpen)toggleKartei();
  mnavActive('mnav-clinic');
}
