// "Tagesuhr" -- doctor.html's home/dashboard canvas-based day/week/month
// calendar (#tuHome, Tag/Woche/Monat view modes) -- extracted out of
// doctor.html's own inline <script> into its own file, same reasoning/
// pattern as vendor/kartei-visits.js and the other vendor/kartei-*.js
// files: doctor.html had grown into one huge script mixing dozens of
// unrelated features together. No behavior change here -- every function
// below is moved verbatim; doctor.html loads this file before its own
// inline <script> so every global here (renderTagesuhr, tuShiftView, etc.)
// is still available exactly as before to onclick="..." attributes and
// other code in doctor.html itself.
//
// makeFloatingWindowDraggable()/makeFloatingWindowResizable() deliberately
// stay in doctor.html, NOT moved here, even though tuCalWindow uses them --
// they're shared with floatingChatWindow (the Praxis chat popup), a
// completely different feature, so bundling them into a "Tagesuhr" file
// would misrepresent what actually depends on what. Everything else this
// file's functions call (arztDisplayName/colorForName/completeTerminVisit/
// currentDoctorUsername/dayBoxLabel/escapeHtml/filterToMyTermine/goBack/
// loadTermine/longDateDE/openChatForPatient/openKarteiForPatientAndShow/
// patientItemHtml/startTerminVisit/todayStr) stays in doctor.html itself or
// vendor/patient-data.js, same as every other vendor/kartei-*.js file's
// dependencies on the rest of the page.
// ══ TAGESUHR (home-canvas calendar, #tuHome) ══
// Local YYYY-MM-DD, deliberately not toISOString() -- that converts to UTC,
// which silently rolls a local midnight Date back to the *previous* day for
// any positive UTC offset (all of Austria, CET/CEST included). Every date
// built for this grid goes through this helper for that reason.
function tuDateStr(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function tuTimeToDecimal(hhmm){
  const [h,m]=(hhmm||'0:0').split(':').map(Number);
  return h+(m||0)/60;
}
let tuSelectedDate=null;
// Whether the dial should keep following "today" -- true until the doctor
// deliberately picks a different day in the strip. Needed because
// tuSelectedDate is a plain string set once: without this, a browser tab
// left open across midnight would keep showing yesterday's date/count
// forever (until a manual click or full page reload), since nothing else
// re-evaluates what "today" currently is.
let tuFollowingToday=true;
// Tag (single day, the existing view) vs Woche (5-day work-week overview)
// vs Monat (full month grid) -- each added alongside the others, never a
// replacement (see the tu-week-grid CSS comment for why an always-on
// alternative layout was already tried and dropped once). Plain
// module-level state like tuSelectedDate above -- survives until reload,
// not persisted further.
let tuViewMode='tag';
function tuSetViewMode(mode){
  tuViewMode=mode;
  // Jump Monat's displayed month to match whatever day is currently
  // selected -- but only on entry into Monat mode, not synced every render
  // like tuMiniCalYear/tuMiniCalMonth are (renderTagesuhr() resyncs those
  // unconditionally, which is right for a "mini date-picker" but would
  // fight tuShiftCalMonth()'s independent month-browsing below if reused
  // for the big grid too).
  if(mode==='monat'){
    const selD=new Date(tuSelectedDate+'T00:00:00');
    tuCalYear=selD.getFullYear(); tuCalMonth=selD.getMonth();
  } else {
    // Leaving Monat -- the floating window has no clicked-cell position to
    // anchor to once we're back on Tag/Woche, so close it rather than
    // leaving a stale overlay showing.
    _tuCalWindowOpen=false;
  }
  const root=document.getElementById('tuHome');
  if(root){
    root.classList.toggle('tu-week-mode',mode==='woche');
    root.classList.toggle('tu-month-mode',mode==='monat');
  }
  document.getElementById('tuViewTagBtn')?.classList.toggle('active',mode==='tag');
  document.getElementById('tuViewWocheBtn')?.classList.toggle('active',mode==='woche');
  document.getElementById('tuViewMonatBtn')?.classList.toggle('active',mode==='monat');
  renderTagesuhr();
}
// Toolbar's ‹/› arrows mean "one step back/forward in whatever unit the
// current view shows" -- a real day in Tag mode (tuShiftDay's own
// weekend-skipping logic), a full week in Woche mode, a full month in
// Monat mode.
function tuShiftView(delta){
  if(tuViewMode==='woche') tuShiftWeek(delta*7);
  else if(tuViewMode==='monat') tuShiftCalMonth(delta);
  else tuShiftDay(delta);
}
function tuSelectDate(dateStr){
  tuSelectedDate=dateStr;
  tuFollowingToday=(dateStr===todayStr());
  renderTagesuhr();
}
// "Heute" toolbar button (mirrors secretary.html's secCalGoToday()) -- jumps
// Tag/Woche back to today (tuFollowingToday re-enables renderTagesuhr()'s own
// weekend-clamping) and, independently, resets Monat's own browsed-away
// month (tuCalYear/tuCalMonth) back to today's, same as tuSetViewMode() does
// on first entering Monat mode.
function tuGoToday(){
  tuFollowingToday=true;
  tuCalYear=null; tuCalMonth=null;
  renderTagesuhr();
}
function tuShiftWeek(deltaDays){
  const d=new Date(tuSelectedDate+'T00:00:00');
  d.setDate(d.getDate()+deltaDays);
  tuSelectDate(tuDateStr(d));
}
// Desktop's single-day view moves one real day at a time (not a whole week
// like tuShiftWeek, still used by mobile's day-strip) but skips straight
// over weekends in either direction -- the practice is closed Sat/Sun, so
// there's never a real day to land on there.
function tuShiftDay(delta){
  const d=new Date(tuSelectedDate+'T00:00:00');
  d.setDate(d.getDate()+delta);
  while(d.getDay()===0||d.getDay()===6){
    d.setDate(d.getDate()+(delta>=0?1:-1));
  }
  tuSelectDate(tuDateStr(d));
}
// Monday-Friday only (5 dates) -- the practice is closed weekends, so
// Saturday/Sunday are never part of the work week shown here at all.
function tuWorkWeekDates(dateStr){
  const d=new Date(dateStr+'T00:00:00');
  const mondayOffset=(d.getDay()+6)%7;
  const monday=new Date(d); monday.setDate(d.getDate()-mondayOffset);
  const out=[];
  for(let i=0;i<5;i++){
    const dd=new Date(monday); dd.setDate(monday.getDate()+i);
    out.push(tuDateStr(dd));
  }
  return out;
}
// Visit progress is entirely doctor-driven (supabase/phase7_termin_visit_state.sql)
// -- NOT inferred from the clock. Comparing scheduled time to now used to
// decide "now/next/past", but that breaks the moment the day runs behind
// or a patient is seen out of order, which is the normal case here. 'now'
// only means the doctor explicitly started that visit; 'done' only means
// they explicitly marked it finished. There is no "next" prediction at all
// anymore, since order isn't reliable enough to guess.
function tuVisitState(t){
  if(t.completedAt) return 'done';
  if(t.startedAt) return 'now';
  return null;
}
// Tracks the one visit "Start" most recently opened, so the topbar's global
// "Zurück" button (goBack(), always returns to Kalender) can auto-complete
// it on the way back -- lets a doctor go Start -> examine/update the
// patient's Kartei -> Zurück, and land back on Kalender with that
// appointment already showing "Fertig", instead of having to separately
// find and click that row's own Fertig button afterward. Only the ONE most
// recently started visit is tracked (not a full stack) -- if a doctor
// starts a second visit without returning from the first, only the second
// gets auto-completed this way; the first's own inline "Fertig" button
// (still rendered as long as its state stays 'now') covers that edge case.
let _tuActiveStartedTerminId=null;
async function tuMarkStarted(id){
  if(!(await startTerminVisit(id))) return;
  renderTagesuhr();
  _tuActiveStartedTerminId=id;
  const t=loadTermine().find(x=>x.id===id);
  if(t) openKarteiForPatientAndShow(t.patient,t.svnr,t.versicherung,t.dob);
}
async function tuMarkDone(id){
  if(await completeTerminVisit(id)) renderTagesuhr();
}
function tuVisitControlHtml(t,size){
  const compact=size==='col'||size==='tl';
  if(t.status==='abgesagt') return `<span class="${compact?'tu-col-badge':'tu-appt-chip'} cancelled">Abgesagt</span>`;
  const state=tuVisitState(t);
  const btnCls=compact?'tu-col-btn':'tu-visit-btn';
  if(state==='done') return `<span class="${compact?'tu-col-badge':'tu-time-chip'} done"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><polyline points="20 6 9 17 4 12"/></svg> Fertig</span>`;
  if(state==='now') return `<button class="${btnCls} done" onclick="event.stopPropagation();tuMarkDone('${t.id}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><polyline points="20 6 9 17 4 12"/></svg> Fertig</button>`;
  return `<button class="${btnCls}" onclick="event.stopPropagation();tuMarkStarted('${t.id}')">▶ Start</button>`;
}
// The "⋮" next to a Kalender row/card's name jumps straight to that
// patient's Kartei (openKarteiForPatientAndShow already opens Kartei as its
// own window on top of #tuHome without leaving the Kalender behind it --
// closing Kartei returns to exactly the same Kalender view) instead of the
// row's own click, which opens the Praxis chat.
function tuToggleRowMenu(e,name,svnr,versicherung,dob){
  e.stopPropagation();
  const menu=document.getElementById('tuRowMenu');
  if(!menu) return;
  const opening=menu.style.display==='none';
  if(opening){
    const rect=e.currentTarget.getBoundingClientRect();
    menu.style.top=(rect.bottom+4)+'px';
    menu.style.left=Math.min(rect.left,window.innerWidth-170)+'px';
    menu.dataset.name=name;
    menu.dataset.svnr=svnr||'';
    menu.dataset.versicherung=versicherung||'';
    menu.dataset.dob=dob||'';
  }
  menu.style.display=opening?'flex':'none';
}
function tuRowMenuOpenKartei(){
  const menu=document.getElementById('tuRowMenu');
  if(!menu) return;
  menu.style.display='none';
  openKarteiForPatientAndShow(menu.dataset.name,menu.dataset.svnr,menu.dataset.versicherung,menu.dataset.dob);
}
document.addEventListener('click',e=>{
  const menu=document.getElementById('tuRowMenu');
  if(!menu||menu.style.display==='none')return;
  if(!e.target.closest('#tuRowMenu')&&!e.target.closest('.tu-row-menu-btn'))menu.style.display='none';
});
function tuApptRowHtml(t){
  const statusClass=t.status==='abgesagt'?'cancelled':(t.status==='bestaetigt'?'':'pending');
  // jsArg-style order (same as patientItemHtml() elsewhere in this file):
  // quote-escape FIRST for the inner JS-string context, THEN escapeHtml for
  // the outer HTML-attribute context -- doing escapeHtml() first (the
  // previous bug here) turns ' into &#39; before the quote-replace ever
  // runs, so the replace matches nothing and the browser's entity-decode-
  // then-JS-eval reconstructs a raw quote that breaks out of the onclick
  // string. versEsc/svnrEsc/dobEsc had no quote-escaping at all.
  const jsArg=s=>escapeHtml(String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
  const nameEsc=jsArg(t.patient);
  const versEsc=jsArg(t.versicherung);
  const svnrEsc=jsArg(t.svnr);
  const dobEsc=jsArg(t.dob);
  const visitState=tuVisitState(t);
  const rowClass='tu-appt-row'+(visitState?' '+visitState:'');
  return `<div class="${rowClass}" onclick="openChatForPatient('${nameEsc}','${colorForName(t.patient)}','${versEsc}')">
    <div class="tu-appt-time">${t.time||''}</div>
    <div class="tu-appt-bar ${statusClass}"></div>
    <div class="tu-appt-info">
      <div class="tu-appt-name-row">
        <div class="tu-appt-name${t.status==='abgesagt'?' strike':''}">${escapeHtml(t.patient)}</div>
        <button class="tu-row-menu-btn" onclick="tuToggleRowMenu(event,'${nameEsc}','${svnrEsc}','${versEsc}','${dobEsc}')" title="Weitere Optionen">⋮</button>
      </div>
      <div class="tu-appt-type">${escapeHtml(t.art||'')}</div>
    </div>
    ${tuVisitControlHtml(t,'row')}
  </div>`;
}
// Desktop's card-grid equivalent of tuApptRowHtml() above -- same data and
// same actions (open chat / row menu / start-visit), just laid out as a
// card so several fit side-by-side on a wide screen instead of one row
// stretching edge-to-edge with a big gap between the name and the button.
function tuApptCardHtml(t){
  // jsArg-style order (same as patientItemHtml() elsewhere in this file):
  // quote-escape FIRST for the inner JS-string context, THEN escapeHtml for
  // the outer HTML-attribute context -- doing escapeHtml() first (the
  // previous bug here) turns ' into &#39; before the quote-replace ever
  // runs, so the replace matches nothing and the browser's entity-decode-
  // then-JS-eval reconstructs a raw quote that breaks out of the onclick
  // string. versEsc/svnrEsc/dobEsc had no quote-escaping at all.
  const jsArg=s=>escapeHtml(String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
  const nameEsc=jsArg(t.patient);
  const versEsc=jsArg(t.versicherung);
  const svnrEsc=jsArg(t.svnr);
  const dobEsc=jsArg(t.dob);
  const visitState=tuVisitState(t);
  const cardClass='tu-appt-card'+(visitState?' '+visitState:'');
  const initial=escapeHtml((t.patient||'?')[0]||'?');
  return `<div class="${cardClass}" onclick="openChatForPatient('${nameEsc}','${colorForName(t.patient)}','${versEsc}')">
    <div class="tu-appt-card-top">
      <div class="tu-appt-card-avatar" style="background:${colorForName(t.patient)};">${initial}</div>
      <div class="tu-appt-card-time">${t.time||''}</div>
      <button class="tu-row-menu-btn" onclick="tuToggleRowMenu(event,'${nameEsc}','${svnrEsc}','${versEsc}','${dobEsc}')" title="Weitere Optionen">⋮</button>
    </div>
    <div class="tu-appt-card-name${t.status==='abgesagt'?' strike':''}">${escapeHtml(t.patient)}</div>
    <div class="tu-appt-card-type">${escapeHtml(t.art||'')}</div>
    <div class="tu-appt-card-foot">${tuVisitControlHtml(t,'col')}</div>
  </div>`;
}
// Replaces the old circular clock-face dial: doctors need to scan "how many
// appointments, who's currently being seen" in one glance rather than read
// an analog dial, so this is just a one-line summary above the plain
// chronological list (tu-appt-row) that was already the real information.
function renderTuSummary(dayAppts){
  const el=document.getElementById('tuSummary');
  if(!el) return;
  const active=dayAppts.filter(t=>t.status!=='abgesagt');
  if(!active.length){
    el.innerHTML='<span class="tu-summary-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span>Keine Termine an diesem Tag</span>';
    return;
  }
  const label=active.length===1?'Termin':'Termine';
  let html=`<span class="tu-summary-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span>${active.length} ${label} an diesem Tag</span>`;
  const inProgress=active.find(t=>tuVisitState(t)==='now');
  if(inProgress) html+=`<span class="tu-summary-next">· Gerade bei: ${escapeHtml(inProgress.patient)}</span>`;
  el.innerHTML=html;
}
const TU_MONTHS_DE=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const TU_DOW_DE=['So','Mo','Di','Mi','Do','Fr','Sa'];
// ── Mini month-calendar (desktop) -- lets the doctor jump straight to any
// date instead of only stepping day-by-day. Its displayed month is kept in
// sync with tuSelectedDate's month by renderTagesuhr() itself; browsing to
// another month via tuShiftMiniCalMonth() only touches these two vars and
// re-renders the mini-cal alone, so it doesn't get reset mid-browse by an
// unrelated renderTagesuhr() call (e.g. a Realtime Termine update landing).
let tuMiniCalYear=null, tuMiniCalMonth=null;
const TU_DOW_MINI=['Mo','Di','Mi','Do','Fr','Sa','So'];
function tuShiftMiniCalMonth(delta){
  let m=tuMiniCalMonth+delta, y=tuMiniCalYear;
  if(m<0){m=11;y--;} else if(m>11){m=0;y++;}
  tuMiniCalMonth=m; tuMiniCalYear=y;
  renderTuMiniCal();
}
// ── Monat view's own displayed month -- deliberately separate state from
// tuMiniCalYear/tuMiniCalMonth above, not reused: renderTagesuhr() forces
// the mini-cal to always follow tuSelectedDate's month on every render
// (right for a small date-picker), which would fight independent month
// browsing here (tuShiftCalMonth() re-renders only the grid itself, same
// pattern as tuShiftMiniCalMonth()).
let tuCalYear=null, tuCalMonth=null;
function tuShiftCalMonth(delta){
  let m=tuCalMonth+delta, y=tuCalYear;
  if(m<0){m=11;y--;} else if(m>11){m=0;y++;}
  tuCalMonth=m; tuCalYear=y;
  renderTuCalGrid(filterToMyTermine(loadTermine()));
  const dayLabelEl=document.getElementById('tuDayLabel');
  if(dayLabelEl) dayLabelEl.textContent=TU_MONTHS_DE[tuCalMonth]+' '+tuCalYear;
}
// Full month grid, one cell per day with up to 2 appointment chips + a
// "+N mehr" overflow marker (mirrors secretary.html's own Termine month
// calendar, renderSecTermineCalendar) -- clicking a cell opens that day's
// appointments in a floating window beside the cell (tuCalSelectDay()),
// same pattern as secretary.html's #secCalWindow.
function renderTuCalGrid(mine){
  const gridEl=document.getElementById('tuCalGrid');
  if(!gridEl) return;
  if(tuCalYear===null){
    const selD=new Date(tuSelectedDate+'T00:00:00');
    tuCalYear=selD.getFullYear(); tuCalMonth=selD.getMonth();
  }
  const year=tuCalYear, month=tuCalMonth;
  const byDate={};
  mine.forEach(t=>{ (byDate[t.date]=byDate[t.date]||[]).push(t); });
  const firstDay=new Date(year,month,1);
  const startOffset=(firstDay.getDay()+6)%7; // Monday-first, matches TU_DOW_MINI
  const daysInMonth=new Date(year,month+1,0).getDate();
  const totalCells=Math.ceil((startOffset+daysInMonth)/7)*7;
  const todayS=todayStr();
  let cells='';
  for(let i=0;i<totalCells;i++){
    const cellDate=new Date(year,month,i-startOffset+1); // JS normalizes over/underflow into neighboring months
    const ds=tuDateStr(cellDate);
    const outside=cellDate.getMonth()!==month;
    const dayTermine=(byDate[ds]||[]).filter(t=>t.status!=='abgesagt').sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const chips=dayTermine.slice(0,2).map(t=>`<div class="tu-cal-day-chip${t.status==='bestaetigt'?' confirmed':' pending'}">${t.time} ${escapeHtml((t.patient||'').split(' ')[0])}</div>`).join('');
    const more=dayTermine.length>2?`<div class="tu-cal-day-more">+${dayTermine.length-2} mehr</div>`:'';
    const count=dayTermine.length?`<div class="tu-cal-day-count">${dayTermine.length}</div>`:'';
    cells+=`<div class="tu-cal-day${outside?' outside':''}${ds===todayS?' today':''}${ds===tuSelectedDate?' selected':''}" onclick="tuCalSelectDay('${ds}',event)">
      <div class="tu-cal-day-num">${cellDate.getDate()}</div>
      ${chips}${more}${count}
    </div>`;
  }
  const dowRow=TU_DOW_MINI.map(d=>`<div class="tu-cal-dow">${d}</div>`).join('');
  gridEl.innerHTML=dowRow+cells;
}
// Whether Monat's floating appointments window (tuCalWindow) is open --
// mirrors secretary.html's own _secCalWindowOpen. Clicking a day cell opens
// it directly; reset to false whenever the view leaves Monat mode (see
// tuSetViewMode()), since there's no clicked-cell position to anchor to
// once back on Tag/Woche.
let _tuCalWindowOpen=false;
function tuCalSelectDay(dateStr,evt){
  // Captured before renderTagesuhr() rebuilds the grid's DOM -- the clicked
  // cell itself may not survive the re-render, but its position at click
  // time is all tuCalPositionWindow() needs.
  const rect=evt&&evt.currentTarget?evt.currentTarget.getBoundingClientRect():null;
  _tuCalWindowOpen=true;
  // Sets tuSelectedDate directly instead of going through tuSelectDate()
  // (which sets tuFollowingToday=true whenever the picked date happens to
  // equal real "today") -- a real bug found via a failing Playwright run on
  // a Saturday: Monat's day cells, unlike Tag/Woche's day-strip, are NOT
  // restricted to weekdays, so clicking on an actual Sat/Sun (one that
  // happens to be "today") turned auto-follow on, and renderTagesuhr()'s
  // weekend-clamp (meant only for Tag/Woche's default/auto-refresh view)
  // then silently swapped tuSelectedDate to the following Monday -- so the
  // floating window opened next to the Saturday cell the doctor actually
  // clicked, but showed Monday's appointments instead. Clicking a specific
  // Monat day cell should always mean exactly that day, full stop.
  tuSelectedDate=dateStr;
  tuFollowingToday=false;
  renderTagesuhr();
  if(rect) tuCalPositionWindow(rect);
}
// Opens next to whichever day cell was actually clicked (same approach as
// secretary.html's secCalPositionWindow()): prefers the cell's right side,
// falls back to its left if that would run off-screen, then clamps fully
// into the viewport as a last resort. Skipped on mobile, where the window
// goes fullscreen (inset:0) regardless of left/top.
function tuCalPositionWindow(rect){
  const win=document.getElementById('tuCalWindow');
  if(!win||window.innerWidth<=768) return;
  // Reset any leftover explicit width/height from a previous drag/resize
  // (makeFloatingWindowDraggable()/makeFloatingWindowResizable()) -- this
  // function's own left/top math below assumes the default winWidth/
  // winHeight, so an unreset size from resizing a different day's window
  // would throw that math off as well as looking wrong.
  win.style.width='';
  win.style.height='';
  const winWidth=360, winHeight=520, margin=12;
  let left=rect.right+margin;
  if(left+winWidth>window.innerWidth-margin) left=rect.left-winWidth-margin;
  left=Math.max(margin,Math.min(left,window.innerWidth-winWidth-margin));
  let top=Math.max(margin,Math.min(rect.top,window.innerHeight-winHeight-margin));
  win.style.left=left+'px';
  win.style.top=top+'px';
  win.style.right='auto';
  win.style.bottom='auto';
}
function closeTuCalWindow(){
  _tuCalWindowOpen=false;
  renderTagesuhr();
}

// ── makeFloatingWindowDraggable()/makeFloatingWindowResizable() and the four
// window-init calls that use them stay in doctor.html (see this file's own
// header comment for why) -- renderTuMiniCal()/renderTagesuhr()/
// renderTuWeekGrid()/tuWeekColClick() below pick back up right after them.

function renderTuMiniCal(){
  const el=document.getElementById('tuMiniCal');
  if(!el) return;
  if(tuMiniCalYear===null){
    const sel=new Date(tuSelectedDate+'T00:00:00');
    tuMiniCalYear=sel.getFullYear(); tuMiniCalMonth=sel.getMonth();
  }
  const firstDay=new Date(tuMiniCalYear,tuMiniCalMonth,1);
  const startOffset=(firstDay.getDay()+6)%7;
  const daysInMonth=new Date(tuMiniCalYear,tuMiniCalMonth+1,0).getDate();
  const todayS=todayStr();
  let cells='';
  for(let i=0;i<startOffset;i++) cells+='<div class="tu-mc-cell empty">.</div>';
  for(let day=1;day<=daysInMonth;day++){
    const ds=tuMiniCalYear+'-'+String(tuMiniCalMonth+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    const dow=new Date(tuMiniCalYear,tuMiniCalMonth,day).getDay();
    const isWeekend=dow===0||dow===6;
    const isSelected=ds===tuSelectedDate;
    const isToday=ds===todayS;
    cells+=`<div class="tu-mc-cell${isWeekend?' weekend':''}${isSelected?' selected':''}${isToday?' today':''}"${isWeekend?'':` onclick="tuSelectDate('${ds}')"`}>${day}</div>`;
  }
  el.innerHTML=`<div class="tu-mc-head">
      <button class="tu-mc-arrow" onclick="tuShiftMiniCalMonth(-1)">‹</button>
      <span>${TU_MONTHS_DE[tuMiniCalMonth]} ${tuMiniCalYear}</span>
      <button class="tu-mc-arrow" onclick="tuShiftMiniCalMonth(1)">›</button>
    </div>
    <div class="tu-mc-dow">${TU_DOW_MINI.map(x=>`<div>${x}</div>`).join('')}</div>
    <div class="tu-mc-grid">${cells}</div>`;
}

function renderTagesuhr(){
  const root=document.getElementById('tuHome');
  if(!root) return;
  // Auto-following "today" (default until the doctor picks another date)
  // clamps forward to Monday whenever today itself is Sat/Sun -- the
  // practice is closed weekends, so there's no work-week column/pill to
  // land on otherwise, and the view would open with nothing highlighted.
  if(!tuSelectedDate||tuFollowingToday){
    const now=new Date();
    if(now.getDay()===0) now.setDate(now.getDate()+1);
    else if(now.getDay()===6) now.setDate(now.getDate()+2);
    tuSelectedDate=tuDateStr(now);
  }
  const nameEl=document.getElementById('tuPracticeName');
  if(nameEl) nameEl.textContent='Praxis '+arztDisplayName(currentDoctorUsername());
  const subEl=document.getElementById('tuPracticeSub');
  if(subEl) subEl.textContent=dayBoxLabel(tuSelectedDate)===dayBoxLabel(todayStr())?'Heute':longDateDE(tuSelectedDate);

  const mine=filterToMyTermine(loadTermine());
  const selD=new Date(tuSelectedDate+'T00:00:00');
  if(tuMiniCalYear===null||tuMiniCalYear!==selD.getFullYear()||tuMiniCalMonth!==selD.getMonth()){
    tuMiniCalYear=selD.getFullYear(); tuMiniCalMonth=selD.getMonth();
  }
  renderTuMiniCal();
  const week=tuWorkWeekDates(tuSelectedDate);
  const dayLabelEl=document.getElementById('tuDayLabel');
  if(dayLabelEl){
    if(tuViewMode==='woche'){
      const first=new Date(week[0]+'T00:00:00'), last=new Date(week[4]+'T00:00:00');
      dayLabelEl.textContent=first.getDate()+'.–'+last.getDate()+'. '+TU_MONTHS_DE[last.getMonth()]+' '+last.getFullYear();
    } else if(tuViewMode==='monat'){
      if(tuCalYear===null){
        const selD=new Date(tuSelectedDate+'T00:00:00');
        tuCalYear=selD.getFullYear(); tuCalMonth=selD.getMonth();
      }
      dayLabelEl.textContent=TU_MONTHS_DE[tuCalMonth]+' '+tuCalYear;
    } else {
      const d=new Date(tuSelectedDate+'T00:00:00');
      dayLabelEl.textContent=TU_DOW_DE[d.getDay()]+', '+d.getDate()+'. '+TU_MONTHS_DE[d.getMonth()]+' '+d.getFullYear();
    }
  }
  const activeDateSet=new Set(mine.filter(t=>t.status!=='abgesagt').map(t=>t.date));
  const stripEl=document.getElementById('tuDayStrip');
  if(stripEl){
    stripEl.innerHTML=week.map(function(ds){
      const d=new Date(ds+'T00:00:00');
      const active=ds===tuSelectedDate;
      return '<div class="tu-day-pill'+(active?' active':'')+'" onclick="tuSelectDate(\''+ds+'\')">'
        +'<span class="dow">'+TU_DOW_DE[d.getDay()]+'</span><span class="dom">'+d.getDate()+'</span>'
        +(activeDateSet.has(ds)?'<span class="dot"></span>':'')
        +'</div>';
    }).join('');
  }

  // Same underlying appointment list feeds both -- the desktop day column
  // (a card grid, tuApptCardHtml) and the mobile legend below the day-strip
  // (a plain row list, tuApptRowHtml) -- just two different layouts of the
  // same data, not two separately-fetched/filtered views.
  const dayAppts=mine.filter(t=>t.date===tuSelectedDate).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  const emptyHtml='<div class="tu-empty">Keine Termine an diesem Tag</div>';
  const legendEl=document.getElementById('tuLegendList');
  if(legendEl) legendEl.innerHTML = dayAppts.length ? dayAppts.map(tuApptRowHtml).join('') : emptyHtml;
  const dayListEl=document.getElementById('tuDayList');
  if(dayListEl) dayListEl.innerHTML = dayAppts.length ? dayAppts.map(tuApptCardHtml).join('') : emptyHtml;
  // Monat's selected-day appointments -- floating window (tuCalWindow), not
  // an inline panel below the grid. Reuses the exact same cards (Start/
  // Fertig controls included) as Tag view's tuDayList -- not a separate
  // read-only summary. Only shown while in Monat mode with the window
  // actually open (see tuCalSelectDay()/closeTuCalWindow()).
  const tuCalWinEl=document.getElementById('tuCalWindow');
  if(tuCalWinEl){
    const showTuCalWin=_tuCalWindowOpen&&tuViewMode==='monat';
    tuCalWinEl.style.display=showTuCalWin?'flex':'none';
    if(showTuCalWin){
      const tuCalWinTitleEl=document.getElementById('tuCalWindowTitle');
      if(tuCalWinTitleEl) tuCalWinTitleEl.textContent=(tuSelectedDate===todayStr()?'Heute — ':'')+longDateDE(tuSelectedDate);
      const tuCalWinBodyEl=document.getElementById('tuCalWindowBody');
      if(tuCalWinBodyEl) tuCalWinBodyEl.innerHTML = dayAppts.length ? dayAppts.map(tuApptCardHtml).join('') : emptyHtml;
    }
  }
  renderTuSummary(dayAppts);
  renderTuWeekGrid(mine,week);
  renderTuCalGrid(mine);
}
// Woche view: one column per work day, each independently scrollable
// (capped height, own overflow-y) -- a busy day scrolls within its own
// column instead of growing taller than the rest of the week, which is
// exactly the failure mode noted in tu-desktop-view's own comment above.
// Always rendered (not gated on tuViewMode) so switching to Woche never
// shows stale data from before the last real refresh -- cheap relative to
// a full page's worth of DOM, and CSS alone controls whether it's visible.
function renderTuWeekGrid(mine,week){
  const gridEl=document.getElementById('tuWeekGrid');
  if(!gridEl) return;
  const emptyHtml='<div class="tu-empty">Keine Termine</div>';
  gridEl.innerHTML=week.map(function(ds){
    const d=new Date(ds+'T00:00:00');
    const isToday=ds===todayStr();
    const isSelected=ds===tuSelectedDate;
    const dayAppts=mine.filter(t=>t.date===ds).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const headClass='tu-week-col-head'+(isToday?' today':'')+(isSelected?' selected':'');
    return `<div class="tu-week-col">
      <div class="${headClass}" onclick="tuWeekColClick('${ds}')">
        <div class="tu-week-col-dow">${TU_DOW_DE[d.getDay()]}</div>
        <div class="tu-week-col-dom">${d.getDate()}</div>
      </div>
      <div class="tu-week-col-list scrollbar">${dayAppts.length?dayAppts.map(tuApptRowHtml).join(''):emptyHtml}</div>
    </div>`;
  }).join('');
}
// Clicking a column's day header selects/highlights that day but stays in
// Woche view -- it used to also jump into Tag, but that meant looking at a
// second day always bounced you out of the week overview you were just
// using to compare days, which is exactly what Woche is for.
function tuWeekColClick(dateStr){
  tuSelectDate(dateStr);
}
