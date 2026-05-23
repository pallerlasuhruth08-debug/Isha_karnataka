/**
 * Isha Karnataka Team Builder — Google Sheets backend (v2)
 * =========================================================
 * Accounts, login, admin approval, per-user profiles, and permission-scoped
 * writes, on top of a chunked JSON key/value store.
 *
 * All requests are POST with Content-Type: text/plain (no CORS preflight).
 * Body is JSON: { action, ...params }.
 *
 *   signup        { email, password, name }
 *   login         { email, password }
 *   me            { token }
 *   updateProfile { token, profile }
 *   getProfile    { token, email }
 *   listUsers     { token }                              // admin
 *   approveUser   { token, email, status, role, assignedCentre, assignedRoleId } // admin
 *   getState      { token }
 *   setState      { token, value }                       // admin
 *   setCentre     { token, centreId, data }              // admin, or owner of that centre
 *
 * BOOTSTRAP: put admin email(s) in ADMIN_EMAILS — they auto-approve as admin.
 */

var ADMIN_EMAILS = ['pallerlasuhruth08@gmail.com']; // <-- your admin email(s), lowercase

var SHEET_STORE = 'store';
var SHEET_USERS = 'users';
var CHUNK_SIZE  = 45000;
var TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

var USER_COLS = ['email','name','passwordHash','salt','status','role',
                 'assignedCentre','assignedRoleId','token','tokenExpiry','createdAt'];

/* ---- key/value chunk store ---- */
function storeSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_STORE);
  if (!sh) { sh = ss.insertSheet(SHEET_STORE); sh.getRange(1,1,1,3).setValues([['key','chunkIndex','data']]); }
  return sh;
}
function readKey_(key) {
  var sh = storeSheet_(); var last = sh.getLastRow();
  if (last < 2) return '';
  var values = sh.getRange(2,1,last-1,3).getValues();
  var chunks = [];
  for (var i=0;i<values.length;i++) if (String(values[i][0])===key) chunks.push({idx:Number(values[i][1])||0, data:String(values[i][2])});
  chunks.sort(function(a,b){return a.idx-b.idx;});
  return chunks.map(function(c){return c.data;}).join('');
}
function writeKey_(key, value) {
  var sh = storeSheet_();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var last = sh.getLastRow();
    if (last >= 2) {
      var col = sh.getRange(2,1,last-1,1).getValues();
      for (var i=col.length-1;i>=0;i--) if (String(col[i][0])===key) sh.deleteRow(i+2);
    }
    var str = value==null ? '' : String(value);
    var rows = [];
    if (str.length===0) { rows.push([key,0,'']); }
    else { var idx=0; for (var p=0;p<str.length;p+=CHUNK_SIZE) rows.push([key, idx++, str.substring(p,p+CHUNK_SIZE)]); }
    sh.getRange(sh.getLastRow()+1,1,rows.length,3).setValues(rows);
  } finally { lock.releaseLock(); }
}

/* ---- users ---- */
function usersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) { sh = ss.insertSheet(SHEET_USERS); sh.getRange(1,1,1,USER_COLS.length).setValues([USER_COLS]); }
  return sh;
}
function rowToUser_(row) { var u = {}; for (var i=0;i<USER_COLS.length;i++) u[USER_COLS[i]] = row[i]; return u; }
function findUserRow_(email) {
  var sh = usersSheet_(); var last = sh.getLastRow();
  if (last < 2) return null;
  var values = sh.getRange(2,1,last-1,USER_COLS.length).getValues();
  for (var i=0;i<values.length;i++)
    if (String(values[i][0]).toLowerCase() === String(email).toLowerCase())
      return { rowIndex: i+2, user: rowToUser_(values[i]) };
  return null;
}
function findUserByToken_(token) {
  if (!token) return null;
  var sh = usersSheet_(); var last = sh.getLastRow();
  if (last < 2) return null;
  var values = sh.getRange(2,1,last-1,USER_COLS.length).getValues();
  for (var i=0;i<values.length;i++) {
    if (String(values[i][8]) === String(token)) {
      var exp = Number(values[i][9]) || 0;
      if (exp && exp < Date.now()) return null;
      return { rowIndex: i+2, user: rowToUser_(values[i]) };
    }
  }
  return null;
}
function setUserField_(rowIndex, field, value) {
  var c = USER_COLS.indexOf(field); if (c < 0) return;
  usersSheet_().getRange(rowIndex, c+1).setValue(value);
}

/* ---- crypto-ish ---- */
function sha256_(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var out = '';
  for (var i=0;i<raw.length;i++) { var b = (raw[i] & 0xFF).toString(16); out += (b.length===1?'0':'') + b; }
  return out;
}
function hashPw_(pw, salt) { return sha256_(salt + ':' + pw); }
function newToken_() { return Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,''); }

/* ---- responses ---- */
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function publicUser_(u, profile) {
  return { email:u.email, name:u.name, status:u.status, role:u.role,
    assignedCentre:u.assignedCentre||'', assignedRoleId:u.assignedRoleId||'',
    createdAt:u.createdAt||'', profile:profile||null };
}

/* ---- actions ---- */
function handleSignup_(b) {
  var email = String(b.email||'').trim().toLowerCase();
  var password = String(b.password||'');
  var name = String(b.name||'').trim();
  if (!email || !password) return json_({ok:false,error:'Email and password required'});
  if (findUserRow_(email)) return json_({ok:false,error:'An account with this email already exists'});
  var isAdmin = ADMIN_EMAILS.map(function(e){return e.toLowerCase();}).indexOf(email) >= 0;
  var salt = newToken_().slice(0,16);
  usersSheet_().appendRow([ email, name, hashPw_(password, salt), salt,
    isAdmin ? 'approved' : 'pending', isAdmin ? 'admin' : 'user', '', '', '', '', new Date().toISOString() ]);
  return json_({ok:true, status: isAdmin?'approved':'pending', admin:isAdmin});
}
function handleLogin_(b) {
  var email = String(b.email||'').trim().toLowerCase();
  var password = String(b.password||'');
  var found = findUserRow_(email);
  if (!found) return json_({ok:false,error:'No account found for this email'});
  var u = found.user;
  if (hashPw_(password, u.salt) !== String(u.passwordHash)) return json_({ok:false,error:'Incorrect password'});
  if (u.status === 'pending')   return json_({ok:false,error:'Your account is awaiting admin approval'});
  if (u.status === 'rejected')  return json_({ok:false,error:'Your account request was declined'});
  if (u.status === 'suspended') return json_({ok:false,error:'Your account is suspended'});
  var token = newToken_();
  setUserField_(found.rowIndex, 'token', token);
  setUserField_(found.rowIndex, 'tokenExpiry', Date.now() + TOKEN_TTL_MS);
  var profile = readKey_('profile_'+email);
  return json_({ok:true, token:token, user: publicUser_(u, profile?JSON.parse(profile):null)});
}
function handleMe_(b) {
  var f = findUserByToken_(b.token);
  if (!f) return json_({ok:false,error:'Session expired — please log in again'});
  var profile = readKey_('profile_'+f.user.email);
  return json_({ok:true, user: publicUser_(f.user, profile?JSON.parse(profile):null)});
}
function handleUpdateProfile_(b) {
  var f = findUserByToken_(b.token);
  if (!f) return json_({ok:false,error:'Session expired'});
  var profile = b.profile || {};
  if (profile.name && String(profile.name).trim()) setUserField_(f.rowIndex,'name',String(profile.name).trim());
  writeKey_('profile_'+f.user.email, JSON.stringify(profile));
  return json_({ok:true});
}
function handleGetProfile_(b) {
  var f = findUserByToken_(b.token);
  if (!f) return json_({ok:false,error:'Session expired'});
  var email = String(b.email||f.user.email).toLowerCase();
  if (f.user.role !== 'admin' && email !== f.user.email.toLowerCase()) return json_({ok:false,error:'Not allowed'});
  var profile = readKey_('profile_'+email);
  return json_({ok:true, profile: profile?JSON.parse(profile):null});
}
function handleListUsers_(b) {
  var f = findUserByToken_(b.token);
  if (!f || f.user.role !== 'admin') return json_({ok:false,error:'Admin only'});
  var sh = usersSheet_(); var last = sh.getLastRow(); var out = [];
  if (last >= 2) {
    var values = sh.getRange(2,1,last-1,USER_COLS.length).getValues();
    for (var i=0;i<values.length;i++) out.push(publicUser_(rowToUser_(values[i]),null));
  }
  return json_({ok:true, users: out});
}
function handleApproveUser_(b) {
  var f = findUserByToken_(b.token);
  if (!f || f.user.role !== 'admin') return json_({ok:false,error:'Admin only'});
  var target = findUserRow_(String(b.email||'').toLowerCase());
  if (!target) return json_({ok:false,error:'User not found'});
  if (b.status !== undefined)         setUserField_(target.rowIndex,'status',b.status);
  if (b.role !== undefined)           setUserField_(target.rowIndex,'role',b.role);
  if (b.assignedCentre !== undefined) setUserField_(target.rowIndex,'assignedCentre',b.assignedCentre);
  if (b.assignedRoleId !== undefined) setUserField_(target.rowIndex,'assignedRoleId',b.assignedRoleId);
  return json_({ok:true});
}
function handleGetState_(b) {
  var f = findUserByToken_(b.token);
  if (!f) return json_({ok:false,error:'Session expired'});
  return json_({ok:true, value: readKey_('ika_v7')});
}
function handleSetState_(b) {
  var f = findUserByToken_(b.token);
  if (!f) return json_({ok:false,error:'Session expired'});
  if (f.user.role !== 'admin') return json_({ok:false,error:'Only admins can edit region-wide data'});
  writeKey_('ika_v7', b.value || '');
  return json_({ok:true});
}
function handleSetCentre_(b) {
  var f = findUserByToken_(b.token);
  if (!f) return json_({ok:false,error:'Session expired'});
  var centreId = String(b.centreId||'');
  if (!centreId) return json_({ok:false,error:'centreId required'});
  if (f.user.role !== 'admin' && String(f.user.assignedCentre) !== centreId)
    return json_({ok:false,error:'You can only edit your assigned centre'});
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var raw = readKey_('ika_v7');
    var state = raw ? JSON.parse(raw) : {region:{},centres:{}};
    if (!state.centres) state.centres = {};
    state.centres[centreId] = b.data || {};
    writeKey_('ika_v7', JSON.stringify(state));
  } finally { lock.releaseLock(); }
  return json_({ok:true});
}

/* ---- routing ---- */
function doPost(e) {
  try {
    var b = {};
    if (e && e.postData && e.postData.contents) b = JSON.parse(e.postData.contents);
    switch (b.action) {
      case 'signup':        return handleSignup_(b);
      case 'login':         return handleLogin_(b);
      case 'me':            return handleMe_(b);
      case 'updateProfile': return handleUpdateProfile_(b);
      case 'getProfile':    return handleGetProfile_(b);
      case 'listUsers':     return handleListUsers_(b);
      case 'approveUser':   return handleApproveUser_(b);
      case 'getState':      return handleGetState_(b);
      case 'setState':      return handleSetState_(b);
      case 'setCentre':     return handleSetCentre_(b);
      default:              return json_({ok:false,error:'Unknown action: '+b.action});
    }
  } catch (err) { return json_({ok:false,error:String(err)}); }
}
function doGet(e) {
  return json_({ok:true, msg:'Isha Karnataka backend is live. Use the app to sign in.'});
}
