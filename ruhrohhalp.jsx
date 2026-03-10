import { useState, useEffect, useRef, useCallback } from "react";

/* ─── GLOBAL STYLES ─────────────────────────────────────────────────────────── */
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body,#root{height:100%}
    ::-webkit-scrollbar{width:3px;height:3px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:#252830;border-radius:2px}
    input,textarea,select,button{font-family:inherit}
    select option{background:#1a1c23;color:#e8e6e1}
    @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
    @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
    .fadeUp{animation:fadeUp .22s ease forwards}
    .slideIn{animation:slideIn .2s ease forwards}
    .slideUp{animation:slideUp .25s ease forwards}
    .dot-1{animation:pulse 1.2s ease infinite}
    .dot-2{animation:pulse 1.2s .2s ease infinite}
    .dot-3{animation:pulse 1.2s .4s ease infinite}
  `}</style>
);

/* ─── TOKENS ─────────────────────────────────────────────────────────────────── */
const C = {
  bg:"#0f1117", surface:"#14171f", card:"#1a1d27", cardHov:"#1e2130",
  border:"#232737", borderMid:"#2c3045", text:"#e4e2dc", textDim:"#8a8896",
  textFaint:"#3e4155", cream:"#f0ede6",
  cl:"#e07d4a", clDim:"#e07d4a14", clMid:"#e07d4a2a",   // claude – warm amber
  gpt:"#41c998", gptDim:"#41c99814", gptMid:"#41c9982a", // chatgpt – mint
  gem:"#5d9ef8", gemDim:"#5d9ef814", gemMid:"#5d9ef82a", // gemini – blue
  task:"#f4a623", note:"#9ec8f5", todo:"#6fcf9a", reminder:"#ef7f7f",
  gold:"#f4c842", silver:"#a0a8b8",
  serif:"'Instrument Serif',Georgia,serif",
  sans:"'Instrument Sans',system-ui,sans-serif",
  mono:"'JetBrains Mono',monospace",
};

/* ─── MODEL REGISTRY ─────────────────────────────────────────────────────────── */
// Add new models here — nothing else needs to change
const MODELS = {
  // ── Claude ──
  "claude-opus-4-5":   { provider:"claude",  label:"Claude Opus 4.5",  tier:"flagship", newest:true,  priceIn:5,    priceOut:25,  badge:"★ Best",     blurb:"Highest reasoning, best for complex strategy & analysis" },
  "claude-sonnet-4-5": { provider:"claude",  label:"Claude Sonnet 4.5",tier:"balanced", newest:false, priceIn:3,    priceOut:15,  badge:"Balanced",   blurb:"Best quality-to-speed ratio for most tasks" },
  "claude-haiku-4-5":  { provider:"claude",  label:"Claude Haiku 4.5", tier:"fast",     newest:false, priceIn:0.8,  priceOut:4,   badge:"Fast",       blurb:"Instant responses, great for quick to-dos" },
  // ── OpenAI ──
  "gpt-4o":            { provider:"chatgpt", label:"GPT-4o",           tier:"flagship", newest:true,  priceIn:5,    priceOut:20,  badge:"★ Best",     blurb:"Top OpenAI model — coding, research, data" },
  "gpt-4o-mini":       { provider:"chatgpt", label:"GPT-4o Mini",      tier:"fast",     newest:false, priceIn:0.15, priceOut:0.6, badge:"Fast",       blurb:"Lean & cheap — great for audits and quick research" },
  // ── Gemini ──
  "gemini-1.5-pro":    { provider:"gemini",  label:"Gemini 1.5 Pro",   tier:"flagship", newest:true,  priceIn:1.25, priceOut:5,   badge:"★ Best",     blurb:"Best Gemini — Google Workspace, long context" },
  "gemini-1.5-flash":  { provider:"gemini",  label:"Gemini 1.5 Flash", tier:"fast",     newest:false, priceIn:0.075,priceOut:0.3, badge:"Fast",       blurb:"Fastest Gemini — great for calendar & quick search" },
};

const PROVIDER_DEFAULT_MODEL = {
  claude:  "claude-sonnet-4-5",
  chatgpt: "gpt-4o",
  gemini:  "gemini-1.5-pro",
};
const PROVIDER_NEWEST = {
  claude:  "claude-opus-4-5",
  chatgpt: "gpt-4o",
  gemini:  "gemini-1.5-pro",
};

/* ─── AGENT REGISTRY ─────────────────────────────────────────────────────────── */
const AGENTS = {
  claude: {
    id:"claude", name:"Claude", icon:"◆", color:C.cl, dim:C.clDim, mid:C.clMid,
    tagline:"Planning · Writing · Strategy · Analysis",
    bestFor:["Planning","Writing","Analysis","Strategy","Product","Code Review"],
    async call(messages, key, system, modelId) {
      const model = modelId || PROVIDER_DEFAULT_MODEL.claude;
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model, max_tokens:1024, system, messages}),
      });
      const d = await res.json();
      if(d.error) throw new Error(d.error.message);
      return d.content?.find(b=>b.type==="text")?.text||"";
    },
  },
  chatgpt: {
    id:"chatgpt", name:"ChatGPT", icon:"◇", color:C.gpt, dim:C.gptDim, mid:C.gptMid,
    tagline:"Research · Code · Data · Brainstorming",
    bestFor:["Research","Coding","Debugging","Data","Technical","Brainstorm"],
    async call(messages, key, system, modelId) {
      const model = modelId || PROVIDER_DEFAULT_MODEL.chatgpt;
      const res = await fetch("https://api.openai.com/v1/chat/completions",{
        method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
        body:JSON.stringify({model, max_tokens:1024, messages:[{role:"system",content:system},...messages]}),
      });
      const d = await res.json();
      if(d.error) throw new Error(d.error.message);
      return d.choices?.[0]?.message?.content||"";
    },
  },
  gemini: {
    id:"gemini", name:"Gemini", icon:"✦", color:C.gem, dim:C.gemDim, mid:C.gemMid,
    tagline:"Calendar · Google Workspace · Search",
    bestFor:["Calendar","Google Docs","Gmail","Search","Workspace","Scheduling"],
    async call(messages, key, system, modelId) {
      const model = modelId || PROVIDER_DEFAULT_MODEL.gemini;
      const contents = messages.map(m=>({
        role:m.role==="assistant"?"model":"user", parts:[{text:m.content}]
      }));
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({systemInstruction:{parts:[{text:system}]}, contents}),
        }
      );
      const d = await res.json();
      if(d.error) throw new Error(d.error.message);
      return d.candidates?.[0]?.content?.parts?.[0]?.text||"";
    },
  },
};

/* ─── ROUTING ─────────────────────────────────────────────────────────────────── */
const ROUTES = [
  {test:t=>/calendar|schedule|meeting|appointment|event|remind at|set a reminder|block time/i.test(t), ai:"gemini",  model:"gemini-1.5-pro",  reason:"Calendar/scheduling → Gemini has native Google Calendar access"},
  {test:t=>/google doc|gmail|email draft|drive|sheets|workspace|gdoc/i.test(t),                       ai:"gemini",  model:"gemini-1.5-pro",  reason:"Google Workspace → Gemini integrates natively"},
  {test:t=>/search|research|look up|what is|who is|find out|latest news|current/i.test(t),            ai:"gemini",  model:"gemini-1.5-pro",  reason:"Real-time search → Gemini has live web access"},
  {test:t=>/code|debug|bug|implement|script|function|deploy|error|api integration/i.test(t),          ai:"chatgpt", model:"gpt-4o",           reason:"Code & debugging → GPT-4o is the strongest coder"},
  {test:t=>/data|analyze data|metrics|csv|statistics|analytics|numbers|chart/i.test(t),               ai:"chatgpt", model:"gpt-4o",           reason:"Data analysis → GPT-4o handles structured data best"},
  {test:t=>/brainstorm|ideas|variations|alternatives|options|explore/i.test(t),                       ai:"chatgpt", model:"gpt-4o",           reason:"Ideation → GPT-4o generates broad creative options"},
  {test:t=>/write|draft|strategy|plan|analyze|review|assess|product|evaluate|content/i.test(t),       ai:"claude",  model:"claude-sonnet-4-5",reason:"Writing & strategy → Claude Sonnet for structured reasoning"},
];
function routeItem(text){
  const t = (text||"").toLowerCase();
  for(const r of ROUTES) if(r.test(t)) return {ai:r.ai, model:r.model, reason:r.reason};
  return {ai:"claude", model:"claude-sonnet-4-5", reason:"General planning → Claude Sonnet for organized thinking"};
}
function detectType(text){
  const t = text.toLowerCase();
  if(/remind|reminder|don't forget|remember to|alert me/i.test(t)) return "reminder";
  if(/todo|to-do|to do|need to|finish|check off|complete/i.test(t)) return "todo";
  if(/note|thought|idea|noticed|fyi|observation/i.test(t)) return "note";
  return "task";
}
const TYPE_META = {
  task:    {label:"Task",    color:C.task,     icon:"◈"},
  note:    {label:"Note",    color:C.note,     icon:"◎"},
  todo:    {label:"To-Do",   color:C.todo,     icon:"☐"},
  reminder:{label:"Reminder",color:C.reminder, icon:"◷"},
};

/* ─── PRICING TIERS ─────────────────────────────────────────────────────────── */
const TIERS = {
  free:    {id:"free",    label:"Free",          price:0,  color:C.textDim, models:["claude-haiku-4-5","gpt-4o-mini","gemini-1.5-flash"], limit:"5 tasks/mo",  desc:"Try ruhrohhalp with basic models",    features:["5 tasks/month","Basic models only","No agent chat","No memory"]},
  starter: {id:"starter", label:"Starter",       price:12, color:C.gpt,    models:["claude-sonnet-4-5","gpt-4o","gemini-1.5-flash"],       limit:"100 tasks/mo",desc:"Best for individuals",          features:["100 tasks/month","Balanced models (Sonnet, GPT-4o, Flash)","Agent chat on all tasks","Shared memory across AIs","ChatGPT audit on every plan"]},
  pro:     {id:"pro",     label:"Pro",           price:25, color:C.gold,   models:["claude-opus-4-5","gpt-4o","gemini-1.5-pro"],           limit:"Unlimited",   desc:"For power users & founders",   features:["Unlimited tasks","Flagship models (Opus, GPT-4o, Gemini Pro)","All agent chats","Full memory & audit","Priority processing","All future models"]},
  byok:    {id:"byok",    label:"BYOK",          price:5,  color:C.cl,     models:["all"],                                                  limit:"Unlimited",   desc:"Bring your own API keys",       features:["Unlimited tasks","All models (your keys)","Full agent chat","$5/mo platform fee only","No markup on tokens","You control your spend"]},
};

/* ─── HELPERS ─────────────────────────────────────────────────────────────────── */
const uid = ()=>Math.random().toString(36).slice(2,10);
const now = ()=>new Date().toISOString();
const fmtDate = iso=>new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric"});
const fmtTime = iso=>new Date(iso).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});

function Spinner({color=C.cl,size=14}){
  return <span style={{display:"inline-block",width:size,height:size,border:`2px solid ${color}30`,borderTopColor:color,borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0}}/>;
}
function ThinkDots({color}){
  return(
    <div style={{display:"flex",gap:4,padding:"10px 14px"}}>
      {[1,2,3].map(i=><span key={i} className={`dot-${i}`} style={{width:6,height:6,borderRadius:"50%",background:color,display:"block"}}/>)}
    </div>
  );
}
function AgentDot({id,size=8}){
  const a=AGENTS[id]; if(!a) return null;
  return <span style={{display:"inline-block",width:size,height:size,borderRadius:"50%",background:a.color,boxShadow:`0 0 5px ${a.color}80`}}/>;
}
function TypeBadge({type}){
  const m=TYPE_META[type]||TYPE_META.task;
  return(
    <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:10,fontFamily:C.mono,letterSpacing:.5,padding:"1px 7px",borderRadius:4,background:m.color+"15",color:m.color,border:`1px solid ${m.color}28`}}>
      {m.icon} {m.label}
    </span>
  );
}
function ModelBadge({modelId, size="sm"}){
  const m=MODELS[modelId]; if(!m) return null;
  const a=AGENTS[m.provider];
  const fs=size==="sm"?10:11;
  return(
    <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:fs,fontFamily:C.mono,letterSpacing:.3,padding:"1px 8px",borderRadius:4,background:a.dim,color:a.color,border:`1px solid ${a.color}30`}}>
      {a.icon} {m.label} {m.newest&&<span style={{fontSize:8,background:a.mid,padding:"0 4px",borderRadius:3}}>NEW</span>}
    </span>
  );
}

/* ─── MODEL PICKER DROPDOWN ─────────────────────────────────────────────────── */
function ModelPicker({value, onChange, lockedTo, tierModels}){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    function h(e){if(ref.current&&!ref.current.contains(e.target))setOpen(false);}
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h);
  },[]);
  // Group by provider
  const groups = Object.entries(AGENTS).map(([pid,agent])=>({
    agent, models: Object.entries(MODELS).filter(([,m])=>m.provider===pid && (tierModels?.includes("all")||tierModels?.includes(m.provider)||tierModels?.includes(pid)))
  })).filter(g=>g.models.length>0);

  const current = MODELS[value];
  const agent = current ? AGENTS[current.provider] : null;

  return(
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{display:"flex",alignItems:"center",gap:6,background:agent?agent.dim:C.card,border:`1px solid ${agent?`${agent.color}40`:C.border}`,borderRadius:6,padding:"4px 8px 4px 7px",cursor:"pointer",fontFamily:C.mono,fontSize:10,color:agent?.color||C.textDim,transition:"all .15s"}}>
        {agent&&<span>{agent.icon}</span>}
        {current?.label||"Select model"}
        <span style={{fontSize:9,color:agent?.color||C.textFaint,marginLeft:2}}>▾</span>
      </button>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,zIndex:50,background:C.card,border:`1px solid ${C.borderMid}`,borderRadius:10,minWidth:260,boxShadow:"0 8px 32px #00000060",overflow:"hidden"}}>
          {groups.map(({agent:a, models})=>(
            <div key={a.id}>
              <div style={{padding:"6px 12px",fontSize:9,fontFamily:C.mono,letterSpacing:1.2,color:a.color,background:`${a.color}08`,borderBottom:`1px solid ${C.border}`}}>
                {a.icon} {a.name.toUpperCase()}
              </div>
              {models.map(([mid,m])=>(
                <button key={mid} onClick={()=>{onChange(mid);setOpen(false);}}
                  style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:value===mid?a.dim:"none",border:"none",cursor:"pointer",textAlign:"left",transition:"background .1s",borderBottom:`1px solid ${C.border}`}}
                  onMouseEnter={e=>e.currentTarget.style.background=a.dim}
                  onMouseLeave={e=>e.currentTarget.style.background=value===mid?a.dim:"none"}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                      <span style={{fontSize:12,fontFamily:C.mono,color:value===mid?a.color:C.text}}>{m.label}</span>
                      {m.newest&&<span style={{fontSize:9,background:a.mid,color:a.color,padding:"1px 5px",borderRadius:3,fontFamily:C.mono}}>NEWEST</span>}
                      <span style={{fontSize:9,color:C.textDim,fontFamily:C.mono}}>{m.badge}</span>
                    </div>
                    <div style={{fontSize:10,fontFamily:C.sans,color:C.textDim}}>{m.blurb}</div>
                  </div>
                  <div style={{fontSize:9,fontFamily:C.mono,color:C.textFaint,textAlign:"right",flexShrink:0}}>
                    ${m.priceIn}/${m.priceOut}<br/>per 1M
                  </div>
                </button>
              ))}
            </div>
          ))}
          <div style={{padding:"7px 12px",fontSize:9,fontFamily:C.mono,color:C.textFaint,background:C.surface,borderTop:`1px solid ${C.border}`}}>
            Prices are per 1M tokens (input/output)
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── PRICING MODAL ─────────────────────────────────────────────────────────── */
function PricingModal({onSelect, onClose, current}){
  const [tab,setTab]=useState("managed");
  return(
    <div style={{position:"fixed",inset:0,background:"#000c",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="slideUp" style={{background:C.surface,border:`1px solid ${C.borderMid}`,borderRadius:16,maxWidth:820,width:"100%",overflow:"hidden",boxShadow:"0 24px 80px #00000090"}}>
        {/* Header */}
        <div style={{padding:"24px 28px 0",position:"relative"}}>
          {onClose&&<button onClick={onClose} style={{position:"absolute",top:18,right:18,background:"none",border:`1px solid ${C.border}`,color:C.textDim,width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>}
          <div style={{fontFamily:C.serif,fontSize:24,fontStyle:"italic",color:C.cream,marginBottom:4}}>Choose your plan</div>
          <div style={{fontSize:13,fontFamily:C.sans,color:C.textDim,marginBottom:20}}>ruhrohhalp processes your notes with Claude + ChatGPT simultaneously. Pick how you want to access the models.</div>
          <div style={{display:"flex",gap:0,background:C.card,borderRadius:8,overflow:"hidden",width:"fit-content",marginBottom:20,border:`1px solid ${C.border}`}}>
            {["managed","byok"].map(t=>(
              <button key={t} onClick={()=>setTab(t)}
                style={{padding:"7px 20px",background:tab===t?C.cl:"none",border:"none",color:tab===t?C.bg:C.textDim,cursor:"pointer",fontFamily:C.mono,fontSize:11,letterSpacing:.5,transition:"all .15s"}}>
                {t==="managed"?"Managed (We handle it)":"BYOK (Your own keys)"}
              </button>
            ))}
          </div>
        </div>

        {tab==="managed"?(
          <div style={{padding:"0 28px 28px",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {["free","starter","pro"].map(tid=>{
              const tier=TIERS[tid];
              const isActive=current===tid;
              const accent=tier.color;
              return(
                <div key={tid} onClick={()=>onSelect(tid)}
                  style={{background:isActive?`${accent}10`:C.card,border:`1px solid ${isActive?accent:C.border}`,borderRadius:12,padding:20,cursor:"pointer",transition:"all .2s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=accent;e.currentTarget.style.background=`${accent}08`;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=isActive?accent:C.border;e.currentTarget.style.background=isActive?`${accent}10`:C.card;}}>
                  <div style={{fontFamily:C.mono,fontSize:10,color:accent,letterSpacing:1.2,marginBottom:6}}>{tier.label.toUpperCase()}</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:6}}>
                    <span style={{fontFamily:C.serif,fontSize:28,fontStyle:"italic",color:C.cream}}>{tier.price===0?"Free":`$${tier.price}`}</span>
                    {tier.price>0&&<span style={{fontSize:11,fontFamily:C.mono,color:C.textDim}}>/mo</span>}
                  </div>
                  <div style={{fontSize:12,fontFamily:C.sans,color:C.textDim,marginBottom:12,minHeight:32}}>{tier.desc}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {tier.features.map((f,i)=>(
                      <div key={i} style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                        <span style={{color:accent,fontSize:11,flexShrink:0,marginTop:1}}>✓</span>
                        <span style={{fontSize:11,fontFamily:C.sans,color:C.text}}>{f}</span>
                      </div>
                    ))}
                  </div>
                  {isActive&&<div style={{marginTop:14,padding:"4px 0",textAlign:"center",fontSize:10,fontFamily:C.mono,color:accent}}>CURRENT PLAN</div>}
                </div>
              );
            })}
          </div>
        ):(
          <div style={{padding:"0 28px 28px"}}>
            <div style={{background:C.card,border:`1px solid ${C.cl}30`,borderRadius:12,padding:20,marginBottom:16}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12}}>
                <div>
                  <div style={{fontFamily:C.mono,fontSize:10,color:C.cl,letterSpacing:1.2,marginBottom:4}}>BYOK — BRING YOUR OWN KEYS</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                    <span style={{fontFamily:C.serif,fontSize:32,fontStyle:"italic",color:C.cream}}>$5</span>
                    <span style={{fontSize:12,fontFamily:C.mono,color:C.textDim}}>/month platform access</span>
                  </div>
                </div>
                <button onClick={()=>onSelect("byok")} style={{background:C.cl,color:C.bg,border:"none",borderRadius:8,padding:"8px 20px",cursor:"pointer",fontFamily:C.sans,fontWeight:600,fontSize:13}}>
                  Choose BYOK →
                </button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {TIERS.byok.features.map((f,i)=>(
                  <div key={i} style={{display:"flex",gap:6}}>
                    <span style={{color:C.cl,fontSize:11,flexShrink:0}}>✓</span>
                    <span style={{fontSize:12,fontFamily:C.sans,color:C.text}}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{fontSize:12,fontFamily:C.sans,color:C.textDim,lineHeight:1.7}}>
              <strong style={{color:C.text}}>Why $5 and not free?</strong> ruhrohhalp handles orchestration, dual-model processing (Claude + ChatGPT run together), AI routing logic, memory injection, and the agent terminal experience. Your keys pay the AI companies directly — you control your spend.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── SETTINGS PANEL ─────────────────────────────────────────────────────────── */
function SettingsPanel({settings,setSettings,sub,onChangePlan,onClose}){
  return(
    <div style={{position:"fixed",inset:0,background:"#000a",zIndex:100,display:"flex",justifyContent:"flex-end"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="slideIn" style={{width:340,height:"100%",background:C.surface,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column"}}>
        <div style={{padding:"18px 18px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:C.serif,fontSize:18,fontStyle:"italic",color:C.cream}}>Settings</div>
            <div style={{fontSize:10,fontFamily:C.mono,color:C.textFaint,marginTop:2,letterSpacing:.5}}>
              {sub==="byok"?"BYOK — your keys":`Plan: ${TIERS[sub]?.label||"Free"}`}
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:`1px solid ${C.border}`,color:C.textDim,width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:18,display:"flex",flexDirection:"column",gap:14}}>
          {/* Plan */}
          <div style={{background:C.card,borderRadius:9,overflow:"hidden",border:`1px solid ${C.border}`}}>
            <div style={{padding:"9px 14px",borderBottom:`1px solid ${C.border}`,fontSize:10,fontFamily:C.mono,color:C.textDim,letterSpacing:1}}>SUBSCRIPTION</div>
            <div style={{padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:13,fontFamily:C.sans,color:C.text}}>{TIERS[sub]?.label||"Free"}</div>
                <div style={{fontSize:11,fontFamily:C.mono,color:C.textDim}}>{TIERS[sub]?.price===0?"Free":`$${TIERS[sub]?.price}/mo`}</div>
              </div>
              <button onClick={onChangePlan} style={{background:C.clDim,color:C.cl,border:`1px solid ${C.cl}40`,borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:11,fontFamily:C.mono}}>
                Change plan
              </button>
            </div>
          </div>

          {/* API Keys */}
          {(sub==="byok"||sub==="free")&&(
            <div style={{background:C.card,borderRadius:9,overflow:"hidden",border:`1px solid ${C.border}`}}>
              <div style={{padding:"9px 14px",borderBottom:`1px solid ${C.border}`,fontSize:10,fontFamily:C.mono,color:C.textDim,letterSpacing:1}}>API KEYS</div>
              <div style={{padding:14,display:"flex",flexDirection:"column",gap:12}}>
                {[
                  {key:"claudeKey",  id:"claude",  label:"Anthropic Key",  ph:"sk-ant-…"},
                  {key:"chatgptKey", id:"chatgpt", label:"OpenAI Key",     ph:"sk-proj-…"},
                  {key:"geminiKey",  id:"gemini",  label:"Gemini Key",     ph:"AIzaSy…"},
                ].map(f=>{
                  const a=AGENTS[f.id]; const has=!!settings[f.key];
                  return(
                    <div key={f.key}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                        <span style={{color:a.color,fontSize:12}}>{a.icon}</span>
                        <span style={{fontSize:11,fontFamily:C.mono,color:C.text}}>{f.label}</span>
                        {has&&<span style={{marginLeft:"auto",fontSize:9,color:a.color,fontFamily:C.mono}}>✓ active</span>}
                      </div>
                      <input type="password" value={settings[f.key]||""} onChange={e=>setSettings(p=>({...p,[f.key]:e.target.value}))}
                        placeholder={f.ph}
                        style={{width:"100%",background:C.surface,border:`1px solid ${has?`${a.color}50`:C.border}`,borderRadius:6,padding:"7px 10px",color:C.text,fontFamily:C.mono,fontSize:11,outline:"none",transition:"border .15s"}}
                        onFocus={e=>e.target.style.borderColor=a.color}
                        onBlur={e=>e.target.style.borderColor=has?`${AGENTS[f.id].color}50`:C.border}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{fontSize:10,fontFamily:C.sans,color:C.textFaint,lineHeight:1.7,padding:"0 2px"}}>
            Keys are stored locally in your browser.<br/>
            <span style={{color:C.cl}}>Anthropic</span>: console.anthropic.com/settings/keys<br/>
            <span style={{color:C.gpt}}>OpenAI</span>: platform.openai.com/api-keys<br/>
            <span style={{color:C.gem}}>Gemini</span>: aistudio.google.com/app/apikey
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── AGENT TERMINAL ─────────────────────────────────────────────────────────── */
function AgentTerminal({item,settings,onClose,allItems,onModelChange,tierModels}){
  const [selectedModel,setSelectedModel]=useState(item.selectedModel||item.recommendedModel);
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [inited,setInited]=useState(false);
  const endRef=useRef(null);
  const inputRef=useRef(null);

  const model=MODELS[selectedModel]||MODELS[PROVIDER_DEFAULT_MODEL.claude];
  const agent=AGENTS[model.provider]||AGENTS.claude;
  const apiKey=settings[`${agent.id}Key`];

  const ctx=allItems.filter(i=>i.id!==item.id&&i.status==="open").slice(0,6).map(i=>`- [${i.type}] ${i.title}`).join("\n")||"None";
  const system=`${agent.id==="claude"?"You are Claude":"You are an AI assistant"}, acting as a dedicated agent inside ruhrohhalp — a personal productivity planner.

You are focused entirely on helping the user complete this specific item:
Type: ${item.type} | Priority: ${item.priority}
Title: ${item.title}
Description: ${item.description||"None"}
How to accomplish: ${item.howTo||"Not yet analyzed"}
ChatGPT Audit Notes: ${item.auditNotes||"None"}

Other open items for context:
${ctx}

Be direct, specific, and actionable. Help the user make real progress on this item through conversation.`;

  useEffect(()=>{
    if(inited)return; setInited(true);
    if(!apiKey){setMessages([{role:"assistant",content:`⚠ No ${agent.name} API key.\n\nGo to Settings → add your ${agent.name} key to use this agent.\n\nItem: **${item.title}**`,ts:now()}]);return;}
    setLoading(true);
    agent.call([{role:"user",content:`I need help with: "${item.title}". ${item.description?`Context: ${item.description}`:""}. Give me a focused 2-sentence opener that acknowledges the task and asks one specific question to get started.`}],apiKey,system,selectedModel)
      .then(r=>setMessages([{role:"assistant",content:r,ts:now()}]))
      .catch(()=>setMessages([{role:"assistant",content:`Ready to work on: **${item.title}**\n\n${item.howTo||"What would you like to tackle first?"}`,ts:now()}]))
      .finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"})},[messages,loading]);
  useEffect(()=>{setTimeout(()=>inputRef.current?.focus(),80)},[]);

  async function send(){
    const text=input.trim(); if(!text||loading)return;
    if(!apiKey){setMessages(p=>[...p,{role:"user",content:text,ts:now()},{role:"assistant",content:`⚠ Add a ${agent.name} API key in Settings.`,ts:now()}]);setInput("");return;}
    const um={role:"user",content:text,ts:now()};
    setMessages(p=>[...p,um]); setInput(""); setLoading(true);
    const hist=[...messages,um].map(m=>({role:m.role,content:m.content}));
    try{
      const res=await agent.call(hist,apiKey,system,selectedModel);
      setMessages(p=>[...p,{role:"assistant",content:res,ts:now()}]);
    }catch(e){setMessages(p=>[...p,{role:"assistant",content:`Error: ${e.message}`,ts:now()}]);}
    finally{setLoading(false);}
  }

  function handleModelSwitch(mid){
    setSelectedModel(mid);
    onModelChange&&onModelChange(mid);
    const newModel=MODELS[mid]; const newAgent=AGENTS[newModel?.provider];
    if(newAgent&&newAgent.id!==agent.id){
      setMessages(p=>[...p,{role:"assistant",content:`Switched to **${newModel.label}** (${newAgent.name}). I have full context on your task. What would you like to work on?`,ts:now()}]);
    }
  }

  function render(text){
    return text.split("\n").map((line,i)=>{
      if(/^\*\*(.+?)\*\*$/.test(line)) return<div key={i} style={{fontWeight:600,color:C.cream,marginBottom:2}}>{line.replace(/\*\*/g,"")}</div>;
      const bolded=line.replace(/\*\*(.+?)\*\*/g,'<strong style="color:#f0ede6">$1</strong>');
      if(line.startsWith("- ")||line.startsWith("• ")) return<div key={i} style={{paddingLeft:12,marginBottom:2,display:"flex",gap:5}}><span style={{color:agent.color,flexShrink:0}}>›</span><span dangerouslySetInnerHTML={{__html:bolded.slice(2)}}/></div>;
      if(/^\d+\.\s/.test(line)) return<div key={i} style={{paddingLeft:12,marginBottom:2}} dangerouslySetInnerHTML={{__html:bolded}}/>;
      if(line.trim()==="") return<div key={i} style={{height:5}}/>;
      return<div key={i} style={{marginBottom:2}} dangerouslySetInnerHTML={{__html:bolded}}/>;
    });
  }

  return(
    <div className="slideIn" style={{display:"flex",flexDirection:"column",height:"100%",background:C.surface,borderLeft:`1px solid ${C.border}`}}>
      {/* Header */}
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"center",background:C.bg,flexShrink:0}}>
        <div style={{width:28,height:28,borderRadius:"50%",background:agent.mid,display:"flex",alignItems:"center",justifyContent:"center",color:agent.color,fontSize:13,flexShrink:0}}>{agent.icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:C.mono,fontSize:9,color:agent.color,letterSpacing:1.2,marginBottom:1}}>{agent.name.toUpperCase()} AGENT</div>
          <div style={{fontFamily:C.sans,fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
        </div>
        <ModelPicker value={selectedModel} onChange={handleModelSwitch} tierModels={tierModels}/>
        <TypeBadge type={item.type}/>
        <button onClick={onClose} style={{background:"none",border:`1px solid ${C.border}`,color:C.textDim,width:26,height:26,borderRadius:6,cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
      </div>

      {/* Context strip */}
      <div style={{padding:"5px 16px",background:`${agent.color}07`,borderBottom:`1px solid ${agent.color}18`,flexShrink:0}}>
        <span style={{fontSize:10,fontFamily:C.mono,color:agent.color,opacity:.7}}>{item.aiReason}</span>
      </div>

      {/* Messages */}
      <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
        {messages.map((msg,i)=>(
          <div key={i} style={{display:"flex",gap:8,flexDirection:msg.role==="user"?"row-reverse":"row"}}>
            {msg.role==="assistant"&&<div style={{width:20,height:20,borderRadius:"50%",background:agent.mid,display:"flex",alignItems:"center",justifyContent:"center",color:agent.color,fontSize:10,flexShrink:0,marginTop:2}}>{agent.icon}</div>}
            <div style={{maxWidth:"83%",padding:"9px 12px",borderRadius:9,background:msg.role==="user"?`${agent.color}14`:C.card,border:`1px solid ${msg.role==="user"?`${agent.color}30`:C.border}`,fontSize:12,fontFamily:C.sans,lineHeight:1.65,color:C.text}}>
              {render(msg.content)}
              <div style={{fontSize:9,fontFamily:C.mono,color:C.textFaint,marginTop:4,textAlign:msg.role==="user"?"right":"left"}}>{fmtTime(msg.ts)}</div>
            </div>
          </div>
        ))}
        {loading&&(
          <div style={{display:"flex",gap:8}}>
            <div style={{width:20,height:20,borderRadius:"50%",background:agent.mid,display:"flex",alignItems:"center",justifyContent:"center",color:agent.color,fontSize:10,flexShrink:0,marginTop:2}}>{agent.icon}</div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9}}><ThinkDots color={agent.color}/></div>
          </div>
        )}
        <div ref={endRef}/>
      </div>

      {/* Input */}
      <div style={{padding:"10px 14px",borderTop:`1px solid ${C.border}`,background:C.bg,flexShrink:0}}>
        <div style={{display:"flex",gap:7,alignItems:"flex-end",background:C.card,border:`1px solid ${C.borderMid}`,borderRadius:9,padding:"7px 9px 7px 13px"}}>
          <textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
            placeholder={`Message ${agent.name} (${model.label})…`} rows={1}
            style={{flex:1,background:"none",border:"none",outline:"none",color:C.text,fontFamily:C.sans,fontSize:12,lineHeight:1.5,resize:"none",maxHeight:90,overflowY:"auto",caretColor:agent.color}}
            onInput={e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,90)+"px";}}
          />
          <button onClick={send} disabled={!input.trim()||loading}
            style={{background:input.trim()&&!loading?agent.color:C.border,border:"none",borderRadius:7,width:30,height:30,cursor:input.trim()&&!loading?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"background .15s"}}>
            {loading?<Spinner color={C.bg} size={12}/>:<span style={{color:C.bg,fontSize:13}}>↑</span>}
          </button>
        </div>
        <div style={{marginTop:4,fontSize:9,fontFamily:C.mono,color:C.textFaint,textAlign:"center"}}>↵ send · ⇧↵ newline · switch model anytime above</div>
      </div>
    </div>
  );
}

/* ─── PLANNER CARD ─────────────────────────────────────────────────────────── */
function PlannerCard({item,index,onOpen,onToggle,onDelete,onModelChange,isActive,tierModels}){
  const recModel=MODELS[item.recommendedModel];
  const selModel=MODELS[item.selectedModel||item.recommendedModel];
  const agent=AGENTS[selModel?.provider||"claude"];
  const isOverridden=item.selectedModel&&item.selectedModel!==item.recommendedModel;
  const [showHow,setShowHow]=useState(false);
  const [showAudit,setShowAudit]=useState(false);

  return(
    <div className="fadeUp" style={{animationDelay:`${index*.035}s`,background:isActive?`${agent.color}08`:C.card,border:`1px solid ${isActive?`${agent.color}45`:C.border}`,borderRadius:10,overflow:"hidden",opacity:item.status==="done"?.42:1,transition:"all .2s"}}>
      <div style={{padding:"12px 14px",display:"flex",gap:11,alignItems:"flex-start"}}>
        {/* Check */}
        <button onClick={()=>onToggle(item.id)}
          style={{flexShrink:0,width:17,height:17,marginTop:2,borderRadius:4,border:`1.5px solid ${item.status==="done"?agent.color:C.borderMid}`,background:item.status==="done"?agent.color:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
          {item.status==="done"&&<span style={{color:C.bg,fontSize:10}}>✓</span>}
        </button>

        {/* Body */}
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
            <TypeBadge type={item.type}/>
            <span style={{fontSize:10,fontFamily:C.mono,color:item.priority==="high"?C.reminder:item.priority==="medium"?C.task:C.textFaint}}>
              {item.priority}
            </span>
            <span style={{fontSize:10,fontFamily:C.mono,color:C.textFaint}}>{fmtDate(item.createdAt)}</span>
          </div>
          <div style={{fontFamily:C.serif,fontSize:14,fontStyle:"italic",color:item.status==="done"?C.textFaint:C.cream,lineHeight:1.4,marginBottom:item.description?4:0,textDecoration:item.status==="done"?"line-through":"none"}}>
            {item.title}
          </div>
          {item.description&&<div style={{fontSize:11,fontFamily:C.sans,color:C.textDim,lineHeight:1.5,marginBottom:6}}>{item.description}</div>}

          {/* Expand buttons */}
          <div style={{display:"flex",gap:10,marginTop:4}}>
            {item.howTo&&(
              <button onClick={()=>setShowHow(s=>!s)} style={{background:"none",border:"none",cursor:"pointer",fontFamily:C.mono,fontSize:9,color:C.textFaint,letterSpacing:.5,display:"flex",alignItems:"center",gap:3,padding:0}}>
                <span style={{transition:"transform .15s",display:"inline-block",transform:showHow?"rotate(90deg)":"none"}}>▸</span>HOW TO
              </button>
            )}
            {item.auditNotes&&(
              <button onClick={()=>setShowAudit(s=>!s)} style={{background:"none",border:"none",cursor:"pointer",fontFamily:C.mono,fontSize:9,color:C.gpt,letterSpacing:.5,display:"flex",alignItems:"center",gap:3,padding:0}}>
                <span style={{transition:"transform .15s",display:"inline-block",transform:showAudit?"rotate(90deg)":"none"}}>▸</span>GPT AUDIT
              </button>
            )}
          </div>

          {showHow&&item.howTo&&(
            <div style={{marginTop:7,padding:"9px 11px",background:C.surface,borderRadius:7,border:`1px solid ${C.border}`,fontSize:11,fontFamily:C.sans,color:C.textDim,lineHeight:1.65}}>
              {item.howTo.split("\n").map((line,i)=>{
                if(line.startsWith("-")||line.startsWith("•")) return<div key={i} style={{paddingLeft:10,marginBottom:1}}>• {line.replace(/^[-•]\s*/,"")}</div>;
                if(line.trim()==="") return<div key={i} style={{height:3}}/>;
                return<div key={i}>{line}</div>;
              })}
            </div>
          )}
          {showAudit&&item.auditNotes&&(
            <div style={{marginTop:7,padding:"9px 11px",background:`${C.gpt}08`,borderRadius:7,border:`1px solid ${C.gpt}25`,fontSize:11,fontFamily:C.sans,color:C.textDim,lineHeight:1.65}}>
              <div style={{fontSize:9,fontFamily:C.mono,color:C.gpt,letterSpacing:1,marginBottom:5}}>◇ CHATGPT AUDIT</div>
              {item.auditNotes.split("\n").map((line,i)=>{
                if(line.startsWith("-")||line.startsWith("•")) return<div key={i} style={{paddingLeft:10,marginBottom:1}}>• {line.replace(/^[-•]\s*/,"")}</div>;
                if(line.trim()==="") return<div key={i} style={{height:3}}/>;
                return<div key={i}>{line}</div>;
              })}
            </div>
          )}
        </div>

        {/* Right actions */}
        <div style={{flexShrink:0,display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end"}}>
          <button onClick={()=>onDelete(item.id)} style={{background:"none",border:"none",color:C.textFaint,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px",opacity:.45,transition:"opacity .15s"}} onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=.45}>×</button>

          {/* Model picker */}
          <ModelPicker value={item.selectedModel||item.recommendedModel} onChange={mid=>onModelChange(item.id,mid)} tierModels={tierModels}/>

          {isOverridden&&(
            <div style={{fontSize:9,fontFamily:C.mono,color:C.textFaint,textAlign:"right"}}>
              Rec: <span style={{color:AGENTS[recModel?.provider||"claude"]?.color}}>{recModel?.label}</span>
            </div>
          )}

          {/* Open agent */}
          <button onClick={()=>onOpen(item)}
            style={{display:"flex",alignItems:"center",gap:5,padding:"5px 9px",borderRadius:6,border:`1px solid ${agent.color}45`,background:isActive?agent.mid:agent.dim,color:agent.color,cursor:"pointer",fontSize:10,fontFamily:C.mono,letterSpacing:.3,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background=agent.mid;e.currentTarget.style.borderColor=agent.color;}}
            onMouseLeave={e=>{e.currentTarget.style.background=isActive?agent.mid:agent.dim;e.currentTarget.style.borderColor=`${agent.color}45`;}}>
            {agent.icon} Open Agent
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{padding:"4px 14px 7px",display:"flex",alignItems:"center",gap:6,borderTop:`1px solid ${C.border}`}}>
        <AgentDot id={agent.id} size={6}/>
        <span style={{fontSize:9,fontFamily:C.mono,color:agent.color,opacity:.7,flex:1}}>{item.aiReason}</span>
        <ModelBadge modelId={item.selectedModel||item.recommendedModel}/>
      </div>
    </div>
  );
}

/* ─── CAPTURE BAR ─────────────────────────────────────────────────────────── */
function CaptureBar({onCapture,processing}){
  const [text,setText]=useState("");
  const taRef=useRef(null);
  function submit(){if(!text.trim()||processing)return;onCapture(text.trim());setText("");if(taRef.current)taRef.current.style.height="auto";}
  return(
    <div style={{background:C.card,border:`1px solid ${C.borderMid}`,borderRadius:12,overflow:"hidden"}}>
      <textarea ref={taRef} value={text} onChange={e=>setText(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();submit();}}}
        placeholder={"Dump anything — tasks, notes, to-dos, ideas, reminders...\n\nExamples:\n  \"Schedule a product review call with Brett next Tuesday at 2pm\"\n  \"Note: Motus paywall still showing for free users after SSO login\"\n  \"Research push notification best practices for fitness retention\"\n  \"Todo: follow up with Clarissa about anniversary dinner reservation\"\n  \"Fix the feedback button — it's emailing tylerjyoung5@gmail.com instead of tyler@motusprogram.com\"\n\n⌘↵ — Claude structures your plan + ChatGPT audits it simultaneously"}
        style={{width:"100%",background:"none",border:"none",outline:"none",padding:"14px 16px",color:C.text,fontFamily:C.sans,fontSize:13,lineHeight:1.7,resize:"none",minHeight:130,caretColor:C.cl}}
        onInput={e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,260)+"px";}}
      />
      <div style={{padding:"8px 12px",borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:`${C.surface}80`}}>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:10,fontFamily:C.mono,color:C.textFaint}}>{text.length>0?`${text.length} chars · `:""}</span>
          <div style={{display:"flex",gap:5,alignItems:"center"}}>
            <span style={{fontSize:10,fontFamily:C.mono,color:C.cl}}>◆ Claude</span>
            <span style={{fontSize:9,color:C.textFaint,fontFamily:C.mono}}>+</span>
            <span style={{fontSize:10,fontFamily:C.mono,color:C.gpt}}>◇ ChatGPT</span>
            <span style={{fontSize:9,color:C.textFaint,fontFamily:C.mono}}>run together</span>
          </div>
        </div>
        <button onClick={submit} disabled={!text.trim()||processing}
          style={{display:"flex",alignItems:"center",gap:7,background:text.trim()&&!processing?C.cl:C.border,color:text.trim()&&!processing?C.bg:C.textFaint,border:"none",borderRadius:7,padding:"6px 14px",cursor:text.trim()&&!processing?"pointer":"default",fontFamily:C.sans,fontWeight:600,fontSize:12,transition:"all .2s"}}>
          {processing?<><Spinner color={C.bg} size={12}/>Processing…</>:<>◆ Process</>}
        </button>
      </div>
    </div>
  );
}

/* ─── STORAGE ─────────────────────────────────────────────────────────────── */
const STORE="ruhrohhalp_v1";
function load(){try{return JSON.parse(localStorage.getItem(STORE)||"null");}catch{return null;}}
function persist(s){try{localStorage.setItem(STORE,JSON.stringify(s));}catch{}}

/* ═══════════════════════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════════════════════ */
export default function RuhrohHalp(){
  const stored=load();
  const [items,setItems]=useState(stored?.items||[]);
  const [settings,setSettings]=useState(stored?.settings||{});
  const [sub,setSub]=useState(stored?.sub||"free");       // free | starter | pro | byok
  const [processing,setProcessing]=useState(false);
  const [processStage,setProcessStage]=useState("");      // "claude" | "chatgpt" | ""
  const [activeAgent,setActiveAgent]=useState(null);
  const [showSettings,setShowSettings]=useState(false);
  const [showPricing,setShowPricing]=useState(false);
  const [filter,setFilter]=useState("all");
  const [aiFilter,setAiFilter]=useState("all");

  useEffect(()=>{persist({items,settings,sub});},[items,settings,sub]);

  const tier=TIERS[sub]||TIERS.free;
  const tierModels=tier.models;
  const hasClaudeKey=!!(settings.claudeKey);
  const hasGptKey=!!(settings.chatgptKey);

  // ── DUAL PROCESSING ────────────────────────────────────────────────────
  async function handleCapture(rawText){
    setProcessing(true); setProcessStage("claude");

    const ctxItems=items.slice(0,8).map(i=>`- [${i.type}] ${i.title}`).join("\n")||"none";

    const CLAUDE_SYSTEM=`You are the planning intelligence behind ruhrohhalp, a personal productivity planner.

Parse the user's free-text input into structured planner items. Return ONLY a valid JSON array — no markdown, no explanation.

Each object must have:
- "title": string (concise, action-oriented, ≤80 chars)
- "description": string (supporting detail, or "")
- "type": "task" | "note" | "todo" | "reminder"
- "priority": "high" | "medium" | "low"
- "howTo": string (3-5 concrete, research-backed steps. Be specific — include real tactics, tools, frameworks.)
- "recommendedAI": "claude" | "chatgpt" | "gemini"
- "recommendedModel": one of: "claude-opus-4-5","claude-sonnet-4-5","claude-haiku-4-5","gpt-4o","gpt-4o-mini","gemini-1.5-pro","gemini-1.5-flash"
- "aiReason": string (one sentence: why this model is best for this item)

Model routing guide:
- gemini-1.5-pro: calendar, scheduling, Google Workspace, Gmail, real-time search
- gpt-4o: coding, debugging, data analysis, broad research, brainstorming  
- claude-sonnet-4-5: writing, strategy, product planning, analysis, structured reasoning
- claude-opus-4-5: only for highly complex strategy, deep analysis, or nuanced writing
- claude-haiku-4-5 / gpt-4o-mini / gemini-1.5-flash: only for simple, fast to-dos

Always prefer the newest/best model unless the task is clearly simple. Default to flagship for unknowns.

If the input has multiple items, return multiple objects. Return at least one.

Existing items for context: ${ctxItems}`;

    const GPT_AUDIT_SYSTEM=`You are ChatGPT, the audit layer in ruhrohhalp — a productivity planner. Claude has parsed the user's notes into a plan. Your job is to audit each item and return JSON.

Return ONLY a valid JSON array of audit objects, one per item. Each object:
- "title": string (exact title from Claude's output, for matching)
- "auditNotes": string (2-4 bullet points: gaps Claude missed, research suggestions, risks, or resources. Be specific and actionable. If the item is solid, confirm it with one validation point.)
- "memoryKey": string (a short 3-8 word phrase summarizing the core context for memory)

Example auditNotes: "- Consider A/B testing notification copy before full rollout\\n- Check if Expo supports background notifications on Android 13\\n- Similar apps saw 40% retention lift with day-1 push"

Be a smart second opinion. Absorb the context into memory.`;

    let claudeItems=[];
    let gptAudits=[];

    // Step 1: Claude parses
    try{
      if(!hasClaudeKey) throw new Error("no-key");
      const raw=await AGENTS.claude.call([{role:"user",content:rawText}],settings.claudeKey,CLAUDE_SYSTEM,"claude-sonnet-4-5");
      const match=raw.match(/\[[\s\S]*\]/);
      if(match) claudeItems=JSON.parse(match[0]);
    }catch(e){
      // Fallback: local parse
      const lines=rawText.split(/\n/).map(l=>l.trim()).filter(Boolean);
      claudeItems=lines.map(line=>{
        const r=routeItem(line);
        return{title:line.slice(0,80),description:"",type:detectType(line),priority:"medium",howTo:"Add your Anthropic API key in Settings for AI-generated how-to guidance.",recommendedAI:r.ai,recommendedModel:r.model,aiReason:r.reason};
      });
      if(claudeItems.length===0) claudeItems=[{title:rawText.slice(0,80),description:rawText.slice(80),type:detectType(rawText),priority:"medium",howTo:"",recommendedAI:"claude",recommendedModel:"claude-sonnet-4-5",aiReason:"General task → Claude for planning"}];
    }

    // Step 2: GPT audits (parallel, non-blocking)
    setProcessStage("chatgpt");
    if(hasGptKey&&claudeItems.length>0){
      try{
        const planSummary=claudeItems.map(i=>`Title: ${i.title}\nType: ${i.type}\nHowTo: ${i.howTo}`).join("\n\n");
        const raw=await AGENTS.chatgpt.call([{role:"user",content:`Audit this plan:\n\n${planSummary}\n\nOriginal input: "${rawText}"`}],settings.chatgptKey,GPT_AUDIT_SYSTEM,"gpt-4o-mini");
        const match=raw.match(/\[[\s\S]*\]/);
        if(match) gptAudits=JSON.parse(match[0]);
      }catch{}
    }

    // Merge
    const merged=claudeItems.map(item=>{
      const audit=gptAudits.find(a=>a.title?.toLowerCase()===item.title?.toLowerCase());
      const r=routeItem(`${item.title} ${item.description}`);
      return{
        id:uid(),
        ...item,
        recommendedAI:item.recommendedAI||r.ai,
        recommendedModel:item.recommendedModel||r.model,
        aiReason:item.aiReason||r.reason,
        selectedModel:null, // null = use recommended
        auditNotes:audit?.auditNotes||"",
        memoryKey:audit?.memoryKey||"",
        status:"open",
        createdAt:now(),
        sourceText:rawText,
      };
    });

    setItems(prev=>[...merged,...prev]);
    setProcessing(false); setProcessStage("");
  }

  function toggleItem(id){setItems(prev=>prev.map(i=>i.id===id?{...i,status:i.status==="done"?"open":"done"}:i));}
  function deleteItem(id){setItems(prev=>prev.filter(i=>i.id!==id));if(activeAgent?.id===id)setActiveAgent(null);}
  function changeModel(id,mid){setItems(prev=>prev.map(i=>i.id===id?{...i,selectedModel:mid}:i));if(activeAgent?.id===id)setActiveAgent(prev=>({...prev,selectedModel:mid}));}
  function openAgent(item){setActiveAgent(prev=>prev?.id===item.id?null:item);}

  function selectPlan(tid){
    setSub(tid);
    setShowPricing(false);
    if(tid==="byok"||tid==="free") setShowSettings(true);
  }

  const displayed=items.filter(item=>{
    const fok=filter==="all"||(filter==="open"&&item.status==="open")||(filter==="done"&&item.status==="done")||filter===item.type;
    const selAI=item.selectedModel?MODELS[item.selectedModel]?.provider:item.recommendedAI;
    const aok=aiFilter==="all"||selAI===aiFilter;
    return fok&&aok;
  });

  const open=items.filter(i=>i.status==="open").length;
  const done=items.filter(i=>i.status==="done").length;
  const FTABS=[{id:"all",l:"All",c:items.length},{id:"open",l:"Open",c:open},{id:"task",l:"Tasks",c:items.filter(i=>i.type==="task").length},{id:"todo",l:"To-Dos",c:items.filter(i=>i.type==="todo").length},{id:"note",l:"Notes",c:items.filter(i=>i.type==="note").length},{id:"reminder",l:"Reminders",c:items.filter(i=>i.type==="reminder").length},{id:"done",l:"Done",c:done}];

  return(
    <div style={{display:"flex",height:"100vh",background:C.bg,color:C.text,fontFamily:C.sans,overflow:"hidden"}}>
      <GS/>
      {showPricing&&<PricingModal onSelect={selectPlan} onClose={()=>setShowPricing(false)} current={sub}/>}
      {showSettings&&<SettingsPanel settings={settings} setSettings={setSettings} sub={sub} onChangePlan={()=>{setShowSettings(false);setShowPricing(true);}} onClose={()=>setShowSettings(false)}/>}

      {/* ── LEFT: Planner ────────────────────────────────────────────── */}
      <div style={{display:"flex",flexDirection:"column",flex:activeAgent?"0 0 52%":"1",minWidth:0,transition:"flex .22s ease",overflow:"hidden"}}>

        {/* Header */}
        <div style={{padding:"16px 22px 12px",borderBottom:`1px solid ${C.border}`,flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
          <div>
            <div style={{fontFamily:C.serif,fontSize:24,fontStyle:"italic",color:C.cream,letterSpacing:-.5,lineHeight:1}}>ruh-roh. halp.</div>
            <div style={{fontSize:9,fontFamily:C.mono,color:C.textFaint,letterSpacing:2,marginTop:3}}>RUHROHHALP.COM</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {/* Live agent dots */}
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              {Object.values(AGENTS).map(a=>{
                const hasKey=!!settings[`${a.id}Key`]||(sub!=="free"&&sub!=="byok");
                return<div key={a.id} title={`${a.name}${hasKey?" active":" — add key"}`} style={{width:7,height:7,borderRadius:"50%",background:hasKey?a.color:C.textFaint,boxShadow:hasKey?`0 0 5px ${a.color}70`:undefined,transition:"all .3s"}}/>;
              })}
            </div>
            {/* Plan pill */}
            <button onClick={()=>setShowPricing(true)}
              style={{background:C.clDim,color:C.cl,border:`1px solid ${C.cl}35`,borderRadius:20,padding:"3px 10px",cursor:"pointer",fontFamily:C.mono,fontSize:9,letterSpacing:.5}}>
              {tier.label}{tier.price>0?` $${tier.price}/mo`:""}
            </button>
            <button onClick={()=>setShowSettings(true)}
              style={{background:"none",border:`1px solid ${C.border}`,color:C.textDim,borderRadius:7,padding:"4px 11px",cursor:"pointer",fontSize:11,fontFamily:C.mono,letterSpacing:.5}}>
              Settings
            </button>
          </div>
        </div>

        {/* Capture */}
        <div style={{padding:"14px 18px 10px",flexShrink:0}}>
          <CaptureBar onCapture={handleCapture} processing={processing}/>
          {processing&&(
            <div style={{marginTop:8,padding:"6px 12px",background:`${C.cl}0c`,border:`1px solid ${C.cl}25`,borderRadius:8,display:"flex",alignItems:"center",gap:8}}>
              <Spinner color={processStage==="chatgpt"?C.gpt:C.cl} size={11}/>
              <span style={{fontSize:10,fontFamily:C.mono,color:processStage==="chatgpt"?C.gpt:C.cl}}>
                {processStage==="claude"?"◆ Claude is structuring your plan…":"◇ ChatGPT is auditing…"}
              </span>
            </div>
          )}
          {!hasClaudeKey&&(
            <div style={{marginTop:7,padding:"5px 11px",background:`${C.cl}0c`,border:`1px solid ${C.cl}25`,borderRadius:7,fontSize:10,fontFamily:C.mono,color:C.cl}}>
              ◆ Add your Anthropic key for AI-powered planning →{" "}
              <button onClick={()=>setShowSettings(true)} style={{background:"none",border:"none",color:C.cl,cursor:"pointer",fontFamily:C.mono,fontSize:10,textDecoration:"underline"}}>Settings</button>
              {" "}or{" "}
              <button onClick={()=>setShowPricing(true)} style={{background:"none",border:"none",color:C.cl,cursor:"pointer",fontFamily:C.mono,fontSize:10,textDecoration:"underline"}}>upgrade plan</button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{padding:"0 18px 10px",flexShrink:0}}>
          <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:5}}>
            {FTABS.map(f=>(
              <button key={f.id} onClick={()=>setFilter(f.id)}
                style={{display:"flex",alignItems:"center",gap:3,background:filter===f.id?`${C.cl}14`:"none",border:`1px solid ${filter===f.id?`${C.cl}45`:C.border}`,color:filter===f.id?C.cl:C.textDim,padding:"3px 9px",borderRadius:20,cursor:"pointer",fontFamily:C.mono,fontSize:9,letterSpacing:.3,transition:"all .15s"}}>
                {f.l}{f.c>0&&<span style={{fontSize:8,background:filter===f.id?`${C.cl}20`:C.surface,padding:"0 4px",borderRadius:8}}>{f.c}</span>}
              </button>
            ))}
          </div>
          <div style={{display:"flex",gap:3}}>
            <button onClick={()=>setAiFilter("all")} style={{background:aiFilter==="all"?C.surface:"none",border:`1px solid ${aiFilter==="all"?C.borderMid:C.border}`,color:aiFilter==="all"?C.textDim:C.textFaint,padding:"2px 8px",borderRadius:20,cursor:"pointer",fontFamily:C.mono,fontSize:9,transition:"all .15s"}}>All AIs</button>
            {Object.values(AGENTS).map(a=>(
              <button key={a.id} onClick={()=>setAiFilter(aiFilter===a.id?"all":a.id)}
                style={{background:aiFilter===a.id?a.dim:"none",border:`1px solid ${aiFilter===a.id?`${a.color}45`:C.border}`,color:aiFilter===a.id?a.color:C.textFaint,padding:"2px 8px",borderRadius:20,cursor:"pointer",fontFamily:C.mono,fontSize:9,display:"flex",alignItems:"center",gap:3,transition:"all .15s"}}>
                {a.icon}{a.name}
              </button>
            ))}
          </div>
        </div>

        {/* Items */}
        <div style={{flex:1,overflowY:"auto",padding:"0 18px 20px",display:"flex",flexDirection:"column",gap:7}}>
          {displayed.length===0&&!processing&&(
            <div style={{textAlign:"center",padding:"60px 20px",color:C.textFaint,fontFamily:C.serif,fontSize:15,fontStyle:"italic"}}>
              {items.length===0?"Type anything above to start your plan":"No items match this filter"}
            </div>
          )}
          {displayed.map((item,i)=>(
            <PlannerCard key={item.id} item={item} index={i}
              onOpen={openAgent} onToggle={toggleItem} onDelete={deleteItem}
              onModelChange={changeModel} isActive={activeAgent?.id===item.id}
              tierModels={tierModels}
            />
          ))}
        </div>

        {/* Footer */}
        {items.length>0&&(
          <div style={{padding:"6px 18px",borderTop:`1px solid ${C.border}`,display:"flex",gap:12,flexShrink:0}}>
            <span style={{fontSize:9,fontFamily:C.mono,color:C.task}}>{open} open</span>
            <span style={{fontSize:9,fontFamily:C.mono,color:C.textFaint}}>{done} done</span>
            <span style={{marginLeft:"auto",fontSize:9,fontFamily:C.mono,color:C.textFaint}}>
              {hasClaudeKey?"◆":"○"} {hasGptKey?"◇":"○"} {settings.geminiKey?"✦":"○"}
            </span>
          </div>
        )}
      </div>

      {/* ── RIGHT: Agent Terminal ─────────────────────────────────── */}
      {activeAgent&&(
        <div style={{flex:"0 0 48%",minWidth:0,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          <AgentTerminal
            item={activeAgent}
            settings={settings}
            onClose={()=>setActiveAgent(null)}
            allItems={items}
            onModelChange={(mid)=>changeModel(activeAgent.id,mid)}
            tierModels={tierModels}
          />
        </div>
      )}
    </div>
  );
}
