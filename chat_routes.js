/**
 * chat_routes.js — kc routes + diary API + memory API + home API
 */
var fs = require("fs");
var path = require("path");
var spMod = require("./system_prompt");
var rtPaths = require("./runtime_paths");
var homeMod = require("./home_status");

var PUBLIC_DIR = path.join(__dirname, "public");
var MIME_TYPES = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon"};

function getDiaryDir(){return rtPaths.runtimeDirectory(process.env.DIARY_DIR||"diary","diary");}
function getMemoryDir(){return rtPaths.runtimeDirectory("memories","memories");}

function registerChatRoutes(app){
  app.get("/chat",async function(req,reply){var p=path.join(PUBLIC_DIR,"index.html");try{reply.type("text/html").send(fs.readFileSync(p,"utf-8"));}catch(e){reply.code(500).send("not found: "+e.message);}});
  app.get("/",async function(req,reply){reply.redirect("/chat");});
  app.get("/:filename",async function(req,reply){var f=req.params.filename;var ext=path.extname(f).toLowerCase();var mime=MIME_TYPES[ext];if(!mime)return;var fp=path.join(PUBLIC_DIR,f);if(!fp.startsWith(PUBLIC_DIR)){reply.code(403).send("Forbidden");return;}try{reply.type(mime).send(fs.readFileSync(fp));}catch(e){}});

  // Diary API
  app.get("/api/diary",async function(req,reply){var dir=getDiaryDir();try{if(!fs.existsSync(dir)){reply.send({entries:[]});return;}var files=fs.readdirSync(dir).filter(function(n){return /^\d{4}-\d{2}-\d{2}\.md$/i.test(n);}).sort().reverse().slice(0,30);var entries=files.map(function(name){return{date:name.replace(".md",""),content:fs.readFileSync(path.join(dir,name),"utf-8").slice(0,10000)};});reply.send({entries:entries});}catch(e){reply.code(500).send({error:e.message});}});

  // Memory API
  app.get("/api/memory",async function(req,reply){
    var memDir=getMemoryDir();
    var rawDir=path.join(memDir,"raw");
    var dailyDir=path.join(memDir,"digests","daily");
    var result={today:[],digests:[]};
    try{
      // today's raw memories
      var now=new Date();var pad=function(n){return n<10?'0'+n:''+n;};
      var todayStr=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
      var todayFile=path.join(rawDir,todayStr+".json");
      if(fs.existsSync(todayFile)){result.today=JSON.parse(fs.readFileSync(todayFile,"utf-8")).slice(-20);}
      // recent digests
      if(fs.existsSync(dailyDir)){var dFiles=fs.readdirSync(dailyDir).filter(function(f){return f.endsWith(".json");}).sort().reverse().slice(0,5);
      dFiles.forEach(function(f){try{var d=JSON.parse(fs.readFileSync(path.join(dailyDir,f),"utf-8"));if(d.summary)result.digests.push({date:d.date||f.replace(".json",""),summary:d.summary});}catch(ex){}});}
    }catch(e){console.error("[MemoryAPI]",e.message);}
    reply.send(result);
  });

  // Home status API
  homeMod.registerHomeRoutes(app);
}

function injectSystemPrompt(llmMessages){var prompt=spMod.loadSystemPrompt();var idx=llmMessages.findIndex(function(m){return m.role==="system";});if(idx!==-1){llmMessages[idx]={role:"system",content:prompt};}else{llmMessages.unshift({role:"system",content:prompt});}}
function buildUpstreamBody(originalBody,llmMessages){var modelName=String(process.env.MODEL_NAME||"gateway-model").trim()||"gateway-model";return Object.assign({},originalBody,{model:modelName,messages:llmMessages});}

module.exports={registerChatRoutes:registerChatRoutes,injectSystemPrompt:injectSystemPrompt,buildUpstreamBody:buildUpstreamBody};
