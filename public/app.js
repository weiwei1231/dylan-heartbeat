var STORAGE_KEY='kc_key',STORAGE_HISTORY='kc_history',START_DATE_STR='2026-08-26';
var historyList=[],isGenerating=false;
var lockView=document.getElementById('lock-view'),mainView=document.getElementById('main-view');
var keyInput=document.getElementById('key-input'),lockBtn=document.getElementById('lock-btn');
var togetherDaysEl=document.getElementById('together-days');
var homeSettingsBtn=document.getElementById('home-settings-btn');
var tabItems=document.querySelectorAll('.tab-item'),tabContents=document.querySelectorAll('.tab-content');
var messagesContainer=document.getElementById('chat-messages');
var textarea=document.getElementById('chat-textarea'),sendBtn=document.getElementById('chat-send-btn');

function init(){
  calcTogetherDays();
  var savedKey=localStorage.getItem(STORAGE_KEY);
  if(savedKey){showMainView();}else{showLockView();}
  lockBtn.addEventListener('click',handleLogin);
  keyInput.addEventListener('keydown',function(e){if(e.key==='Enter')handleLogin();});
  homeSettingsBtn.addEventListener('click',function(){switchTab('settings');});
  tabItems.forEach(function(item){item.addEventListener('click',function(){switchTab(item.dataset.tab);});});
  textarea.addEventListener('input',autoResizeTextarea);
  textarea.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!isGenerating&&textarea.value.trim())sendMessage();}});
  sendBtn.addEventListener('click',function(){if(!isGenerating&&textarea.value.trim())sendMessage();});
  initTheme();
}

function calcTogetherDays(){
  var start=new Date(START_DATE_STR),now=new Date();
  var d=Math.floor(Math.abs(now-start)/(1000*60*60*24));
  togetherDaysEl.textContent=d;
  var ad=document.getElementById('about-days');
  if(ad)ad.textContent=d;
}

function switchTab(tabName){
  tabItems.forEach(function(i){i.classList.toggle('active',i.dataset.tab===tabName);});
  tabContents.forEach(function(c){c.classList.remove('active');});
  var target=document.getElementById('tab-'+tabName);
  if(target)target.classList.add('active');
  if(tabName==='chat')scrollToBottom();
}

function showLockView(){lockView.classList.add('active');mainView.classList.remove('active');keyInput.value='';}
function showMainView(){lockView.classList.remove('active');mainView.classList.add('active');loadHistory();}
function handleLogin(){var val=keyInput.value.trim();if(val){localStorage.setItem(STORAGE_KEY,val);showMainView();}}

function autoResizeTextarea(){
  textarea.style.height='auto';
  textarea.style.height=Math.min(textarea.scrollHeight,120)+'px';
  sendBtn.disabled=!textarea.value.trim()||isGenerating;
}

function getTimeString(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});}

function saveHistory(){
  if(historyList.length>60)historyList=historyList.slice(-60);
  localStorage.setItem(STORAGE_HISTORY,JSON.stringify(historyList));
}

function loadHistory(){
  messagesContainer.innerHTML='';
  var saved=localStorage.getItem(STORAGE_HISTORY);
  if(saved){
    try{
      historyList=JSON.parse(saved);
      historyList.forEach(function(msg){renderMessageUI(msg.role,msg.content,msg.time||getTimeString());});
      scrollToBottom();
    }catch(e){historyList=[];}
  }
}

function renderMessageUI(role,text,time){
  var row=document.createElement('div');
  row.className='msg-row '+role;
  if(role==='ai'){
    row.innerHTML='<div class="ai-msg-wrapper"><div class="chat-avatar">克</div><div><div class="msg-bubble"></div><div class="msg-time">'+time+'</div></div></div>';
  }else{
    row.innerHTML='<div class="msg-bubble"></div><div class="msg-time">'+time+'</div>';
  }
  var bubbleEl=row.querySelector('.msg-bubble');
  bubbleEl.textContent=text;
  messagesContainer.appendChild(row);
  scrollToBottom();
  return bubbleEl;
}

function renderError(text){
  var d=document.createElement('div');d.className='error-msg';d.textContent=text;
  messagesContainer.appendChild(d);scrollToBottom();
}

function scrollToBottom(){messagesContainer.scrollTop=messagesContainer.scrollHeight;}

async function sendMessage(){
  var text=textarea.value.trim();
  if(!text||isGenerating)return;
  var time=getTimeString();
  renderMessageUI('user',text,time);
  historyList.push({role:'user',content:text,time:time});
  saveHistory();
  textarea.value='';autoResizeTextarea();
  isGenerating=true;sendBtn.disabled=true;
  var aiTime=getTimeString();
  var aiBubble=renderMessageUI('ai','',aiTime);
  var apiKey=localStorage.getItem(STORAGE_KEY);
  var apiMessages=historyList.map(function(item){return{role:item.role==='ai'?'assistant':'user',content:item.content};});
  try{
    var response=await fetch('/v1/chat/completions',{
      method:'POST',
      headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:'kei',messages:apiMessages,stream:true})
    });
    if(response.status===401){localStorage.removeItem(STORAGE_KEY);renderError('密钥已失效，请刷新重新登录');showLockView();return;}
    if(!response.ok){var errText=await response.text();throw new Error(errText||('HTTP '+response.status));}
    var reader=response.body.getReader(),decoder=new TextDecoder(),fullContent='',buffer='';
    while(true){
      var result=await reader.read();
      if(result.done)break;
      buffer+=decoder.decode(result.value,{stream:true});
      var lines=buffer.split('\n');buffer=lines.pop()||'';
      for(var i=0;i<lines.length;i++){
        var line=lines[i].trim();
        if(line.startsWith('data: ')){
          var dataStr=line.slice(6).trim();
          if(dataStr==='[DONE]')break;
          try{var parsed=JSON.parse(dataStr);var delta=parsed.choices&&parsed.choices[0]&&parsed.choices[0].delta&&parsed.choices[0].delta.content||'';if(delta){fullContent+=delta;aiBubble.textContent=fullContent;scrollToBottom();}}catch(e){}
        }
      }
    }
    if(fullContent){historyList.push({role:'ai',content:fullContent,time:aiTime});saveHistory();}
  }catch(err){renderError(err.message||'网络连接错误');}
  finally{isGenerating=false;sendBtn.disabled=!textarea.value.trim();}
}

/* Settings */
function toggleSettingPanel(el){
  var panel=el.querySelector('.setting-panel');
  var wasOpen=panel.classList.contains('active');
  document.querySelectorAll('.setting-panel').forEach(function(p){p.classList.remove('active');});
  if(!wasOpen){
    panel.classList.add('active');
    if(el.querySelector('#cfg-target-url'))checkAdminAuth();
    refreshSettingsData();
  }
}

function refreshSettingsData(){
  try{var h=JSON.parse(localStorage.getItem(STORAGE_HISTORY)||'[]');document.getElementById('chat-history-count').textContent=h.length;}catch(e){document.getElementById('chat-history-count').textContent='0';}
  var k=localStorage.getItem(STORAGE_KEY)||'';
  document.getElementById('gateway-key-preview').textContent=k?k.substring(0,4)+'****':'未设置';
  var start=new Date(START_DATE_STR),now=new Date();
  document.getElementById('about-days').textContent=Math.floor(Math.abs(now-start)/(1000*60*60*24));
}

function checkAdminAuth(){
  var u=localStorage.getItem('kc_admin_user'),p=localStorage.getItem('kc_admin_pass');
  document.getElementById('admin-auth-panel').style.display=(!u||!p)?'block':'none';
}

function saveAdminAuth(){
  var u=document.getElementById('cfg-admin-user').value.trim(),p=document.getElementById('cfg-admin-pass').value.trim();
  if(u&&p){localStorage.setItem('kc_admin_user',u);localStorage.setItem('kc_admin_pass',p);document.getElementById('admin-auth-panel').style.display='none';}
}

function getAuthHeader(){
  var u=localStorage.getItem('kc_admin_user')||'',p=localStorage.getItem('kc_admin_pass')||'';
  return'Basic '+btoa(u+':'+p);
}

function saveApiConfig(){
  var url=document.getElementById('cfg-target-url').value,key=document.getElementById('cfg-target-key').value,model=document.getElementById('cfg-model-name').value;
  var tips=document.getElementById('api-save-tips');
  fetch('/admin/save',{method:'POST',headers:{'Content-Type':'application/json','Authorization':getAuthHeader()},body:JSON.stringify({target_url:url,target_key:key,model_name:model})})
  .then(function(r){if(r.ok){tips.className='setting-tips success';tips.textContent='已保存';tips.style.display='block';setTimeout(function(){tips.style.display='none';},3000);}else throw new Error();})
  .catch(function(){tips.className='setting-tips error';tips.textContent='保存失败，请检查凭证';tips.style.display='block';});
}

function testBarkPush(){
  var tips=document.getElementById('bark-tips');
  fetch('/admin/test-bark',{headers:{'Authorization':getAuthHeader()}})
  .then(function(r){if(r.ok){tips.className='setting-tips success';tips.textContent='推送成功';}else throw new Error();tips.style.display='block';})
  .catch(function(){tips.className='setting-tips error';tips.textContent='推送失败';tips.style.display='block';});
}

function changeTheme(name){
  if(name==='lavender')document.body.style.background='linear-gradient(135deg,#e8e0f0 0%,#f3e5f5 100%)';
  else if(name==='warm')document.body.style.background='linear-gradient(135deg,#fff3e0 0%,#fce4ec 100%)';
  else document.body.style.background='';
  localStorage.setItem('kc_theme',name);
  document.querySelectorAll('.theme-btn').forEach(function(b){b.classList.remove('active');});
  var ab=document.querySelector('.theme-'+name);if(ab)ab.classList.add('active');
}

function initTheme(){var t=localStorage.getItem('kc_theme')||'default';changeTheme(t);}

function clearChatHistory(){
  if(confirm('确定要清空所有聊天记录吗？')){
    historyList=[];localStorage.removeItem(STORAGE_HISTORY);
    messagesContainer.innerHTML='';refreshSettingsData();
  }
}

function logoutGateway(){localStorage.removeItem(STORAGE_KEY);location.reload();}

init();
