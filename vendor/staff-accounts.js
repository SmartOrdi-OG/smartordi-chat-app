// Shared staff (Arzt/Sekretär:in) account store and invite-link helpers.
// Loaded by register.html, login.html, and doctor.html so all three agree on
// the exact same localStorage shape -- register.html creates the first
// account (the registering doctor, marked isAdmin:true), login.html
// authenticates against it (and lets an invited colleague create their own
// account via a token), and doctor.html's "Team" settings card lists
// everyone and lets the admin generate new invite links.
//
// Every plan (Basic/Pro/Enterprise) allows an unlimited number of Ärzte and
// Sekretär:innen -- there is no seat-count gating here, only the separate
// feature flags in doctor.html's PLAN_FEATURES (Rezept/Impfpass, patient
// limits, API).

const STAFF_ACCOUNTS_KEY='smartordi_staff_accounts';
const STAFF_INVITES_KEY='smartordi_staff_invites';

function loadStaffAccounts(){
  let accounts;
  try{ accounts=JSON.parse(localStorage.getItem(STAFF_ACCOUNTS_KEY))||{}; }catch(e){ accounts={}; }
  // Demo seed so the existing dr.ahmed/sekretariat logins used throughout
  // the app (and its tests) keep working once real accounts exist.
  if(!accounts['dr.ahmed']){
    accounts['dr.ahmed']={
      pw:'arzt2026', vorname:'Sarah', nachname:'Ahmed', fullName:'Dr. Sarah Ahmed',
      role:'arzt', fach:localStorage.getItem('fachrichtung')||'Allgemeinmedizin', isAdmin:true,
    };
  }
  if(!accounts['sekretariat']){
    accounts['sekretariat']={
      pw:'buero2026', vorname:'Lisa', nachname:'H.', fullName:'Lisa H.',
      role:'sekretaerin', isAdmin:false,
    };
  }
  return accounts;
}
function saveStaffAccounts(accounts){
  localStorage.setItem(STAFF_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function loadStaffInvites(){
  try{ const list=JSON.parse(localStorage.getItem(STAFF_INVITES_KEY)); return Array.isArray(list)?list:[]; }catch(e){ return []; }
}
function saveStaffInvites(list){
  localStorage.setItem(STAFF_INVITES_KEY, JSON.stringify(list));
}
function genStaffInviteToken(){
  return 'inv_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
}
function findStaffInvite(token){
  return loadStaffInvites().find(i=>i.token===token&&!i.used)||null;
}
function markStaffInviteUsed(token,username){
  const list=loadStaffInvites();
  const inv=list.find(i=>i.token===token);
  if(inv){ inv.used=true; inv.usedBy=username; saveStaffInvites(list); }
}
