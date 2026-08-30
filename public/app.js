var STORAGE_KEY='kc_key',STORAGE_HISTORY='kc_history',STORAGE_NOTES='kc_notes',START_DATE_STR='2026-08-26';
var historyList=[],isGenerating=false;
var lockView,mainView,keyInput,lockBtn,togetherDaysEl,homeSettingsBtn,tabItems,tabContents,messagesContainer,textarea,sendBtn;
var currentAvatarRole='';
var diaryLoaded=false;

function init(){
lockView=document.getElementById('lock-view');mainView=document.getElementById('main-view');
keyInput=document.getElementById('key-input');lockBtn=document.getElementById('lock-btn');
togetherDaysEl=document.getElementById('together-days');
homeSettingsBtn=document.getElementById('home-settings-btn');
tabItems=document.querySelectorAll('.tab-item');tabContents=document.querySelectorAll('.tab-content');
messagesContainer=document.getElementById('chat-messages');
textarea=document.getElementById('chat-textarea');sendBtn=document.getElementById('chat-send-btn');

calcTogetherDays();
var savedKey=localStorage.getItem(STORAGE_KEY);if(savedKey){showMainView();}else{showLockView();}
lockBtn.addEventListener('click',handleLogin);
keyInput.addEventListener('keydown',function(e){if(e.key==='Enter')handleLogin();});
homeSettingsBtn.addEventListener('click',function(){switchTab('settings');});
tabItems.forEach(function(item){item.addEventListener('click',function(){switchTab(item.dataset.tab);});});
textarea.addEventListener('input',autoResizeTextarea);
textarea.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!isGenerating&&textarea.value.trim())sendMessage();}});
sendBtn.addEventListener('click',function(){if(!isGenerating&&textarea.value.trim())sendMessage();});
document.getElementById('note-input').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();sendNote();}});
document.getElementById('avatar-upload').addEventListener('change',handleAvatarFile);
initTheme();initAvatars();loadNotes();
}

function calcTogetherDays(){var start=new Date(START_DATE_STR),now=new Date();var d=Math.floor(Math.abs(now-start)/(1000*60*60*24));togetherDaysEl.textContent=d;var ad=document.getElementById('about-days');if(ad)ad.textContent=d;}
function switchTab(tabName){tabItems.forEach(function(i){i.classList.toggle('active',i.dataset.tab===tabName);});tabContents.forEach(function(c){c.classList.remove('active');});var target=document.getElementById('tab-'+tabName);if(target)target.classList.add('active');if(tabName==='chat')scrollToBottom();if(tabName==='diary'&&!diaryLoaded)loadDiary();}
function showLockView(){lockView.classList.add('active');mainView.classList.remove('active');keyInput.value='';}
function showMainView(){lockView.classList.remove('active');mainView.classList.add('active');loadHistory();}
function handleLogin(){var val=keyInput.value.trim();if(val){localStorage.setItem(STORAGE_KEY,val);showMainView();}}
function autoResizeTextarea(){textarea.style.height='auto';textarea.style.height=Math.min(textarea.scrollHeight,120)+'px';sendBtn.disabled=!textarea.value.trim()||isGenerating;}
function getTimeString(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});}
function saveHistory(){if(historyList.length>60)historyList=historyList.slice(-60);localStorage.setItem(STORAGE_HISTORY,JSON.stringify(historyList));}
function loadHistory(){messagesContainer.innerHTML='';var saved=localStorage.getItem(STORAGE_HISTORY);if(saved){try{historyList=JSON.parse(saved);historyList.forEach(function(msg){renderMessageUI(msg.role,msg.content,msg.time||getTimeString());});scrollToBottom();}catch(e){historyList=[];}}}

function renderMessageUI(role,text,time){var row=document.createElement('div');row.className='msg-row '+role;
var keiAvatar=localStorage.getItem('kc_avatar_kei');
if(role==='ai'){
var avatarHtml=keiAvatar?'<img src="'+keiAvatar+'">':'\u514b';
row.innerHTML='<div class="ai-msg-wrapper"><div class="chat-avatar">'+avatarHtml+'</div><div><div class="msg-bubble"></div><div class="msg-time">'+time+'</div></div></div>';
}else{row.innerHTML='<div class="msg-bubble"></div><div class="msg-time">'+time+'</div>';}
var bubbleEl=row.querySelector('.msg-bubble');bubbleEl.textContent=text;messagesContainer.appendChild(row);scrollToBottom();return bubbleEl;}

function renderError(text){var d=document.createElement('div');d.className='error-msg';d.textContent=text;messagesContainer.appendChild(d);scrollToBottom();}
function scrollToBottom(){messagesContainer.scrollTop=messagesContainer.scrollHeight;}

async function sendMessage(){var text=textarea.value.trim();if(!text||isGenerating)return;var time=getTimeString();
renderMessageUI('user',text,time);historyList.push({role:'user',content:text,time:time});saveHistory();
textarea.value='';autoResizeTextarea();isGenerating=true;sendBtn.disabled=true;
var aiTime=getTimeString();var aiBubble=renderMessageUI('ai','',aiTime);
var apiKey=localStorage.getItem(STORAGE_KEY);
var apiMessages=historyList.map(function(item){return{role:item.role==='ai'?'assistant':'user',content:item.content};});
try{var response=await fetch('/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:'kei',messages:apiMessages,stream:true})});
if(response.status===401){localStorage.removeItem(STORAGE_KEY);renderError('\u5bc6\u94a5\u5df2\u5931\u6548\uff0c\u8bf7\u5237\u65b0\u91cd\u65b0\u767b\u5f55');showLockView();return;}
if(!response.ok){var errText=await response.text();throw new Error(errText||('HTTP '+response.status));}
var reader=response.body.getReader(),decoder=new TextDecoder(),fullContent='',buffer='';
while(true){var result=await reader.read();if(result.done)break;buffer+=decoder.decode(result.value,{stream:true});var lines=buffer.split('\n');buffer=lines.pop()||'';
for(var i=0;i<lines.length;i++){var line=lines[i].trim();if(line.startsWith('data: ')){var dataStr=line.slice(6).trim();if(dataStr==='[DONE]')break;
try{var parsed=JSON.parse(dataStr);var delta=parsed.choices&&parsed.choices[0]&&parsed.choices[0].delta&&parsed.choices[0].delta.content||'';if(delta){fullContent+=delta;aiBubble.textContent=fullContent;scrollToBottom();}}catch(e){}}}}
if(fullContent){historyList.push({role:'ai',content:fullContent,time:aiTime});saveHistory();}}
catch(err){renderError(err.message||'\u7f51\u7edc\u8fde\u63a5\u9519\u8bef');}
finally{isGenerating=false;sendBtn.disabled=!textarea.value.trim();}}

/* Diary */
function loadDiary(){
var list=document.getElementById('diary-list');
list.innerHTML='<div class="diary-loading">\u52a0\u8f7d\u4e2d...</div>';
var apiKey=localStorage.getItem(STORAGE_KEY);
fetch('/api/diary',{headers:{'Authorization':'Bearer '+apiKey}}).then(function(r){return r.json();}).then(function(data){
list.innerHTML='';
if(!data.entries||data.entries.length===0){list.innerHTML='<div class="diary-empty">\u8fd8\u6ca1\u6709\u65e5\u8bb0</div>';diaryLoaded=true;return;}
data.entries.forEach(function(entry){
var card=document.createElement('div');card.className='glass-card diary-card';
var preview=entry.content.replace(/^#.*$/gm,'').trim().substring(0,120);
card.innerHTML='<div class="diary-card-date">'+escapeHtml(entry.date)+'</div><div class="diary-card-preview">'+escapeHtml(preview)+'</div><div class="diary-full">'+escapeHtml(entry.content)+'</div>';
card.addEventListener('click',function(){var full=card.querySelector('.diary-full');full.classList.toggle('open');var prev=card.querySelector('.diary-card-preview');prev.style.display=full.classList.contains('open')?'none':'';});
list.appendChild(card);});
diaryLoaded=true;
}).catch(function(err){list.innerHTML='<div class="diary-empty">\u52a0\u8f7d\u5931\u8d25: '+escapeHtml(err.message)+'</div>';});}

/* Notes */
function loadNotes(){var list=document.getElementById('note-reply-list');list.innerHTML='';
var notes=[];try{notes=JSON.parse(localStorage.getItem(STORAGE_NOTES)||'[]');}catch(e){}
var recent=notes.slice(-10);
var vvAvatar=localStorage.getItem('kc_avatar_vv');
var keiAvatar=localStorage.getItem('kc_avatar_kei');
for(var i=0;i<recent.length;i++){var n=recent[i];var item=document.createElement('div');item.className='note-reply-item';
var isVv=n.from==='vv';var avatarClass=isVv?'vv':'kei';var avatarText=isVv?'\u5fae':'\u514b';
var imgData=isVv?vvAvatar:keiAvatar;var avatarInner=imgData?'<img src="'+imgData+'">':avatarText;
item.innerHTML='<div class="note-reply-avatar '+avatarClass+'">'+avatarInner+'</div><div class="note-reply-body"><div class="note-reply-text">'+escapeHtml(n.content)+'</div><div class="note-reply-time">'+escapeHtml(n.time||'')+'</div></div>';
list.appendChild(item);}}

function sendNote(){var input=document.getElementById('note-input');var text=input.value.trim();if(!text)return;
var notes=[];try{notes=JSON.parse(localStorage.getItem(STORAGE_NOTES)||'[]');}catch(e){}
notes.push({from:'vv',content:text,time:getTimeString()});
if(notes.length>50)notes=notes.slice(-50);
localStorage.setItem(STORAGE_NOTES,JSON.stringify(notes));input.value='';loadNotes();}

function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* Avatar */
function triggerAvatarUpload(role){currentAvatarRole=role;document.getElementById('avatar-upload').click();}

function handleAvatarFile(e){var file=e.target.files&&e.target.files[0];if(!file)return;
var reader=new FileReader();reader.onload=function(ev){compressAvatar(ev.target.result,function(dataUrl){
localStorage.setItem('kc_avatar_'+currentAvatarRole,dataUrl);applyAvatar(currentAvatarRole,dataUrl);loadNotes();});};
reader.readAsDataURL(file);e.target.value='';}

function compressAvatar(src,cb){var img=new Image();img.onload=function(){var c=document.createElement('canvas');c.width=80;c.height=80;var ctx=c.getContext('2d');
var s=Math.min(img.width,img.height);var sx=(img.width-s)/2,sy=(img.height-s)/2;
ctx.drawImage(img,sx,sy,s,s,0,0,80,80);cb(c.toDataURL('image/jpeg',0.8));};img.src=src;}

function applyAvatar(role,dataUrl){
if(role==='vv'){var el=document.getElementById('avatar-vv');if(el)el.innerHTML='<img src="'+dataUrl+'">';}
if(role==='kei'){var el2=document.getElementById('avatar-kei');if(el2)el2.innerHTML='<img src="'+dataUrl+'">';
document.querySelectorAll('.chat-avatar').forEach(function(a){if(!a.querySelector('img'))a.innerHTML='<img src="'+dataUrl+'">';});}}

function initAvatars(){var vv=localStorage.getItem('kc_avatar_vv');var kei=localStorage.getItem('kc_avatar_kei');
if(vv)applyAvatar('vv',vv);if(kei)applyAvatar('kei',kei);}

/* Settings */
function toggleSettingPanel(el){var panel=el.querySelector('.setting-panel');var wasOpen=panel.classList.contains('active');document.querySelectorAll('.setting-panel').forEach(function(p){p.classList.remove('active');});if(!wasOpen){panel.classList.add('active');if(el.querySelector('#cfg-target-url'))checkAdminAuth();refreshSettingsData();}}
function refreshSettingsData(){try{var h=JSON.parse(localStorage.getItem(STORAGE_HISTORY)||'[]');document.getElementById('chat-history-count').textContent=h.length;}catch(e){document.getElementById('chat-history-count').textContent='0';}
var k=localStorage.getItem(STORAGE_KEY)||'';document.getElementById('gateway-key-preview').textContent=k?k.substring(0,4)+'****':'\u672a\u8bbe\u7f6e';
var start=new Date(START_DATE_STR),now=new Date();document.getElementById('about-days').textContent=Math.floor(Math.abs(now-start)/(1000*60*60*24));}
function checkAdminAuth(){var u=localStorage.getItem('kc_admin_user'),p=localStorage.getItem('kc_admin_pass');document.getElementById('admin-auth-panel').style.display=(!u||!p)?'block':'none';}
function saveAdminAuth(){var u=document.getElementById('cfg-admin-user').value.trim(),p=document.getElementById('cfg-admin-pass').value.trim();if(u&&p){localStorage.setItem('kc_admin_user',u);localStorage.setItem('kc_admin_pass',p);document.getElementById('admin-auth-panel').style.display='none';}}
function getAuthHeader(){var u=localStorage.getItem('kc_admin_user')||'',p=localStorage.getItem('kc_admin_pass')||'';return'Basic '+btoa(u+':'+p);}
function saveApiConfig(){var url=document.getElementById('cfg-target-url').value,key=document.getElementById('cfg-target-key').value,model=document.getElementById('cfg-model-name').value;var tips=document.getElementById('api-save-tips');
fetch('/admin/save',{method:'POST',headers:{'Content-Type':'application/json','Authorization':getAuthHeader()},body:JSON.stringify({target_url:url,target_key:key,model_name:model})}).then(function(r){if(r.ok){tips.className='setting-tips success';tips.textContent='\u5df2\u4fdd\u5b58';tips.style.display='block';setTimeout(function(){tips.style.display='none';},3000);}else throw new Error();}).catch(function(){tips.className='setting-tips error';tips.textContent='\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u51ed\u8bc1';tips.style.display='block';});}
function testBarkPush(){var tips=document.getElementById('bark-tips');fetch('/admin/test-bark',{headers:{'Authorization':getAuthHeader()}}).then(function(r){if(r.ok){tips.className='setting-tips success';tips.textContent='\u63a8\u9001\u6210\u529f';}else throw new Error();tips.style.display='block';}).catch(function(){tips.className='setting-tips error';tips.textContent='\u63a8\u9001\u5931\u8d25';tips.style.display='block';});}
function changeTheme(name){if(name==='lavender')document.body.style.background='linear-gradient(135deg,#e8e0f0 0%,#f3e5f5 100%)';else if(name==='warm')document.body.style.background='linear-gradient(135deg,#fff3e0 0%,#fce4ec 100%)';else document.body.style.background='';localStorage.setItem('kc_theme',name);document.querySelectorAll('.theme-btn').forEach(function(b){b.classList.remove('active');});var ab=document.querySelector('.theme-'+name);if(ab)ab.classList.add('active');}
function initTheme(){var t=localStorage.getItem('kc_theme')||'default';changeTheme(t);}
function clearChatHistory(){if(confirm('\u786e\u5b9a\u8981\u6e05\u7a7a\u6240\u6709\u804a\u5929\u8bb0\u5f55\u5417\uff1f')){historyList=[];localStorage.removeItem(STORAGE_HISTORY);messagesContainer.innerHTML='';refreshSettingsData();}}
function logoutGateway(){localStorage.removeItem(STORAGE_KEY);location.reload();}

init();
