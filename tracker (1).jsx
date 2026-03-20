import { useState, useRef, useEffect } from "react";

const DEFAULT_BASAL = 2000;

const SYSTEM_PROMPT = `Você é um rastreador de saúde pessoal inteligente e motivador. O objetivo do usuário é PERDER PESO e GANHAR MASSA MAGRA simultaneamente (recomposição corporal).

O déficit calórico real do usuário é calculado assim:
DÉFICIT = Basal + Kcal queimadas no treino − Kcal ingeridas
(Basal atual será informado no contexto de cada mensagem)

1. REFEIÇÕES: Calcule as calorias estimadas. Use estimativas realistas para porções médias brasileiras.

2. TREINOS: Dê feedback motivador. Comente a intensidade pelo BPM (60-100 baixo, 100-140 moderado, 140-170 alto, 170+ máximo).

3. HUMOR: Nota 0-10, responda de forma empática.

4. BASAL: Se o usuário informar sua taxa metabólica basal (ex: "minha basal é 2200"), registre e confirme.

5. A CADA MENSAGEM que registre algo, calcule e inclua um SCORE PARCIAL atualizado usando os critérios abaixo.

6. FINALIZAR DIA: Crie resumo completo com score FINAL fechado. Use o déficit real (Basal + Treino − Ingerido) para avaliar.

CRITÉRIOS DO SCORE (0 a 10):
- Déficit real moderado (300-600kcal): +3pts. Déficit >800kcal: +2pts. Sem déficit (superávit): 0pts nesse critério.
- Treino realizado: +3pts. Musculação/força: +0.5 bônus. Sem treino: 0.
- Qualidade pelo BPM (zona certa): até +1pt.
- Humor: nota/10 × 2pts (máx 2pts).
- Proteína mencionada (frango, ovo, carne, peixe, whey etc): +1pt.
- Ultraprocessados/fast-food: -0.5pt cada.
- Mínimo 0, máximo 10.

TAGS obrigatórias ao final de cada resposta relevante:
Refeição: [KCAL_IN: número] [REFEICAO: nome resumido]
Treino: [KCAL_OUT: número] [TREINO: nome] [BPM: número]
Humor: [HUMOR: número]
Basal atualizada: [BASAL: número]
Score parcial (em TODA mensagem que registre algo): [SCORE: número com 1 decimal]
Dia finalizado: [FINALIZADO: true]

Português brasileiro. Tom: amigável, direto, motivador.`;

function parseAIResponse(text, state) {
  const ns = { ...state };
  const kcalIn  = text.match(/\[KCAL_IN:\s*(\d+)\]/);
  const refeicao= text.match(/\[REFEICAO:\s*([^\]]+)\]/);
  const kcalOut = text.match(/\[KCAL_OUT:\s*(\d+)\]/);
  const treino  = text.match(/\[TREINO:\s*([^\]]+)\]/);
  const bpm     = text.match(/\[BPM:\s*(\d+)\]/);
  const humor   = text.match(/\[HUMOR:\s*([\d.]+)\]/);
  const score   = text.match(/\[SCORE:\s*([\d.]+)\]/);
  const basal   = text.match(/\[BASAL:\s*(\d+)\]/);
  const fin     = text.match(/\[FINALIZADO:\s*true\]/i);

  if (kcalIn) {
    const val = parseInt(kcalIn[1]);
    ns.kcalIn = (state.kcalIn || 0) + val;
    const name = refeicao ? refeicao[1] : `Refeição ${(state.meals||[]).length+1}`;
    ns.meals = [...(state.meals||[]), { name, kcal: val }];
  }
  if (kcalOut) {
    const val = parseInt(kcalOut[1]);
    ns.kcalOut = (state.kcalOut||0) + val;
    ns.workouts = [...(state.workouts||[]), { type: treino?treino[1]:"Treino", kcal: val, bpm: bpm?bpm[1]:null }];
  }
  if (humor)  ns.humor   = parseFloat(humor[1]);
  if (score)  ns.score   = parseFloat(score[1]);
  if (basal)  ns.basal   = parseInt(basal[1]);
  if (fin)    ns.finalizado = true;

  const clean = text
    .replace(/\[KCAL_IN:\s*\d+\]/g,"").replace(/\[REFEICAO:\s*[^\]]+\]/g,"")
    .replace(/\[KCAL_OUT:\s*\d+\]/g,"").replace(/\[TREINO:\s*[^\]]+\]/g,"")
    .replace(/\[BPM:\s*\d+\]/g,"").replace(/\[HUMOR:\s*[\d.]+\]/g,"")
    .replace(/\[SCORE:\s*[\d.]+\]/g,"").replace(/\[FINALIZADO:\s*true\]/gi,"")
    .replace(/\[BASAL:\s*\d+\]/g,"").trim();

  return { clean, ns };
}

const humorLabels = ["","Péssimo 😞","Muito ruim 😣","Ruim 😕","Abaixo da média 😐","Mediano 😶","Ok 🙂","Bom 😊","Muito bom 😄","Ótimo 🤩","Perfeito! 🔥"];

function scoreColor(s) {
  if (s==null) return "#555";
  if (s>=8) return "#c8ff3e";
  if (s>=6) return "#3ec8ff";
  if (s>=4) return "#ffb347";
  return "#ff6b35";
}
function scoreLabel(s) {
  if (s==null) return "—";
  if (s>=9) return "Dia Perfeito 🔥";
  if (s>=8) return "Excelente 💪";
  if (s>=7) return "Muito Bom ✅";
  if (s>=6) return "Bom 👍";
  if (s>=5) return "Regular 😐";
  if (s>=4) return "Abaixo da média ⚠️";
  return "Precisa melhorar ❌";
}

const EMPTY_DAY = { active:false, dayNum:0, kcalIn:0, kcalOut:0, humor:null, meals:[], workouts:[], score:null, finalizado:false, date:null, basal: DEFAULT_BASAL };
const S_DAY  = "daytrack-current";
const S_LOG  = "daytrack-log";
const S_MSGS = "daytrack-messages";
const S_BASAL= "daytrack-basal";

export default function DayTracker() {
  const WELCOME = { role:"bot", text:"Olá! 👋 Sou seu rastreador diário de saúde.\n\nSeu objetivo: **perder peso e ganhar massa magra** 💪\n\nDiga **\"iniciar o dia\"** para começar. Depois me conte:\n• 🍽️ O que comeu (calcularei as kcal)\n• 💪 Seus treinos (tipo, kcal, bpm)\n• 😊 Sua nota de humor (0 a 10)\n• 🔥 \"minha basal é 2000\" para ajustar sua taxa\n• 📊 \"finalizar o dia\" para fechar com score final" };

  const [messages,   setMessages]   = useState([WELCOME]);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [day,        setDay]        = useState({ ...EMPTY_DAY });
  const [aiHistory,  setAiHistory]  = useState([]);
  const [tab,        setTab]        = useState("chat");
  const [log,        setLog]        = useState([]);
  const [ready,      setReady]      = useState(false);
  const [editingBasal, setEditingBasal] = useState(false);
  const [basalInput,   setBasalInput]   = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        const [rDay, rLog, rMsgs, rBasal] = await Promise.allSettled([
          window.storage.get(S_DAY),
          window.storage.get(S_LOG),
          window.storage.get(S_MSGS),
          window.storage.get(S_BASAL),
        ]);
        let loadedBasal = DEFAULT_BASAL;
        if (rBasal.status==="fulfilled" && rBasal.value?.value) {
          loadedBasal = parseInt(rBasal.value.value);
        }
        if (rDay.status==="fulfilled" && rDay.value?.value) {
          const d = JSON.parse(rDay.value.value);
          // ensure basal is present (migrate old saves)
          if (!d.basal) d.basal = loadedBasal;
          setDay(d);
        } else {
          setDay(prev => ({ ...prev, basal: loadedBasal }));
        }
        if (rLog.status==="fulfilled" && rLog.value?.value) setLog(JSON.parse(rLog.value.value));
        if (rMsgs.status==="fulfilled" && rMsgs.value?.value) {
          const saved = JSON.parse(rMsgs.value.value);
          if (saved?.length > 0) setMessages(saved);
        }
      } catch {}
      setReady(true);
    }
    load();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);

  async function saveDay(d)  { try { await window.storage.set(S_DAY,  JSON.stringify(d)); } catch {} }
  async function saveLog(l)  { try { await window.storage.set(S_LOG,  JSON.stringify(l)); } catch {} }
  async function saveMsgs(m) { try { await window.storage.set(S_MSGS, JSON.stringify(m.slice(-60))); } catch {} }
  async function saveBasal(b){ try { await window.storage.set(S_BASAL, String(b)); } catch {} }

  // Déficit real = basal + queimado - ingerido
  const realDeficit = day.basal + day.kcalOut - day.kcalIn;

  async function applyBasal(val) {
    const num = parseInt(val);
    if (isNaN(num) || num < 500 || num > 6000) return;
    const updated = { ...day, basal: num };
    setDay(updated);
    await saveDay(updated);
    await saveBasal(num);
  }

  async function send(text) {
    const msg = (text||input).trim();
    if (!msg||loading) return;
    setInput("");
    const lower = msg.toLowerCase();
    let cur = { ...day };

    if (lower.includes("iniciar") && lower.includes("dia")) {
      cur = { ...EMPTY_DAY, active:true, dayNum:day.dayNum+1, date:new Date().toLocaleDateString("pt-BR"), basal: day.basal };
      setDay(cur);
      await saveDay(cur);
    }
    const isFinalizing = lower.includes("finalizar") && lower.includes("dia");

    const newMsgs = [...messages, { role:"user", text:msg }];
    setMessages(newMsgs);
    setLoading(true);

    const deficit = cur.basal + cur.kcalOut - cur.kcalIn;
    const ctx = cur.active
      ? `[Dia ${cur.dayNum} | ${cur.date} | Basal: ${cur.basal}kcal | Ingerido: ${cur.kcalIn}kcal | Queimado no treino: ${cur.kcalOut}kcal | Déficit real: ${deficit}kcal (basal+treino-ingerido) | Humor: ${cur.humor!=null?cur.humor+"/10":"—"} | Refeições: ${cur.meals.map(m=>m.name).join(", ")||"nenhuma"} | Treinos: ${cur.workouts.map(w=>w.type).join(", ")||"nenhum"} | Score atual: ${cur.score??"—"}]\n\n${msg}`
      : msg;

    const newAiHist = [...aiHistory, { role:"user", content:ctx }];

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1200, system:SYSTEM_PROMPT, messages:newAiHist })
      });
      const data = await res.json();
      const raw  = data.content.map(c=>c.text||"").join("");
      const { clean, ns } = parseAIResponse(raw, cur);

      setAiHistory([...newAiHist, { role:"assistant", content:raw }]);

      const final = { ...cur, ...ns };

      // If basal was updated via chat, persist it globally too
      if (ns.basal) await saveBasal(ns.basal);

      if (isFinalizing || ns.finalizado) {
        final.active = false;
        final.finalizado = true;
        const realDef = final.basal + final.kcalOut - final.kcalIn;
        const entry = {
          dayNum:final.dayNum, date:final.date,
          kcalIn:final.kcalIn, kcalOut:final.kcalOut,
          basal:final.basal, deficit: realDef,
          humor:final.humor, score:final.score,
          workouts:final.workouts, meals:final.meals
        };
        const updatedLog = [...log, entry];
        setLog(updatedLog);
        await saveLog(updatedLog);
      }

      setDay(final);
      await saveDay(final);

      const updatedMsgs = [...newMsgs, { role:"bot", text:clean }];
      setMessages(updatedMsgs);
      await saveMsgs(updatedMsgs);

    } catch {
      const errMsgs = [...newMsgs, { role:"bot", text:"Erro ao conectar. Tente novamente." }];
      setMessages(errMsgs);
    }
    setLoading(false);
  }

  function renderText(t) {
    return t.split("\n").map((line,i,arr) => (
      <span key={i}>
        {line.split(/(\*\*[^*]+\*\*)/).map((p,j) =>
          p.startsWith("**") ? <strong key={j}>{p.slice(2,-2)}</strong> : p
        )}
        {i<arr.length-1 && <br/>}
      </span>
    ));
  }

  const avgScore = log.length>0
    ? (log.reduce((s,d)=>s+(d.score||0),0)/log.length).toFixed(1) : null;

  if (!ready) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#0c0c14", color:"#555", fontFamily:"system-ui" }}>
      Carregando seus dados...
    </div>
  );

  // Stats bar items — 6 columns now
  const statsItems = [
    { label:"Basal", val: day.basal, unit:"kcal", color:"#a78bfa", editable:true },
    { label:"Ingerido", val: day.kcalIn, unit:"kcal", color:"#c8ff3e" },
    { label:"Queimado", val: day.kcalOut, unit:"kcal", color:"#ff6b35" },
    { label: realDeficit>=0 ? "Déficit Real" : "Superávit", val: Math.abs(realDeficit), unit:"kcal", color: realDeficit>=0 ? "#c8ff3e" : "#ff6b35" },
    { label:"Humor", val: day.humor!=null?day.humor:"—", unit:"/10", color:"#3ec8ff" },
    { label: day.finalizado?"Score Final ✓":"Score Parcial", val: day.score!=null?day.score:"—", unit:"/10", color:scoreColor(day.score) },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"#0c0c14", color:"#e2e2f0", fontFamily:"'Segoe UI',system-ui,sans-serif", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 20px", borderBottom:"1px solid #1e1e2e", background:"#10101c", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20, fontWeight:800, letterSpacing:2, color:"#c8ff3e" }}>DAYTRACK</span>
          <span style={{ fontSize:11, padding:"2px 8px", borderRadius:20, background:day.active?"rgba(200,255,62,0.15)":"rgba(255,255,255,0.06)", color:day.active?"#c8ff3e":"#666", border:`1px solid ${day.active?"rgba(200,255,62,0.3)":"#222"}`, fontWeight:600 }}>
            {day.active?`● Dia ${day.dayNum}`:day.finalizado?`✓ Dia ${day.dayNum} finalizado`:"● Inativo"}
          </span>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {["chat","dados","histórico"].map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{ padding:"5px 12px", borderRadius:8, border:"none", cursor:"pointer", background:tab===t?"#c8ff3e":"transparent", color:tab===t?"#000":"#666", fontWeight:600, fontSize:11, textTransform:"uppercase", letterSpacing:1, fontFamily:"inherit" }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Stats bar — 6 columns */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", borderBottom:"1px solid #1e1e2e", flexShrink:0 }}>
        {statsItems.map((s,i) => (
          <div key={i} style={{ padding:"7px 10px", borderRight:i<5?"1px solid #1e1e2e":"none", position:"relative" }}>
            <div style={{ fontSize:9, letterSpacing:1.5, textTransform:"uppercase", color:"#555", marginBottom:2, display:"flex", alignItems:"center", gap:4 }}>
              {s.label}
              {s.editable && <span onClick={()=>{ setEditingBasal(true); setBasalInput(String(day.basal)); }} style={{ cursor:"pointer", color:"#a78bfa", fontSize:10, lineHeight:1 }} title="Editar basal">✎</span>}
            </div>
            {s.editable && editingBasal ? (
              <input
                autoFocus
                value={basalInput}
                onChange={e=>setBasalInput(e.target.value)}
                onBlur={async()=>{ await applyBasal(basalInput); setEditingBasal(false); }}
                onKeyDown={async e=>{ if(e.key==="Enter"){ await applyBasal(basalInput); setEditingBasal(false); } if(e.key==="Escape") setEditingBasal(false); }}
                style={{ width:"100%", background:"transparent", border:"none", borderBottom:"1px solid #a78bfa", color:"#a78bfa", fontSize:20, fontWeight:800, outline:"none", fontFamily:"inherit", padding:"0" }}
              />
            ) : (
              <div style={{ fontSize:20, fontWeight:800, color:s.color, lineHeight:1, cursor:s.editable?"pointer":"default" }}
                onClick={()=>{ if(s.editable){ setEditingBasal(true); setBasalInput(String(day.basal)); } }}>
                {s.val}
              </div>
            )}
            <div style={{ fontSize:10, color:"#444" }}>{s.unit}</div>
          </div>
        ))}
      </div>

      {/* CHAT TAB */}
      {tab==="chat" && <>
        <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 0", display:"flex", flexDirection:"column", gap:12 }}>
          {messages.map((m,i) => (
            <div key={i} style={{ display:"flex", gap:10, maxWidth:"88%", alignSelf:m.role==="user"?"flex-end":"flex-start", flexDirection:m.role==="user"?"row-reverse":"row" }}>
              <div style={{ width:30, height:30, borderRadius:8, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, background:m.role==="user"?"#c8ff3e":"#1a1a28", color:m.role==="user"?"#000":"#c8ff3e", border:m.role==="bot"?"1px solid #2a2a3e":"none" }}>{m.role==="user"?"EU":"AI"}</div>
              <div style={{ padding:"10px 14px", fontSize:13.5, lineHeight:1.65, background:m.role==="user"?"#c8ff3e":"#161622", color:m.role==="user"?"#000":"#e2e2f0", border:m.role==="bot"?"1px solid #2a2a3e":"none", borderRadius:m.role==="user"?"12px 2px 12px 12px":"2px 12px 12px 12px", fontWeight:m.role==="user"?600:400 }}>
                {renderText(m.text)}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display:"flex", gap:10, alignSelf:"flex-start" }}>
              <div style={{ width:30, height:30, borderRadius:8, background:"#1a1a28", border:"1px solid #2a2a3e", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, color:"#c8ff3e" }}>AI</div>
              <div style={{ padding:"12px 16px", borderRadius:"2px 12px 12px 12px", background:"#161622", border:"1px solid #2a2a3e", display:"flex", gap:5, alignItems:"center" }}>
                {[0,0.2,0.4].map((d,i)=><span key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#c8ff3e", display:"inline-block", animation:`bounce 1.1s ${d}s infinite` }}/>)}
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        <div style={{ padding:"12px 16px", borderTop:"1px solid #1e1e2e", background:"#10101c", flexShrink:0 }}>
          <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap" }}>
            {["iniciar o dia","finalizar o dia","Como está meu dia?"].map(b=>(
              <button key={b} onClick={()=>send(b)} disabled={loading} style={{ padding:"4px 12px", borderRadius:20, border:"1px solid #2a2a3e", background:"transparent", color:"#666", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}
                onMouseEnter={e=>{e.target.style.borderColor="#c8ff3e";e.target.style.color="#c8ff3e";}}
                onMouseLeave={e=>{e.target.style.borderColor="#2a2a3e";e.target.style.color="#666";}}
              >{b}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <textarea value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
              placeholder="Ex: comi arroz e frango / treino de corrida 350kcal bpm 155 / minha basal é 2200..."
              rows={1} style={{ flex:1, background:"#161622", border:"1px solid #2a2a3e", borderRadius:10, padding:"10px 14px", color:"#e2e2f0", fontSize:13.5, outline:"none", resize:"none", fontFamily:"inherit", minHeight:42, maxHeight:110 }}
              onFocus={e=>e.target.style.borderColor="#c8ff3e"}
              onBlur={e=>e.target.style.borderColor="#2a2a3e"}
            />
            <button onClick={()=>send()} disabled={loading||!input.trim()} style={{ width:42, height:42, borderRadius:10, border:"none", background:loading||!input.trim()?"#1e1e2e":"#c8ff3e", color:loading||!input.trim()?"#444":"#000", fontSize:16, cursor:loading||!input.trim()?"not-allowed":"pointer", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>➤</button>
          </div>
        </div>
      </>}

      {/* DADOS TAB */}
      {tab==="dados" && (
        <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:14 }}>
          <Section title="🍽️ Refeições">
            {day.meals.length===0?<Empty>Nenhuma refeição registrada ainda</Empty>
              :day.meals.map((m,i)=><Row key={i} left={m.name} right={`+${m.kcal} kcal`} color="#c8ff3e"/>)}
            {day.meals.length>0&&<div style={{ borderTop:"1px solid #2a2a3e", paddingTop:8, marginTop:4, display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:700 }}><span style={{color:"#888"}}>Total</span><span style={{color:"#c8ff3e"}}>{day.kcalIn} kcal</span></div>}
          </Section>

          <Section title="💪 Treinos">
            {day.workouts.length===0?<Empty>Nenhum treino registrado ainda</Empty>
              :day.workouts.map((w,i)=>(
                <div key={i} style={{ background:"#161622", border:"1px solid #2a2a3e", borderRadius:8, padding:"10px 12px", marginBottom:8 }}>
                  <div style={{ fontWeight:700, color:"#ff6b35", fontSize:13, marginBottom:4 }}>{w.type}</div>
                  <div style={{ display:"flex", gap:14, fontSize:12, color:"#888" }}>
                    <span>🔥 {w.kcal} kcal</span>{w.bpm&&<span>❤️ {w.bpm} bpm</span>}
                  </div>
                </div>
              ))}
          </Section>

          <Section title="😊 Humor">
            {day.humor==null?<Empty>Nota de humor não registrada</Empty>:(
              <div style={{ textAlign:"center", padding:"8px 0" }}>
                <div style={{ fontSize:52, fontWeight:900, color:day.humor>=7?"#c8ff3e":day.humor>=4?"#3ec8ff":"#ff6b35" }}>{day.humor}</div>
                <div style={{ fontSize:12, color:"#888", marginTop:2 }}>{humorLabels[Math.round(day.humor)]}</div>
                <div style={{ height:4, background:"#1e1e2e", borderRadius:2, margin:"10px 0 0", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${day.humor*10}%`, background:"linear-gradient(90deg,#ff6b35,#c8ff3e)", borderRadius:2 }}/>
                </div>
              </div>
            )}
          </Section>

          <Section title="⚖️ Balanço Calórico Real">
            <Row left="Basal (gasto em repouso)" right={`${day.basal} kcal`} color="#a78bfa"/>
            <Row left="Queimado no treino" right={`+${day.kcalOut} kcal`} color="#ff6b35"/>
            <Row left="Gasto total" right={`${day.basal + day.kcalOut} kcal`} color="#e2e2f0"/>
            <Row left="Ingerido" right={`${day.kcalIn} kcal`} color="#c8ff3e"/>
            <div style={{ borderTop:"1px solid #2a2a3e", paddingTop:8, marginTop:4, display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:700 }}>
              <span style={{color:"#888"}}>{realDeficit>=0?"Déficit real":"Superávit"}</span>
              <span style={{color:realDeficit>=0?"#c8ff3e":"#ff6b35"}}>{Math.abs(realDeficit)} kcal</span>
            </div>
          </Section>

          {day.score!=null&&(
            <Section title={day.finalizado?"⭐ Score Final":"⭐ Score Parcial (em andamento)"}>
              <div style={{ textAlign:"center", padding:"12px 0" }}>
                <div style={{ fontSize:76, fontWeight:900, color:scoreColor(day.score), lineHeight:1 }}>{day.score}</div>
                <div style={{ fontSize:15, fontWeight:700, color:scoreColor(day.score), marginTop:8 }}>{scoreLabel(day.score)}</div>
                {!day.finalizado&&<div style={{ fontSize:11, color:"#555", marginTop:4 }}>atualizado a cada registro — fecha ao finalizar o dia</div>}
                <div style={{ height:6, background:"#1e1e2e", borderRadius:3, margin:"12px 0 6px", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${day.score*10}%`, background:`linear-gradient(90deg,#ff6b35,${scoreColor(day.score)})`, borderRadius:3, transition:"width 0.6s" }}/>
                </div>
                <div style={{ fontSize:11, color:"#444" }}>objetivo: perder peso + ganhar massa magra</div>
              </div>
            </Section>
          )}
        </div>
      )}

      {/* HISTÓRICO TAB */}
      {tab==="histórico" && (
        <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:14 }}>
          {log.length===0?(
            <div style={{ textAlign:"center", padding:"50px 20px" }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
              <div style={{ color:"#555", fontSize:14 }}>Nenhum dia finalizado ainda.</div>
              <div style={{ color:"#3a3a50", fontSize:12, marginTop:6 }}>Dias finalizados aparecem aqui e ficam salvos permanentemente.</div>
            </div>
          ):<>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              {[
                { label:"Dias registrados", val:log.length, color:"#3ec8ff" },
                { label:"Score médio", val:avgScore?`${avgScore}/10`:"—", color:scoreColor(parseFloat(avgScore)) },
                { label:"Treinos realizados", val:log.reduce((s,d)=>s+d.workouts.length,0), color:"#ff6b35" }
              ].map((c,i)=>(
                <div key={i} style={{ background:"#10101c", border:"1px solid #1e1e2e", borderRadius:10, padding:"12px", textAlign:"center" }}>
                  <div style={{ fontSize:9, letterSpacing:2, textTransform:"uppercase", color:"#555", marginBottom:6 }}>{c.label}</div>
                  <div style={{ fontSize:24, fontWeight:800, color:c.color }}>{c.val}</div>
                </div>
              ))}
            </div>

            {[...log].reverse().map((d,i)=>(
              <div key={i} style={{ background:"#10101c", border:"1px solid #1e1e2e", borderRadius:12, padding:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14 }}>Dia {d.dayNum}</div>
                    <div style={{ fontSize:11, color:"#555" }}>{d.date}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:30, fontWeight:900, color:scoreColor(d.score), lineHeight:1 }}>{d.score??"—"}</div>
                    <div style={{ fontSize:10, color:scoreColor(d.score) }}>{scoreLabel(d.score)}</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                  {[
                    { l:"Ingerido",  v:d.kcalIn,           u:"kcal", c:"#c8ff3e" },
                    { l:"Queimado",  v:d.kcalOut,          u:"kcal", c:"#ff6b35" },
                    { l:d.deficit>=0?"Déficit":"Superáv.", v:Math.abs(d.deficit), u:"kcal", c:d.deficit>=0?"#c8ff3e":"#ff6b35" },
                    { l:"Humor",     v:d.humor!=null?d.humor:"—", u:"/10", c:"#3ec8ff" }
                  ].map((s,j)=>(
                    <div key={j} style={{ background:"#161622", borderRadius:8, padding:"8px 10px" }}>
                      <div style={{ fontSize:9, color:"#555", textTransform:"uppercase", letterSpacing:1 }}>{s.l}</div>
                      <div style={{ fontSize:16, fontWeight:800, color:s.c }}>{s.v}</div>
                      <div style={{ fontSize:9, color:"#444" }}>{s.u}</div>
                    </div>
                  ))}
                </div>
                {d.workouts.length>0&&<div style={{ marginTop:8, fontSize:11, color:"#555" }}>💪 {d.workouts.map(w=>w.type).join(" · ")}</div>}
                <div style={{ height:3, background:"#1a1a28", borderRadius:2, marginTop:10, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${(d.score||0)*10}%`, background:`linear-gradient(90deg,#ff6b35,${scoreColor(d.score)})`, borderRadius:2 }}/>
                </div>
              </div>
            ))}

            <button onClick={async()=>{
              if(!confirm("Apagar todo o histórico?")) return;
              try { await window.storage.delete(S_LOG); } catch {}
              setLog([]);
            }} style={{ padding:"8px", borderRadius:8, border:"1px solid #2a2a3e", background:"transparent", color:"#444", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>🗑️ Limpar histórico</button>
          </>}
        </div>
      )}

      <style>{`
        @keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:0.5;}30%{transform:translateY(-5px);opacity:1;}}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px;}
        textarea{scrollbar-width:thin;scrollbar-color:#2a2a3e transparent;}
      `}</style>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background:"#10101c", border:"1px solid #1e1e2e", borderRadius:12, padding:16 }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"#555", marginBottom:12 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ left, right, color }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid #1a1a28", fontSize:13 }}>
      <span style={{color:"#aaa"}}>{left}</span>
      <span style={{color:color||"#e2e2f0", fontWeight:600, fontFamily:"monospace"}}>{right}</span>
    </div>
  );
}
function Empty({ children }) {
  return <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:"12px 0" }}>{children}</div>;
}
