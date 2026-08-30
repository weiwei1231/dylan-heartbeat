var STORAGE_KEY='kc_key',STORAGE_HISTORY='kc_history',STORAGE_NOTES='kc_notes',STORAGE_ALBUM='kc_album',STORAGE_CMDS='kc_commands',START_DATE_STR='2026-08-26';
var historyList=[],isGenerating=false;
var lockView,mainView,keyInput,lockBtn,togetherDaysEl,homeSettingsBtn,tabItems,tabContents,messagesContainer,textarea,sendBtn;
var currentAvatarRole='';
var diaryLoaded=false,memoryLoaded=false;
var currentSubPage='';
var chatMenuOpen=false;

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
document.getElementById('bg-upload').addEventListener('change',handleBgFile);
document.getElementById('album-upload').addEventListener('change',handleAlbumFile);
initTheme();initAvatars();loadNotes();loadHomeStatus();initBgImage();initCustomCSS();loadAlbum();initCommands();
}

function calcTogetherDays(){var start=new Date(START_DATE_STR),now=new Date();var d=Math.floor(Math.abs(now-start)/(1000*60*60*24));togetherDaysEl.textContent=d;var ad=document.getElementById('about-days');if(ad)ad.textContent=d;}
function switchTab(tabName){closeSubPage();tabItems.forEach(function(i){i.classList.toggle('active',i.dataset.tab===tabName);});tabContents.forEach(function(c){c.classList.remove('active');});var target=document.getElementById('tab-'+tabName);if(target)target.classList.add('active');document.getElementById('tab-bar').style.display='';}
function openSubPage(name){tabContents.forEach(function(c){c.classList.remove('active');});var sub=document.getElementById('sub-'+name);if(sub){sub.classList.add('active');currentSubPage=name;}if(name==='chat')scrollToBottom();if(name==='diary'&&!diaryLoaded)loadDiary();if(name==='memory'&&!memoryLoaded)loadMemory();tabItems.forEach(function(i){i.classList.remove('active');});document.getElementById('tab-bar').style.display='none';closeChatMenu();}
function closeSubPage(){if(!currentSubPage)return;var sub=document.getElementById('sub-'+currentSubPage);if(sub)sub.classList.remove('active');currentSubPage='';document.getElementById('tab-features').classList.add('active');tabItems.forEach(function(i){i.classList.toggle('active',i.dataset.tab==='features');});document.getElementById('tab-bar').style.display='';closeChatMenu();}
function toggleChatMenu(){if(chatMenuOpen)closeChatMenu();else openChatMenu();}
function openChatMenu(){document.getElementById('chat-menu').classList.add('open');chatMenuOpen=true;}
function closeChatMenu(){var m=document.getElementById('chat-menu');if(m)m.classList.remove('open');chatMenuOpen=false;}
function chatMenuAction(action){closeChatMenu();if(action==='clear'){if(confirm('\u786e\u5b9a\u6e05\u7a7a\u804a\u5929\u8bb0\u5f55\uff1f')){historyList=[];localStorage.removeItem(STORAGE_HISTORY);messagesContainer.innerHTML='';}}if(action==='photo'){document.getElementById('chat-photo-upload').click();}if(action==='voice'){alert('\u8bed\u97f3\u529f\u80fd\u5f00\u53d1\u4e2d...');}if(action==='link'){var url=prompt('\u8f93\u5165\u94fe\u63a5URL:');if(url&&url.trim()){textarea.value=url.trim();autoResizeTextarea();}}}

/* Profile */
function openProfile(){var overlay=document.getElementById('profile-overlay');var avatarEl=document.getElementById('profile-avatar');var keiAvatar=localStorage.getItem('kc_avatar_kei');if(keiAvatar){avatarEl.innerHTML='<img src="'+keiAvatar+'">';}else{avatarEl.textContent='\u514b';}loadProfilePosts();overlay.classList.add('open');}
function closeProfile(){document.getElementById('profile-overlay').classList.remove('open');}
function loadProfilePosts(){var container=document.getElementById('profile-posts');container.innerHTML='<div class="profile-card-post">\u52a0\u8f7d\u4e2d...</div>';fetch('/api/diary').then(function(r){return r.json();}).then(function(data){container.innerHTML='';if(!data.entries||data.entries.length===0){container.innerHTML='<div class="profile-card-post">\u8fd8\u6ca1\u6709\u52a8\u6001</div>';return;}data.entries.slice(0,3).forEach(function(entry){var post=document.createElement('div');post.className='profile-card-post';var preview=entry.content.replace(/^#.*$/gm,'').trim().substring(0,80);post.innerHTML='<div style="font-size:11px;color:#f06292;margin-bottom:4px">'+escapeHtml(entry.date)+'</div>'+escapeHtml(preview)+(preview.length>=80?'...':'');container.appendChild(post);});}).catch(function(){container.innerHTML='<div class="profile-card-post">\u52a0\u8f7d\u5931\u8d25</div>';});}

function showLockView(){lockView.classList.add('active');mainView.classList.remove('active');keyInput.value='';}
function showMainView(){lockView.classList.remove('active');mainView.classList.add('active');loadHistory();}
function handleLogin(){var val=keyInput.value.trim();if(val){localStorage.setItem(STORAGE_KEY,val);showMainView();}}
function autoResizeTextarea(){textarea.style.height='auto';textarea.style.height=Math.min(textarea.scrollHeight,120)+'px';sendBtn.disabled=!textarea.value.trim()||isGenerating;}
function getTimeString(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});}
function saveHistory(){if(historyList.length>60)historyList=historyList.slice(-60);localStorage.setItem(STORAGE_HISTORY,JSON.stringify(historyList));}
function loadHistory(){messagesContainer.innerHTML='';var saved=localStorage.getItem(STORAGE_HISTORY);if(saved){try{historyList=JSON.parse(saved);historyList.forEach(function(msg){renderMessageUI(msg.role,msg.content,msg.time||getTimeString());});scrollToBottom();}catch(e){historyList=[];}}}
function loadHomeStatus(){fetch('/api/home').then(function(r){return r.json();}).then(function(data){var moodEl=document.getElementById('home-mood');if(moodEl)moodEl.textContent=data.mood||'\u60f3\u4f60';var moodDescEl=document.getElementById('home-mood-desc');if(moodDescEl)moodDescEl.textContent='"'+(data.mood_desc||'')+'"';var noteEl=document.getElementById('home-note');if(noteEl)noteEl.textContent=data.note||'';var noteTimeEl=document.getElementById('home-note-time');if(noteTimeEl)noteTimeEl.textContent='\u5c0f\u514b\u8d34\u7684 \u00b7 '+(data.note_time||'\u4eca\u5929');var vvEl=document.getElementById('home-vv-status');if(vvEl)vvEl.textContent=data.vv_status||'\u7b49\u4f60\u56de\u5bb6';var keiEl=document.getElementById('home-kei-status');if(keiEl)keiEl.textContent=data.kei_status||'\u5728\u7ebf';}).catch(function(e){console.log('[Home] load failed:',e.message);});}

function renderMessageUI(role,text,time){var row=document.createElement('div');row.className='msg-row '+role;var keiAvatar=localStorage.getItem('kc_avatar_kei');if(role==='ai'){var avatarHtml=keiAvatar?'<img src="'+keiAvatar+'">':'\u514b';row.innerHTML='<div class="ai-msg-wrapper"><div class="chat-avatar" onclick="openProfile()">'+avatarHtml+'</div><div><div class="msg-bubble"></div><div class="msg-time">'+time+'</div></div></div>';}else{row.innerHTML='<div class="msg-bubble"></div><div class="msg-time">'+time+'</div>';}var bubbleEl=row.querySelector('.msg-bubble');bubbleEl.textContent=text;messagesContainer.appendChild(row);scrollToBottom();return bubbleEl;}
function renderError(text){var d=document.createElement('div');d.className='error-msg';d.textContent=text;messagesContainer.appendChild(d);scrollToBottom();}
function scrollToBottom(){messagesContainer.scrollTop=messagesContainer.scrollHeight;}

async function sendMessage(){var text=textarea.value.trim();if(!text||isGenerating)return;var time=getTimeString();
renderMessageUI('user',text,time);historyList.push({role:'user',content:text,time:time});saveHistory();
textarea.value='';autoResizeTextarea();isGenerating=true;sendBtn.disabled=true;
var aiTime=getTimeString();var aiBubble=renderMessageUI('ai','',aiTime);
var apiKey=localStorage.getItem(STORAGE_KEY);
var apiMessages=historyList.map(function(item){return{role:item.role==='ai'?'assistant':'user',content:item.content};});
/* Inject custom commands as a system message if set */
var cmds=localStorage.getItem(STORAGE_CMDS);
if(cmds&&cmds.trim()){apiMessages.unshift({role:'system',content:cmds.trim()});}
try{var response=await fetch('/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:'kei',messages:apiMessages,stream:true})});
if(response.status===401){localStorage.removeItem(STORAGE_KEY);renderError('\u5bc6\u94a5\u5df2\u5931\u6548');showLockView();return;}
if(!response.ok){var errText=await response.text();throw new Error(errText||('HTTP '+response.status));}
var reader=response.body.getReader(),decoder=new TextDecoder(),fullContent='',buffer='';
while(true){var result=await reader.read();if(result.done)break;buffer+=decoder.decode(result.value,{stream:true});var lines=buffer.split('\n');buffer=lines.pop()||'';
for(var i=0;i<lines.length;i++){var line=lines[i].trim();if(line.startsWith('data: ')){var dataStr=line.slice(6).trim();if(dataStr==='[DONE]')break;
try{var parsed=JSON.parse(dataStr);var delta=parsed.choices&&parsed.choices[0]&&parsed.choices[0].delta&&parsed.choices[0].delta.content||'';if(delta){fullContent+=delta;aiBubble.textContent=fullContent;scrollToBottom();}}catch(e){}}}}
if(fullContent){historyList.push({role:'ai',content:fullContent,time:aiTime});saveHistory();}}
catch(err){renderError(err.message||'\u7f51\u7edc\u9519\u8bef');}
finally{isGenerating=false;sendBtn.disabled=!textarea.value.trim();}}

/* Diary */
function loadDiary(){var list=document.getElementById('diary-list');list.innerHTML='<div class="diary-loading">\u52a0\u8f7d\u4e2d...</div>';fetch('/api/diary').then(function(r){return r.json();}).then(function(data){list.innerHTML='';if(!data.entries||data.entries.length===0){list.innerHTML='<div class="diary-empty">\u8fd8\u6ca1\u6709\u65e5\u8bb0</div>';diaryLoaded=true;return;}data.entries.forEach(function(entry){var card=document.createElement('div');card.className='glass-card diary-card';var preview=entry.content.replace(/^#.*$/gm,'').trim().substring(0,120);card.innerHTML='<div class="diary-card-date">'+escapeHtml(entry.date)+'</div><div class="diary-card-preview">'+escapeHtml(preview)+'</div><div class="diary-full">'+escapeHtml(entry.content)+'</div>';card.addEventListener('click',function(){var full=card.querySelector('.diary-full');full.classList.toggle('open');var prev=card.querySelector('.diary-card-preview');prev.style.display=full.classList.contains('open')?'none':'';});list.appendChild(card);});diaryLoaded=true;}).catch(function(){list.innerHTML='<div class="diary-empty">\u52a0\u8f7d\u5931\u8d25</div>';});}

/* Memory */
function loadMemory(){
var todayEl=document.getElementById('memory-today');
var digestEl=document.getElementById('memory-digest');
fetch('/api/memory').then(function(r){return r.json();}).then(function(data){
if(data.today&&data.today.length>0){todayEl.innerHTML='';data.today.forEach(function(item){var d=document.createElement('div');d.style.cssText='margin-bottom:4px';d.textContent='['+escapeHtml(item.category)+'] '+escapeHtml(item.content);todayEl.appendChild(d);});}else{todayEl.textContent='\u4eca\u5929\u8fd8\u6ca1\u6709\u65b0\u8bb0\u5fc6';}
if(data.digests&&data.digests.length>0){digestEl.innerHTML='';data.digests.forEach(function(d){var div=document.createElement('div');div.style.cssText='margin-bottom:8px';div.innerHTML='<div style="font-size:11px;color:#f06292;margin-bottom:2px">'+escapeHtml(d.date)+'</div>'+escapeHtml(d.summary);digestEl.appendChild(div);});}else{digestEl.textContent='\u8fd8\u6ca1\u6709\u6458\u8981';}
memoryLoaded=true;
}).catch(function(e){todayEl.textContent='\u52a0\u8f7d\u5931\u8d25: '+e.message;digestEl.textContent='';});}

/* Commands */
function initCommands(){var cmds=localStorage.getItem(STORAGE_CMDS)||'';var el=document.getElementById('custom-commands');if(el)el.value=cmds;}
function saveCommands(){var cmds=document.getElementById('custom-commands').value;localStorage.setItem(STORAGE_CMDS,cmds);var tips=document.getElementById('cmd-save-tips');tips.className='setting-tips success';tips.textContent='\u5df2\u4fdd\u5b58';tips.style.display='block';setTimeout(function(){tips.style.display='none';},3000);}

/* Notes */
function loadNotes(){var list=document.getElementById('note-reply-list');list.innerHTML='';var notes=[];try{notes=JSON.parse(localStorage.getItem(STORAGE_NOTES)||'[]');}catch(e){}var recent=notes.slice(-10);var vvAvatar=localStorage.getItem('kc_avatar_vv');var keiAvatar=localStorage.getItem('kc_avatar_kei');for(var i=0;i<recent.length;i++){var n=recent[i];var item=document.createElement('div');item.className='note-reply-item';var isVv=n.from==='vv';var avatarClass=isVv?'vv':'kei';var avatarText=isVv?'\u5fae':'\u514b';var imgData=isVv?vvAvatar:keiAvatar;var avatarInner=imgData?'<img src="'+imgData+'">':avatarText;item.innerHTML='<div class="note-reply-avatar '+avatarClass+'">'+avatarInner+'</div><div class="note-reply-body"><div class="note-reply-text">'+escapeHtml(n.content)+'</div><div class="note-reply-time">'+escapeHtml(n.time||'')+'</div></div>';list.appendChild(item);}}
function sendNote(){var input=document.getElementById('note-input');var text=input.value.trim();if(!text)return;var notes=[];try{notes=JSON.parse(localStorage.getItem(STORAGE_NOTES)||'[]');}catch(e){}notes.push({from:'vv',content:text,time:getTimeString()});if(notes.length>50)notes=notes.slice(-50);localStorage.setItem(STORAGE_NOTES,JSON.stringify(notes));input.value='';loadNotes();}
function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* Album */
function loadAlbum(){var grid=document.getElementById('album-grid');grid.innerHTML='';var photos=[];try{photos=JSON.parse(localStorage.getItem(STORAGE_ALBUM)||'[]');}catch(e){}photos.forEach(function(src,idx){var thumb=document.createElement('div');thumb.className='album-thumb';thumb.innerHTML='<img src="'+src+'">';thumb.addEventListener('click',function(){if(confirm('\u5220\u9664\u8fd9\u5f20\u7167\u7247\uff1f')){photos.splice(idx,1);localStorage.setItem(STORAGE_ALBUM,JSON.stringify(photos));loadAlbum();}});grid.appendChild(thumb);});}
function handleAlbumFile(e){var file=e.target.files&&e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(ev){var img=new Image();img.onload=function(){var c=document.createElement('canvas');var maxW=400;var scale=Math.min(1,maxW/img.width);c.width=img.width*scale;c.height=img.height*scale;c.getContext('2d').drawImage(img,0,0,c.width,c.height);var dataUrl=c.toDataURL('image/jpeg',0.7);var photos=[];try{photos=JSON.parse(localStorage.getItem(STORAGE_ALBUM)||'[]');}catch(ex){}if(photos.length>=20){alert('\u6700\u591a20\u5f20');return;}photos.push(dataUrl);localStorage.setItem(STORAGE_ALBUM,JSON.stringify(photos));loadAlbum();};img.src=ev.target.result;};reader.readAsDataURL(file);e.target.value='';}

/* Avatar */
function triggerAvatarUpload(role){currentAvatarRole=role;document.getElementById('avatar-upload').click();}
function handleAvatarFile(e){var file=e.target.files&&e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(ev){compressAvatar(ev.target.result,function(dataUrl){localStorage.setItem('kc_avatar_'+currentAvatarRole,dataUrl);applyAvatar(currentAvatarRole,dataUrl);loadNotes();});};reader.readAsDataURL(file);e.target.value='';}
function compressAvatar(src,cb){var img=new Image();img.onload=function(){var c=document.createElement('canvas');c.width=80;c.height=80;var ctx=c.getContext('2d');var s=Math.min(img.width,img.height);var sx=(img.width-s)/2,sy=(img.height-s)/2;ctx.drawImage(img,sx,sy,s,s,0,0,80,80);cb(c.toDataURL('image/jpeg',0.8));};img.src=src;}
function applyAvatar(role,dataUrl){if(role==='vv'){var el=document.getElementById('avatar-vv');if(el)el.innerHTML='<img src="'+dataUrl+'">';}if(role==='kei'){var el2=document.getElementById('avatar-kei');if(el2)el2.innerHTML='<img src="'+dataUrl+'">';document.querySelectorAll('.chat-avatar').forEach(function(a){if(!a.querySelector('img'))a.innerHTML='<img src="'+dataUrl+'">';});}}
function initAvatars(){var vv=localStorage.getItem('kc_avatar_vv');var kei=localStorage.getItem('kc_avatar_kei');if(vv)applyAvatar('vv',vv);if(kei)applyAvatar('kei',kei);}

/* Background */
function handleBgFile(e){var file=e.target.files&&e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(ev){localStorage.setItem('kc_bg_image',ev.target.result);applyBgImage(ev.target.result);updateBgPreview(ev.target.result);};reader.readAsDataURL(file);e.target.value='';}
function applyBgImage(d){document.body.style.backgroundImage='url('+d+')';document.body.style.backgroundSize='cover';document.body.style.backgroundPosition='center';}
function removeBgImage(){localStorage.removeItem('kc_bg_image');document.body.style.backgroundImage='';document.getElementById('bg-preview').innerHTML='\u672a\u8bbe\u7f6e\u80cc\u666f\u56fe';}
function updateBgPreview(d){document.getElementById('bg-preview').innerHTML='<img src="'+d+'">';}
function initBgImage(){var bg=localStorage.getItem('kc_bg_image');if(bg){applyBgImage(bg);updateBgPreview(bg);}}
function saveCustomCSS(){var css=document.getElementById('css-editor').value;localStorage.setItem('kc_custom_css',css);applyCustomCSS(css);}
function applyCustomCSS(css){document.getElementById('kc-custom-css').textContent=css||'';}
function initCustomCSS(){var css=localStorage.getItem('kc_custom_css')||'';if(css){applyCustomCSS(css);var ed=document.getElementById('css-editor');if(ed)ed.value=css;}}

/* Settings */
function toggleSettingPanel(el){var panel=el.querySelector('.setting-panel');var wasOpen=panel.classList.contains('active');document.querySelectorAll('.setting-panel').forEach(function(p){p.classList.remove('active');});if(!wasOpen){panel.classList.add('active');if(el.querySelector('#cfg-target-url'))checkAdminAuth();refreshSettingsData();}}
function refreshSettingsData(){try{var h=JSON.parse(localStorage.getItem(STORAGE_HISTORY)||'[]');document.getElementById('chat-history-count').textContent=h.length;}catch(e){document.getElementById('chat-history-count').textContent='0';}var k=localStorage.getItem(STORAGE_KEY)||'';document.getElementById('gateway-key-preview').textContent=k?k.substring(0,4)+'****':'\u672a\u8bbe\u7f6e';var start=new Date(START_DATE_STR),now=new Date();document.getElementById('about-days').textContent=Math.floor(Math.abs(now-start)/(1000*60*60*24));}
function checkAdminAuth(){var u=localStorage.getItem('kc_admin_user'),p=localStorage.getItem('kc_admin_pass');document.getElementById('admin-auth-panel').style.display=(!u||!p)?'block':'none';}
function saveAdminAuth(){var u=document.getElementById('cfg-admin-user').value.trim(),p=document.getElementById('cfg-admin-pass').value.trim();if(u&&p){localStorage.setItem('kc_admin_user',u);localStorage.setItem('kc_admin_pass',p);document.getElementById('admin-auth-panel').style.display='none';}}
function getAuthHeader(){var u=localStorage.getItem('kc_admin_user')||'',p=localStorage.getItem('kc_admin_pass')||'';return'Basic '+btoa(u+':'+p);}
function saveApiConfig(){var url=document.getElementById('cfg-target-url').value,key=document.getElementById('cfg-target-key').value,model=document.getElementById('cfg-model-name').value;var tips=document.getElementById('api-save-tips');fetch('/admin/save',{method:'POST',headers:{'Content-Type':'application/json','Authorization':getAuthHeader()},body:JSON.stringify({target_url:url,target_key:key,model_name:model})}).then(function(r){if(r.ok){tips.className='setting-tips success';tips.textContent='\u5df2\u4fdd\u5b58';tips.style.display='block';setTimeout(function(){tips.style.display='none';},3000);}else throw new Error();}).catch(function(){tips.className='setting-tips error';tips.textContent='\u4fdd\u5b58\u5931\u8d25';tips.style.display='block';});}
function testBarkPush(){var tips=document.getElementById('bark-tips');fetch('/admin/test-bark',{headers:{'Authorization':getAuthHeader()}}).then(function(r){if(r.ok){tips.className='setting-tips success';tips.textContent='\u63a8\u9001\u6210\u529f';}else throw new Error();tips.style.display='block';}).catch(function(){tips.className='setting-tips error';tips.textContent='\u63a8\u9001\u5931\u8d25';tips.style.display='block';});}
function changeTheme(name){if(name==='lavender')document.body.style.background='linear-gradient(135deg,#e8e0f0 0%,#f3e5f5 100%)';else if(name==='warm')document.body.style.background='linear-gradient(135deg,#fff3e0 0%,#fce4ec 100%)';else document.body.style.background='';localStorage.setItem('kc_theme',name);document.querySelectorAll('.theme-btn').forEach(function(b){b.classList.remove('active');});var ab=document.querySelector('.theme-'+name);if(ab)ab.classList.add('active');var bg=localStorage.getItem('kc_bg_image');if(bg)applyBgImage(bg);}
function initTheme(){var t=localStorage.getItem('kc_theme')||'default';changeTheme(t);}
function clearChatHistory(){if(confirm('\u786e\u5b9a\u6e05\u7a7a\u804a\u5929\u8bb0\u5f55\uff1f')){historyList=[];localStorage.removeItem(STORAGE_HISTORY);messagesContainer.innerHTML='';refreshSettingsData();}}
function logoutGateway(){localStorage.removeItem(STORAGE_KEY);location.reload();}

init();
