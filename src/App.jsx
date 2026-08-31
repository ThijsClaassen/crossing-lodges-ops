import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { sb, LOCATIONS, LOC_COLORS } from "./sb.js";
import { subscribe as subscribeOffline, listRejected, retryRejected, discardEntry, syncNow } from "./offline.js";
import { supabase } from "./supabaseClient.js";
import { T, css } from "./theme.js";
import { LOGO_DATA } from "./logo.js";
import Login from "./Login.jsx";
import SetPassword from "./SetPassword.jsx";
import { CompanyProvider, useCompany } from "./CompanyContext.jsx";
import { transferEffect, transferEffectAsOf, incomingTransfers, outstandingSent, daysInTransit } from "./transferEngine.js";
import { uploadPurchaseSlip, getSlipUrl } from "./slipUpload.js";
import { listMembers as listBillingMembers, logMemberPurchase } from "./memberPurchase.js";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtR = n => `R ${Number(n).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtL = n => `${Number(n).toLocaleString()} L`;
const fmtNum = n => Number(n || 0).toLocaleString("en-ZA", { maximumFractionDigits: 0 });
// This app's today() returns DD/MM/YYYY, which the older fuel screens store
// as text via DateField. vehicle_trips.trip_date is a real Postgres `date`
// column, and a native <input type="date"> only accepts ISO — so it needs its
// own helper rather than reusing today().
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid   = () => crypto.randomUUID();
const round2 = n => Math.round((Number(n)||0)*100)/100;

// Date helpers — app stores DD/MM/YYYY, HTML date input needs YYYY-MM-DD
const toISO   = (dmy) => {
  if (!dmy) return "";
  const [dd,mm,yyyy] = dmy.split("/");
  return `${yyyy}-${mm}-${dd}`;
};
const fromISO = (iso) => {
  if (!iso) return "";
  const [yyyy,mm,dd] = iso.split("-");
  return `${dd}/${mm}/${yyyy}`;
};
const today = () => {
  const d = new Date();
  const dd   = String(d.getDate()).padStart(2,"0");
  const mm   = String(d.getMonth()+1).padStart(2,"0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

// ─── SLIP SCANNING / ATTACHING (2026-08-12) ─────────────────────────────────
// Shrinks a photo before it's sent anywhere — keeps requests well under
// Vercel's serverless body-size limit and speeds up the AI read, without
// losing the legibility a slip actually needs.
async function resizeImageFile(file, maxDim=1800, quality=0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim/Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width*scale), h = Math.round(bitmap.height*scale);
  const canvas = document.createElement("canvas");
  canvas.width=w; canvas.height=h;
  canvas.getContext("2d").drawImage(bitmap,0,0,w,h);
  return new Promise(resolve=>canvas.toBlob(blob=>resolve(blob),"image/jpeg",quality));
}
function blobToBase64(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(",")[1]||"");
    reader.onerror=reject;
    reader.readAsDataURL(blob);
  });
}

// One button used across Diesel Deliveries, Petrol Purchases, and Repairs —
// deliberately does both jobs at once rather than offering separate "scan"
// and "manually attach" buttons: the photo is uploaded and linked (the part
// that actually matters for the 7-year compliance record) BEFORE the OCR
// read is even attempted, so a slip the AI can't read still gets saved —
// the person just fills in the fields by hand instead of them being
// pre-filled. onResult({slipId, ocr}) — ocr is null if the read failed.
function ScanSlipButton({ companyId, locId, onResult, label="Scan / attach slip" }) {
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState("");
  const fileRef=useRef(null);
  const handleFile=async e=>{
    const file=e.target.files?.[0]; e.target.value="";
    if(!file)return;
    setNote(""); setBusy(true);
    try{
      const resized=await resizeImageFile(file);
      const slip = await uploadPurchaseSlip({companyId, locationId:locId, blob:resized});
      let ocr=null;
      try{
        const base64=await blobToBase64(resized);
        const res=await fetch("/api/parse-slip",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image_base64:base64,media_type:"image/jpeg"})});
        const data=await res.json();
        if(res.ok) ocr=data;
      }catch{ /* OCR failed — the photo is already saved either way */ }
      onResult({ slipId: slip.id, ocr });
      setNote(ocr ? "Slip photo saved and read — check the fields below." : "Slip photo saved. Could not read it automatically — enter the details below by hand.");
    }catch(err){ setNote("Could not save the slip photo: "+err.message); }
    finally{ setBusy(false); }
  };
  return (
    <div style={{marginBottom:12}}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleFile}/>
      <button type="button" className="btn btn-ghost btn-sm" onClick={()=>fileRef.current?.click()} disabled={busy}>{busy?"Reading slip…":label}</button>
      {note && <div style={{fontSize:11,color:T.muted,marginTop:5}}>{note}</div>}
    </div>
  );
}

function ViewSlipLink({ storagePath }) {
  const [loading,setLoading]=useState(false);
  const open=async()=>{
    setLoading(true);
    try{ const url=await getSlipUrl(storagePath); window.open(url,"_blank","noopener"); }
    catch(err){ alert("Could not open the slip: "+err.message); }
    finally{ setLoading(false); }
  };
  return <button className="btn btn-ghost btn-sm" onClick={open} disabled={loading}>{loading?"…":"View slip"}</button>;
}

function AttachSlipButton({ companyId, locId, onAttached, label="Attach slip" }) {
  const [uploading,setUploading]=useState(false);
  const fileRef=useRef(null);
  const handleFile=async e=>{
    const file=e.target.files?.[0]; e.target.value="";
    if(!file)return;
    setUploading(true);
    try{
      const resized=await resizeImageFile(file);
      const slip=await uploadPurchaseSlip({companyId, locationId:locId, blob:resized});
      onAttached(slip);
    }catch(err){ alert("Could not attach the slip: "+err.message); }
    finally{ setUploading(false); }
  };
  return (<>
    <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleFile}/>
    <button type="button" className="btn btn-ghost btn-sm" onClick={()=>fileRef.current?.click()} disabled={uploading}>{uploading?"Uploading…":label}</button>
  </>);
}

// ─── SHARED SMALL COMPONENTS ─────────────────────────────────────────────────
// ─── DATE FIELD ───────────────────────────────────────────────────────────────
// Uses native date picker (opens phone calendar), stores as DD/MM/YYYY
function DateField({ value, onChange }) {
  return (
    <input
      type="date"
      value={toISO(value)}
      onChange={e => onChange(fromISO(e.target.value))}
      style={{
        width:"100%", background:"rgba(0,0,0,.25)",
        border:`1px solid ${T.border}`, borderRadius:6,
        padding:"10px 11px", color:T.cream,
        fontFamily:"'Inter',sans-serif", fontSize:16,
        outline:"none", colorScheme:"dark",
      }}
      onFocus={e=>e.target.style.borderColor=T.gold}
      onBlur={e=>e.target.style.borderColor=T.border}
    />
  );
}

function KPI({ label, value, sub, accent, pct }) {
  return (
    <div className="kpi" style={{"--accent": accent||T.gold}}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {pct !== undefined && (
        <div className="gauge-wrap" style={{marginTop:5}}>
          <div className="gauge-fill" style={{width:`${Math.min(100,Math.max(0,pct))}%`,background:accent||T.gold}}/>
        </div>
      )}
    </div>
  );
}

function LocBadge({ locId }) {
  const loc = LOCATIONS.find(l => l.id === locId);
  return (
    <span className="badge-loc" style={{background:`${LOC_COLORS[locId]}22`,color:LOC_COLORS[locId],border:`1px solid ${LOC_COLORS[locId]}55`}}>
      {loc?.name || locId}
    </span>
  );
}

// ─── STOCK BANNER (reused by both fuel pages) ─────────────────────────────────
function StockBanner({ cards }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(${cards.length},1fr)`,gap:11,marginBottom:22}}>
      {cards.map(k => (
        <div key={k.label} style={{background:T.panel,border:`1px solid ${k.big?k.accent:T.border}`,borderRadius:8,padding:"13px 15px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.accent}}/>
          <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:T.muted,fontWeight:600,marginBottom:5}}>{k.label}</div>
          <div style={{fontSize:k.big?21:17,fontWeight:700,fontFamily:"'Space Mono'",color:k.accent}}>{k.val}</div>
        </div>
      ))}
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ locId, loc, fleet, locData, serviceJobs }) {
  const dieselIssued  = loc.dieselIssues.reduce((s,e)=>s+(e.litres||0),0);
  const petrolIssued  = loc.petrolIssues.reduce((s,e)=>s+Math.abs(e.litres<0?e.litres:0),0);
  const totalRepairs  = loc.repairs.reduce((s,e)=>s+(e.totalCost||0),0);
  const totalParts    = (loc.partIssues||[]).reduce((s,iss)=>{
    const unitCost = loc.parts.find(p=>p.id===iss.partId)?.openCost || 0;
    return s+iss.qty*unitCost;
  },0);
  const locColor = LOC_COLORS[locId];

  return (
    <>
      <FleetAlerts fleet={fleet} locData={locData||{}} serviceJobs={serviceJobs}/>

      <div className="kpi-row">
        <KPI label="Diesel Issued" value={fmtL(dieselIssued)} sub="From bulk tank this month" accent={T.fuel_d} pct={dieselIssued/500*100}/>
        <KPI label="Petrol Issued" value={fmtL(petrolIssued)} sub="From jerrycan stock" accent={T.fuel_p} pct={petrolIssued/100*100}/>
        <KPI label="External Repairs" value={fmtR(totalRepairs)} sub="Workshop invoices" accent={T.ok}/>
        <KPI label="Parts Issued" value={fmtR(totalParts)} sub="At weighted avg cost" accent={T.gold}/>
      </div>
      <div className="section">
        <div className="section-title">Fleet Activity at {LOCATIONS.find(l=>l.id===locId)?.name}</div>
        <div className="vcards">
          {fleet.map(v=>{
            const dIssued = v.fuel==="diesel"
              ? loc.dieselIssues.filter(e=>e.vehicle===v.id).reduce((s,e)=>s+(e.litres||0),0)
              : 0;
            const pIssued = v.fuel==="petrol"
              ? loc.petrolIssues.filter(e=>e.vehicle===v.id).reduce((s,e)=>s+Math.abs(e.litres<0?e.litres:0),0)
              : 0;
            const repCost = loc.repairs.filter(e=>e.vehicle===v.id).reduce((s,e)=>s+(e.totalCost||0),0);
            const active = dIssued>0||pIssued>0||repCost>0;
            return (
              <div key={v.id} className="vcard" style={{opacity:active?1:.5}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:T.cream}}>{v.name}</div>
                    <div style={{fontSize:10,color:T.muted,fontFamily:"'Space Mono'",marginTop:2}}>{v.id}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"flex-end"}}>
                    <span className={`badge badge-${v.fuel==="diesel"?"d":"p"}`}>{v.fuel}</span>
                    <span className={`badge badge-${v.category==="vehicle"?"v":"e"}`}>{v.category}</span>
                  </div>
                </div>
                <div style={{fontSize:11,color:T.muted,lineHeight:1.7}}>
                  {dIssued>0 && <div>Diesel: <span style={{color:T.fuel_d,fontFamily:"'Space Mono'"}}>{fmtL(dIssued)}</span></div>}
                  {pIssued>0 && <div>Petrol: <span style={{color:T.fuel_p,fontFamily:"'Space Mono'"}}>{fmtL(pIssued)}</span></div>}
                  {repCost>0 && <div>Repairs: <span style={{color:T.cream,fontFamily:"'Space Mono'"}}>{fmtR(repCost)}</span></div>}
                  {!active && <div style={{color:T.border}}>No activity this month</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── DIESEL INVENTORY ────────────────────────────────────────────────────────

// Fuel transfers between lodge tanks (diesel or petrol).
//
// Before this existed there was no way to move fuel: diesel issues are tied to
// a vehicle and a mileage reading, so litres pumped for another lodge could
// only be recorded by letting the dip reading absorb them. That converts a
// known, legitimate movement into unexplained VARIANCE — and variance is the
// signal used to detect theft, so the workaround blinded the alarm.
//
// Two-step like stock transfers: litres leave this tank on send, and only
// arrive in the other lodge's tank when someone there confirms. Anything sent
// and never confirmed stays visible as an open transfer.
function FuelTransfers({ domain, locId, companyId, transfers, litresOnHand, onChanged }) {
  const [form, setForm] = useState({ to:"", litres:"", date:todayISO(), notes:"" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState("");
  const [gotQty, setGotQty] = useState({});

  const others   = LOCATIONS.filter(l => l.id !== locId);
  const lodge    = id => LOCATIONS.find(l => l.id === id)?.name || id;
  const incoming = useMemo(()=>incomingTransfers(transfers,{domain,locationId:locId}),[transfers,domain,locId]);
  const awaiting = useMemo(()=>outstandingSent(transfers,{domain,locationId:locId}),[transfers,domain,locId]);

  const litres = parseFloat(form.litres)||0;
  const over   = litres > (litresOnHand||0);

  async function send() {
    if (!form.to || litres<=0) { setMsg("Pick a lodge and a number of litres."); return; }
    setBusy(true); setMsg("");
    try {
      await sb.insert("stock_transfers", {
        id: uid(), company_id: companyId, domain,
        from_location_id: locId, to_location_id: form.to,
        item_id: null, item_name: domain === "diesel" ? "Diesel" : "Petrol",
        qty: litres,
        // Fuel has no weighted average per item, so value is left at zero
        // rather than inventing a price. The litres are what matter for the
        // tank; the rand value already sits in the Cost Summary.
        unit_cost: 0, total_value: 0,
        sent_date: form.date, status: "in_transit", notes: form.notes||null,
      });
      setForm({ to:"", litres:"", date:todayISO(), notes:"" });
      setMsg(`Sent to ${lodge(form.to)} — counts as their fuel only once they confirm.`);
      onChanged?.();
    } catch(e){ setMsg("Could not send: "+e.message); } finally { setBusy(false); }
  }

  async function confirm(t) {
    const raw = gotQty[t.id];
    const got = raw===""||raw===undefined ? Number(t.qty) : Number(raw);
    if (!(got>=0)) { setMsg("Litres received must be zero or more."); return; }
    setBusy(true); setMsg("");
    try {
      await sb.patch("stock_transfers", t.id, { status:"received", received_date:todayISO(), received_qty:got });
      const short = Number(t.qty)-got;
      setMsg(short>0
        ? `Received ${got} of ${t.qty} L. The ${short} L short stays visible as a loss in transit.`
        : "Confirmed — now in this lodge's tank.");
      onChanged?.();
    } catch(e){ setMsg("Could not confirm: "+e.message); } finally { setBusy(false); }
  }

  async function cancel(t) {
    setBusy(true); setMsg("");
    try {
      await sb.patch("stock_transfers", t.id, { status:"cancelled" });
      setMsg("Cancelled — the fuel stays with the sending lodge.");
      onChanged?.();
    } catch(e){ setMsg("Could not cancel: "+e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{marginTop:14}}>
      <div className="card-title">Transfer fuel to another lodge</div>
      <div style={{fontSize:12,color:T.muted,marginBottom:10}}>
        Use this instead of issuing to a vehicle. A transfer never counts as usage and never
        shows up as dip variance — so moving fuel legitimately can't look like a loss.
      </div>
      <div className="grid3">
        <div className="field"><label>To lodge</label>
          <select value={form.to} onChange={e=>setForm(f=>({...f,to:e.target.value}))}>
            <option value="">Select lodge…</option>
            {others.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Litres</label>
          <input type="number" inputMode="decimal" value={form.litres}
            onChange={e=>setForm(f=>({...f,litres:e.target.value}))}/>
          <div style={{fontSize:11,color:over?T.danger:T.muted,marginTop:3}}>
            {over ? `Only ${fmtL(litresOnHand)} expected in this tank` : `${fmtL(litresOnHand)} expected in this tank`}
          </div>
        </div>
        <div className="field"><label>Date sent</label>
          <DateField value={form.date} onChange={v=>setForm(f=>({...f,date:v}))}/>
        </div>
      </div>
      <div className="field"><label>Notes</label>
        <input type="text" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
          placeholder="e.g. drums on the Hilux"/>
      </div>
      <button className="btn btn-primary" onClick={send} disabled={busy}>{busy?"Saving…":"Send fuel"}</button>
      {msg && <div style={{fontSize:12,marginTop:8}}>{msg}</div>}

      {incoming.length>0 && (
        <>
          <div className="card-title" style={{marginTop:16}}>Incoming — confirm what arrived ({incoming.length})</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Sent</th><th>From</th><th className="num">Sent L</th><th className="num">Received L</th><th></th></tr></thead>
            <tbody>
              {incoming.map(t=>{
                const d = daysInTransit(t);
                return (
                  <tr key={t.id}>
                    <td className="mono" style={{fontSize:12}}>{t.sent_date}
                      {d>3 && <div style={{fontSize:10,color:T.danger}}>{d} days ago</div>}</td>
                    <td>{lodge(t.from_location_id)}</td>
                    <td className="num">{fmtL(t.qty)}</td>
                    <td className="num">
                      <input type="number" inputMode="decimal" placeholder={String(t.qty)}
                        value={gotQty[t.id] ?? ""} style={{width:90}}
                        onChange={e=>setGotQty(m=>({...m,[t.id]:e.target.value}))}/>
                    </td>
                    <td>
                      <button className="btn btn-primary btn-sm" onClick={()=>confirm(t)} disabled={busy}>Confirm</button>{" "}
                      <button className="btn btn-ghost btn-sm" onClick={()=>cancel(t)} disabled={busy}>Never sent</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </>
      )}

      {awaiting.length>0 && (
        <>
          <div className="card-title" style={{marginTop:16}}>Sent, not yet confirmed ({awaiting.length})</div>
          <div style={{fontSize:12,color:T.muted,marginBottom:6}}>
            Already out of this tank. Anything here for more than a few days left and nobody
            has said it arrived.
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Sent</th><th>To</th><th className="num">Litres</th><th className="num">Waiting</th></tr></thead>
            <tbody>
              {awaiting.map(t=>{
                const d = daysInTransit(t);
                return (
                  <tr key={t.id}>
                    <td className="mono" style={{fontSize:12}}>{t.sent_date}</td>
                    <td>{lodge(t.to_location_id)}</td>
                    <td className="num">{fmtL(t.qty)}</td>
                    <td className="num" style={{color:d>3?T.danger:T.muted}}>{d} day{d===1?"":"s"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

function DieselInventory({ locId, loc, setLoc, fleet, isAdmin, companyId, slips, onSlipAttached, transfers, onTransfersChanged }) {
  const [tab, setTab]             = useState("issues");
  const [showDelivery, setShowDelivery] = useState(false);
  const [showIssue,    setShowIssue]    = useState(false);
  const [showDip,      setShowDip]      = useState(false);
  const [dForm, setDForm] = useState({date:today(),litres:"",pricePerLitre:"",supplier:"",invoiceNo:"",notes:"",slipId:null});
  const [iForm, setIForm] = useState({date:today(),open:"",close:"",litres:"",vehicle:"",mileage:"",notes:""});
  const [dipForm,setDipForm]=useState({date:today(),litres:"",notes:""});

  const { dieselDeliveries:deliveries, dieselIssues:issues, dieselDips:dips, dieselOpening:opening } = loc;
  const supplierOptions = useMemo(
    ()=>[...new Set((deliveries||[]).map(d=>d.supplier).filter(Boolean))].sort(),[deliveries]);
  const upd = patch => setLoc(l=>({...l,...patch}));

  const totalDelivered = deliveries.reduce((s,d)=>s+(d.litres||0),0);
  const totalIssued    = issues.reduce((s,i)=>s+(i.litres||0),0);
  // Fuel moved to or from another lodge's tank. THIS IS THE WHOLE POINT of
  // fuel transfers: without it, litres pumped into a bakkie for the other
  // lodge could only be recorded by letting the dip absorb them — turning a
  // known movement into unexplained variance, which is exactly the signal
  // used to spot theft.
  const tx             = transferEffect(transfers, { domain: "diesel", locationId: locId });
  const theoretical    = (opening||0)+totalDelivered-totalIssued+tx.netUnits;

  // Theoretical stock AS AT a past date, for the dip history table.
  //
  // Every row used to be compared against TODAY's theoretical, so a dip taken
  // in June was scored against September's stock and its "variance" was
  // meaningless — only the newest row was ever trustworthy. Each dip is now
  // measured against what the tank should have held on the day it was dipped,
  // which is the only comparison that says anything about that day.
  const theoreticalAsOf = useCallback((iso) => {
    const upto = (rows, pick) => (rows||[])
      .filter(r => String(r.date||"") <= String(iso))
      .reduce((sum, r) => sum + (Number(pick(r))||0), 0);
    const t = transferEffectAsOf(transfers, { domain:"diesel", locationId:locId, asOf:iso });
    return (opening||0) + upto(deliveries, d=>d.litres) - upto(issues, i=>i.litres) + t.netUnits;
  }, [deliveries, issues, transfers, locId, opening]);
  // "Last dip" means the most recent BY DATE, which is not the last element of
  // this array. sb.select appends `order=created_at.desc`, so `dips` arrives
  // NEWEST FIRST — `dips[dips.length-1]` was therefore returning the very first
  // dip ever recorded, and it never changed no matter how many were added.
  // (The Finance Dashboard's Manager Overview sorted by date before taking the
  // last one, so it showed the right figure while this screen showed the wrong
  // one — worth knowing if the two ever disagree again.)
  //
  // Sorting by date rather than by insertion order also handles a dip that gets
  // captured a day or two late: what matters is when the tank was measured, not
  // when someone typed it in. Array.sort is stable, so dips sharing a date keep
  // their created_at.desc order and the most recently entered one wins.
  const dipsNewestFirst = useMemo(
    ()=>[...dips].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))),[dips]);
  const latestDip      = dipsNewestFirst[0] || null;
  const lastDip        = latestDip ? latestDip.litres : null;
  const variance       = lastDip!==null?lastDip-theoretical:null;
  const varOk          = variance!==null&&Math.abs(variance)<50;
  const totalSpend     = deliveries.reduce((s,d)=>s+(d.litres||0)*(d.pricePerLitre||0),0);
  const wavg           = totalDelivered>0?totalSpend/totalDelivered:0;

  const byVehicle = useMemo(()=>{
    const m={};
    issues.forEach(i=>{if(!i.vehicle)return;m[i.vehicle]=(m[i.vehicle]||0)+(i.litres||0);});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  },[issues]);

  const dieselFleet = fleet.filter(v=>v.fuel==="diesel");

  const addDelivery=()=>{
    upd({dieselDeliveries:[...deliveries,{...dForm,id:uid(),litres:parseFloat(dForm.litres)||0,pricePerLitre:parseFloat(dForm.pricePerLitre)||0}]});
    setDForm({date:today(),litres:"",pricePerLitre:"",supplier:"",invoiceNo:"",notes:"",slipId:null});setShowDelivery(false);
  };
  const addIssue=()=>{
    const lit=parseFloat(iForm.litres)||((parseFloat(iForm.close)||0)-(parseFloat(iForm.open)||0));
    upd({dieselIssues:[...issues,{...iForm,id:uid(),litres:lit,open:parseFloat(iForm.open)||0,close:parseFloat(iForm.close)||0}]});
    setIForm({date:today(),open:"",close:"",litres:"",vehicle:"",mileage:"",notes:""});setShowIssue(false);
  };
  const addDip=()=>{
    upd({dieselDips:[...dips,{...dipForm,id:uid(),litres:parseFloat(dipForm.litres)||0}]});
    setDipForm({date:today(),litres:"",notes:""});setShowDip(false);
  };

  const VariancePill=()=>{
    if(variance===null)return null;
    return(
      <div style={{display:"inline-flex",alignItems:"center",gap:8,background:varOk?"rgba(90,155,106,.14)":"rgba(192,80,80,.14)",border:`1px solid ${varOk?T.ok:T.danger}`,borderRadius:6,padding:"7px 13px",marginBottom:16}}>
        <span style={{fontSize:17}}>{varOk?"OK":"!"}</span>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:varOk?T.ok:T.danger}}>Variance: {variance>0?"+":""}{variance.toFixed(0)} L</div>
          <div style={{fontSize:11,color:T.muted}}>{varOk?"Within acceptable range":"Investigate — possible unlogged draw or meter drift"}</div>
        </div>
      </div>
    );
  };

  return(
    <>
      <StockBanner cards={[
        {label:"Opening Stock",val:fmtL(opening||0),accent:T.muted},
        {label:"Deliveries In",val:fmtL(totalDelivered),accent:T.ok},
        {label:"Issued (Meter)",val:fmtL(totalIssued),accent:T.fuel_d},
        {label:"Theoretical Stock",val:fmtL(Math.max(0,theoretical)),accent:T.gold,big:true},
        {label:lastDip!==null?"Last Dip":"No Dip Yet",val:lastDip!==null?fmtL(lastDip):"—",accent:varOk?T.ok:variance!==null?T.danger:T.muted},
      ]}/>
      <div className="tabs">
        {(isAdmin
          ? [{id:"issues",label:"Issues (Meter)"},{id:"deliveries",label:"Deliveries"},{id:"stock",label:"Stock Position"},{id:"dips",label:"Dip Checks"}]
          : [{id:"issues",label:"Issues (Meter)"},{id:"dips",label:"Dip Checks"}]
        ).map(t=>(
          <button key={t.id} className={`tab${tab===t.id?" active":""}`} onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ISSUES */}
      {tab==="issues"&&(
        <>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
            <button className="btn btn-primary" onClick={()=>setShowIssue(true)}>+ Log Issue</button>
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th>Open Meter</th><th>Close Meter</th><th className="num">Litres</th><th>Vehicle</th><th>Mileage</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {issues.map(i=>(
                <tr key={i.id}>
                  <td className="mono" style={{fontSize:12}}>{i.date}</td>
                  <td className="num mono">{i.open}</td>
                  <td className="num mono">{i.close}</td>
                  <td className="num" style={{color:T.fuel_d,fontWeight:700}}>{i.litres}</td>
                  <td>{i.vehicle?<span className="badge badge-d">{i.vehicle}</span>:<span style={{color:T.muted,fontSize:11}}>Unallocated</span>}</td>
                  <td className="mono" style={{fontSize:11,color:T.muted}}>{i.mileage||"—"}</td>
                  <td style={{fontSize:12,color:T.muted}}>{i.notes}</td>
                  <td>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>upd({dieselIssues:issues.filter(x=>x.id!==i.id)})}>x</button>}</td>
                </tr>
              ))}
              {issues.length===0&&<tr><td colSpan={8} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No issues logged yet</td></tr>}
            </tbody>
          </table></div>
          {issues.length>0&&<div style={{marginTop:10,padding:"8px 13px",background:"rgba(74,124,181,.08)",border:`1px solid rgba(74,124,181,.25)`,borderRadius:6}}>
            <span style={{fontSize:11,color:T.muted}}>Total issued via meter: </span>
            <strong style={{fontFamily:"'Space Mono'",color:T.fuel_d}}>{fmtL(totalIssued)}</strong>
          </div>}
        </>
      )}

      {/* DELIVERIES */}
      {tab==="deliveries"&&isAdmin&&(
        <>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
            <button className="btn btn-primary" onClick={()=>setShowDelivery(true)}>+ Log Delivery</button>
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th className="num">Litres</th><th className="num">Price/L</th><th className="num">Total</th><th>Supplier</th><th>Invoice</th><th>Notes</th><th>Slip</th><th></th></tr></thead>
            <tbody>
              {deliveries.map(d=>(
                <tr key={d.id}>
                  <td className="mono" style={{fontSize:12}}>{d.date}</td>
                  <td className="num ok" style={{fontWeight:700}}>{fmtL(d.litres)}</td>
                  <td className="num">R {parseFloat(d.pricePerLitre||0).toFixed(2)}</td>
                  <td className="num">{fmtR((d.litres||0)*(d.pricePerLitre||0))}</td>
                  <td style={{fontSize:12}}>{d.supplier||<span style={{color:T.muted}}>—</span>}</td>
                  <td>{d.invoiceNo?<span className="badge badge-v">#{d.invoiceNo}</span>:<span style={{color:T.muted}}>—</span>}</td>
                  <td style={{fontSize:12,color:T.muted}}>{d.notes}</td>
                  <td>
                    {d.slipId && slips[d.slipId] ? <ViewSlipLink storagePath={slips[d.slipId].storage_path}/>
                      : <AttachSlipButton companyId={companyId} locId={locId}
                          onAttached={(slip)=>{onSlipAttached(slip); sb.patch("diesel_deliveries",d.id,{slip_id:slip.id}).catch(e=>alert("Saved photo but could not link it: "+e.message)); upd({dieselDeliveries:deliveries.map(x=>x.id===d.id?{...x,slipId:slip.id}:x)});}}/>}
                  </td>
                  <td><button className="btn btn-danger btn-sm" onClick={()=>upd({dieselDeliveries:deliveries.filter(x=>x.id!==d.id)})}>x</button></td>
                </tr>
              ))}
              {deliveries.length===0&&<tr><td colSpan={9} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No deliveries recorded yet</td></tr>}
            </tbody>
          </table></div>
          {deliveries.length>0&&<div style={{marginTop:10,padding:"8px 13px",background:"rgba(90,155,106,.08)",border:`1px solid rgba(90,155,106,.25)`,borderRadius:6,display:"flex",gap:24}}>
            <div><span style={{fontSize:11,color:T.muted}}>Total: </span><strong style={{fontFamily:"'Space Mono'",color:T.ok}}>{fmtL(totalDelivered)}</strong></div>
            <div><span style={{fontSize:11,color:T.muted}}>Spend: </span><strong style={{fontFamily:"'Space Mono'",color:T.ok}}>{fmtR(totalSpend)}</strong></div>
            <div><span style={{fontSize:11,color:T.muted}}>Avg: </span><strong style={{fontFamily:"'Space Mono'",color:T.ok}}>R {wavg.toFixed(2)}/L</strong></div>
          </div>}
        </>
      )}

      {/* STOCK POSITION */}
      {tab==="stock"&&isAdmin&&(
        <>
          <VariancePill/>
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
            <div>
              <div style={{fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:T.muted,fontWeight:600,marginBottom:4}}>Opening Stock (L)</div>
              <input type="number" inputMode="decimal" value={loc.dieselOpening} onChange={e=>upd({dieselOpening:parseFloat(e.target.value)||0})}
                style={{width:130,background:"rgba(0,0,0,.3)",border:`1px solid ${T.border}`,borderRadius:6,padding:"8px 11px",color:T.cream,fontFamily:"'Space Mono'",fontSize:14,outline:"none"}} placeholder="0"/>
            </div>
            <div style={{fontSize:12,color:T.muted,lineHeight:1.7,paddingTop:18}}>Set to litres in the tank at month start.</div>
          </div>
          {deliveries.length>0&&(
            <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"14px 18px",marginBottom:20}}>
              <div className="section-title">Cost of Stock on Hand</div>
              <div style={{display:"flex",gap:28,flexWrap:"wrap"}}>
                {[["Delivered",fmtL(totalDelivered)],["Spend",fmtR(totalSpend)],["Avg Price",`R ${wavg.toFixed(2)}/L`],["Stock Value",fmtR(Math.max(0,theoretical)*wavg)]].map(([l,v])=>(
                  <div key={l}>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:T.muted,fontWeight:600,marginBottom:2}}>{l}</div>
                    <div style={{fontSize:15,fontWeight:700,fontFamily:"'Space Mono'",color:T.gold}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {byVehicle.length>0&&(
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Vehicle</th><th className="num">Litres</th><th>Bar</th></tr></thead>
              <tbody>
                {byVehicle.map(([vid,l])=>(
                  <tr key={vid}>
                    <td style={{fontWeight:600}}>{fleet.find(v=>v.id===vid)?.name||vid}</td>
                    <td className="num" style={{color:T.fuel_d}}>{fmtL(l)}</td>
                    <td style={{width:140}}><div className="gauge-wrap" style={{marginTop:0}}><div className="gauge-fill" style={{width:`${totalIssued>0?l/totalIssued*100:0}%`,background:T.fuel_d}}/></div></td>
                  </tr>
                ))}
                <tr>
                  <td style={{fontWeight:700,color:T.muted}}>Unallocated</td>
                  <td className="num" style={{color:T.muted}}>{fmtL(Math.max(0,totalIssued-byVehicle.reduce((s,[,l])=>s+l,0)))}</td>
                  <td/>
                </tr>
              </tbody>
            </table></div>
          )}
          {byVehicle.length===0&&deliveries.length===0&&<div className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>Log deliveries and issues to see the stock position</div>}
        </>
      )}

      {/* DIP CHECKS */}
      {tab==="dips"&&(
        <>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
            <button className="btn btn-primary" onClick={()=>setShowDip(true)}>+ Log Dip</button>
          </div>
          {dips.length>0&&<VariancePill/>}
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th className="num">Dip (L)</th><th className="num">Theoretical</th><th className="num">Variance</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {/* Ordered by date, so the newest dip is the top row and matches
                  the "Last Dip" figure above. Previously this listed in
                  created_at order, which usually looked right but drifted
                  whenever a dip was captured a day or two after it was taken. */}
              {dipsNewestFirst.map(d=>{
                // Compared against the tank as it should have been ON THIS
                // DIP'S DATE, not as it is today.
                const th=theoreticalAsOf(d.date);
                const v=d.litres-th;const ok=Math.abs(v)<50;
                return(
                  <tr key={d.id}>
                    <td className="mono" style={{fontSize:12}}>{d.date}</td>
                    <td className="num" style={{fontWeight:700}}>{fmtL(d.litres)}</td>
                    <td className="num" style={{color:T.muted}}>{fmtL(Math.max(0,th))}</td>
                    <td className={`num ${ok?"ok":"bad"}`} style={{fontWeight:700}}>{v>0?"+":""}{v.toFixed(0)} L</td>
                    <td style={{fontSize:12,color:T.muted}}>{d.notes}</td>
                    <td>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>upd({dieselDips:dips.filter(x=>x.id!==d.id)})}>x</button>}</td>
                  </tr>
                );
              })}
              {dips.length===0&&<tr><td colSpan={6} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No dip readings yet</td></tr>}
            </tbody>
          </table></div>
        </>
      )}

      {/* MODALS */}
      {showDelivery&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowDelivery(false)}>
          <div className="modal">
            <div className="modal-title">Log Bulk <span>Diesel Delivery</span></div>
            <ScanSlipButton companyId={companyId} locId={locId} onResult={({slipId,ocr})=>{
              const li = ocr?.line_items?.[0];
              const litres = li?.qty!=null ? String(li.qty) : null;
              const price = li?.unit_price!=null ? String(round2(li.unit_price)) : (li?.total_price!=null && li?.qty ? String(round2(li.total_price/li.qty)) : null);
              setDForm(f=>({
                ...f, slipId,
                date: ocr?.date_guess ? fromISO(ocr.date_guess) : f.date,
                supplier: ocr?.supplier_guess || f.supplier,
                litres: litres!=null ? litres : f.litres,
                pricePerLitre: price!=null ? price : f.pricePerLitre,
              }));
            }}/>
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={dForm.date} onChange={v=>setDForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Litres Delivered</label><input type="number" inputMode="decimal" placeholder="e.g. 5000" value={dForm.litres} onChange={e=>setDForm(f=>({...f,litres:e.target.value}))}/></div>
              <div className="field"><label>Price / Litre (R)</label><input type="number" inputMode="decimal" step="0.01" value={dForm.pricePerLitre} onChange={e=>setDForm(f=>({...f,pricePerLitre:e.target.value}))}/></div>
              <div className="field"><label>Supplier</label>
                <PickOrAdd value={dForm.supplier} options={supplierOptions}
                  onChange={v=>setDForm(f=>({...f,supplier:v}))} placeholder="e.g. Engen"/>
              </div>
              <div className="field"><label>Invoice #</label><input type="text" value={dForm.invoiceNo} onChange={e=>setDForm(f=>({...f,invoiceNo:e.target.value}))}/></div>
            </div>
            {dForm.litres&&dForm.pricePerLitre&&(
              <div className="info-box" style={{marginBottom:12}}>
                <span style={{fontSize:11,color:T.muted}}>Total cost of delivery</span>
                <strong style={{fontFamily:"'Space Mono'",color:T.ok}}>{fmtR((parseFloat(dForm.litres)||0)*(parseFloat(dForm.pricePerLitre)||0))}</strong>
              </div>
            )}
            <div className="field"><label>Notes</label><input type="text" value={dForm.notes} onChange={e=>setDForm(f=>({...f,notes:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={addDelivery}>Save Delivery</button><button className="btn btn-ghost" onClick={()=>setShowDelivery(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      {showIssue&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowIssue(false)}>
          <div className="modal">
            <div className="modal-title">Log Diesel <span>Issue</span></div>
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={iForm.date} onChange={v=>setIForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Vehicle / Equipment</label>
                <select value={iForm.vehicle} onChange={e=>setIForm(f=>({...f,vehicle:e.target.value}))}>
                  <option value="">— Unallocated —</option>
                  {dieselFleet.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Opening Meter</label><input type="number" inputMode="decimal" value={iForm.open} onChange={e=>setIForm(f=>({...f,open:e.target.value}))}/></div>
              <div className="field"><label>Closing Meter</label><input type="number" inputMode="decimal" value={iForm.close} onChange={e=>setIForm(f=>({...f,close:e.target.value,litres:String((parseFloat(e.target.value)||0)-(parseFloat(f.open)||0))}))}/></div>
              <div className="field"><label>Litres (auto-calc)</label><input type="number" inputMode="decimal" value={iForm.litres} onChange={e=>setIForm(f=>({...f,litres:e.target.value}))}/></div>
              <div className="field"><label>Mileage / Hours</label><input type="text" inputMode="decimal" value={iForm.mileage} onChange={e=>setIForm(f=>({...f,mileage:e.target.value}))}/></div>
            </div>
            <div className="field"><label>Notes</label><input type="text" value={iForm.notes} onChange={e=>setIForm(f=>({...f,notes:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={addIssue}>Save Issue</button><button className="btn btn-ghost" onClick={()=>setShowIssue(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      {showDip&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowDip(false)}>
          <div className="modal" style={{maxWidth:400}}>
            <div className="modal-title">Log Tank <span>Dip</span></div>
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={dipForm.date} onChange={v=>setDipForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Dip Reading (L)</label><input type="number" inputMode="decimal" value={dipForm.litres} onChange={e=>setDipForm(f=>({...f,litres:e.target.value}))}/></div>
            </div>
            {dipForm.litres&&(()=>{
              const dip=parseFloat(dipForm.litres)||0;const v=dip-theoretical;const ok=Math.abs(v)<50;
              return<div className="info-box" style={{background:ok?"rgba(90,155,106,.1)":"rgba(192,80,80,.1)",border:`1px solid ${ok?T.ok:T.danger}`,marginBottom:12}}>
                <span style={{fontSize:11,color:T.muted}}>Variance vs theoretical ({fmtL(Math.max(0,theoretical))})</span>
                <strong style={{fontFamily:"'Space Mono'",color:ok?T.ok:T.danger}}>{v>0?"+":""}{v.toFixed(0)} L</strong>
              </div>;
            })()}
            <div className="field"><label>Notes</label><input type="text" placeholder="Who dipped, conditions..." value={dipForm.notes} onChange={e=>setDipForm(f=>({...f,notes:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={addDip}>Save Dip</button><button className="btn btn-ghost" onClick={()=>setShowDip(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* Transfers sit below the tabs rather than inside one, so the
          option is visible from every fuel view — the whole reason it
          exists is that people were reaching for the wrong tool. */}
      <FuelTransfers domain="diesel" locId={locId} companyId={companyId}
        transfers={transfers} litresOnHand={theoretical} onChanged={onTransfersChanged}/>
    </>
  );
}

// ─── PETROL INVENTORY ────────────────────────────────────────────────────────
function PetrolInventory({ loc, setLoc, fleet, locId, companyId, slips, onSlipAttached, transfers, onTransfersChanged }) {
  const [tab,setTab]=[...useState("issues")];
  const [showPurchase,setShowPurchase]=useState(false);
  const [showIssue,setShowIssue]=useState(false);
  const [pForm,setPForm]=useState({date:today(),litres:"",pricePerLitre:"",station:"",notes:"",
    issueNow:false,issueVehicle:"",issueLitres:"",issueMileage:"",slipId:null});
  const [iForm,setIForm]=useState({date:today(),litres:"",vehicle:"",mileage:"",notes:""});

  const {petrolPurchases:purchases,petrolIssues:issues,petrolOpening:opening}=loc;
  const stationOptions = useMemo(
    ()=>[...new Set((purchases||[]).map(x=>x.station).filter(Boolean))].sort(),[purchases]);
  const upd=patch=>setLoc(l=>({...l,...patch}));
  const petrolFleet=fleet.filter(v=>v.fuel==="petrol");

  const totalPurchased=purchases.reduce((s,p)=>s+(p.litres||0),0);
  const totalIssued   =issues.reduce((s,i)=>s+Math.abs(i.litres<0?i.litres:0),0);
  // Same reasoning as diesel — see the note in DieselInventory.
  const tx            = transferEffect(transfers, { domain: "petrol", locationId: locId });
  const theoretical   =(opening||0)+totalPurchased-totalIssued+tx.netUnits;
  const totalSpend    =purchases.reduce((s,p)=>s+(p.litres||0)*(p.pricePerLitre||0),0);
  const wavg          =totalPurchased>0?totalSpend/totalPurchased:0;

  const byVehicle=useMemo(()=>{
    const m={};
    issues.forEach(i=>{if(!i.vehicle)return;m[i.vehicle]=(m[i.vehicle]||0)+Math.abs(i.litres<0?i.litres:0);});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  },[issues]);

  const blankPForm = {date:today(),litres:"",pricePerLitre:"",station:"",notes:"",
    issueNow:false,issueVehicle:"",issueLitres:"",issueMileage:"",slipId:null};

  const addPurchase=()=>{
    const purchaseRow = {date:pForm.date,litres:parseFloat(pForm.litres)||0,pricePerLitre:parseFloat(pForm.pricePerLitre)||0,
      station:pForm.station,notes:pForm.notes,id:uid(),slipId:pForm.slipId};
    const newPurchases = [...purchases,purchaseRow];

    let newIssues = issues;
    if (pForm.issueNow && pForm.issueVehicle && parseFloat(pForm.issueLitres)>0) {
      const issueRow = {
        id:uid(), date:pForm.date, vehicle:pForm.issueVehicle,
        litres:-Math.abs(parseFloat(pForm.issueLitres)||0),
        mileage:pForm.issueMileage, notes:"Filled up at purchase",
      };
      newIssues = [...issues, issueRow];
    }

    upd({petrolPurchases:newPurchases, petrolIssues:newIssues});
    setPForm(blankPForm);setShowPurchase(false);
  };
  const addIssue=()=>{
    upd({petrolIssues:[...issues,{...iForm,id:uid(),litres:-Math.abs(parseFloat(iForm.litres)||0)}]});
    setIForm({date:today(),litres:"",vehicle:"",mileage:"",notes:""});setShowIssue(false);
  };

  const [tabState,setTabState]=useState("issues");

  return(
    <>
      <StockBanner cards={[
        {label:"Opening Stock",val:fmtL(opening||0),accent:T.muted},
        {label:"Purchased",val:fmtL(totalPurchased),accent:T.fuel_p},
        {label:"Issued",val:fmtL(totalIssued),accent:T.muted},
        {label:"Stock on Hand",val:fmtL(Math.max(0,theoretical)),accent:T.gold,big:true},
      ]}/>
      <div className="tabs">
        {[{id:"issues",label:"Issues"},{id:"purchases",label:"Purchases"},{id:"stock",label:"Stock Position"}].map(t=>(
          <button key={t.id} className={`tab${tabState===t.id?" active":""}`} onClick={()=>setTabState(t.id)}>{t.label}</button>
        ))}
      </div>

      {tabState==="issues"&&(
        <>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
            <button className="btn btn-primary" onClick={()=>setShowIssue(true)}>+ Log Issue</button>
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th className="num">Litres</th><th>Vehicle</th><th>Mileage</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {issues.map(i=>(
                <tr key={i.id}>
                  <td className="mono" style={{fontSize:12}}>{i.date}</td>
                  <td className="num" style={{color:T.fuel_p,fontWeight:700}}>{Math.abs(i.litres)}</td>
                  <td>{i.vehicle?<span className="badge badge-p">{i.vehicle}</span>:<span style={{color:T.muted,fontSize:11}}>Unallocated</span>}</td>
                  <td className="mono" style={{fontSize:11,color:T.muted}}>{i.mileage||"—"}</td>
                  <td style={{fontSize:12,color:T.muted}}>{i.notes}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={()=>upd({petrolIssues:issues.filter(x=>x.id!==i.id)})}>x</button></td>
                </tr>
              ))}
              {issues.length===0&&<tr><td colSpan={6} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No issues logged yet</td></tr>}
            </tbody>
          </table></div>
        </>
      )}

      {tabState==="purchases"&&(
        <>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
            <button className="btn btn-primary" onClick={()=>{setPForm({...blankPForm,date:today()});setShowPurchase(true);}}>+ Log Purchase</button>
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th className="num">Litres</th><th className="num">Price/L</th><th className="num">Total</th><th>Station</th><th>Notes</th><th>Slip</th><th></th></tr></thead>
            <tbody>
              {purchases.map(p=>(
                <tr key={p.id}>
                  <td className="mono" style={{fontSize:12}}>{p.date}</td>
                  <td className="num ok" style={{fontWeight:700}}>{fmtL(p.litres)}</td>
                  <td className="num">R {parseFloat(p.pricePerLitre||0).toFixed(2)}</td>
                  <td className="num">{fmtR((p.litres||0)*(p.pricePerLitre||0))}</td>
                  <td style={{fontSize:12}}>{p.station||<span style={{color:T.muted}}>—</span>}</td>
                  <td style={{fontSize:12,color:T.muted}}>{p.notes}</td>
                  <td>
                    {p.slipId && slips[p.slipId] ? <ViewSlipLink storagePath={slips[p.slipId].storage_path}/>
                      : <AttachSlipButton companyId={companyId} locId={locId}
                          onAttached={(slip)=>{onSlipAttached(slip); sb.patch("petrol_purchases",p.id,{slip_id:slip.id}).catch(e=>alert("Saved photo but could not link it: "+e.message)); upd({petrolPurchases:purchases.map(x=>x.id===p.id?{...x,slipId:slip.id}:x)});}}/>}
                  </td>
                  <td><button className="btn btn-danger btn-sm" onClick={()=>upd({petrolPurchases:purchases.filter(x=>x.id!==p.id)})}>x</button></td>
                </tr>
              ))}
              {purchases.length===0&&<tr><td colSpan={8} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No purchases yet</td></tr>}
            </tbody>
          </table></div>
          {purchases.length>0&&<div style={{marginTop:10,padding:"8px 13px",background:"rgba(90,155,106,.08)",border:`1px solid rgba(90,155,106,.25)`,borderRadius:6,display:"flex",gap:24}}>
            <div><span style={{fontSize:11,color:T.muted}}>Total: </span><strong style={{fontFamily:"'Space Mono'",color:T.ok}}>{fmtL(totalPurchased)}</strong></div>
            <div><span style={{fontSize:11,color:T.muted}}>Spend: </span><strong style={{fontFamily:"'Space Mono'",color:T.ok}}>{fmtR(totalSpend)}</strong></div>
            <div><span style={{fontSize:11,color:T.muted}}>Avg: </span><strong style={{fontFamily:"'Space Mono'",color:T.ok}}>R {wavg.toFixed(2)}/L</strong></div>
          </div>}
        </>
      )}

      {tabState==="stock"&&(
        <>
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
            <div>
              <div style={{fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:T.muted,fontWeight:600,marginBottom:4}}>Opening Stock (L)</div>
              <input type="number" inputMode="decimal" value={loc.petrolOpening} onChange={e=>upd({petrolOpening:parseFloat(e.target.value)||0})}
                style={{width:130,background:"rgba(0,0,0,.3)",border:`1px solid ${T.border}`,borderRadius:6,padding:"8px 11px",color:T.cream,fontFamily:"'Space Mono'",fontSize:14,outline:"none"}} placeholder="0"/>
            </div>
            <div style={{fontSize:12,color:T.muted,lineHeight:1.7,paddingTop:18}}>Litres in jerrycans at month start.</div>
          </div>
          {purchases.length>0&&(
            <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:"14px 18px",marginBottom:20}}>
              <div className="section-title">Cost of Stock on Hand</div>
              <div style={{display:"flex",gap:28,flexWrap:"wrap"}}>
                {[["Purchased",fmtL(totalPurchased)],["Spend",fmtR(totalSpend)],["Avg Price",`R ${wavg.toFixed(2)}/L`],["Stock Value",fmtR(Math.max(0,theoretical)*wavg)]].map(([l,v])=>(
                  <div key={l}>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:T.muted,fontWeight:600,marginBottom:2}}>{l}</div>
                    <div style={{fontSize:15,fontWeight:700,fontFamily:"'Space Mono'",color:T.gold}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {byVehicle.length>0&&(
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Vehicle</th><th className="num">Litres</th><th>Bar</th></tr></thead>
              <tbody>
                {byVehicle.map(([vid,l])=>(
                  <tr key={vid}>
                    <td style={{fontWeight:600}}>{fleet.find(v=>v.id===vid)?.name||vid}</td>
                    <td className="num" style={{color:T.fuel_p}}>{fmtL(l)}</td>
                    <td style={{width:140}}><div className="gauge-wrap" style={{marginTop:0}}><div className="gauge-fill" style={{width:`${totalIssued>0?l/totalIssued*100:0}%`,background:T.fuel_p}}/></div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          {byVehicle.length===0&&purchases.length===0&&<div className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>Log purchases and issues to see the stock position</div>}
        </>
      )}

      {showPurchase&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowPurchase(false)}>
          <div className="modal" style={{maxWidth:440}}>
            <div className="modal-title">Log <span>Petrol Purchase</span></div>
            <ScanSlipButton companyId={companyId} locId={locId} onResult={({slipId,ocr})=>{
              const li = ocr?.line_items?.[0];
              const litres = li?.qty!=null ? String(li.qty) : null;
              const price = li?.unit_price!=null ? String(round2(li.unit_price)) : (li?.total_price!=null && li?.qty ? String(round2(li.total_price/li.qty)) : null);
              setPForm(f=>({
                ...f, slipId,
                date: ocr?.date_guess ? fromISO(ocr.date_guess) : f.date,
                station: ocr?.supplier_guess || f.station,
                litres: litres!=null ? litres : f.litres,
                pricePerLitre: price!=null ? price : f.pricePerLitre,
              }));
            }}/>
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={pForm.date} onChange={v=>setPForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Litres</label><input type="number" inputMode="decimal" value={pForm.litres} onChange={e=>setPForm(f=>({...f,litres:e.target.value}))}/></div>
              <div className="field"><label>Price / Litre (R)</label><input type="number" inputMode="decimal" step="0.01" value={pForm.pricePerLitre} onChange={e=>setPForm(f=>({...f,pricePerLitre:e.target.value}))}/></div>
              <div className="field"><label>Filling Station</label>
                <PickOrAdd value={pForm.station} options={stationOptions}
                  onChange={v=>setPForm(f=>({...f,station:v}))} placeholder="e.g. BP Modimolle"/>
              </div>
            </div>
            {pForm.litres&&pForm.pricePerLitre&&(
              <div className="info-box" style={{marginBottom:12}}>
                <span style={{fontSize:11,color:T.muted}}>Total cost</span>
                <strong style={{fontFamily:"'Space Mono'",color:T.ok}}>{fmtR((parseFloat(pForm.litres)||0)*(parseFloat(pForm.pricePerLitre)||0))}</strong>
              </div>
            )}
            <div className="field"><label>Notes</label><input type="text" value={pForm.notes} onChange={e=>setPForm(f=>({...f,notes:e.target.value}))}/></div>

            <div style={{background:"rgba(184,147,90,.06)",border:`1px solid rgba(184,147,90,.2)`,borderRadius:7,padding:"12px 13px",marginBottom:14}}>
              <label style={{display:"flex",alignItems:"center",gap:9,cursor:"pointer",marginBottom:pForm.issueNow?12:0}}>
                <input type="checkbox" checked={pForm.issueNow}
                  onChange={e=>setPForm(f=>({...f,issueNow:e.target.checked}))}
                  style={{width:16,height:16,accentColor:T.gold,cursor:"pointer"}}/>
                <span style={{fontSize:13,fontWeight:600,color:T.cream}}>Also fill up a vehicle with this now</span>
              </label>
              {pForm.issueNow&&(<>
                <div className="grid2">
                  <div className="field"><label>Vehicle</label>
                    <select value={pForm.issueVehicle} onChange={e=>setPForm(f=>({...f,issueVehicle:e.target.value}))}>
                      <option value="">— Select —</option>
                      {petrolFleet.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Litres to Vehicle</label>
                    <input type="number" inputMode="decimal" placeholder={pForm.litres||"0"} value={pForm.issueLitres}
                      onChange={e=>setPForm(f=>({...f,issueLitres:e.target.value}))}/>
                  </div>
                </div>
                <div className="field" style={{marginBottom:0}}>
                  <label>Mileage / Hours</label>
                  <input type="text" inputMode="decimal" value={pForm.issueMileage} onChange={e=>setPForm(f=>({...f,issueMileage:e.target.value}))}/>
                </div>
                {parseFloat(pForm.issueLitres)>parseFloat(pForm.litres||0) && (
                  <div style={{fontSize:11,color:T.warn,marginTop:8}}>
                    Note: more litres going to the vehicle than were purchased just now — that's fine if you're topping up from existing jerrycan stock too.
                  </div>
                )}
              </>)}
            </div>

            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={addPurchase}>Save</button><button className="btn btn-ghost" onClick={()=>setShowPurchase(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      {showIssue&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowIssue(false)}>
          <div className="modal" style={{maxWidth:440}}>
            <div className="modal-title">Log <span>Petrol Issue</span></div>
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={iForm.date} onChange={v=>setIForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Vehicle / Equipment</label>
                <select value={iForm.vehicle} onChange={e=>setIForm(f=>({...f,vehicle:e.target.value}))}>
                  <option value="">— Unallocated —</option>
                  {petrolFleet.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Litres</label><input type="number" inputMode="decimal" value={iForm.litres} onChange={e=>setIForm(f=>({...f,litres:e.target.value}))}/></div>
              <div className="field"><label>Mileage / Hours</label><input type="text" inputMode="decimal" value={iForm.mileage} onChange={e=>setIForm(f=>({...f,mileage:e.target.value}))}/></div>
            </div>
            <div className="field"><label>Notes</label><input type="text" value={iForm.notes} onChange={e=>setIForm(f=>({...f,notes:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={addIssue}>Save</button><button className="btn btn-ghost" onClick={()=>setShowIssue(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* Transfers sit below the tabs rather than inside one, so the
          option is visible from every fuel view — the whole reason it
          exists is that people were reaching for the wrong tool. */}
      <FuelTransfers domain="petrol" locId={locId} companyId={companyId}
        transfers={transfers} litresOnHand={theoretical} onChanged={onTransfersChanged}/>
    </>
  );
}

// ─── PARTS & STOCK ───────────────────────────────────────────────────────────
function PartsStock({ loc, locId, setLoc, isAdmin, fleet, companyId, slips, onSlipAttached }) {
  const parts=loc.parts;
  const partIssues=loc.partIssues||[];
  const partPurchases=loc.partPurchases||[];
  const supplierOptions = useMemo(
    ()=>[...new Set(partPurchases.map(x=>x.supplier).filter(Boolean))].sort(),[partPurchases]);
  const partCreditNotes=loc.partCreditNotes||[];
  const upd=patch=>setLoc(l=>({...l,...patch}));
  const [showForm,setShowForm]=useState(false);
  const [showIssue,setShowIssue]=useState(false);
  const [showPurchase,setShowPurchase]=useState(false);
  const [showCredit,setShowCredit]=useState(false);
  const [issueBusy,setIssueBusy]=useState(false);
  const [purchaseBusy,setPurchaseBusy]=useState(false);
  const [creditBusy,setCreditBusy]=useState(false);
  const [form,setForm]=useState({description:"",storeroom:"",shelf:"",location:"",unit:"each",openCost:"",openQty:"",purchaseQty:"",purchaseCost:"",purchaseFrom:"",closingQty:""});
  const [issueForm,setIssueForm]=useState({partId:"",vehicle:"",qty:"",date:today()});
  const [purchaseForm,setPurchaseForm]=useState({partId:"",qty:"",totalCost:"",supplier:"",date:today(),notes:"",slipId:null});
  const [creditForm,setCreditForm]=useState({partId:"",qty:"",unitCost:"",supplier:"",reason:"wrong_item",creditNoteNumber:"",date:today(),notes:"",pendingSlipBlob:null,pendingSlipName:""});

  // Ongoing restocks (logged via Log Purchase below) aren't baked into the
  // part row itself the way the original opening purchase is — summed here
  // per part_id so valuation and the part list can fold them in.
  const purchaseTotalsByPart = useMemo(()=>{
    const m={};
    partPurchases.forEach(pp=>{
      if(!m[pp.partId]) m[pp.partId]={qty:0,cost:0};
      m[pp.partId].qty += pp.qty||0;
      m[pp.partId].cost += pp.totalCost||0;
    });
    return m;
  },[partPurchases]);
  const weightedCost = p => {
    const extra = purchaseTotalsByPart[p.id] || {qty:0,cost:0};
    const totalQty = (p.openQty||0)+(p.purchaseQty||0)+extra.qty;
    const totalCost = (p.openCost||0)*(p.openQty||0)+(p.purchaseCost||0)+extra.cost;
    return totalQty>0 ? totalCost/totalQty : (p.openCost||0);
  };

  const addPart=()=>{
    const p={...form,id:uid(),openCost:parseFloat(form.openCost)||0,openQty:parseFloat(form.openQty)||0,purchaseQty:parseFloat(form.purchaseQty)||0,purchaseCost:parseFloat(form.purchaseCost)||0,closingQty:parseFloat(form.closingQty)||0,issues:{}};
    upd({parts:[...parts,p]});
    setForm({description:"",storeroom:"",shelf:"",location:"",unit:"each",openCost:"",openQty:"",purchaseQty:"",purchaseCost:"",purchaseFrom:"",closingQty:""});
    setShowForm(false);
  };

  // Writes directly to Supabase rather than relying on the whole-location
  // diff-sync, since that sync only detects rows being added/removed by id —
  // it can't see an in-place edit to an existing part's closing quantity.
  const issuePart=async()=>{
    const qty = parseFloat(issueForm.qty)||0;
    if (!issueForm.partId || !issueForm.vehicle || qty<=0) return;
    setIssueBusy(true);
    try{
      const part = parts.find(p=>p.id===issueForm.partId);
      const newClosingQty = Math.max(0,(part?.closingQty||0)-qty);
      const row = {id:uid(), location_id:locId, company_id:companyId, part_id:issueForm.partId, vehicle_id:issueForm.vehicle, date:issueForm.date, qty, notes:null};

      await sb.insert("parts_issues", row);
      await sb.patch("parts", issueForm.partId, {closing_qty:newClosingQty});

      upd({
        parts: parts.map(p=>p.id===issueForm.partId?{...p,closingQty:newClosingQty}:p),
        partIssues: [...partIssues, {id:row.id,date:row.date,partId:row.part_id,vehicle:row.vehicle_id,qty:row.qty,notes:""}],
      });
      setIssueForm({partId:"",vehicle:"",qty:"",date:today()});
      setShowIssue(false);
    }catch(e){ alert("Could not issue part: "+e.message); }
    finally{ setIssueBusy(false); }
  };

  // Deleting an issue record restores the quantity to closing stock —
  // treated as "undo this issue" rather than just erasing the log entry.
  const deleteIssue=async(iss)=>{
    if(!window.confirm("Delete this issue record? The quantity will be added back to closing stock."))return;
    try{
      const part = parts.find(p=>p.id===iss.partId);
      const restoredQty = (part?.closingQty||0)+iss.qty;
      await sb.delete("parts_issues", iss.id);
      if(part) await sb.patch("parts", part.id, {closing_qty:restoredQty});
      upd({
        parts: parts.map(p=>p.id===iss.partId?{...p,closingQty:restoredQty}:p),
        partIssues: partIssues.filter(x=>x.id!==iss.id),
      });
    }catch(e){ alert("Error: "+e.message); }
  };

  // Logs a restock of an existing part — same "direct write, patch
  // closing_qty in place" pattern as issuePart above, just adding instead
  // of subtracting. The photo (if any) is uploaded by ScanSlipButton/
  // AttachSlipButton before this runs; purchaseForm.slipId just carries the
  // id through.
  const logPurchase=async()=>{
    const qty = parseFloat(purchaseForm.qty)||0;
    if (!purchaseForm.partId || qty<=0) return;
    setPurchaseBusy(true);
    try{
      const part = parts.find(p=>p.id===purchaseForm.partId);
      const newClosingQty = (part?.closingQty||0)+qty;
      const row = {id:uid(), location_id:locId, company_id:companyId, part_id:purchaseForm.partId, date:purchaseForm.date, qty, total_cost:parseFloat(purchaseForm.totalCost)||0, supplier:purchaseForm.supplier||null, notes:purchaseForm.notes||null, slip_id:purchaseForm.slipId||null};

      await sb.insert("parts_purchases", row);
      await sb.patch("parts", purchaseForm.partId, {closing_qty:newClosingQty});

      upd({
        parts: parts.map(p=>p.id===purchaseForm.partId?{...p,closingQty:newClosingQty}:p),
        partPurchases: [...partPurchases, {id:row.id,date:row.date,partId:row.part_id,qty:row.qty,totalCost:row.total_cost,supplier:row.supplier||"",notes:row.notes||"",slipId:row.slip_id}],
      });
      setPurchaseForm({partId:"",qty:"",totalCost:"",supplier:"",date:today(),notes:"",slipId:null});
      setShowPurchase(false);
    }catch(e){ alert("Could not log purchase: "+e.message); }
    finally{ setPurchaseBusy(false); }
  };

  // Same "undo" convention as deleteIssue — removing a purchase record
  // takes its quantity back out of closing stock.
  const deletePartPurchase=async(pp)=>{
    if(!window.confirm("Delete this purchase record? The quantity will be removed from closing stock."))return;
    try{
      const part = parts.find(p=>p.id===pp.partId);
      const reducedQty = Math.max(0,(part?.closingQty||0)-pp.qty);
      await sb.delete("parts_purchases", pp.id);
      if(part) await sb.patch("parts", part.id, {closing_qty:reducedQty});
      upd({
        parts: parts.map(p=>p.id===pp.partId?{...p,closingQty:reducedQty}:p),
        partPurchases: partPurchases.filter(x=>x.id!==pp.id),
      });
    }catch(e){ alert("Error: "+e.message); }
  };

  // Supplier Credit Notes (2026-08-25) — when the wrong part was bought and
  // has to go back to the supplier. Same "direct write, patch closing_qty in
  // place" pattern as issuePart, decrementing stock the same way — but
  // parts_issues requires a vehicle_id (every part issue here is issued to
  // a vehicle/equipment) which doesn't fit a supplier return, so this skips
  // parts_issues entirely and only records the financial side in the shared
  // supplier_credit_notes table (issue_id left null there).
  const pickCreditSlipFile=async e=>{
    const file=e.target.files?.[0]; e.target.value="";
    if(!file)return;
    const resized=await resizeImageFile(file);
    setCreditForm(f=>({...f,pendingSlipBlob:resized,pendingSlipName:file.name}));
  };
  const logCredit=async()=>{
    const qty = parseFloat(creditForm.qty)||0;
    const unitCost = parseFloat(creditForm.unitCost)||0;
    if (!creditForm.partId || qty<=0 || !creditForm.supplier) return;
    setCreditBusy(true);
    try{
      const part = parts.find(p=>p.id===creditForm.partId);
      const newClosingQty = Math.max(0,(part?.closingQty||0)-qty);
      const totalCredit = round2(qty*unitCost);

      let slipId=null;
      if(creditForm.pendingSlipBlob){
        const slip=await uploadPurchaseSlip({companyId, locationId:locId, blob:creditForm.pendingSlipBlob});
        slipId=slip.id;
        onSlipAttached(slip);
      }

      const row = {id:uid(), company_id:companyId, app:"ops", location_id:locId, period:null,
        item_id:creditForm.partId, item_description:part?.description||"", issue_id:null,
        qty, unit_cost:unitCost, total_credit:totalCredit, supplier:creditForm.supplier,
        reason:creditForm.reason, credit_note_number:creditForm.creditNoteNumber||null,
        date:toISO(creditForm.date), notes:creditForm.notes||null, slip_id:slipId};

      await sb.insert("supplier_credit_notes", row);
      await sb.patch("parts", creditForm.partId, {closing_qty:newClosingQty});

      upd({
        parts: parts.map(p=>p.id===creditForm.partId?{...p,closingQty:newClosingQty}:p),
        partCreditNotes: [...partCreditNotes, {id:row.id,date:creditForm.date,partId:row.item_id,itemDescription:row.item_description,qty,unitCost,totalCredit,supplier:row.supplier,reason:row.reason,creditNoteNumber:row.credit_note_number||"",notes:row.notes||"",slipId:row.slip_id}],
      });
      setCreditForm({partId:"",qty:"",unitCost:"",supplier:"",reason:"wrong_item",creditNoteNumber:"",date:today(),notes:"",pendingSlipBlob:null,pendingSlipName:""});
      setShowCredit(false);
    }catch(e){ alert("Could not log credit note: "+e.message); }
    finally{ setCreditBusy(false); }
  };

  // Same "undo" convention as deleteIssue/deletePartPurchase — deleting a
  // credit note reverses the stock deduction it caused.
  const deletePartCreditNote=async(c)=>{
    if(!window.confirm("Delete this credit note? The quantity will be added back to closing stock."))return;
    try{
      const part = parts.find(p=>p.id===c.partId);
      const restoredQty = (part?.closingQty||0)+c.qty;
      await sb.delete("supplier_credit_notes", c.id);
      await sb.patch("parts", c.partId, {closing_qty:restoredQty});
      upd({
        parts: parts.map(p=>p.id===c.partId?{...p,closingQty:restoredQty}:p),
        partCreditNotes: partCreditNotes.filter(x=>x.id!==c.id),
      });
    }catch(e){ alert("Error: "+e.message); }
  };

  const totalValue=parts.reduce((s,p)=>s+(p.closingQty||0)*weightedCost(p),0);
  const totalPurchases=parts.reduce((s,p)=>s+(p.purchaseCost||0),0);
  const totalLoggedPurchases=partPurchases.reduce((s,pp)=>s+(pp.totalCost||0),0);
  const totalCredits=partCreditNotes.reduce((s,c)=>s+(c.totalCredit||0),0);

  const recentPurchases = useMemo(()=>{
    return [...partPurchases].sort((a,b)=>{
      const da=parseDMY(a.date), db=parseDMY(b.date);
      return (db?db.getTime():0)-(da?da.getTime():0);
    }).slice(0,25);
  },[partPurchases]);

  const recentCreditNotes = useMemo(()=>{
    return [...partCreditNotes].sort((a,b)=>{
      const da=parseDMY(a.date), db=parseDMY(b.date);
      return (db?db.getTime():0)-(da?da.getTime():0);
    }).slice(0,25);
  },[partCreditNotes]);

  const recentIssues = useMemo(()=>{
    return [...partIssues].sort((a,b)=>{
      const da=parseDMY(a.date), db=parseDMY(b.date);
      return (db?db.getTime():0)-(da?da.getTime():0);
    }).slice(0,25);
  },[partIssues]);
  const partName = id => parts.find(p=>p.id===id)?.description || "(deleted part)";
  const vehicleName = id => (fleet||[]).find(v=>v.id===id)?.name || id || "—";
  const partUnitCost = id => weightedCost(parts.find(p=>p.id===id)||{});

  return(
    <>
      <div className="strip">
        <div className="strip-item"><div className="strip-label">Closing Stock Value</div><div className="strip-val">{fmtR(totalValue)}</div></div>
        <div className="strip-item"><div className="strip-label">Opening Purchases</div><div className="strip-val">{fmtR(totalPurchases)}</div></div>
        <div className="strip-item"><div className="strip-label">Logged Purchases</div><div className="strip-val">{fmtR(totalLoggedPurchases)}</div></div>
        <div className="strip-item"><div className="strip-label">Line Items</div><div className="strip-val">{parts.length}</div></div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button className="btn btn-ghost" onClick={()=>{setPurchaseForm({partId:"",qty:"",totalCost:"",supplier:"",date:today(),notes:"",slipId:null});setShowPurchase(true);}}>Log Purchase</button>
          <button className="btn btn-ghost" onClick={()=>{setCreditForm({partId:"",qty:"",unitCost:"",supplier:"",reason:"wrong_item",creditNoteNumber:"",date:today(),notes:"",pendingSlipBlob:null,pendingSlipName:""});setShowCredit(true);}}>Credit Note</button>
          <button className="btn btn-ghost" onClick={()=>{setIssueForm({partId:"",vehicle:"",qty:"",date:today()});setShowIssue(true);}}>Issue Part</button>
          <button className="btn btn-primary" onClick={()=>setShowForm(true)}>+ Add Part</button>
        </div>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Description</th><th>Location</th><th>Unit</th><th className="num">Open Qty</th><th className="num">Open Cost</th><th className="num">Purchased</th><th className="num">Purchase Cost</th><th>From</th><th className="num">Closing Qty</th><th className="num">Avg Cost/Unit</th><th className="num">Value</th><th></th></tr></thead>
        <tbody>
          {parts.map(p=>{
            const w=weightedCost(p);
            return(
              <tr key={p.id}>
                <td style={{fontWeight:600}}>{p.description}</td>
                <td style={{fontSize:11,color:T.muted}}>{[p.storeroom,p.shelf,p.location].filter(Boolean).join(" - ")}</td>
                <td><span className="badge badge-v">{p.unit}</span></td>
                <td className="num">{p.openQty}</td>
                <td className="num">{fmtR(p.openCost)}</td>
                <td className="num">{p.purchaseQty}</td>
                <td className="num">{fmtR(p.purchaseCost)}</td>
                <td style={{fontSize:12,color:T.muted}}>{p.purchaseFrom}</td>
                <td className="num">{p.closingQty}</td>
                <td className="num" style={{color:T.muted,fontSize:12}}>{fmtR(w)}</td>
                <td className="num">{fmtR((p.closingQty||0)*w)}</td>
                <td>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>upd({parts:parts.filter(x=>x.id!==p.id)})}>x</button>}</td>
              </tr>
            );
          })}
          {parts.length===0&&<tr><td colSpan={12} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No parts recorded at this location</td></tr>}
        </tbody>
      </table></div>

      {partPurchases.length>0 && (
        <div style={{marginTop:22}}>
          <div className="section-title">Recent Purchases</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th>Part</th><th className="num">Qty</th><th className="num">Total Cost</th><th>Supplier</th><th>Slip</th><th></th></tr></thead>
            <tbody>
              {recentPurchases.map(pp=>(
                <tr key={pp.id}>
                  <td className="mono" style={{fontSize:11}}>{pp.date}</td>
                  <td style={{fontWeight:600}}>{partName(pp.partId)}</td>
                  <td className="num">{pp.qty}</td>
                  <td className="num">{fmtR(pp.totalCost)}</td>
                  <td style={{fontSize:12,color:T.muted}}>{pp.supplier||"—"}</td>
                  <td>
                    {pp.slipId && slips[pp.slipId] ? <ViewSlipLink storagePath={slips[pp.slipId].storage_path}/>
                      : <AttachSlipButton companyId={companyId} locId={locId}
                          onAttached={(slip)=>{onSlipAttached(slip); sb.patch("parts_purchases",pp.id,{slip_id:slip.id}).catch(e=>alert("Saved photo but could not link it: "+e.message)); upd({partPurchases:partPurchases.map(x=>x.id===pp.id?{...x,slipId:slip.id}:x)});}}/>}
                  </td>
                  <td>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>deletePartPurchase(pp)}>x</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {partPurchases.length>25 && (
            <div style={{fontSize:11,color:T.muted,marginTop:6}}>Showing the 25 most recent of {partPurchases.length} purchases.</div>
          )}
        </div>
      )}

      {partCreditNotes.length>0 && (
        <div style={{marginTop:22}}>
          <div className="section-title">Recent Credit Notes — {fmtR(totalCredits)} total</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th>Part</th><th className="num">Qty</th><th className="num">Credit R</th><th>Supplier</th><th>Reason</th><th>Credit note #</th><th>Slip</th><th></th></tr></thead>
            <tbody>
              {recentCreditNotes.map(c=>(
                <tr key={c.id}>
                  <td className="mono" style={{fontSize:11}}>{c.date}</td>
                  <td style={{fontWeight:600}}>{c.itemDescription||partName(c.partId)}</td>
                  <td className="num">{c.qty}</td>
                  <td className="num">{fmtR(c.totalCredit)}</td>
                  <td style={{fontSize:12,color:T.muted}}>{c.supplier||"—"}</td>
                  <td style={{fontSize:12,color:T.muted}}>{CREDIT_REASONS.find(r=>r.value===c.reason)?.label||c.reason}</td>
                  <td style={{fontSize:12,color:T.muted}}>{c.creditNoteNumber||"—"}</td>
                  <td>
                    {c.slipId && slips[c.slipId] ? <ViewSlipLink storagePath={slips[c.slipId].storage_path}/>
                      : <AttachSlipButton companyId={companyId} locId={locId}
                          onAttached={(slip)=>{onSlipAttached(slip); sb.patch("supplier_credit_notes",c.id,{slip_id:slip.id}).catch(e=>alert("Saved photo but could not link it: "+e.message)); upd({partCreditNotes:partCreditNotes.map(x=>x.id===c.id?{...x,slipId:slip.id}:x)});}}/>}
                  </td>
                  <td>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>deletePartCreditNote(c)}>x</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {partCreditNotes.length>25 && (
            <div style={{fontSize:11,color:T.muted,marginTop:6}}>Showing the 25 most recent of {partCreditNotes.length} credit notes.</div>
          )}
        </div>
      )}

      {partIssues.length>0 && (
        <div style={{marginTop:22}}>
          <div className="section-title">Recent Issues</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th>Part</th><th>Vehicle</th><th className="num">Qty</th><th className="num">Value</th><th></th></tr></thead>
            <tbody>
              {recentIssues.map(iss=>(
                <tr key={iss.id}>
                  <td className="mono" style={{fontSize:11,color:iss.date?T.cream:T.muted}}>
                    {iss.date || "unknown (migrated)"}
                  </td>
                  <td style={{fontWeight:600}}>{partName(iss.partId)}</td>
                  <td style={{fontSize:12,color:T.muted}}>{vehicleName(iss.vehicle)}</td>
                  <td className="num">{iss.qty}</td>
                  <td className="num" style={{color:T.muted}}>{fmtR(iss.qty*partUnitCost(iss.partId))}</td>
                  <td>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>deleteIssue(iss)}>x</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {partIssues.length>25 && (
            <div style={{fontSize:11,color:T.muted,marginTop:6}}>Showing the 25 most recent of {partIssues.length} issues.</div>
          )}
        </div>
      )}

      {showForm&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowForm(false)}>
          <div className="modal">
            <div className="modal-title">Add <span>Part / Stock Item</span></div>
            <div className="field"><label>Description</label><input type="text" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
            <div className="grid3">
              <div className="field"><label>Storeroom</label><input type="text" value={form.storeroom} onChange={e=>setForm(f=>({...f,storeroom:e.target.value}))}/></div>
              <div className="field"><label>Shelf</label><input type="text" value={form.shelf} onChange={e=>setForm(f=>({...f,shelf:e.target.value}))}/></div>
              <div className="field"><label>Position</label><input type="text" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}/></div>
            </div>
            <div className="grid2">
              <div className="field"><label>Unit</label>
                <select value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}>
                  {["each","litre","kg","set","box","pair","metre"].map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="field"><label>Opening Cost (R)</label><input type="number" inputMode="decimal" value={form.openCost} onChange={e=>setForm(f=>({...f,openCost:e.target.value}))}/></div>
              <div className="field"><label>Opening Qty</label><input type="number" inputMode="decimal" value={form.openQty} onChange={e=>setForm(f=>({...f,openQty:e.target.value}))}/></div>
              <div className="field"><label>Purchase Qty</label><input type="number" inputMode="decimal" value={form.purchaseQty} onChange={e=>setForm(f=>({...f,purchaseQty:e.target.value}))}/></div>
              <div className="field"><label>Purchase Cost (R excl VAT)</label><input type="number" inputMode="decimal" value={form.purchaseCost} onChange={e=>setForm(f=>({...f,purchaseCost:e.target.value}))}/></div>
              <div className="field"><label>Closing Qty (Count)</label><input type="number" inputMode="decimal" value={form.closingQty} onChange={e=>setForm(f=>({...f,closingQty:e.target.value}))}/></div>
            </div>
            <div className="field"><label>Purchased From</label><input type="text" value={form.purchaseFrom} onChange={e=>setForm(f=>({...f,purchaseFrom:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={addPart}>Save Part</button><button className="btn btn-ghost" onClick={()=>setShowForm(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      {showIssue&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowIssue(false)}>
          <div className="modal" style={{maxWidth:440}}>
            <div className="modal-title">Issue <span>Part to Vehicle</span></div>
            <div className="field"><label>Part</label>
              <select value={issueForm.partId} onChange={e=>setIssueForm(f=>({...f,partId:e.target.value}))}>
                <option value="">— Select part —</option>
                {parts.map(p=><option key={p.id} value={p.id}>{p.description} ({p.closingQty} {p.unit} in stock)</option>)}
              </select>
            </div>
            <div className="field"><label>Vehicle / Equipment</label>
              <select value={issueForm.vehicle} onChange={e=>setIssueForm(f=>({...f,vehicle:e.target.value}))}>
                <option value="">— Select —</option>
                {(fleet||[]).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Date</label><DateField value={issueForm.date} onChange={v=>setIssueForm(f=>({...f,date:v}))}/></div>
            <div className="field"><label>Quantity</label><input type="number" inputMode="decimal" min="0" value={issueForm.qty} onChange={e=>setIssueForm(f=>({...f,qty:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={issuePart} disabled={issueBusy}>{issueBusy?"Issuing...":"Issue Part"}</button><button className="btn btn-ghost" onClick={()=>setShowIssue(false)} disabled={issueBusy}>Cancel</button></div>
          </div>
        </div>
      )}
      {showPurchase&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowPurchase(false)}>
          <div className="modal" style={{maxWidth:460}}>
            <div className="modal-title">Log <span>Part Purchase</span></div>
            <ScanSlipButton companyId={companyId} locId={locId} onResult={({slipId,ocr})=>{
              const li = ocr?.line_items?.[0];
              setPurchaseForm(f=>({
                ...f, slipId,
                date: ocr?.date_guess ? fromISO(ocr.date_guess) : f.date,
                supplier: ocr?.supplier_guess || f.supplier,
                qty: li?.qty!=null ? String(li.qty) : f.qty,
                totalCost: li?.total_price!=null ? String(round2(li.total_price)) : (ocr?.slip_total!=null ? String(ocr.slip_total) : f.totalCost),
              }));
            }}/>
            <div className="field"><label>Part</label>
              <select value={purchaseForm.partId} onChange={e=>setPurchaseForm(f=>({...f,partId:e.target.value}))}>
                <option value="">— Select part —</option>
                {parts.map(p=><option key={p.id} value={p.id}>{p.description} ({p.closingQty} {p.unit} in stock)</option>)}
              </select>
            </div>
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={purchaseForm.date} onChange={v=>setPurchaseForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Quantity</label><input type="number" inputMode="decimal" min="0" value={purchaseForm.qty} onChange={e=>setPurchaseForm(f=>({...f,qty:e.target.value}))}/></div>
              <div className="field"><label>Total Cost (R excl VAT)</label><input type="number" inputMode="decimal" step="0.01" value={purchaseForm.totalCost} onChange={e=>setPurchaseForm(f=>({...f,totalCost:e.target.value}))}/></div>
              <div className="field"><label>Supplier</label>
                <PickOrAdd value={purchaseForm.supplier} options={supplierOptions}
                  onChange={v=>setPurchaseForm(f=>({...f,supplier:v}))} placeholder="New supplier name"/>
              </div>
            </div>
            {purchaseForm.qty&&purchaseForm.totalCost&&(
              <div className="info-box" style={{marginBottom:12}}>
                <span style={{fontSize:11,color:T.muted}}>Cost per unit</span>
                <strong style={{fontFamily:"'Space Mono'",color:T.ok}}>{fmtR((parseFloat(purchaseForm.totalCost)||0)/(parseFloat(purchaseForm.qty)||1))}</strong>
              </div>
            )}
            <div className="field"><label>Notes</label><input type="text" value={purchaseForm.notes} onChange={e=>setPurchaseForm(f=>({...f,notes:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={logPurchase} disabled={purchaseBusy}>{purchaseBusy?"Saving...":"Log Purchase"}</button><button className="btn btn-ghost" onClick={()=>setShowPurchase(false)} disabled={purchaseBusy}>Cancel</button></div>
          </div>
        </div>
      )}
      {showCredit&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowCredit(false)}>
          <div className="modal" style={{maxWidth:460}}>
            <div className="modal-title">Log <span>Credit Note</span></div>
            <div style={{fontSize:12,color:T.muted,marginBottom:12}}>
              For when the wrong part was bought and has to go back to the supplier. This reduces
              closing stock and records a credit against the supplier for Finance Dashboard to reconcile.
            </div>
            <div className="field"><label>Part</label>
              <select value={creditForm.partId} onChange={e=>setCreditForm(f=>({...f,partId:e.target.value}))}>
                <option value="">— Select part —</option>
                {parts.map(p=><option key={p.id} value={p.id}>{p.description} ({p.closingQty} {p.unit} in stock)</option>)}
              </select>
            </div>
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={creditForm.date} onChange={v=>setCreditForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Qty returned</label><input type="number" inputMode="decimal" min="0" value={creditForm.qty} onChange={e=>setCreditForm(f=>({...f,qty:e.target.value}))}/></div>
              <div className="field"><label>Unit cost (R excl VAT)</label><input type="number" inputMode="decimal" step="0.01" value={creditForm.unitCost} onChange={e=>setCreditForm(f=>({...f,unitCost:e.target.value}))}/></div>
              <div className="field"><label>Supplier</label>
                <PickOrAdd value={creditForm.supplier} options={supplierOptions}
                  onChange={v=>setCreditForm(f=>({...f,supplier:v}))} placeholder="New supplier name"/>
              </div>
            </div>
            <div className="field"><label>Reason</label>
              <select value={creditForm.reason} onChange={e=>setCreditForm(f=>({...f,reason:e.target.value}))}>
                {CREDIT_REASONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Credit note # (if known)</label><input type="text" value={creditForm.creditNoteNumber} onChange={e=>setCreditForm(f=>({...f,creditNoteNumber:e.target.value}))}/></div>
            {creditForm.qty&&creditForm.unitCost&&(
              <div className="info-box" style={{marginBottom:12}}>
                <span style={{fontSize:11,color:T.muted}}>Total credit</span>
                <strong style={{fontFamily:"'Space Mono'",color:T.ok}}>{fmtR((parseFloat(creditForm.qty)||0)*(parseFloat(creditForm.unitCost)||0))}</strong>
              </div>
            )}
            <div className="field"><label>Notes</label><input type="text" value={creditForm.notes} onChange={e=>setCreditForm(f=>({...f,notes:e.target.value}))}/></div>
            <div className="field">
              <label>Slip / credit note photo (optional)</label>
              <input type="file" accept="image/*" capture="environment" onChange={pickCreditSlipFile}/>
              {creditForm.pendingSlipName && <div style={{fontSize:11,color:T.ok,marginTop:4}}>Attached: {creditForm.pendingSlipName}</div>}
            </div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={logCredit} disabled={creditBusy}>{creditBusy?"Saving...":"Log Credit Note"}</button><button className="btn btn-ghost" onClick={()=>setShowCredit(false)} disabled={creditBusy}>Cancel</button></div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── REPAIRS ─────────────────────────────────────────────────────────────────
const BLANK_REPAIR = () => ({date:today(),vehicle:"",workshop:"",invoiceNo:"",description:"",labourCost:"",partsCost:"",otherCost:"",invoiceReceived:false,notes:"",slipId:null});
function Repairs({ loc, setLoc, fleet, isAdmin, locId, companyId, slips, onSlipAttached }) {
  const repairs=loc.repairs;
  const upd=patch=>setLoc(l=>({...l,...patch}));
  const [showForm,setShowForm]=useState(false);
  const [viewEntry,setViewEntry]=useState(null);
  const [form,setForm]=useState(BLANK_REPAIR());
  const totalOf=r=>(parseFloat(r.labourCost)||0)+(parseFloat(r.partsCost)||0)+(parseFloat(r.otherCost)||0);
  const formTotal=totalOf(form);

  const addRepair=()=>{
    upd({repairs:[{...form,id:uid(),totalCost:totalOf(form)},...repairs]});
    setForm(BLANK_REPAIR());setShowForm(false);
  };

  const totalSpend=repairs.reduce((s,r)=>s+(r.totalCost||0),0);
  const byVehicle=useMemo(()=>{
    const m={};
    repairs.forEach(r=>{if(!r.vehicle)return;if(!m[r.vehicle])m[r.vehicle]={count:0,cost:0};m[r.vehicle].count++;m[r.vehicle].cost+=r.totalCost||0;});
    return Object.entries(m).sort((a,b)=>b[1].cost-a[1].cost);
  },[repairs]);

  return(
    <>
      <div className="strip">
        <div className="strip-item"><div className="strip-label">Total Spend</div><div className="strip-val">{fmtR(totalSpend)}</div></div>
        <div className="strip-item"><div className="strip-label">Jobs</div><div className="strip-val">{repairs.length}</div></div>
        <div style={{marginLeft:"auto"}}><button className="btn btn-primary" onClick={()=>{setForm(BLANK_REPAIR());setShowForm(true);}}>+ Log Repair</button></div>
      </div>
      {byVehicle.length>0&&(
        <div style={{marginBottom:20}}>
          <div className="section-title">Spend by Vehicle</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Vehicle</th><th className="num">Jobs</th><th className="num">Total</th><th>Bar</th></tr></thead>
            <tbody>
              {byVehicle.map(([vid,d])=>(
                <tr key={vid}>
                  <td style={{fontWeight:600}}>{fleet.find(v=>v.id===vid)?.name||vid}</td>
                  <td className="num">{d.count}</td>
                  <td className="num" style={{color:T.gold}}>{fmtR(d.cost)}</td>
                  <td style={{width:130}}><div className="gauge-wrap" style={{marginTop:0}}><div className="gauge-fill" style={{width:`${totalSpend>0?d.cost/totalSpend*100:0}%`,background:T.ok}}/></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      <div className="section-title">All Repair Jobs</div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Date</th><th>Vehicle</th><th>Workshop</th><th>Description</th><th className="num">Labour</th><th className="num">Parts</th><th className="num">Total</th><th>Invoice</th><th>Slip</th><th></th></tr></thead>
        <tbody>
          {repairs.map(r=>(
            <tr key={r.id} style={{cursor:"pointer"}} onClick={()=>setViewEntry(r)}>
              <td className="mono" style={{fontSize:12}}>{r.date}</td>
              <td style={{fontWeight:600}}>{fleet.find(v=>v.id===r.vehicle)?.name||r.vehicle||<span style={{color:T.muted}}>—</span>}</td>
              <td style={{fontSize:12,color:T.muted}}>{r.workshop||"—"}</td>
              <td style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:13}}>{r.description||<span style={{color:T.muted}}>—</span>}</td>
              <td className="num">{parseFloat(r.labourCost)>0?fmtR(r.labourCost):<span style={{color:T.muted}}>—</span>}</td>
              <td className="num">{parseFloat(r.partsCost)>0?fmtR(r.partsCost):<span style={{color:T.muted}}>—</span>}</td>
              <td className="num" style={{fontWeight:700,color:T.gold}}>{fmtR(r.totalCost||0)}</td>
              <td>{r.invoiceNo?<span className="badge badge-v">#{r.invoiceNo}</span>:r.invoiceReceived?<span className="badge badge-d">Received</span>:<span className="badge" style={{background:"rgba(192,80,80,.15)",color:T.danger,border:"1px solid rgba(192,80,80,.3)"}}>Pending</span>}</td>
              <td onClick={e=>e.stopPropagation()}>
                {r.slipId && slips[r.slipId] ? <ViewSlipLink storagePath={slips[r.slipId].storage_path}/>
                  : <AttachSlipButton companyId={companyId} locId={locId}
                      onAttached={(slip)=>{onSlipAttached(slip); sb.patch("repairs",r.id,{slip_id:slip.id}).catch(e=>alert("Saved photo but could not link it: "+e.message)); upd({repairs:repairs.map(x=>x.id===r.id?{...x,slipId:slip.id}:x)});}}/>}
              </td>
              <td onClick={e=>e.stopPropagation()}>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>upd({repairs:repairs.filter(x=>x.id!==r.id)})}>x</button>}</td>
            </tr>
          ))}
          {repairs.length===0&&<tr><td colSpan={10} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No repairs logged at this location</td></tr>}
        </tbody>
      </table></div>
      {viewEntry&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setViewEntry(null)}>
          <div className="modal" style={{maxWidth:540}}>
            <div className="modal-title">* Repair Detail <button className="btn btn-ghost btn-sm" style={{marginLeft:"auto"}} onClick={()=>setViewEntry(null)}>Close</button></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 18px",marginBottom:16}}>
              {[["Date",viewEntry.date],["Vehicle",fleet.find(v=>v.id===viewEntry.vehicle)?.name||viewEntry.vehicle||"—"],["Workshop",viewEntry.workshop||"—"],["Invoice #",viewEntry.invoiceNo||"—"]].map(([l,v])=>(
                <div key={l} style={{padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
                  <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:T.muted,fontWeight:600,marginBottom:2}}>{l}</div>
                  <div style={{fontSize:13,fontWeight:600,color:T.cream}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{background:"rgba(0,0,0,.28)",border:`1px solid ${T.border}`,borderRadius:7,padding:"12px 15px",marginBottom:16}}>
              <div style={{fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:T.muted,fontWeight:600,marginBottom:6}}>Work Description</div>
              <div style={{fontSize:13,color:T.cream,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{viewEntry.description||"—"}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
              {[["Workshop Labour",viewEntry.labourCost],["Parts Supplied",viewEntry.partsCost],["Other",viewEntry.otherCost]].map(([l,v])=>(
                <div key={l} style={{background:"rgba(201,125,58,.06)",border:`1px solid rgba(201,125,58,.2)`,borderRadius:7,padding:"11px 13px",textAlign:"center"}}>
                  <div style={{fontSize:9,letterSpacing:".1em",textTransform:"uppercase",color:T.muted,fontWeight:600,marginBottom:3}}>{l}</div>
                  <div style={{fontSize:16,fontWeight:700,fontFamily:"'Space Mono'",color:parseFloat(v)>0?T.cream:T.muted}}>{parseFloat(v)>0?fmtR(v):"—"}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(201,125,58,.12)",border:`1px solid rgba(201,125,58,.35)`,borderRadius:7,padding:"12px 16px"}}>
              <span style={{fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:T.gold}}>Total Invoice</span>
              <span style={{fontSize:21,fontWeight:700,fontFamily:"'Space Mono'",color:T.gold}}>{fmtR(viewEntry.totalCost||0)}</span>
            </div>
            {viewEntry.notes&&<div style={{marginTop:12,fontSize:12,color:T.muted}}><strong style={{color:T.cream}}>Notes:</strong> {viewEntry.notes}</div>}
          </div>
        </div>
      )}
      {showForm&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowForm(false)}>
          <div className="modal" style={{maxWidth:540}}>
            <div className="modal-title">Log <span>External Repair</span></div>
            <ScanSlipButton companyId={companyId} locId={locId} onResult={({slipId,ocr})=>{
              const hasCosts = (parseFloat(form.labourCost)||0)+(parseFloat(form.partsCost)||0)+(parseFloat(form.otherCost)||0) > 0;
              setForm(f=>({
                ...f, slipId,
                date: ocr?.date_guess ? fromISO(ocr.date_guess) : f.date,
                workshop: ocr?.supplier_guess || f.workshop,
                otherCost: (!hasCosts && ocr?.slip_total!=null) ? String(ocr.slip_total) : f.otherCost,
              }));
            }}/>
            {form.slipId && <div style={{fontSize:11,color:T.muted,marginBottom:10}}>If the invoice total was pre-filled into "Other", move it between Labour/Parts/Other as it's actually billed.</div>}
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={form.date} onChange={v=>setForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Vehicle / Equipment</label>
                <select value={form.vehicle} onChange={e=>setForm(f=>({...f,vehicle:e.target.value}))}>
                  <option value="">— Select —</option>
                  {fleet.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Workshop / Mechanic</label><input type="text" placeholder="e.g. Total Autocare" value={form.workshop} onChange={e=>setForm(f=>({...f,workshop:e.target.value}))}/></div>
              <div className="field"><label>Invoice Number</label><input type="text" value={form.invoiceNo} onChange={e=>setForm(f=>({...f,invoiceNo:e.target.value}))}/></div>
            </div>
            <div className="field"><label>Work Description</label>
              <textarea rows={3} placeholder="Describe what was repaired or replaced..." value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} style={{width:"100%",background:"rgba(0,0,0,.3)",border:`1px solid ${T.border}`,borderRadius:6,padding:"8px 11px",color:T.cream,fontFamily:"'Inter',sans-serif",fontSize:13,outline:"none",resize:"vertical"}} onFocus={e=>e.target.style.borderColor=T.gold} onBlur={e=>e.target.style.borderColor=T.border}/>
            </div>
            <div className="grid3">
              <div className="field"><label>Labour (R)</label><input type="number" inputMode="decimal" min="0" value={form.labourCost} onChange={e=>setForm(f=>({...f,labourCost:e.target.value}))}/></div>
              <div className="field"><label>Parts (R)</label><input type="number" inputMode="decimal" min="0" value={form.partsCost} onChange={e=>setForm(f=>({...f,partsCost:e.target.value}))}/></div>
              <div className="field"><label>Other (R)</label><input type="number" inputMode="decimal" min="0" value={form.otherCost} onChange={e=>setForm(f=>({...f,otherCost:e.target.value}))}/></div>
            </div>
            <div className="info-box" style={{marginBottom:12}}>
              <span style={{fontSize:11,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>Invoice Total</span>
              <span style={{fontFamily:"'Space Mono'",fontWeight:700,fontSize:17,color:T.gold}}>{fmtR(formTotal)}</span>
            </div>
            <div className="field"><label>Notes</label><input type="text" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></div>
            <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:16}}>
              <input type="checkbox" id="inv-recv" checked={form.invoiceReceived} onChange={e=>setForm(f=>({...f,invoiceReceived:e.target.checked}))} style={{accentColor:T.gold,width:15,height:15}}/>
              <label htmlFor="inv-recv" style={{fontSize:13,color:T.muted,cursor:"pointer"}}>Invoice received</label>
            </div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={addRepair}>Save Repair</button><button className="btn btn-ghost" onClick={()=>setShowForm(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── FLEET MANAGEMENT ────────────────────────────────────────────────────────

// ─── FLEET LICENCE & SERVICE HELPERS ─────────────────────────────────────────
const LICENSE_WARN_DAYS = 14;   // notify 2 weeks before licence disk expires
const SERVICE_WARN_DAYS = 14;   // notify 2 weeks before service due date
const SERVICE_WARN_KM   = 500;  // notify within 500 km of service due

const parseDMY = (s) => {
  if (!s) return null;
  const p = s.split("/");
  if (p.length !== 3) return null;
  const d = new Date(+p[2], +p[1]-1, +p[0]);
  return isNaN(d.getTime()) ? null : d;
};
const fmtDMY = (dt) =>
  `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}`;
const addMonths = (dt, n) => { const d = new Date(dt.getTime()); d.setMonth(d.getMonth()+n); return d; };
const daysUntil = (dmy) => {
  const d = parseDMY(dmy);
  if (!d) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  return Math.round((d - t) / 86400000);
};

// Highest odometer reading seen for each vehicle, across every location
function latestOdometers(locData) {
  const m = {};
  Object.values(locData).forEach(loc => {
    if (!loc) return;
    [...(loc.dieselIssues||[]), ...(loc.petrolIssues||[])].forEach(e => {
      const km = parseFloat(e.mileage);
      if (e.vehicle && !isNaN(km) && km > 0) {
        m[e.vehicle] = Math.max(m[e.vehicle] || 0, km);
      }
    });
  });
  return m;
}

// Works out licence + service standing for one vehicle
function vehicleStatus(v, latestKm) {
  const out = { license:null, service:null };

  if (v.license_expiry) {
    const days = daysUntil(v.license_expiry);
    out.license = {
      date: v.license_expiry,
      days,
      state: days < 0 ? "overdue" : days <= LICENSE_WARN_DAYS ? "soon" : "ok",
    };
  }

  const hasDate = v.last_service_date && v.service_interval_months > 0;
  const hasKm   = v.last_service_km != null && v.service_interval_km > 0;

  if (hasDate || hasKm) {
    const s = { dueDate:null, daysLeft:null, dueKm:null, kmLeft:null, state:"ok",
                lastDate:v.last_service_date||null, lastKm:v.last_service_km ?? null };

    if (hasDate) {
      const last = parseDMY(v.last_service_date);
      if (last) {
        s.dueDate  = fmtDMY(addMonths(last, +v.service_interval_months));
        s.daysLeft = daysUntil(s.dueDate);
      }
    }
    if (hasKm) {
      s.dueKm = (+v.last_service_km) + (+v.service_interval_km);
      if (latestKm != null) s.kmLeft = s.dueKm - latestKm;
    }

    // Whichever trigger comes first wins
    const states = [];
    if (s.daysLeft != null) states.push(s.daysLeft < 0 ? "overdue" : s.daysLeft <= SERVICE_WARN_DAYS ? "soon" : "ok");
    if (s.kmLeft   != null) states.push(s.kmLeft   < 0 ? "overdue" : s.kmLeft   <= SERVICE_WARN_KM   ? "soon" : "ok");
    s.state = states.includes("overdue") ? "overdue" : states.includes("soon") ? "soon" : "ok";
    out.service = s;
  }

  return out;
}

// Every vehicle needing attention, worst first
function buildFleetAlerts(fleet, locData) {
  const odo = latestOdometers(locData);
  const rows = [];
  fleet.forEach(v => {
    const st = vehicleStatus(v, odo[v.id]);
    if (st.license && st.license.state !== "ok") {
      rows.push({ vehicle:v, kind:"Licence disk", state:st.license.state,
        detail: st.license.state === "overdue"
          ? `Expired ${Math.abs(st.license.days)} day${Math.abs(st.license.days)===1?"":"s"} ago (${st.license.date})`
          : `Expires in ${st.license.days} day${st.license.days===1?"":"s"} (${st.license.date})` });
    }
    if (st.service && st.service.state !== "ok") {
      const bits = [];
      if (st.service.daysLeft != null) {
        bits.push(st.service.daysLeft < 0
          ? `${Math.abs(st.service.daysLeft)} day${Math.abs(st.service.daysLeft)===1?"":"s"} overdue`
          : `due in ${st.service.daysLeft} day${st.service.daysLeft===1?"":"s"}`);
      }
      if (st.service.kmLeft != null) {
        bits.push(st.service.kmLeft < 0
          ? `${Math.abs(st.service.kmLeft).toLocaleString()} km past due`
          : `${st.service.kmLeft.toLocaleString()} km to go`);
      }
      rows.push({ vehicle:v, kind:"Service", state:st.service.state, detail: bits.join(" · ") });
    }
  });
  return rows.sort((a,b) => (a.state==="overdue"?0:1) - (b.state==="overdue"?0:1));
}

// ─── SELF-SERVICED VEHICLES -> MAINTENANCE JOB CARDS ─────────────────────────
// Both apps share one Supabase project. This writes directly into the
// Maintenance app's own tables (maint_jobs / maint_job_materials) — there's
// no API between the two apps, just the shared database, same as everything
// else in this build. Runs once per full data load (from loadAll), not from
// FleetAlerts, since that component renders on three different pages and
// would otherwise trigger this repeatedly.
async function syncServiceJobs(fleet, locData, companyId) {
  const odo = latestOdometers(locData);
  const due = fleet.filter(v => {
    if (!v.self_serviced || !v.service_location_id) return false;
    const st = vehicleStatus(v, odo[v.id]);
    return st.service && (st.service.state === "soon" || st.service.state === "overdue");
  });

  const result = {}; // vehicleId -> { open: true }
  if (due.length === 0) return result;

  try {
    // One query for every currently-open vehicle-linked job, rather than one per vehicle.
    // maint_jobs is owned by the Maintenance app, not Ops — company_id was
    // added to it in Maintenance's own 3a (2026-08-08), closing the gap
    // Ops's 3a deliberately left open (see add_company_id_to_ops_tables.sql).
    const openJobs = await sb.select("maint_jobs", `company_id=eq.${companyId}&vehicle_id=not.is.null&status=in.(scheduled,in_progress)`);
    const openByVehicle = new Set(openJobs.map(j => j.vehicle_id));

    for (const v of due) {
      if (openByVehicle.has(v.id)) { result[v.id] = { open:true }; continue; }
      const row = {
        id: uid(), location_id: v.service_location_id, company_id: companyId, template_id: null, vehicle_id: v.id,
        name: `Service: ${v.name}`,
        description: "Auto-created from Operations — this vehicle is due for scheduled service. Add the parts/materials needed below.",
        job_type: "preventive", destination_id: null, dest_name: null,
        assigned_to: null, due_date: today(), status: "scheduled",
      };
      await sb.insert("maint_jobs", row);
      result[v.id] = { open:true, justCreated:true };
    }
  } catch (e) {
    console.error("syncServiceJobs:", e);
  }
  return result;
}

// ─── FLEET ALERTS BANNER ─────────────────────────────────────────────────────
function FleetAlerts({ fleet, locData, onOpenVehicle, serviceJobs }) {
  const alerts = useMemo(() => buildFleetAlerts(fleet, locData), [fleet, locData]);
  if (alerts.length === 0) return null;

  const overdue = alerts.filter(a => a.state === "overdue").length;

  return (
    <div style={{
      background: overdue ? "rgba(192,88,88,.08)" : "rgba(200,151,58,.08)",
      border: `1px solid ${overdue ? "rgba(192,88,88,.3)" : "rgba(200,151,58,.3)"}`,
      borderRadius: 8, padding: "13px 16px", marginBottom: 18,
    }}>
      <div style={{fontSize:10,letterSpacing:".12em",textTransform:"uppercase",fontWeight:700,
        color: overdue ? T.danger : T.warn, marginBottom:9}}>
        Fleet Attention Needed ({alerts.length})
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {alerts.map((a,i) => {
          const sentToMaint = a.kind==="Service" && a.vehicle.self_serviced && serviceJobs?.[a.vehicle.id]?.open;
          return (
          <button key={i}
            onClick={() => onOpenVehicle && onOpenVehicle(a.vehicle)}
            style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap",background:"none",
              border:"none",padding:0,textAlign:"left",cursor:onOpenVehicle?"pointer":"default",
              fontFamily:"'Inter',sans-serif",width:"100%"}}>
            <span className="badge" style={{
              background: a.state==="overdue" ? "rgba(192,88,88,.2)" : "rgba(200,151,58,.2)",
              color:      a.state==="overdue" ? T.danger : T.warn,
              border:`1px solid ${a.state==="overdue" ? "rgba(192,88,88,.4)" : "rgba(200,151,58,.4)"}`,
              flexShrink:0,
            }}>{a.kind}</span>
            <span style={{fontSize:13,fontWeight:600,color:T.cream}}>{a.vehicle.name}</span>
            <span style={{fontSize:12,color:T.muted}}>{a.detail}</span>
            {sentToMaint && (
              <span className="badge badge-v" style={{flexShrink:0}}>→ Job card in Maintenance</span>
            )}
          </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── VEHICLE DETAIL ──────────────────────────────────────────────────────────
function VehicleDetail({ vehicle, locData, onClose }) {
  const [tab, setTab] = useState("repairs");
  const DIESEL_PRICE = 20.5;
  const PETROL_PRICE = 21.5;

  const data = useMemo(() => {
    const repairs = [];
    const parts   = [];
    const fuel    = [];

    LOCATIONS.forEach(l => {
      const loc = locData[l.id];
      if (!loc) return;

      (loc.repairs||[]).forEach(r => {
        if (r.vehicle === vehicle.id) repairs.push({ ...r, locId:l.id, locName:l.name });
      });

      (loc.partIssues||[]).forEach(iss => {
        if (iss.vehicle !== vehicle.id) return;
        const p = (loc.parts||[]).find(x=>x.id===iss.partId);
        parts.push({
          id: iss.id, date: iss.date || "", description: p?.description || "(deleted part)",
          unit: p?.unit || "", qty: iss.qty, unitCost: p?.openCost||0, value: iss.qty*(p?.openCost||0),
          locId: l.id, locName: l.name,
        });
      });

      (loc.dieselIssues||[]).forEach(e => {
        if (e.vehicle === vehicle.id) fuel.push({
          id:`d-${e.id}`, date:e.date, litres:e.litres||0, type:"Diesel",
          cost:(e.litres||0)*DIESEL_PRICE, mileage:e.mileage, locName:l.name,
        });
      });
      (loc.petrolIssues||[]).forEach(e => {
        if (e.vehicle === vehicle.id) {
          const lit = Math.abs(e.litres < 0 ? e.litres : 0);
          if (lit > 0) fuel.push({
            id:`p-${e.id}`, date:e.date, litres:lit, type:"Petrol",
            cost:lit*PETROL_PRICE, mileage:e.mileage, locName:l.name,
          });
        }
      });
    });

    const byDateDesc = (a,b) => {
      const da = parseDMY(a.date), db = parseDMY(b.date);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    };
    repairs.sort(byDateDesc);
    fuel.sort(byDateDesc);
    parts.sort(byDateDesc);

    const repairTotal = repairs.reduce((s,r)=>s+(r.totalCost||0),0);
    const partsTotal  = parts.reduce((s,p)=>s+p.value,0);
    const fuelTotal   = fuel.reduce((s,f)=>s+f.cost,0);
    const litresTotal = fuel.reduce((s,f)=>s+f.litres,0);

    return { repairs, parts, fuel, repairTotal, partsTotal, fuelTotal, litresTotal };
  }, [vehicle, locData]);

  const odo = latestOdometers(locData)[vehicle.id];
  const st  = vehicleStatus(vehicle, odo);
  const stColor = s => s==="overdue" ? T.danger : s==="soon" ? T.warn : T.ok;
  const grandTotal = data.repairTotal + data.partsTotal + data.fuelTotal;

  const TABS = [
    { id:"repairs", label:`Repairs (${data.repairs.length})` },
    { id:"parts",   label:`Parts (${data.parts.length})` },
    { id:"fuel",    label:`Fuel (${data.fuel.length})` },
  ];

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:760}}>
        <div className="modal-title">{vehicle.name}</div>
        <div style={{display:"flex",gap:7,marginBottom:16,flexWrap:"wrap"}}>
          <span className="mono" style={{fontSize:11,color:T.muted}}>{vehicle.id}</span>
          <span className={`badge badge-${vehicle.fuel==="diesel"?"d":"p"}`}>{vehicle.fuel}</span>
          <span className={`badge badge-${vehicle.category==="vehicle"?"v":"e"}`}>{vehicle.category}</span>
          {odo != null && <span className="badge badge-neu">{odo.toLocaleString()} km</span>}
        </div>

        {/* Licence + service standing */}
        <div className="grid2" style={{marginBottom:16}}>
          <div style={{background:"rgba(0,0,0,.22)",border:`1px solid ${T.border}`,borderRadius:7,padding:"11px 13px"}}>
            <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:T.muted,fontWeight:700,marginBottom:6}}>Licence Disk</div>
            {st.license ? (<>
              <div style={{fontFamily:"'Space Mono'",fontSize:15,fontWeight:700,color:stColor(st.license.state)}}>
                {st.license.date}
              </div>
              <div style={{fontSize:11,color:T.muted,marginTop:3}}>
                {st.license.days < 0
                  ? `Expired ${Math.abs(st.license.days)} days ago`
                  : `${st.license.days} days remaining`}
              </div>
            </>) : <div style={{fontSize:12,color:T.border}}>Not set</div>}
          </div>

          <div style={{background:"rgba(0,0,0,.22)",border:`1px solid ${T.border}`,borderRadius:7,padding:"11px 13px"}}>
            <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:T.muted,fontWeight:700,marginBottom:6}}>Service</div>
            {st.service ? (<>
              <div style={{fontFamily:"'Space Mono'",fontSize:15,fontWeight:700,color:stColor(st.service.state)}}>
                {st.service.dueDate || (st.service.dueKm != null ? `${st.service.dueKm.toLocaleString()} km` : "—")}
              </div>
              <div style={{fontSize:11,color:T.muted,marginTop:3,lineHeight:1.5}}>
                {st.service.lastDate && <>Last: {st.service.lastDate}<br/></>}
                {st.service.daysLeft != null && (st.service.daysLeft < 0
                  ? `${Math.abs(st.service.daysLeft)} days overdue`
                  : `Due in ${st.service.daysLeft} days`)}
                {st.service.kmLeft != null && <><br/>{st.service.kmLeft < 0
                  ? `${Math.abs(st.service.kmLeft).toLocaleString()} km past due`
                  : `${st.service.kmLeft.toLocaleString()} km to go`}</>}
              </div>
            </>) : <div style={{fontSize:12,color:T.border}}>Not set</div>}
          </div>
        </div>

        {/* Lifetime cost strip */}
        <div className="strip" style={{marginBottom:16}}>
          <div className="strip-item"><div className="strip-label">Fuel</div><div className="strip-val">{fmtR(data.fuelTotal)}</div></div>
          <div className="strip-item"><div className="strip-label">Parts</div><div className="strip-val">{fmtR(data.partsTotal)}</div></div>
          <div className="strip-item"><div className="strip-label">Repairs</div><div className="strip-val">{fmtR(data.repairTotal)}</div></div>
          <div className="strip-item"><div className="strip-label">Total</div>
            <div className="strip-val" style={{color:T.goldLt}}>{fmtR(grandTotal)}</div></div>
        </div>

        <div className="tabs">
          {TABS.map(t=>(
            <button key={t.id} className={`tab${tab===t.id?" active":""}`} onClick={()=>setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {/* REPAIRS */}
        {tab==="repairs" && (
          <div className="tbl-wrap"><table className="tbl" style={{minWidth:0}}>
            <thead><tr><th>Date</th><th>Workshop</th><th>Description</th><th>Where</th>
              <th className="num">Labour</th><th className="num">Parts</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.repairs.map(r=>(
                <tr key={r.id}>
                  <td className="mono" style={{fontSize:11}}>{r.date}</td>
                  <td style={{fontWeight:600}}>{r.workshop||"—"}</td>
                  <td style={{fontSize:12,color:T.muted,maxWidth:220}}>{r.description||"—"}</td>
                  <td><span className="badge badge-neu">{r.locId}</span></td>
                  <td className="num" style={{color:T.muted}}>{fmtR(r.labourCost)}</td>
                  <td className="num" style={{color:T.muted}}>{fmtR(r.partsCost)}</td>
                  <td className="num" style={{fontWeight:700,color:T.gold}}>{fmtR(r.totalCost)}</td>
                </tr>
              ))}
              {data.repairs.length===0&&<tr><td colSpan={7} className="empty">No repairs recorded for this vehicle</td></tr>}
            </tbody>
          </table></div>
        )}

        {/* PARTS */}
        {tab==="parts" && (
          <div className="tbl-wrap"><table className="tbl" style={{minWidth:0}}>
            <thead><tr><th>Date</th><th>Part</th><th>Where</th><th className="num">Qty</th>
              <th className="num">Unit Cost</th><th className="num">Value</th></tr></thead>
            <tbody>
              {data.parts.map(p=>(
                <tr key={p.id}>
                  <td className="mono" style={{fontSize:11,color:p.date?T.cream:T.muted}}>{p.date || "unknown"}</td>
                  <td style={{fontWeight:600}}>{p.description}</td>
                  <td><span className="badge badge-neu">{p.locId}</span></td>
                  <td className="num">{p.qty} <span style={{fontSize:10,color:T.muted}}>{p.unit}</span></td>
                  <td className="num" style={{color:T.muted}}>{fmtR(p.unitCost)}</td>
                  <td className="num" style={{fontWeight:700,color:T.gold}}>{fmtR(p.value)}</td>
                </tr>
              ))}
              {data.parts.length===0&&<tr><td colSpan={6} className="empty">No parts allocated to this vehicle</td></tr>}
            </tbody>
          </table></div>
        )}

        {/* FUEL */}
        {tab==="fuel" && (
          <div className="tbl-wrap"><table className="tbl" style={{minWidth:0}}>
            <thead><tr><th>Date</th><th>Type</th><th>Where</th><th className="num">Litres</th>
              <th className="num">Odometer</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {data.fuel.map(f=>(
                <tr key={f.id}>
                  <td className="mono" style={{fontSize:11}}>{f.date}</td>
                  <td><span className={`badge badge-${f.type==="Diesel"?"d":"p"}`}>{f.type}</span></td>
                  <td style={{fontSize:11,color:T.muted}}>{f.locName}</td>
                  <td className="num">{f.litres.toFixed(1)} L</td>
                  <td className="num" style={{color:T.muted}}>{f.mileage?Number(f.mileage).toLocaleString():"—"}</td>
                  <td className="num" style={{fontWeight:700,color:T.gold}}>{fmtR(f.cost)}</td>
                </tr>
              ))}
              {data.fuel.length===0&&<tr><td colSpan={6} className="empty">No fuel issued to this vehicle</td></tr>}
            </tbody>
          </table></div>
        )}

        <div style={{display:"flex",gap:9,marginTop:16}}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function FleetManager({ fleet, setFleet, sbFleet, locData, serviceJobs, companyId }) {
  // Read the flag here rather than threading a prop down — the Running Cost
  // field is the only part of this page that's Demo-gated.
  const { vehicleRegisterEnabled } = useCompany();
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [detailVehicle, setDetailVehicle] = useState(null);
  const BLANK_V = { name:"", id:"", category:"vehicle", fuel:"diesel",
    license_expiry:"", last_service_date:"", last_service_km:"",
    service_interval_months:"", service_interval_km:"",
    cost_per_km:"", insurance_monthly:"",
    self_serviced:false, service_location_id:"" };
  const [form, setForm] = useState(BLANK_V);

  const odo = useMemo(()=>latestOdometers(locData||{}), [locData]);

  const openAdd  = () => { setForm(BLANK_V); setEditEntry(null); setShowForm(true); };
  const openEdit = (v) => {
    setForm({...BLANK_V, ...Object.fromEntries(Object.entries(v).map(([k,x])=>[k, x==null?"":x]))});
    setEditEntry(v.id); setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.id.trim()) return;
    try {
      if (editEntry) {
        await sbFleet.upd(form);
        setFleet(f => f.map(v => v.id === editEntry ? {...form} : v));
      } else {
        if (fleet.find(v => v.id === form.id)) { alert("ID already exists — choose a unique ID"); return; }
        await sbFleet.add(form, companyId);
        setFleet(f => [...f, {...form}]);
      }
      setShowForm(false);
    } catch(e) { alert("Error saving: " + e.message); }
  };

  const remove = async (v) => {
    if (!window.confirm(`Remove ${v.name}?`)) return;
    try {
      await sbFleet.remove(v.id);
      setFleet(f => f.filter(x => x.id !== v.id));
    } catch(e) { alert("Error removing: " + e.message); }
  };

  // Grouped so that EVERY fleet row lands somewhere (2026-08-27). This used to
  // be `category === "vehicle"` vs `category === "equipment"`, which meant a row
  // with any other category — Demo's seed used descriptive ones like "Game
  // Drive Vehicle" — matched neither group and silently vanished from the only
  // page that manages it, while still appearing in every dropdown. A vehicle
  // being invisible on its own register is a bad failure, so equipment is now
  // the explicit case and everything else is treated as a vehicle.
  const equipment  = fleet.filter(v => v.category === "equipment");
  const vehicles   = fleet.filter(v => v.category !== "equipment");

  return (
    <>
      <FleetAlerts fleet={fleet} locData={locData||{}} onOpenVehicle={setDetailVehicle} serviceJobs={serviceJobs}/>

      <div className="strip">
        <div className="strip-item"><div className="strip-label">Vehicles</div><div className="strip-val">{vehicles.length}</div></div>
        <div className="strip-item"><div className="strip-label">Equipment</div><div className="strip-val">{equipment.length}</div></div>
        <div style={{marginLeft:"auto"}}><button className="btn btn-primary" onClick={openAdd}>+ Add Vehicle / Equipment</button></div>
      </div>

      {[{label:"Vehicles", items:vehicles}, {label:"Equipment", items:equipment}].map(group => (
        <div key={group.label} style={{marginBottom:28}}>
          <div className="section-title">{group.label}</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Name</th><th>ID / Reg</th><th>Fuel</th><th>Licence Disk</th><th>Service Due</th><th></th></tr></thead>
            <tbody>
              {group.items.map(v => {
                const st = vehicleStatus(v, odo[v.id]);
                const col = s => s==="overdue"?T.danger:s==="soon"?T.warn:T.ok;
                return (
                <tr key={v.id}>
                  <td style={{fontWeight:600}}>
                    <button onClick={()=>setDetailVehicle(v)}
                      style={{background:"none",border:"none",padding:0,color:T.cream,fontWeight:600,
                        fontFamily:"'Inter',sans-serif",fontSize:13,cursor:"pointer",textAlign:"left",
                        display:"flex",alignItems:"center",gap:7}}>
                      {v.name}
                      {v.self_serviced && <span className="badge badge-neu" title="Serviced in-house">In-house</span>}
                    </button>
                  </td>
                  <td className="mono" style={{fontSize:11,color:T.muted}}>{v.id}</td>
                  <td><span className={`badge badge-${v.fuel==="diesel"?"d":"p"}`}>{v.fuel}</span></td>
                  <td>
                    {st.license
                      ? <span style={{fontFamily:"'Space Mono'",fontSize:12,color:col(st.license.state)}}>
                          {st.license.date}
                        </span>
                      : <span style={{color:T.border,fontSize:11}}>—</span>}
                  </td>
                  <td>
                    {st.service
                      ? <span style={{fontFamily:"'Space Mono'",fontSize:12,color:col(st.service.state)}}>
                          {st.service.dueDate || (st.service.dueKm!=null?`${st.service.dueKm.toLocaleString()} km`:"—")}
                        </span>
                      : <span style={{color:T.border,fontSize:11}}>—</span>}
                  </td>
                  <td style={{display:"flex",gap:6}}>
                    <button className="btn btn-ghost btn-sm" onClick={()=>openEdit(v)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>remove(v)}>Remove</button>
                  </td>
                </tr>
              );})}
              {group.items.length===0&&<tr><td colSpan={6} className="empty">No {group.label.toLowerCase()} yet</td></tr>}
            </tbody>
          </table></div>
        </div>
      ))}

      {detailVehicle && (
        <VehicleDetail vehicle={detailVehicle} locData={locData||{}} onClose={()=>setDetailVehicle(null)}/>
      )}

      {showForm && (
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowForm(false)}>
          <div className="modal" style={{maxWidth:440}}>
            <div className="modal-title">{editEntry?"Edit":"Add"} <span>Vehicle / Equipment</span></div>
            <div className="field"><label>Display Name</label><input type="text" placeholder="e.g. Toyota Hilux GD6 — Martin" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
            <div className="field">
              <label>ID / Registration</label>
              <input type="text" placeholder="e.g. GD6 Martin" value={form.id} onChange={e=>setForm(f=>({...f,id:e.target.value}))} disabled={!!editEntry}
                style={{opacity:editEntry?0.5:1}}/>
              {editEntry && <div style={{fontSize:11,color:T.muted,marginTop:3}}>ID cannot be changed after creation</div>}
            </div>
            <div className="grid2">
              <div className="field"><label>Type</label>
                <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                  <option value="vehicle">Vehicle</option>
                  <option value="equipment">Equipment</option>
                </select>
              </div>
              <div className="field"><label>Fuel</label>
                <select value={form.fuel} onChange={e=>setForm(f=>({...f,fuel:e.target.value}))}>
                  <option value="diesel">Diesel</option>
                  <option value="petrol">Petrol</option>
                </select>
              </div>
            </div>

            <div className="section-title" style={{marginTop:6}}>Licence Disk</div>
            <div className="field"><label>Expiry Date</label>
              <DateField value={form.license_expiry} onChange={v=>setForm(f=>({...f,license_expiry:v}))}/>
              <div style={{fontSize:11,color:T.muted,marginTop:4}}>
                You will be alerted {LICENSE_WARN_DAYS} days before this date.
              </div>
            </div>

            <div className="section-title" style={{marginTop:12}}>Service Schedule</div>
            <div style={{fontSize:11,color:T.muted,marginBottom:10,lineHeight:1.55}}>
              Fill in either the date fields, the kilometre fields, or both.
              With both, whichever falls due first triggers the alert. Leave blank to skip service tracking.
            </div>
            <div className="grid2">
              <div className="field"><label>Last Service Date</label>
                <DateField value={form.last_service_date} onChange={v=>setForm(f=>({...f,last_service_date:v}))}/>
              </div>
              <div className="field"><label>Interval (months)</label>
                <input type="number" inputMode="decimal" min="0" placeholder="e.g. 12" value={form.service_interval_months}
                  onChange={e=>setForm(f=>({...f,service_interval_months:e.target.value}))}/>
              </div>
              <div className="field"><label>Odometer at Last Service (km)</label>
                <input type="number" inputMode="decimal" min="0" placeholder="e.g. 82000" value={form.last_service_km}
                  onChange={e=>setForm(f=>({...f,last_service_km:e.target.value}))}/>
              </div>
              <div className="field"><label>Interval (km)</label>
                <input type="number" inputMode="decimal" min="0" placeholder="e.g. 10000" value={form.service_interval_km}
                  onChange={e=>setForm(f=>({...f,service_interval_km:e.target.value}))}/>
              </div>
            </div>

            <div className="field" style={{marginBottom:6}}>
              <label>Insurance Premium (R per month)</label>
              <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="e.g. 1250.00"
                value={form.insurance_monthly ?? ""} onChange={e=>setForm(f=>({...f,insurance_monthly:e.target.value}))}/>
              <div style={{fontSize:11,color:T.muted,marginTop:4}}>
                What this vehicle costs to insure each month. Unlike fuel and repairs there's no transaction to
                read it from, so it has to be entered here — it then feeds into the vehicle's cost per km on the
                Cost Summary, and into what maintenance trips are charged. Leave blank if it isn't insured
                separately.
              </div>
            </div>


            <div style={{background:"rgba(184,147,90,.06)",border:`1px solid rgba(184,147,90,.2)`,borderRadius:7,padding:"12px 13px",marginBottom:6}}>
              <label style={{display:"flex",alignItems:"center",gap:9,cursor:"pointer",marginBottom:form.self_serviced?12:0}}>
                <input type="checkbox" checked={!!form.self_serviced}
                  onChange={e=>setForm(f=>({...f,self_serviced:e.target.checked}))}
                  style={{width:16,height:16,accentColor:T.gold,cursor:"pointer"}}/>
                <span style={{fontSize:13,fontWeight:600,color:T.cream}}>We service this vehicle ourselves</span>
              </label>
              {form.self_serviced && (
                <>
                  <div className="field" style={{marginBottom:6}}>
                    <label>Send job cards to</label>
                    <select value={form.service_location_id} onChange={e=>setForm(f=>({...f,service_location_id:e.target.value}))}>
                      <option value="">-- Select location's maintenance calendar --</option>
                      {LOCATIONS.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div style={{fontSize:11,color:T.muted,lineHeight:1.55}}>
                    When this vehicle comes due for service, a job card is created automatically on
                    this location's Maintenance app calendar. Add the parts/materials needed over there —
                    completing it there updates the Last Service Date above.
                  </div>
                </>
              )}
            </div>

            <div style={{display:"flex",gap:9}}>
              <button className="btn btn-primary" onClick={save}
                disabled={form.self_serviced && !form.service_location_id}
                style={{opacity:(form.self_serviced && !form.service_location_id)?.5:1}}>
                {editEntry?"Save Changes":"Add to Fleet"}
              </button>
              <button className="btn btn-ghost" onClick={()=>setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── COST SUMMARY ────────────────────────────────────────────────────────────

// ─── VEHICLE RUNNING COST ────────────────────────────────────────────────────
// One shared calculation, used by both the Cost Summary page and the Vehicle
// Log's trip costing (2026-08-27). It used to live inside CostSummary; lifting
// it out means the rate a trip is charged at is provably the same number the
// Cost Summary shows, rather than two implementations drifting apart.
//
// Cost per km = (fuel + parts + repairs) / km driven, where km driven is the
// spread between the highest and lowest odometer readings captured on that
// vehicle's fuel issues. Needs at least two readings — a vehicle without them
// has no rate of its own and falls back to the fleet average.
//
// Fuel is valued at the ACTUAL weighted-average price paid (2026-08-27), taken
// from diesel deliveries and petrol purchases, instead of the hardcoded
// R20.50/R21.50 constants this used to assume. Those constants remain only as
// a fallback for a company with no purchase history yet — otherwise a "live"
// cost per km would be resting on a price someone typed into the source once.

const FALLBACK_DIESEL_PRICE = 20.5;
const FALLBACK_PETROL_PRICE = 21.5;

export function fuelPricesFrom(locData, locIds) {
  let dLitres = 0, dSpend = 0, pLitres = 0, pSpend = 0;
  for (const lid of locIds) {
    const loc = locData?.[lid];
    if (!loc) continue;
    (loc.dieselDeliveries||[]).forEach(d => {
      const l = Number(d.litres)||0, pr = Number(d.pricePerLitre)||0;
      if (l > 0 && pr > 0) { dLitres += l; dSpend += l * pr; }
    });
    (loc.petrolPurchases||[]).forEach(d => {
      const l = Number(d.litres)||0, pr = Number(d.pricePerLitre)||0;
      if (l > 0 && pr > 0) { pLitres += l; pSpend += l * pr; }
    });
  }
  return {
    diesel: dLitres > 0 ? dSpend / dLitres : FALLBACK_DIESEL_PRICE,
    petrol: pLitres > 0 ? pSpend / pLitres : FALLBACK_PETROL_PRICE,
    dieselIsActual: dLitres > 0,
    petrolIsActual: pLitres > 0,
  };
}

// inMonth: null for lifetime, or (dateStr) => boolean for a single month.
// locIds: the lodges being shown. allLocIds: every lodge, used to work out a
// vehicle's total usage so insurance can be split fairly (see below).
export function computeVehicleCosts({ locData, fleet, locIds, inMonth = null, allLocIds = null }) {
  const price = fuelPricesFrom(locData, locIds);
  const everyLoc = allLocIds || locIds;
  const m = {};
  (fleet||[]).forEach(v => {
    m[v.id] = {
      fuel:0, parts:0, repairs:0, name:v.name, fuel_type:v.fuel, category:v.category,
      insurance_monthly: v.insurance_monthly == null ? null : Number(v.insurance_monthly),
      odomReadings:[],           // readings within the lodges being shown
      readingsByLoc:{},          // every lodge, for the insurance split
      firstSeen:null,            // earliest activity anywhere, for months elapsed
    };
  });

  // Pass 1 — every lodge. Needed for the insurance share and the start date,
  // both of which are properties of the vehicle rather than of the view.
  everyLoc.forEach(lid => {
    const loc = locData?.[lid];
    if (!loc) return;
    const noteDate = (v, dateStr) => {
      const d = parseDMY(dateStr);
      if (!d) return;
      if (!m[v].firstSeen || d < m[v].firstSeen) m[v].firstSeen = d;
    };
    const noteKm = (v, mileage) => {
      const km = parseFloat(mileage);
      if (isNaN(km) || km <= 0) return;
      (m[v].readingsByLoc[lid] ||= []).push(km);
    };
    loc.dieselIssues.forEach(e => { if (e.vehicle && m[e.vehicle]) { noteDate(e.vehicle, e.date); noteKm(e.vehicle, e.mileage); } });
    loc.petrolIssues.forEach(e => { if (e.vehicle && m[e.vehicle]) { noteDate(e.vehicle, e.date); noteKm(e.vehicle, e.mileage); } });
    loc.repairs.forEach(e => { if (m[e.vehicle]) noteDate(e.vehicle, e.date); });
  });

  // Pass 2 — only the lodges being shown. Spend and km for the visible view.
  locIds.forEach(lid => {
    const loc = locData?.[lid];
    if (!loc) return;

    loc.dieselIssues.forEach(e => {
      if (inMonth && !inMonth(e.date)) return;
      if (e.vehicle && m[e.vehicle]) {
        m[e.vehicle].fuel += (e.litres||0) * price.diesel;
        const km = parseFloat(e.mileage);
        if (!isNaN(km) && km > 0) m[e.vehicle].odomReadings.push(km);
      }
    });
    loc.petrolIssues.forEach(e => {
      if (inMonth && !inMonth(e.date)) return;
      if (e.vehicle && m[e.vehicle]) {
        m[e.vehicle].fuel += Math.abs(e.litres < 0 ? e.litres : 0) * price.petrol;
        const km = parseFloat(e.mileage);
        if (!isNaN(km) && km > 0) m[e.vehicle].odomReadings.push(km);
      }
    });
    loc.repairs.forEach(e => {
      if (inMonth && !inMonth(e.date)) return;
      if (m[e.vehicle]) m[e.vehicle].repairs += e.totalCost||0;
    });
    (loc.partIssues||[]).forEach(iss => {
      if (inMonth && !inMonth(iss.date)) return;
      if (m[iss.vehicle]) {
        const unitCost = loc.parts.find(p=>p.id===iss.partId)?.openCost || 0;
        m[iss.vehicle].parts += iss.qty * unitCost;
      }
    });
  });

  const spread = arr => (arr && arr.length >= 2) ? Math.max(...arr) - Math.min(...arr) : 0;
  const now = new Date();

  return Object.entries(m).map(([id, d]) => {
    // --- Insurance (2026-08-27) -----------------------------------------
    // A monthly premium, so it has to be multiplied by a number of months.
    // Lifetime counts every month since the vehicle's FIRST record up to
    // today — insurance accrues whether the vehicle moves or not, so a bakkie
    // parked for three months still carries three months of premium. A month
    // view counts exactly one.
    //
    // Split across lodges by share of kilometres, since a premium belongs to
    // the vehicle rather than to any one lodge: viewing a single lodge shows
    // only the portion matching the km it drove. Note the share uses each
    // lodge's own reading spread, which double-counts where trips overlap —
    // it's a weighting, not an exact apportionment, and the all-lodges view
    // (which is what trip costing uses) always comes to the full premium.
    let insurance = 0;
    if (d.insurance_monthly > 0) {
      const months = inMonth
        ? 1
        : (d.firstSeen
            ? Math.max(1, (now.getFullYear()-d.firstSeen.getFullYear())*12 + (now.getMonth()-d.firstSeen.getMonth()) + 1)
            : 0);
      const kmShown = locIds.reduce((s,lid)=>s+spread(d.readingsByLoc[lid]), 0);
      const kmEvery = everyLoc.reduce((s,lid)=>s+spread(d.readingsByLoc[lid]), 0);
      const share = kmEvery > 0
        ? kmShown / kmEvery
        : (locIds.length >= everyLoc.length ? 1 : 0);  // no km anywhere: only count it in the full view
      insurance = d.insurance_monthly * months * share;
    }

    const total = d.fuel + d.parts + d.repairs + insurance;
    const readings = d.odomReadings;
    const kmDriven = readings.length >= 2 ? Math.max(...readings) - Math.min(...readings) : null;
    const costPerKm = kmDriven && kmDriven > 0 ? total / kmDriven : null;
    return { id, ...d, insurance, total, kmDriven, costPerKm };
  })
  .filter(r => r.total > 0)
  .sort((a, b) => b.total - a.total);
}

// The rate a trip should actually be charged at, and where it came from — the
// Vehicle Log shows the basis so nobody has to guess whether a figure is that
// vehicle's own history or a stand-in.
export function runningRateFor(vehicleId, costRows) {
  const own = costRows.find(r => r.id === vehicleId);
  if (own && own.costPerKm != null) return { rate: own.costPerKm, basis: "vehicle" };
  const withRate = costRows.filter(r => r.costPerKm != null);
  if (withRate.length) {
    return { rate: withRate.reduce((s,r)=>s+r.costPerKm,0) / withRate.length, basis: "fleet" };
  }
  return { rate: null, basis: "none" };
}

function CostSummary({ locData, fleet, serviceJobs }) {
  const [viewLoc, setViewLoc]         = useState("all");
  const [detailVehicle, setDetailVehicle] = useState(null);
  const [costTab, setCostTab]         = useState("lifetime"); // "lifetime" | "monthly"
  const [monthCursor, setMonthCursor] = useState(() => { const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()}; });

  const locsToShow = viewLoc === "all" ? LOCATIONS.map(l=>l.id) : [viewLoc];

  // The calculation itself now lives in computeVehicleCosts() above, shared
  // with the Vehicle Log so a trip is charged at exactly the rate shown here.
  // It also values fuel at the real weighted-average price paid rather than
  // the old hardcoded R20.50/R21.50 — so these figures may differ slightly
  // from what this page showed before, and are closer to the truth for it.
  const price = useMemo(()=>fuelPricesFrom(locData, locsToShow), [locData, viewLoc]);
  // allLocIds is every lodge regardless of the filter — the insurance split
  // needs a vehicle's total usage to work out this lodge's share of it.
  const computeCosts = (inMonth) => computeVehicleCosts({
    locData, fleet, locIds: locsToShow, allLocIds: LOCATIONS.map(l=>l.id), inMonth,
  });

  // ── LIFETIME ──
  const lifetime = useMemo(() => computeCosts(null), [locData, fleet, viewLoc]);
  const grand        = lifetime.reduce((s,r) => s + r.total, 0);
  const totalKm       = lifetime.filter(r=>r.kmDriven).reduce((s,r)=>s+(r.kmDriven||0),0);
  const withCpkm      = lifetime.filter(r => r.costPerKm !== null);
  const fleetAvgCpkm  = withCpkm.length > 0
    ? withCpkm.reduce((s,r)=>s+r.total,0) / withCpkm.reduce((s,r)=>s+(r.kmDriven||0),0)
    : null;

  // ── MONTHLY ──
  const monthLabel = (y,m) => new Date(y,m,1).toLocaleString("en-ZA",{month:"long",year:"numeric"});
  const inMonthFilter = (y,m) => (dateStr) => {
    const d = parseDMY(dateStr);
    return !!d && d.getFullYear()===y && d.getMonth()===m;
  };
  const now = new Date();
  const isCurrentOrFutureMonth = monthCursor.y > now.getFullYear() ||
    (monthCursor.y === now.getFullYear() && monthCursor.m >= now.getMonth());

  const monthlyRows = useMemo(
    () => computeCosts(inMonthFilter(monthCursor.y, monthCursor.m)),
    [locData, fleet, viewLoc, monthCursor]
  );
  const monthTotal = monthlyRows.reduce((s,r)=>s+r.total,0);
  const monthKm    = monthlyRows.filter(r=>r.kmDriven).reduce((s,r)=>s+(r.kmDriven||0),0);

  const prevCursor = monthCursor.m === 0 ? {y:monthCursor.y-1, m:11} : {y:monthCursor.y, m:monthCursor.m-1};
  const prevTotal = useMemo(() => {
    const rows = computeCosts(inMonthFilter(prevCursor.y, prevCursor.m));
    return rows.reduce((s,r)=>s+r.total,0);
  }, [locData, fleet, viewLoc, monthCursor]);
  const monthDelta = prevTotal > 0 ? ((monthTotal - prevTotal) / prevTotal) * 100 : null;

  // Trailing 6 months (oldest first) for the trend bars
  const last6 = useMemo(() => {
    const out = [];
    for (let i=5; i>=0; i--) {
      let y=monthCursor.y, m=monthCursor.m-i;
      while (m < 0) { m += 12; y -= 1; }
      const rows = computeCosts(inMonthFilter(y,m));
      out.push({ y, m, total: rows.reduce((s,r)=>s+r.total,0) });
    }
    return out;
  }, [locData, fleet, viewLoc, monthCursor]);
  const last6Max = Math.max(1, ...last6.map(x=>x.total));

  return (
    <>
      <FleetAlerts fleet={fleet} locData={locData} onOpenVehicle={setDetailVehicle} serviceJobs={serviceJobs}/>

      {/* Sub-tabs */}
      <div className="tabs">
        <button className={`tab${costTab==="lifetime"?" active":""}`} onClick={()=>setCostTab("lifetime")}>Lifetime</button>
        <button className={`tab${costTab==="monthly"?" active":""}`} onClick={()=>setCostTab("monthly")}>Monthly</button>
      </div>

      {/* Location filter — shared by both tabs */}
      <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
        {[{id:"all",name:"All Locations"},...LOCATIONS].map(l=>(
          <button key={l.id} className={`btn ${viewLoc===l.id?"btn-primary":"btn-ghost"}`}
            style={{fontSize:12,padding:"6px 13px"}} onClick={()=>setViewLoc(l.id)}>
            {l.name}
          </button>
        ))}
      </div>

      {/* ═══════════════════ LIFETIME TAB ═══════════════════ */}
      {costTab==="lifetime" && (<>
        <div style={{fontSize:11,color:T.muted,marginBottom:14,lineHeight:1.6}}>
          Totals since you started using this app — everything ever logged, with no monthly reset.
          Switch to the <strong style={{color:T.cream}}>Monthly</strong> tab to see a specific month or compare month to month.
        </div>

        <div className="strip">
          <div className="strip-item"><div className="strip-label">Total Fleet Cost</div><div className="strip-val">{fmtR(grand)}</div></div>
          <div className="strip-item"><div className="strip-label">Total KM Tracked</div>
            <div className="strip-val">{totalKm > 0 ? `${totalKm.toLocaleString()} km` : "—"}</div></div>
          <div className="strip-item"><div className="strip-label">Fleet Avg Cost / KM</div>
            <div className="strip-val" style={{color: fleetAvgCpkm ? T.goldLt : T.muted}}>
              {fleetAvgCpkm ? `R ${fleetAvgCpkm.toFixed(2)}` : "—"}
            </div></div>
          {/* Now the real weighted-average price paid, not a constant. The
              subtext says which, so a figure resting on the fallback is never
              mistaken for one backed by actual purchases. */}
          <div className="strip-item"><div className="strip-label">Diesel Rate</div>
            <div className="strip-val" style={{color:T.fuel_d}}>R{price.diesel.toFixed(2)}/L</div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>{price.dieselIsActual?"avg. actually paid":"estimate — no deliveries logged"}</div></div>
          <div className="strip-item"><div className="strip-label">Petrol Rate</div>
            <div className="strip-val" style={{color:T.fuel_p}}>R{price.petrol.toFixed(2)}/L</div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>{price.petrolIsActual?"avg. actually paid":"estimate — no purchases logged"}</div></div>
        </div>

        {lifetime.length > 0 && withCpkm.length === 0 && (
          <div style={{background:"rgba(201,125,58,.07)",border:`1px solid rgba(201,125,58,.22)`,borderRadius:6,
            padding:"9px 13px",marginBottom:16,fontSize:12,color:T.muted}}>
            Tip: Cost/km is calculated from odometer readings on fuel issues. Add mileage when logging diesel or petrol issues to see cost per km.
          </div>
        )}

        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>
            <th>Vehicle / Equipment</th><th>Fuel</th><th className="num">Fuel Cost</th><th className="num">Parts</th>
            <th className="num">Repairs</th><th className="num">Total</th><th className="num">KM Driven</th>
            <th className="num">Cost / KM</th><th>Bar</th>
          </tr></thead>
          <tbody>
            {lifetime.map(r => (
              <tr key={r.id}>
                <td style={{fontWeight:600}}>
                  <button onClick={()=>{ const v = fleet.find(x=>x.id===r.id); if (v) setDetailVehicle(v); }}
                    style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",
                      fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:600,color:T.cream,borderBottom:`1px dotted ${T.border}`}}>
                    {r.name}
                  </button>
                </td>
                <td><span className={`badge badge-${r.fuel_type==="diesel"?"d":"p"}`}>{r.fuel_type}</span></td>
                <td className="num">{fmtR(r.fuel)}</td>
                <td className="num">{fmtR(r.parts)}</td>
                <td className="num">{fmtR(r.repairs)}</td>
                <td className="num" style={{fontWeight:700,color:T.gold}}>{fmtR(r.total)}</td>
                <td className="num" style={{color:T.muted}}>
                  {r.kmDriven !== null ? <span style={{color:T.cream}}>{r.kmDriven.toLocaleString()} km</span> : <span style={{color:T.border,fontSize:11}}>no odo</span>}
                </td>
                <td className="num">
                  {r.costPerKm !== null ? (
                    <span style={{fontWeight:700,fontFamily:"'Space Mono'",color: r.costPerKm < 3 ? T.ok : r.costPerKm < 7 ? T.gold : T.danger}}>
                      R {r.costPerKm.toFixed(2)}
                    </span>
                  ) : <span style={{color:T.border,fontSize:11}}>—</span>}
                </td>
                <td style={{width:100}}>
                  <div className="gauge-wrap" style={{marginTop:0}}>
                    <div className="gauge-fill" style={{width:`${grand>0?r.total/grand*100:0}%`,background:T.gold}}/>
                  </div>
                </td>
              </tr>
            ))}
            {lifetime.length===0 && <tr><td colSpan={9} className="empty">No cost data yet</td></tr>}
          </tbody>
        </table></div>

        {lifetime.length > 0 && (
          <div style={{fontSize:11,color:T.muted,marginTop:10}}>Tap a vehicle name to see its full repair, parts and fuel history.</div>
        )}

        {withCpkm.length > 0 && (
          <div style={{display:"flex",gap:16,marginTop:14,flexWrap:"wrap"}}>
            {[
              {color:T.ok,    label:"< R3.00/km — efficient"},
              {color:T.gold,  label:"R3.00–R7.00/km — average"},
              {color:T.danger,label:"> R7.00/km — review costs"},
            ].map(l=>(
              <div key={l.label} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:T.muted}}>
                <span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:l.color}}/>
                {l.label}
              </div>
            ))}
          </div>
        )}
      </>)}

      {/* ═══════════════════ MONTHLY TAB ═══════════════════ */}
      {costTab==="monthly" && (<>
        {/* Month navigator */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <button className="btn btn-ghost btn-sm"
            onClick={()=>setMonthCursor(c=>{ const m=c.m-1; return m<0?{y:c.y-1,m:11}:{y:c.y,m}; })}>
            &#8592; Prev
          </button>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:19,fontWeight:600,color:T.cream}}>
            {monthLabel(monthCursor.y, monthCursor.m)}
          </div>
          <button className="btn btn-ghost btn-sm" disabled={isCurrentOrFutureMonth}
            style={{opacity:isCurrentOrFutureMonth?.4:1}}
            onClick={()=>setMonthCursor(c=>{ const m=c.m+1; return m>11?{y:c.y+1,m:0}:{y:c.y,m}; })}>
            Next &#8594;
          </button>
        </div>

        <div style={{background:"rgba(184,147,90,.06)",border:`1px solid rgba(184,147,90,.2)`,borderRadius:6,
          padding:"9px 13px",marginBottom:16,fontSize:12,color:T.muted,lineHeight:1.6}}>
          Parts issued before month-by-month tracking was switched on don't have a known date, so
          they show up in <strong style={{color:T.cream}}>Lifetime</strong> but can't appear in any
          specific month here. Anything issued from now on is dated and included below.
        </div>

        {/* Comparison strip */}
        <div className="strip">
          <div className="strip-item"><div className="strip-label">This Month</div><div className="strip-val">{fmtR(monthTotal)}</div></div>
          <div className="strip-item"><div className="strip-label">Previous Month</div>
            <div className="strip-val" style={{color:T.muted}}>{prevTotal>0?fmtR(prevTotal):"—"}</div></div>
          <div className="strip-item"><div className="strip-label">Change</div>
            <div className="strip-val" style={{color: monthDelta===null?T.muted : monthDelta>0?T.danger:T.ok}}>
              {monthDelta===null ? "—" : `${monthDelta>0?"+":""}${monthDelta.toFixed(1)}%`}
            </div></div>
          <div className="strip-item"><div className="strip-label">KM This Month</div>
            <div className="strip-val">{monthKm > 0 ? `${monthKm.toLocaleString()} km` : "—"}</div></div>
        </div>

        {/* Per-vehicle monthly table */}
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>
            <th>Vehicle / Equipment</th><th>Fuel</th><th className="num">Fuel Cost</th><th className="num">Parts</th>
            <th className="num">Repairs</th><th className="num">Total</th><th className="num">KM Driven</th>
            <th className="num">Cost / KM</th><th>Bar</th>
          </tr></thead>
          <tbody>
            {monthlyRows.map(r => (
              <tr key={r.id}>
                <td style={{fontWeight:600}}>
                  <button onClick={()=>{ const v = fleet.find(x=>x.id===r.id); if (v) setDetailVehicle(v); }}
                    style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",
                      fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:600,color:T.cream,borderBottom:`1px dotted ${T.border}`}}>
                    {r.name}
                  </button>
                </td>
                <td><span className={`badge badge-${r.fuel_type==="diesel"?"d":"p"}`}>{r.fuel_type}</span></td>
                <td className="num">{fmtR(r.fuel)}</td>
                <td className="num">{fmtR(r.parts)}</td>
                <td className="num">{fmtR(r.repairs)}</td>
                <td className="num" style={{fontWeight:700,color:T.gold}}>{fmtR(r.total)}</td>
                <td className="num" style={{color:T.muted}}>
                  {r.kmDriven !== null ? <span style={{color:T.cream}}>{r.kmDriven.toLocaleString()} km</span> : <span style={{color:T.border,fontSize:11}}>no odo</span>}
                </td>
                <td className="num">
                  {r.costPerKm !== null ? (
                    <span style={{fontWeight:700,fontFamily:"'Space Mono'",color: r.costPerKm < 3 ? T.ok : r.costPerKm < 7 ? T.gold : T.danger}}>
                      R {r.costPerKm.toFixed(2)}
                    </span>
                  ) : <span style={{color:T.border,fontSize:11}}>—</span>}
                </td>
                <td style={{width:100}}>
                  <div className="gauge-wrap" style={{marginTop:0}}>
                    <div className="gauge-fill" style={{width:`${monthTotal>0?r.total/monthTotal*100:0}%`,background:T.gold}}/>
                  </div>
                </td>
              </tr>
            ))}
            {monthlyRows.length===0 && <tr><td colSpan={9} className="empty">No cost data for {monthLabel(monthCursor.y,monthCursor.m)}</td></tr>}
          </tbody>
        </table></div>

        {/* 6-month trend */}
        <div className="section-title" style={{marginTop:26}}>Last 6 Months</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:8}}>
          {last6.map(x=>(
            <div key={`${x.y}-${x.m}`} style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:90,fontSize:11,color:T.muted,flexShrink:0}}>{monthLabel(x.y,x.m).replace(` ${x.y}`,"")}</div>
              <div style={{flex:1,height:16,background:"rgba(0,0,0,.25)",borderRadius:4,overflow:"hidden"}}>
                <div style={{
                  height:"100%",
                  width:`${last6Max>0?(x.total/last6Max*100):0}%`,
                  background: (x.y===monthCursor.y && x.m===monthCursor.m) ? T.gold : T.navyLt,
                  borderRadius:4,
                }}/>
              </div>
              <div style={{width:90,textAlign:"right",fontSize:12,fontFamily:"'Space Mono'",color:T.muted,flexShrink:0}}>
                {x.total>0?fmtR(x.total):"—"}
              </div>
            </div>
          ))}
        </div>
      </>)}

      {detailVehicle && (
        <VehicleDetail vehicle={detailVehicle} locData={locData} onClose={()=>setDetailVehicle(null)}/>
      )}
    </>
  );
}



// ─── ROOT APP ─────────────────────────────────────────────────────────────────
const PAGES = [
  { id:"dashboard", label:"Dashboard",     section:"Overview",   adminOnly:true  },
  { id:"diesel",    label:"Diesel",        section:"Fuel",       adminOnly:false },
  { id:"petrol",    label:"Petrol",        section:"Fuel",       adminOnly:false },
  { id:"parts",     label:"Parts & Stock", section:"Mechanical", adminOnly:false },
  { id:"repairs",   label:"Repairs",       section:"Mechanical", adminOnly:false },
  { id:"vehicles",  label:"Vehicle Log",   section:"Mechanical", adminOnly:false, flag:"vehicleRegister" },
  { id:"fleet",     label:"Fleet",         section:"Management", adminOnly:true  },
  { id:"costs",     label:"Cost Summary",  section:"Reports",    adminOnly:true  },
];

// Supplier Credit Notes (2026-08-25) — when the wrong item was bought and
// has to go back to the supplier. Reasons match the shared
// supplier_credit_notes table's check constraint (see
// add_supplier_credit_notes.sql) — keep in sync across all 5 apps.
const CREDIT_REASONS = [
  { value: "wrong_item", label: "Wrong item" },
  { value: "damaged", label: "Damaged" },
  { value: "short_delivery", label: "Short delivery" },
  { value: "overcharged", label: "Overcharged" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other" },
];

const emptyLoc = () => ({
  dieselDeliveries:[], dieselIssues:[], dieselDips:[], dieselOpening:0,
  petrolPurchases:[], petrolIssues:[], petrolOpening:0,
  parts:[], partIssues:[], partPurchases:[], repairs:[], partCreditNotes:[],
});

// ─── SUPABASE SYNC ────────────────────────────────────────────────────────────
async function syncLocChanges(locId, companyId, oldLoc, newLoc) {
  const added   = (o,n) => n.filter(x => !o.find(y=>y.id===x.id));
  const removed = (o,n) => o.filter(x => !n.find(y=>y.id===x.id));

  for (const r of added(oldLoc.dieselDeliveries, newLoc.dieselDeliveries))
    await sb.insert("diesel_deliveries",{id:r.id,location_id:locId,company_id:companyId,date:r.date,litres:r.litres,price_per_litre:r.pricePerLitre,supplier:r.supplier||null,invoice_no:r.invoiceNo||null,notes:r.notes||null,slip_id:r.slipId||null});
  for (const r of removed(oldLoc.dieselDeliveries, newLoc.dieselDeliveries))
    await sb.delete("diesel_deliveries",r.id);

  for (const r of added(oldLoc.dieselIssues, newLoc.dieselIssues))
    await sb.insert("diesel_issues",{id:r.id,location_id:locId,company_id:companyId,date:r.date,open_meter:r.open,close_meter:r.close,litres:r.litres,vehicle_id:r.vehicle||null,mileage:r.mileage||null,notes:r.notes||null});
  for (const r of removed(oldLoc.dieselIssues, newLoc.dieselIssues))
    await sb.delete("diesel_issues",r.id);

  for (const r of added(oldLoc.dieselDips, newLoc.dieselDips))
    await sb.insert("diesel_dips",{id:r.id,location_id:locId,company_id:companyId,date:r.date,litres:r.litres,notes:r.notes||null});
  for (const r of removed(oldLoc.dieselDips, newLoc.dieselDips))
    await sb.delete("diesel_dips",r.id);

  if (oldLoc.dieselOpening !== newLoc.dieselOpening)
    await sb.upsert("diesel_opening",{location_id:locId,company_id:companyId,litres:newLoc.dieselOpening,updated_at:new Date().toISOString()},"location_id,company_id");

  for (const r of added(oldLoc.petrolPurchases, newLoc.petrolPurchases))
    await sb.insert("petrol_purchases",{id:r.id,location_id:locId,company_id:companyId,date:r.date,litres:r.litres,price_per_litre:r.pricePerLitre,station:r.station||null,notes:r.notes||null,slip_id:r.slipId||null});
  for (const r of removed(oldLoc.petrolPurchases, newLoc.petrolPurchases))
    await sb.delete("petrol_purchases",r.id);

  for (const r of added(oldLoc.petrolIssues, newLoc.petrolIssues))
    await sb.insert("petrol_issues",{id:r.id,location_id:locId,company_id:companyId,date:r.date,litres:r.litres,vehicle_id:r.vehicle||null,mileage:r.mileage||null,notes:r.notes||null});
  for (const r of removed(oldLoc.petrolIssues, newLoc.petrolIssues))
    await sb.delete("petrol_issues",r.id);

  if (oldLoc.petrolOpening !== newLoc.petrolOpening)
    await sb.upsert("petrol_opening",{location_id:locId,company_id:companyId,litres:newLoc.petrolOpening,updated_at:new Date().toISOString()},"location_id,company_id");

  for (const r of added(oldLoc.parts, newLoc.parts))
    await sb.insert("parts",{id:r.id,location_id:locId,company_id:companyId,description:r.description,storeroom:r.storeroom||null,shelf:r.shelf||null,position:r.location||null,unit:r.unit||"each",open_cost:r.openCost,open_qty:r.openQty,purchase_qty:r.purchaseQty,purchase_cost:r.purchaseCost,purchase_from:r.purchaseFrom||null,closing_qty:r.closingQty,issues:r.issues||{}});
  for (const r of removed(oldLoc.parts, newLoc.parts))
    await sb.delete("parts",r.id);

  for (const r of added(oldLoc.repairs, newLoc.repairs))
    await sb.insert("repairs",{id:r.id,location_id:locId,company_id:companyId,date:r.date,vehicle_id:r.vehicle||null,workshop:r.workshop||null,invoice_no:r.invoiceNo||null,description:r.description||null,labour_cost:r.labourCost||0,parts_cost:r.partsCost||0,other_cost:r.otherCost||0,total_cost:r.totalCost||0,invoice_received:r.invoiceReceived||false,notes:r.notes||null,slip_id:r.slipId||null});
  for (const r of removed(oldLoc.repairs, newLoc.repairs))
    await sb.delete("repairs",r.id);
}

const fleetRow = v => ({
  id:v.id, name:v.name, category:v.category, fuel:v.fuel,
  license_expiry:          v.license_expiry || null,
  last_service_date:       v.last_service_date || null,
  last_service_km:         v.last_service_km === "" || v.last_service_km == null ? null : Number(v.last_service_km),
  service_interval_months: v.service_interval_months === "" || v.service_interval_months == null ? null : Number(v.service_interval_months),
  service_interval_km:     v.service_interval_km === "" || v.service_interval_km == null ? null : Number(v.service_interval_km),
  self_serviced:           !!v.self_serviced,
  service_location_id:     v.self_serviced ? (v.service_location_id || null) : null,
  cost_per_km:             v.cost_per_km === "" || v.cost_per_km == null ? null : Number(v.cost_per_km),
  insurance_monthly:       v.insurance_monthly === "" || v.insurance_monthly == null ? null : Number(v.insurance_monthly),
});

const sbFleet = {
  async add(v, companyId) { await sb.insert("fleet", {...fleetRow(v), company_id: companyId}); },
  async upd(v)    { const {id, ...rest} = fleetRow(v); await sb.patch("fleet", v.id, rest); },
  async remove(id){ await sb.deleteById("fleet",id); },
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
// Real Supabase Auth replaces the old shared staff/admin password checked
// against app_access (2026-08-08 — Ops 3b of the multi-tenant rebuild).
// app_access is deliberately left in the schema, unused by this app from
// here on — it's a shared table other not-yet-migrated apps may still read,
// same reasoning as food_access/hr_access.
//
// Supabase's invite/recovery links land back here with a #type=invite or
// #type=recovery hash fragment when someone lands back in the app from an
// email link — read once, synchronously, on first render, before
// supabase-js has a chance to process and clear it.
function getAuthHashType() {
  if (typeof window === "undefined" || !window.location.hash) return null;
  return new URLSearchParams(window.location.hash.slice(1)).get("type");
}

function AuthMessageScreen({ children }) {
  return (
    <>
      <style>{css}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:T.bg,padding:24,textAlign:"center"}}>
        <img src={LOGO_DATA} alt="Crossing Lodges" style={{width:160,filter:"brightness(0) invert(1) opacity(.8)",marginBottom:16}}/>
        <div style={{maxWidth:320}}>{children}</div>
      </div>
    </>
  );
}

export default function App() {
  // undefined = still checking for an existing session, null = signed out
  const [session, setSession] = useState(undefined);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(() => {
    const type = getAuthHashType();
    return type === "invite" || type === "recovery";
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <AuthMessageScreen>
        <p>Loading…</p>
      </AuthMessageScreen>
    );
  }

  if (!session) {
    return <Login />;
  }

  if (needsPasswordSetup) {
    return <SetPassword onDone={() => setNeedsPasswordSetup(false)} />;
  }

  // key forces CompanyProvider to reload from scratch if a different user
  // signs in without a full page refresh.
  return (
    <CompanyProvider key={session.user.id}>
      <AuthenticatedApp />
    </CompanyProvider>
  );
}

// Quick-log a purchase straight to a member's account instead of any of
// this app's own fuel/parts/repairs records — see memberPurchase.js. Only
// shown when memberBillingEnabled is true for the current company (Demo
// only today). Global (not tied to any one of Diesel/Petrol/Parts/Repairs)
// since a member purchase is pass-through spend, not fleet/stock data.
function MemberPurchaseModal({ companyId, locId, onClose }) {
  const [members,setMembers]=useState([]);
  const [form,setForm]=useState({member_id:"",date:new Date().toISOString().slice(0,10),description:"",amount:""});
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");

  useEffect(()=>{
    listBillingMembers({companyId}).then(m=>{
      setMembers(m);
      setForm(f=>({...f,member_id:f.member_id||m[0]?.id||""}));
    }).catch(()=>setMembers([]));
  },[companyId]);

  const save=async()=>{
    setMessage("");
    if(!form.member_id||!form.description||!form.amount){setMessage("Pick a member and fill in description + amount.");return;}
    setSaving(true);
    try{
      await logMemberPurchase({companyId,memberId:form.member_id,locationId:locId,chargeDate:form.date,description:form.description,amount:form.amount});
      setMessage("Logged to their member account.");
      setForm(f=>({...f,description:"",amount:""}));
    }catch(e){setMessage(e.message||"Could not save.");}
    finally{setSaving(false);}
  };

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-title">Log <span>Member Purchase</span></div>
        <div style={{fontSize:12,color:T.muted,marginBottom:10}}>Bought on a member's behalf — goes straight to their account, not this app's own records.</div>
        <div className="field"><label>Member</label>
          <select value={form.member_id} onChange={e=>setForm(p=>({...p,member_id:e.target.value}))}>
            {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="grid2">
          <div className="field"><label>Date</label><input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
          <div className="field"><label>Amount (R)</label><input type="number" inputMode="decimal" step="0.01" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))}/></div>
        </div>
        <div className="field"><label>Description</label><input type="text" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="e.g. Spares run for a member's vehicle"/></div>
        {message&&<div style={{fontSize:12,color:T.muted,marginBottom:8}}>{message}</div>}
        <div style={{display:"flex",gap:9}}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?"Saving…":"Log to member account"}</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const {
    loading: companyLoading,
    error: companyError,
    availableCompanies,
    companyId,
    companyName,
    role,
    switchCompany,
    memberBillingEnabled,
    vehicleRegisterEnabled,
  } = useCompany();

  const [page,    setPage]    = useState("dashboard");
  const [locId,   setLocId]   = useState("ZC");
  // 'ZC' is only a first guess: this state initialises before the lodge list
  // has loaded (CompanyContext fetches it), and another company won't have a
  // lodge called ZC at all. Once LOCATIONS is populated — and again whenever
  // it changes on a company switch — snap to the first real lodge if the
  // current pick isn't in the list (2026-08-26).
  useEffect(() => {
    if (LOCATIONS.length === 0) return
    if (!LOCATIONS.some((l) => l.id === locId)) setLocId(LOCATIONS[0].id)
  }, [companyId, locId])
  const [showMemberPurchase, setShowMemberPurchase] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fleet,   setFleet]   = useState([]);
  // Same reason as `nd` inside loadAll: seeded empty rather than with three
  // hardcoded lodge ids, now that the lodge list comes from the database.
  const [locData, setLocData] = useState({});
  // Vehicle Register (2026-08-27) — company-wide like fleet, since vehicles
  // move between lodges; the page filters by lodge itself.
  const [vehicleTrips, setVehicleTrips] = useState([]);
  const [tripPurposes, setTripPurposes] = useState([]);
  const [hrEmployees, setHrEmployees] = useState([]);
  // Fuel transfers between lodge tanks. Held at the top level rather than
  // inside the per-location `data` blob, because a transfer belongs to two
  // lodges at once — filing it under one would hide it from the other.
  const [transfers, setTransfers] = useState([]);
  const [vehicleJobs, setVehicleJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [serviceJobs, setServiceJobs] = useState({});
  // Purchase slip photos (2026-08-12) — keyed by purchase_slips.id, loaded
  // company-wide for the "View slip" links and the manual Attach flow.
  const [slips, setSlips] = useState({});
  const onSlipAttached = (slip) => { if (slip) setSlips(s => ({...s, [slip.id]: slip})); };

  const [locPickerOpen, setLocPickerOpen] = useState(false);

  const isAdmin = role === "admin";

  // Staff land on Diesel since Dashboard is admin-only
  useEffect(() => {
    if (role && !isAdmin && page === "dashboard") setPage("diesel");
  }, [role, isAdmin, page]);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setLoadErr(null);
    try {
      const cf = `company_id=eq.${companyId}`;
      const [fleetRows,dDel,dIss,dDips,dOpen,pPurch,pIss,pOpen,partsRows,partIssRows,partPurchRows,repRows,slipRows,partCnRows,
             tripRows,purposeRows,hrEmpRows,vehicleJobRows,transferRows] = await Promise.all([
        sb.select("fleet", cf),
        sb.select("diesel_deliveries", cf),
        sb.select("diesel_issues", cf),
        sb.select("diesel_dips", cf),
        sb.select("stock_transfers", cf + "&domain=in.(diesel,petrol)"),
        sb.select("diesel_opening", cf),
        sb.select("petrol_purchases", cf),
        sb.select("petrol_issues", cf),
        sb.select("petrol_opening", cf),
        sb.select("parts", cf),
        sb.select("parts_issues", cf),
        sb.select("parts_purchases", cf),
        sb.select("repairs", cf),
        sb.select("purchase_slips", `app=eq.ops&${cf}`),
        sb.select("supplier_credit_notes", `app=eq.ops&${cf}`),
        // Vehicle Register (2026-08-27). Wrapped in .catch(()=>[]) so an Ops
        // app pointed at a company that hasn't had the SQL run yet still
        // loads everything else instead of failing wholesale — same guard
        // used for the invoicing tables in Maintenance.
        sb.select("vehicle_trips", cf).catch(()=>[]),
        sb.select("vehicle_trip_purposes", `${cf}&active=eq.true`).catch(()=>[]),
        // Drivers come from HR (cross-app read, same Supabase project) so the
        // dropdown holds real staff names rather than free text that drifts.
        sb.select("hr_employees", `active=eq.true&${cf}`).catch(()=>[]),
        // Open job cards, for attaching a maintenance trip to one.
        sb.select("maint_jobs", `${cf}&status=in.(scheduled,in_progress,completed)`).catch(()=>[]),
      ]);
      const slipMap={}; (slipRows||[]).forEach(s=>{slipMap[s.id]=s;});
      setSlips(slipMap);

      setFleet(fleetRows.map(r=>({
        id:r.id, name:r.name, category:r.category, fuel:r.fuel,
        license_expiry:          r.license_expiry || "",
        last_service_date:       r.last_service_date || "",
        last_service_km:         r.last_service_km == null ? null : +r.last_service_km,
        service_interval_months: r.service_interval_months == null ? null : +r.service_interval_months,
        service_interval_km:     r.service_interval_km == null ? null : +r.service_interval_km,
        self_serviced:           !!r.self_serviced,
        service_location_id:     r.service_location_id || "",
        cost_per_km:             r.cost_per_km == null ? null : +r.cost_per_km,
        insurance_monthly:       r.insurance_monthly == null ? null : +r.insurance_monthly,
      })));

      // Vehicle Register (2026-08-27)
      setVehicleTrips((tripRows||[]).map(r=>({
        ...r,
        start_km:+r.start_km, end_km:+r.end_km, km:+r.km,
        cost_per_km: r.cost_per_km==null?null:+r.cost_per_km,
        trip_cost: r.trip_cost==null?0:+r.trip_cost,
      })));
      setTripPurposes((purposeRows||[]).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)));
      setHrEmployees(hrEmpRows||[]);
      setTransfers(transferRows||[]);
      setVehicleJobs(vehicleJobRows||[]);

      // Built from LOCATIONS rather than a hardcoded {ZC,EC,SC} (2026-08-27).
      // Since lodges became dynamic, a company whose lodge ids aren't exactly
      // those three would hit `nd[lid]` as undefined on the very next line and
      // crash the whole load. Seeding from the real list can't drift.
      const nd = {};
      LOCATIONS.forEach(l => { nd[l.id] = emptyLoc(); });
      LOCATIONS.forEach(l => {
        const lid = l.id;
        nd[lid].dieselDeliveries = dDel.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,litres:+r.litres,pricePerLitre:+r.price_per_litre,supplier:r.supplier||"",invoiceNo:r.invoice_no||"",notes:r.notes||"",slipId:r.slip_id||null}));
        nd[lid].dieselIssues     = dIss.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,open:+r.open_meter,close:+r.close_meter,litres:+r.litres,vehicle:r.vehicle_id||"",mileage:r.mileage||"",notes:r.notes||""}));
        nd[lid].dieselDips       = dDips.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,litres:+r.litres,notes:r.notes||""}));
        nd[lid].dieselOpening    = +(dOpen.find(r=>r.location_id===lid)?.litres||0);
        nd[lid].petrolPurchases  = pPurch.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,litres:+r.litres,pricePerLitre:+r.price_per_litre,station:r.station||"",notes:r.notes||"",slipId:r.slip_id||null}));
        nd[lid].petrolIssues     = pIss.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,litres:+r.litres,vehicle:r.vehicle_id||"",mileage:r.mileage||"",notes:r.notes||""}));
        nd[lid].petrolOpening    = +(pOpen.find(r=>r.location_id===lid)?.litres||0);
        nd[lid].parts            = partsRows.filter(r=>r.location_id===lid).map(r=>({id:r.id,description:r.description,storeroom:r.storeroom||"",shelf:r.shelf||"",location:r.position||"",unit:r.unit||"each",openCost:+r.open_cost,openQty:+r.open_qty,purchaseQty:+r.purchase_qty,purchaseCost:+r.purchase_cost,purchaseFrom:r.purchase_from||"",closingQty:+r.closing_qty,issues:r.issues||{}}));
        nd[lid].partIssues       = partIssRows.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date||"",partId:r.part_id,vehicle:r.vehicle_id||"",qty:+r.qty,notes:r.notes||""}));
        nd[lid].partPurchases    = partPurchRows.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,partId:r.part_id,qty:+r.qty,totalCost:+r.total_cost,supplier:r.supplier||"",notes:r.notes||"",slipId:r.slip_id||null}));
        nd[lid].repairs          = repRows.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,vehicle:r.vehicle_id||"",workshop:r.workshop||"",invoiceNo:r.invoice_no||"",description:r.description||"",labourCost:+r.labour_cost,partsCost:+r.parts_cost,otherCost:+r.other_cost,totalCost:+r.total_cost,invoiceReceived:r.invoice_received||false,notes:r.notes||"",slipId:r.slip_id||null}));
        // supplier_credit_notes.date is a native Postgres date column (comes
        // back ISO, YYYY-MM-DD) — every other date in this app is stored as
        // free text DD/MM/YYYY, so convert here once rather than special-
        // casing credit notes everywhere they're displayed.
        nd[lid].partCreditNotes  = partCnRows.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:fromISO(r.date),partId:r.item_id,itemDescription:r.item_description,qty:+r.qty,unitCost:+r.unit_cost,totalCredit:+r.total_credit,supplier:r.supplier||"",reason:r.reason,creditNoteNumber:r.credit_note_number||"",notes:r.notes||"",slipId:r.slip_id||null}));
      });
      setLocData(nd);

      // Self-serviced vehicles due for service get a job card on the
      // Maintenance app's calendar automatically. Runs after fleet/locData
      // are both known so vehicleStatus (which needs odometer history) is accurate.
      const fleetForSync = fleetRows.map(r=>({
        id:r.id, name:r.name, self_serviced: !!r.self_serviced, service_location_id: r.service_location_id||"",
        last_service_date: r.last_service_date||"", last_service_km: r.last_service_km==null?null:+r.last_service_km,
        service_interval_months: r.service_interval_months==null?null:+r.service_interval_months,
        service_interval_km: r.service_interval_km==null?null:+r.service_interval_km,
        license_expiry: r.license_expiry||"",
      }));
      syncServiceJobs(fleetForSync, nd, companyId).then(setServiceJobs);
    } catch(e) {
      setLoadErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const setLoc = useCallback((patch) => {
    setLocData(prev => {
      const cur  = prev[locId];
      const next = typeof patch==="function" ? patch(cur) : {...cur,...patch};
      syncLocChanges(locId, companyId, cur, next).catch(e => console.error("Sync:", e));
      return {...prev, [locId]: next};
    });
  }, [locId, companyId]);

  const handleSetFleet = useCallback((updater) => {
    setFleet(prev => typeof updater==="function" ? updater(prev) : updater);
  }, []);

  // `flag` gates a page on a per-company feature flag (Vehicle Log is Demo-only
  // while it's being trialled). A page with no flag behaves exactly as before.
  const featureFlags = { vehicleRegister: vehicleRegisterEnabled };
  const visiblePages = PAGES.filter(p => (isAdmin || !p.adminOnly) && (!p.flag || featureFlags[p.flag]));
  const sections  = [...new Set(visiblePages.map(p=>p.section))];
  const current   = PAGES.find(p=>p.id===page);
  const locColor  = LOC_COLORS[locId];
  const locName   = LOCATIONS.find(l=>l.id===locId)?.name;
  const now        = new Date();
  const monthLabel = now.toLocaleString("en-ZA",{month:"long",year:"numeric"}).toUpperCase();
  const footerDate = now.toLocaleString("en-ZA",{month:"short",year:"numeric"});
  const loc        = locData[locId];

  // Company-access guards — placed here, after every hook above, rather
  // than before them: React requires the same hooks to run on every render
  // in the same order, so an early return can't come before a useState.
  if (companyLoading) {
    return (
      <AuthMessageScreen>
        <p>Loading your account…</p>
      </AuthMessageScreen>
    );
  }

  if (companyError) {
    return (
      <AuthMessageScreen>
        <p style={{color:T.danger,marginBottom:12}}>Could not load your company access: {companyError}</p>
        <button className="btn btn-primary" onClick={logout}>Log out</button>
      </AuthMessageScreen>
    );
  }

  if (!companyId) {
    return (
      <AuthMessageScreen>
        <p style={{marginBottom:12}}>Your account isn't linked to any company yet. Contact your administrator to get access.</p>
        <button className="btn btn-primary" onClick={logout}>Log out</button>
      </AuthMessageScreen>
    );
  }

  if (loading) return (
    <>
      <style>{css}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:16,background:T.bg}}>
        <img src={LOGO_DATA} alt="Crossing Lodges" style={{width:160,filter:"brightness(0) invert(1) opacity(.8)"}}/>
        <div style={{fontSize:13,color:T.muted,letterSpacing:".1em",textTransform:"uppercase"}}>Loading operations data...</div>
        <div style={{width:220,height:3,background:T.border,borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",background:T.gold,borderRadius:2,width:"40%",animation:"ldg 1.2s ease-in-out infinite"}}/>
        </div>
        <style>{"@keyframes ldg{0%{margin-left:0;width:30%}50%{width:60%}100%{margin-left:100%;width:0}}"}</style>
      </div>
    </>
  );

  if (loadErr) return (
    <>
      <style>{css}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:12,background:T.bg,padding:32}}>
        <div style={{fontSize:32}}>!</div>
        <div style={{fontSize:16,fontWeight:700,color:T.cream}}>Could not connect to database</div>
        <div style={{fontSize:13,color:T.muted,textAlign:"center",maxWidth:400}}>{loadErr}</div>
        <button className="btn btn-primary" style={{marginTop:12}} onClick={loadAll}>Retry</button>
      </div>
    </>
  );


  return (
    <>
      <style>{css}</style>
      <div className="shell">
        {/* ── DESKTOP SIDEBAR ── */}
        <div className="sidebar">
          <div className="logo">
            <img src={LOGO_DATA} alt="Crossing Lodges" style={{width:148,height:"auto",filter:"brightness(0) invert(1) opacity(0.88)"}}/>
            <div style={{fontSize:9,letterSpacing:".2em",textTransform:"uppercase",color:T.gold,fontWeight:600,marginTop:2,opacity:.8}}>Operations</div>
            <div style={{fontSize:11,color:T.muted,marginTop:4}}>{companyName}</div>
          </div>

          {availableCompanies.length > 1 && (
            <div style={{padding:"10px 13px",borderBottom:`1px solid ${T.border}`}}>
              <select
                value={companyId}
                onChange={e=>switchCompany(e.target.value)}
                style={{width:"100%",background:"rgba(0,0,0,.25)",border:`1px solid ${T.border}`,borderRadius:6,padding:"7px 9px",color:T.cream,fontFamily:"'Inter',sans-serif",fontSize:12}}
              >
                {availableCompanies.map(c=>(
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="loc-switcher">
            <div className="loc-label">Location</div>
            {LOCATIONS.map(l=>(
              <button key={l.id} className={`loc-btn${locId===l.id?` active-${l.id}`:""}`} onClick={()=>setLocId(l.id)}>
                <span className="loc-dot" style={{background:LOC_COLORS[l.id]}}/>
                {l.name}
              </button>
            ))}
          </div>

          <nav className="nav">
            {sections.map(sec=>(
              <div key={sec}>
                <div className="nav-section">{sec}</div>
                {visiblePages.filter(p=>p.section===sec).map(p=>(
                  <button key={p.id} className={`nav-item${page===p.id?" active":""}`} onClick={()=>setPage(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div style={{padding:"13px 18px",borderTop:`1px solid ${T.border}`,fontSize:10,color:T.muted,lineHeight:1.6}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <span style={{color:T.gold,fontWeight:700}}>{footerDate}</span>
              <span style={{
                fontSize:9,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",
                padding:"2px 8px",borderRadius:3,
                background: isAdmin ? "rgba(184,147,90,.18)" : "rgba(91,140,196,.18)",
                color: isAdmin ? T.gold : T.fuel_d,
                border: `1px solid ${isAdmin ? "rgba(184,147,90,.4)" : "rgba(91,140,196,.4)"}`,
              }}>{isAdmin ? "Admin" : "Staff"}</span>
            </div>
            Modimolle, Limpopo - ZA
            <div style={{marginTop:6,display:"flex",gap:10}}>
              <button onClick={loadAll} style={{background:"none",border:"none",color:T.muted,fontSize:10,cursor:"pointer",padding:0,letterSpacing:".05em"}}>R Refresh</button>
              <button onClick={logout} style={{background:"none",border:"none",color:T.muted,fontSize:10,cursor:"pointer",padding:0,letterSpacing:".05em"}}>Sign out</button>
            </div>
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="main">
          {/* Topbar */}
          <div className="topbar" style={{position:"sticky",top:0,zIndex:10}}>
            <div className="page-title">{current?.label}</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <OfflineStatus/>
              {page!=="costs"&&page!=="fleet"&&(
                <div style={{position:"relative"}}>
                  <button
                    onClick={()=>setLocPickerOpen(v=>!v)}
                    className="loc-badge"
                    style={{
                      background:`${locColor}22`,border:`1px solid ${locColor}55`,
                      color:locColor,cursor:"pointer",display:"flex",alignItems:"center",
                      gap:6,fontFamily:"'Inter',sans-serif",fontSize:11,fontWeight:600,
                      padding:"4px 10px",borderRadius:4,letterSpacing:".04em",
                    }}>
                    <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:locColor,flexShrink:0}}/>
                    {locName}
                    <span style={{fontSize:9,opacity:.7,marginLeft:2}}>&#9660;</span>
                  </button>
                  {locPickerOpen&&(
                    <>
                      {/* Backdrop to close on outside tap */}
                      <div
                        onClick={()=>setLocPickerOpen(false)}
                        style={{position:"fixed",inset:0,zIndex:49}}
                      />
                      {/* Dropdown */}
                      <div style={{
                        position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:50,
                        background:"#28273A",border:"1px solid #3A3850",
                        borderRadius:8,overflow:"hidden",minWidth:180,
                        boxShadow:"0 8px 24px rgba(0,0,0,.5)",
                      }}>
                        {LOCATIONS.map(l=>(
                          <button key={l.id} onClick={()=>{setLocId(l.id);setLocPickerOpen(false);}}
                            style={{
                              display:"flex",alignItems:"center",gap:10,width:"100%",
                              padding:"11px 14px",border:"none",textAlign:"left",cursor:"pointer",
                              fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:500,
                              background:locId===l.id?"rgba(255,255,255,.06)":"transparent",
                              color:locId===l.id?LOC_COLORS[l.id]:"#8A8899",
                              borderBottom:l.id!=="SC"?"1px solid #3A3850":"none",
                            }}>
                            <span style={{width:8,height:8,borderRadius:"50%",background:LOC_COLORS[l.id],display:"inline-block",flexShrink:0}}/>
                            {l.name}
                            {locId===l.id&&<span style={{marginLeft:"auto",fontSize:11}}>&#10003;</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {memberBillingEnabled && (
                <button onClick={()=>setShowMemberPurchase(true)}
                  style={{background:"none",border:"1px solid #3A3850",borderRadius:6,color:"#8A8899",fontSize:11,fontWeight:600,cursor:"pointer",padding:"5px 10px",flexShrink:0}}>
                  + Member Purchase
                </button>
              )}
              <span className="month-badge">{monthLabel}</span>
              <button onClick={logout} title="Sign out"
                style={{background:"none",border:"1px solid #3A3850",borderRadius:6,color:"#8A8899",fontSize:11,fontWeight:600,cursor:"pointer",padding:"5px 10px",flexShrink:0}}>
                Log out
              </button>
            </div>
          </div>
          {showMemberPurchase && <MemberPurchaseModal companyId={companyId} locId={locId} onClose={()=>setShowMemberPurchase(false)}/>}

          {/* Mobile location bar */}
          <div className="mobile-loc-bar">
            {LOCATIONS.map(l=>(
              <button key={l.id} className={`mobile-loc-btn${locId===l.id?` active-${l.id}`:""}`} onClick={()=>setLocId(l.id)}>
                <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:LOC_COLORS[l.id]}}/>
                {l.name}
              </button>
            ))}
            <button onClick={loadAll} style={{marginLeft:"auto",background:"none",border:"none",color:T.muted,fontSize:11,cursor:"pointer",padding:"4px 8px",flexShrink:0}}>R</button>
            <button onClick={logout} style={{background:"none",border:"none",color:T.muted,fontSize:11,cursor:"pointer",padding:"4px 8px",flexShrink:0}}>Sign out</button>
          </div>

          <div className="section">
            {page==="dashboard" && isAdmin && <Dashboard locId={locId} loc={loc} fleet={fleet} locData={locData} serviceJobs={serviceJobs}/>}
            {page==="diesel"    && <DieselInventory locId={locId} loc={loc} setLoc={setLoc} fleet={fleet} isAdmin={isAdmin} companyId={companyId} slips={slips} onSlipAttached={onSlipAttached} transfers={transfers} onTransfersChanged={loadAll}/>}
            {page==="petrol"    && <PetrolInventory loc={loc} setLoc={setLoc} fleet={fleet} locId={locId} companyId={companyId} slips={slips} onSlipAttached={onSlipAttached} transfers={transfers} onTransfersChanged={loadAll}/>}
            {page==="parts"     && <PartsStock loc={loc} locId={locId} setLoc={setLoc} isAdmin={isAdmin} fleet={fleet} companyId={companyId} slips={slips} onSlipAttached={onSlipAttached}/>}
            {page==="repairs"   && <Repairs loc={loc} setLoc={setLoc} fleet={fleet} isAdmin={isAdmin} locId={locId} companyId={companyId} slips={slips} onSlipAttached={onSlipAttached}/>}
            {page==="vehicles"  && vehicleRegisterEnabled && <VehicleRegister
                                    locId={locId} locData={locData} fleet={fleet} trips={vehicleTrips} setTrips={setVehicleTrips}
                                    purposes={tripPurposes} setPurposes={setTripPurposes}
                                    hrEmployees={hrEmployees} jobs={vehicleJobs}
                                    isAdmin={isAdmin} companyId={companyId}/>}
            {page==="fleet"     && isAdmin && <FleetManager fleet={fleet} setFleet={handleSetFleet} sbFleet={sbFleet} locData={locData} serviceJobs={serviceJobs} companyId={companyId}/>}
            {page==="costs"     && isAdmin && <CostSummary locData={locData} fleet={fleet} serviceJobs={serviceJobs}/>}
            {!isAdmin && (page==="dashboard"||page==="fleet"||page==="costs") && (
              <div className="empty">
                <div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>
                This section is only available to Admin accounts
              </div>
            )}
          </div>
        </div>

        {/* ── MOBILE BOTTOM NAV ── a single Menu button rather than a row of
            tabs, since a horizontal strip either clips tabs off the edge of
            the screen or needs a swipe gesture nobody discovers on their
            own. Tapping it opens a bottom sheet listing every tab for the
            current role (same grouping as the desktop sidebar), so every
            tab is always reachable regardless of how many exist. Desktop
            keeps the sidebar as-is (this bar is hidden above 768px via CSS). */}
        <nav className="bottom-nav">
          <button className="nav-menu-btn" onClick={()=>setMenuOpen(true)}>
            <span>{current?.label || "Menu"}</span>
            <span style={{fontSize:10,opacity:.7}}>&#9650;</span>
          </button>
        </nav>

        {menuOpen && (
          <div className="nav-overlay" onClick={()=>setMenuOpen(false)}>
            <div className="nav-sheet" onClick={e=>e.stopPropagation()}>
              <div className="nav-sheet-header">
                <span className="nav-sheet-title">Menu</span>
                <button className="nav-sheet-close" onClick={()=>setMenuOpen(false)}>Close</button>
              </div>
              {sections.map(sec=>(
                <div key={sec}>
                  <div className="nav-section">{sec}</div>
                  {visiblePages.filter(p=>p.section===sec).map(p=>(
                    <button key={p.id} className={`nav-sheet-item${page===p.id?" active":""}`}
                      onClick={()=>{setPage(p.id);setMenuOpen(false);}}>
                      {p.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── OFFLINE STATUS ─────────────────────────────────────────────────────────
// A small pill in the header. It stays out of the way when everything's
// normal (online, nothing queued = nothing shown), and only speaks up when
// there's something the person should actually know: no signal, work waiting
// to upload, or something the server refused.
//
// The point is that crew shouldn't have to trust silently — if they logged
// five things in a valley with no bars, they can see "5 waiting" and know
// it's safe to close the app.
function OfflineStatus() {
  const [state, setState] = useState(() => ({ online: navigator.onLine, syncing: false, pending: 0, rejected: 0 }));
  const [open, setOpen] = useState(false);
  const [rejects, setRejects] = useState([]);

  useEffect(() => {
    const unsub = subscribeOffline(setState);
    const onNet = () => setState(s => ({ ...s, online: navigator.onLine }));
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    return () => { unsub(); window.removeEventListener("online", onNet); window.removeEventListener("offline", onNet); };
  }, []);

  useEffect(() => { if (open) listRejected().then(setRejects); }, [open, state.rejected]);

  // Nothing worth saying.
  if (state.online && !state.pending && !state.rejected && !state.syncing) return null;

  const color = state.rejected ? T.danger : !state.online ? T.warn : T.ok;
  const label = state.rejected
    ? `${state.rejected} failed`
    : state.syncing
      ? "Syncing…"
      : !state.online
        ? (state.pending ? `Offline · ${state.pending} waiting` : "Offline")
        : `${state.pending} waiting`;

  return (
    <div style={{position:"relative"}}>
      <button onClick={()=>setOpen(v=>!v)} className="loc-badge"
        style={{background:`${color}22`,border:`1px solid ${color}55`,color}}>
        <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:color,flexShrink:0}}/>
        {label}
      </button>
      {open && (<>
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:49}}/>
        <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:50,background:T.panel,
          border:`1px solid ${T.border}`,borderRadius:8,padding:"12px 14px",minWidth:260,
          boxShadow:"0 8px 24px rgba(0,0,0,.5)",fontSize:12,color:T.muted}}>
          {!state.online && (
            <div style={{marginBottom:8,color:T.warn}}>
              No connection. You can carry on working — everything you add is saved on this
              device and uploads by itself once you're back in signal.
            </div>
          )}
          {state.pending > 0 && (
            <div style={{marginBottom:8}}>
              <strong style={{color:T.cream}}>{state.pending}</strong> change{state.pending===1?"":"s"} waiting to upload.
              {state.online && " Uploading now…"}
            </div>
          )}
          {state.pending === 0 && state.online && state.rejected === 0 && (
            <div style={{marginBottom:8,color:T.ok}}>Everything's uploaded.</div>
          )}
          {state.rejected > 0 && (
            <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
              <div style={{color:T.danger,marginBottom:6}}>
                {state.rejected} change{state.rejected===1?"":"s"} the server wouldn't accept. These are kept
                here rather than thrown away, but they need a person to look at them.
              </div>
              {rejects.slice(0,5).map(r=>(
                <div key={r.seq} style={{marginBottom:6,paddingBottom:6,borderBottom:`1px solid ${T.border}`}}>
                  <div style={{color:T.cream,fontSize:11}}>{r.op} · {r.table}</div>
                  <div style={{fontSize:10,wordBreak:"break-word"}}>{(r.lastError||"").slice(0,140)}</div>
                  <div style={{display:"flex",gap:6,marginTop:4}}>
                    <button className="btn btn-ghost btn-sm" onClick={()=>retryRejected(r.seq).then(()=>listRejected().then(setRejects))}>Try again</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>{
                      if(window.confirm("Discard this change permanently? It will not be uploaded.")) {
                        discardEntry(r.seq).then(()=>listRejected().then(setRejects));
                      }
                    }}>Discard</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {state.online && (state.pending>0 || state.rejected>0) && (
            <button className="btn btn-ghost btn-sm" style={{marginTop:6}} onClick={()=>syncNow()}>Sync now</button>
          )}
        </div>
      </>)}
    </div>
  );
}

// Ported from the Maintenance app (2026-08-27) — Ops was the one app missed in
// the 2026-08-25 searchable-dropdown rollout, and the Vehicle Log's job-card
// picker is exactly the case it exists for: a list long enough that scrolling
// it on a phone is worse than typing three letters.
// Type-to-search dropdown (2026-08-25) — same value/onChange contract as a
// plain <select> (value = selected option's `value`, onChange receives the
// new value), but lets staff type a few letters to filter instead of
// scrolling a long native list. Used for item/supplier/member-style
// pickers with many options; short toggles/enums (job type, destination,
// status, recurrence, unit) stay as plain <select>s since search doesn't
// help there. `options` is [{ value, label }].
const searchSelectInput = {width:"100%",background:"rgba(0,0,0,.25)",border:`1px solid ${T.border}`,borderRadius:6,
  padding:"10px 11px",color:T.cream,fontFamily:"'Inter',sans-serif",fontSize:16,outline:"none"};

// Pick an existing value or add a new one — for short free-text fields where
// the same thing gets retyped over and over (supplier and filling-station
// names).
//
// Added 2026-08-31. Supplier names are not cosmetic here: the Finance
// Dashboard's supplier reconciliation matches uploaded statements against
// purchase rows across five apps BY SUPPLIER NAME, so "Engen" and "engen "
// become two suppliers and a statement silently fails to reconcile against
// half its own invoices.
//
// The key behaviour is in confirm(): a newly typed value SNAPS to an existing
// one when the two differ only by case, spacing or punctuation. A dropdown
// alone does not stop drift, because people still click "+ New" and type a
// variant; trimming alone does not either.
function PickOrAdd({ value, options, onChange, placeholder = "New value" }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  function confirm() {
    const typed = text.trim();
    if (typed) {
      const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const existing = options.find(o => norm(o) === norm(typed));
      onChange(existing || typed);
    }
    setAdding(false); setText("");
  }

  if (adding || options.length === 0) {
    return (
      <div style={{display:"flex",gap:7}}>
        <input
          type="text" autoFocus={adding} placeholder={placeholder} value={value || ""}
          onChange={e=>{ setText(e.target.value); onChange(e.target.value); }}
          onBlur={()=>{ if (text.trim()) confirm(); }}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); confirm(); } }}
          style={{flex:1}}
        />
        {options.length>0 && (
          <button className="btn btn-ghost btn-sm" type="button"
            onClick={()=>{ setAdding(false); setText(""); onChange(""); }}>
            Choose existing
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{display:"flex",gap:7}}>
      <select value={value || ""} onChange={e=>onChange(e.target.value)} style={{flex:1}}>
        <option value="">-- Select --</option>
        {options.map(o=><option key={o} value={o}>{o}</option>)}
        {/* A value saved before this control existed must still show, even if
            nothing else uses it — otherwise the select renders blank and the
            next save quietly wipes it. */}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
      </select>
      <button className="btn btn-ghost btn-sm" type="button"
        onClick={()=>{ setAdding(true); setText(""); onChange(""); }}>
        + New
      </button>
    </div>
  );
}

function SearchableSelect({ value, onChange, options, placeholder = "Select…", style, inputStyle, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  useEffect(() => {
    function onDocDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  function choose(opt) {
    onChange(opt.value);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        setHighlight(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) choose(filtered[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <input
        type="text"
        style={inputStyle || searchSelectInput}
        placeholder={selected && !open ? selected.label : placeholder}
        value={open ? query : selected ? selected.label : ""}
        onFocus={() => { setOpen(true); setQuery(""); setHighlight(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      {open && (
        <div
          style={{
            position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2, zIndex: 50,
            background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
            maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.35)",
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: "7px 10px", fontSize: 12, color: T.muted }}>No matches</div>
          )}
          {filtered.map((o, i) => (
            <div
              key={o.value}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: "7px 10px", fontSize: 13, cursor: "pointer", color: T.cream,
                background: i === highlight ? "rgba(184,147,90,.14)" : "transparent",
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── VEHICLE REGISTER ───────────────────────────────────────────────────────
// Trip log: who drove what, how far, and why (2026-08-27). Demo company only
// for now, behind companies.vehicle_register_enabled.
//
// Distance is entered as START and END odometer rather than a km figure —
// harder to fudge, and it means each vehicle always has a current reading,
// which is what makes the Fleet page's existing "service due by km" alerts
// meaningful (before this there was nothing current to compare against).
//
// A trip whose purpose is flagged is_maintenance can be attached to a job
// card. The Maintenance app's Internal Billing then adds that trip's cost to
// the job alongside labour and materials — which was the point of the whole
// exercise: internal invoices that carry the real vehicle cost of getting
// someone to the job, not just their time and parts.
function VehicleRegister({ locId, locData, fleet, trips, setTrips, purposes, setPurposes, hrEmployees, jobs, isAdmin, companyId }) {
  const blank = { vehicle_id:"", trip_date:todayISO(), driver_employee_id:"", driver_name:"",
                  purpose_id:"", start_km:"", end_km:"", job_id:"", notes:"" };
  const [form, setForm] = useState(blank);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [showPurposes, setShowPurposes] = useState(false);
  const [locFilter, setLocFilter] = useState(locId);
  // A trip with no end reading yet — the vehicle is still out.
  const [closing, setClosing] = useState(null);   // the trip being closed
  const [closeKm, setCloseKm] = useState("");
  const [closeErr, setCloseErr] = useState("");

  useEffect(()=>{ setLocFilter(locId); },[locId]);

  // km and trip_cost are GENERATED columns in Postgres, so a trip created
  // offline (queued, not yet synced) has neither until it reaches the server.
  // Deriving them here means an offline-logged trip still shows its real
  // distance and cost instead of a misleading 0.
  // hr_employees stores first_name/last_name — there is no `name` column.
  // Same join the Maintenance app does for its crew pickers.
  const staffName = e => e ? `${e.first_name||""} ${e.last_name||""}`.trim() || "(unnamed)" : "";
  const isOpen   = t => t.end_km == null;
  const tripKm   = t => t.end_km == null ? 0 : (t.km != null ? t.km : Number(t.end_km) - Number(t.start_km));
  const tripCost = t => t.end_km == null ? 0 : (t.trip_cost != null ? t.trip_cost : tripKm(t) * Number(t.cost_per_km||0));

  // Running rates come from the SAME calculation the Cost Summary page shows —
  // real fuel/parts/repair spend divided by km actually driven — rather than a
  // rate anybody types in (Thijs, 2026-08-27: "we don't fill anything in
  // ourselves. Rather use the Cost/KM from the Cost Summary. As that is live
  // and most up to date"). Computed across all lodges, since a vehicle's
  // running cost is a property of the vehicle, not of where it happens to be
  // parked.
  const costRows = useMemo(
    ()=>computeVehicleCosts({ locData, fleet, locIds: LOCATIONS.map(l=>l.id) }),
    [locData, fleet]
  );

  const vehicleById = useMemo(()=>Object.fromEntries(fleet.map(v=>[v.id,v])),[fleet]);
  const purposeById = useMemo(()=>Object.fromEntries(purposes.map(p=>[p.id,p])),[purposes]);
  const jobById     = useMemo(()=>Object.fromEntries((jobs||[]).map(j=>[j.id,j])),[jobs]);

  // Last odometer reading we've seen for each vehicle — used to prefill the
  // start reading and to warn if someone types one that goes backwards.
  const lastKmByVehicle = useMemo(()=>{
    const m = {};
    for (const t of trips) {
      // An open trip has no end reading, but its START is still the last thing
      // we know about that vehicle — otherwise the next trip would prefill
      // from an older reading and understate the distance.
      const known = t.end_km != null ? Number(t.end_km) : Number(t.start_km);
      if (!m[t.vehicle_id] || known > m[t.vehicle_id]) m[t.vehicle_id] = known;
    }
    return m;
  },[trips]);

  const visible = useMemo(()=>
    trips.filter(t=>locFilter==="all"||t.location_id===locFilter)
         .sort((a,b)=>(b.trip_date||"").localeCompare(a.trip_date||"")||(b.created_at||"").localeCompare(a.created_at||"")),
  [trips, locFilter]);

  const selectedPurpose = purposeById[form.purpose_id];
  const isMaintenanceTrip = !!selectedPurpose?.is_maintenance;

  const km = (parseFloat(form.end_km)||0) - (parseFloat(form.start_km)||0);
  const { rate, basis } = runningRateFor(form.vehicle_id, costRows);
  const estCost = rate == null ? null : km * rate;

  function pickVehicle(id) {
    // Prefill the start reading from wherever that vehicle was last left —
    // saves typing and makes a gap in the log obvious.
    const last = lastKmByVehicle[id];
    setForm(f=>({...f, vehicle_id:id, start_km: last!=null?String(last):f.start_km }));
  }

  async function save() {
    setErr("");
    if(!form.vehicle_id) return setErr("Pick a vehicle.");
    if(!form.purpose_id) return setErr("Pick what the trip was for.");
    const driver = form.driver_employee_id
      ? staffName(hrEmployees.find(e=>e.id===form.driver_employee_id))
      : form.driver_name.trim();
    if(!driver) return setErr("Say who was driving.");
    const s = parseFloat(form.start_km);
    if(!(s>=0)) return setErr("The opening odometer reading is needed.");
    // End reading is optional on purpose: crew log the trip as they leave and
    // close it off when they get back, which may be hours later and after the
    // app has been shut. An open trip is a normal state, not an error.
    const hasEnd = form.end_km !== "" && form.end_km != null;
    const e = hasEnd ? parseFloat(form.end_km) : null;
    if(hasEnd && !(e>=0)) return setErr("That closing reading doesn't look like a number.");
    if(hasEnd && e < s) return setErr("The closing reading can't be lower than the opening one.");
    if(isMaintenanceTrip && !form.job_id) return setErr("Pick the job card this trip was for, so its cost lands on the right job.");

    setSaving(true);
    try {
      const row = {
        id: uid(), company_id: companyId, location_id: locFilter==="all"?locId:locFilter,
        vehicle_id: form.vehicle_id, purpose_id: form.purpose_id,
        trip_date: form.trip_date,
        driver_name: driver,
        driver_employee_id: form.driver_employee_id || null,
        start_km: s, end_km: e,   // null while the vehicle is still out
        job_id: isMaintenanceTrip ? (form.job_id || null) : null,
        // Snapshot the derived rate as it stands today. It's frozen here on
        // purpose: the underlying cost/km keeps moving as fuel and repairs are
        // logged, and an invoice that silently restates itself months later
        // would be impossible to reconcile against.
        cost_per_km: rate,
        notes: form.notes.trim() || null,
      };
      await sb.insert("vehicle_trips", row);
      // km/trip_cost are generated in the database; mirror them locally so the
      // row renders correctly without waiting for a reload.
      setTrips(p=>[...p, {...row,
        km: e==null?null:e-s,
        trip_cost: e==null?null:(row.cost_per_km||0)*(e-s)}]);
      setForm({...blank, trip_date:form.trip_date});
      setShowForm(false);
    } catch(ex) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  async function closeTrip() {
    setCloseErr("");
    const t = closing;
    const e = parseFloat(closeKm);
    if(!(e>=0)) return setCloseErr("Enter the closing odometer reading.");
    if(e < Number(t.start_km)) return setCloseErr(`Can't be below the opening reading of ${fmtNum(t.start_km)}.`);
    try {
      await sb.patch("vehicle_trips", t.id, { end_km: e });
      setTrips(p=>p.map(x=>x.id===t.id
        ? {...x, end_km:e, km:e-Number(x.start_km), trip_cost:(x.cost_per_km||0)*(e-Number(x.start_km))}
        : x));
      setClosing(null); setCloseKm("");
    } catch(ex){ setCloseErr(ex.message); }
  }

  async function remove(t) {
    if(!window.confirm(`Delete the trip on ${t.trip_date} (${fmtNum(tripKm(t))} km)?`)) return;
    try {
      await sb.delete("vehicle_trips", t.id);
      setTrips(p=>p.filter(x=>x.id!==t.id));
    } catch(ex){ alert("Error: "+ex.message); }
  }

  const monthKm = visible.filter(t=>(t.trip_date||"").slice(0,7)===new Date().toISOString().slice(0,7));
  const totalKm = monthKm.reduce((s,t)=>s+tripKm(t),0);
  const totalCost = monthKm.reduce((s,t)=>s+tripCost(t),0);
  const maintKm = monthKm.filter(t=>t.job_id).reduce((s,t)=>s+tripKm(t),0);

  return (<>
    <div className="strip" style={{marginBottom:14}}>
      <div className="strip-item"><div className="strip-label">This Month — KM</div>
        <div className="strip-val">{fmtNum(totalKm)}</div></div>
      <div className="strip-item"><div className="strip-label">This Month — Cost</div>
        <div className="strip-val" style={{color:T.gold}}>{fmtR(totalCost)}</div>
        <div style={{fontSize:10,color:T.muted,marginTop:2}}>Vehicles with no rate set count as R0</div></div>
      <div className="strip-item"><div className="strip-label">On Job Cards</div>
        <div className="strip-val">{fmtNum(maintKm)}</div>
        <div style={{fontSize:10,color:T.muted,marginTop:2}}>Billed to Maintenance jobs</div></div>
      <div className="strip-item"><div className="strip-label">Trips Logged</div>
        <div className="strip-val">{visible.length}</div></div>
    </div>

    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <select value={locFilter} onChange={e=>setLocFilter(e.target.value)}
        style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:6,color:T.cream,
                fontFamily:"'Space Mono'",fontSize:13,padding:"6px 10px"}}>
        <option value="all">All lodges</option>
        {LOCATIONS.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button className="btn" onClick={()=>setShowForm(v=>!v)}>{showForm?"Cancel":"+ Log a trip"}</button>
      {isAdmin && <button className="btn btn-ghost" onClick={()=>setShowPurposes(v=>!v)}>
        {showPurposes?"Hide categories":"Edit categories"}
      </button>}
    </div>

    {showPurposes && isAdmin && (
      <TripPurposeManager purposes={purposes} setPurposes={setPurposes} companyId={companyId}/>
    )}

    {showForm && (
      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">Log a trip</div>
        <div className="grid2">
          <div className="field"><label>Vehicle</label>
            <SearchableSelect
              value={form.vehicle_id}
              onChange={pickVehicle}
              options={fleet.map(v=>{
                const r = runningRateFor(v.id, costRows);
                return { value:v.id, label:`${v.name}${r.rate!=null
                  ? ` — ${fmtR(r.rate)}/km${r.basis==="fleet"?" (fleet avg)":""}`
                  : " — no cost history yet"}` };
              })}
              placeholder="Search vehicles…"/>
          </div>
          <div className="field"><label>Date</label>
            <input type="date" value={form.trip_date} onChange={e=>setForm(f=>({...f,trip_date:e.target.value}))}/></div>

          <div className="field"><label>Driver</label>
            <SearchableSelect
              value={form.driver_employee_id}
              onChange={v=>setForm(f=>({...f,driver_employee_id:v}))}
              options={[{ value:"", label:"— someone not on the staff list —" },
                ...[...hrEmployees].sort((a,b)=>staffName(a).localeCompare(staffName(b)))
                  .map(e=>({ value:e.id, label:staffName(e) }))]}
              placeholder="Search staff…"/>
          </div>
          {!form.driver_employee_id && (
            <div className="field"><label>Driver name</label>
              <input value={form.driver_name} onChange={e=>setForm(f=>({...f,driver_name:e.target.value}))}
                placeholder="e.g. guest, contractor"/></div>
          )}

          <div className="field"><label>Purpose</label>
            <select value={form.purpose_id} onChange={e=>setForm(f=>({...f,purpose_id:e.target.value,job_id:""}))}>
              <option value="">Select purpose…</option>
              {purposes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {isMaintenanceTrip && (
            <div className="field"><label>Job card</label>
              <SearchableSelect
                value={form.job_id}
                onChange={v=>setForm(f=>({...f,job_id:v}))}
                options={(jobs||[]).map(j=>({ value:j.id,
                  label:`${j.name}${j.due_date?` — due ${j.due_date}`:""}${j.status==="completed"?" (completed)":""}` }))}
                placeholder="Search job cards…"/>
            </div>
          )}

          <div className="field"><label>Odometer — start</label>
            <input type="number" inputMode="decimal" value={form.start_km}
              onChange={e=>setForm(f=>({...f,start_km:e.target.value}))}/></div>
          <div className="field"><label>Odometer — end <span style={{color:T.muted,fontWeight:400}}>(optional)</span></label>
            <input type="number" inputMode="decimal" value={form.end_km} placeholder="leave blank if still out"
              onChange={e=>setForm(f=>({...f,end_km:e.target.value}))}/></div>
        </div>

        {form.vehicle_id && lastKmByVehicle[form.vehicle_id]!=null && parseFloat(form.start_km) < lastKmByVehicle[form.vehicle_id] && (
          <div style={{fontSize:12,color:T.warn,marginTop:6}}>
            &#9888; This vehicle was last left at {fmtNum(lastKmByVehicle[form.vehicle_id])} km. A lower opening
            reading usually means a trip wasn't logged, or a digit slipped.
          </div>
        )}
        {km>0 && (
          <div style={{fontSize:12,color:T.muted,marginTop:6}}>
            {fmtNum(km)} km
            {estCost!=null
              ? <> · {fmtR(estCost)} at {fmtR(rate)}/km{basis==="fleet"
                  ? <span style={{color:T.warn}}> (fleet average — this vehicle has no cost history of its own yet)</span>
                  : <span style={{color:T.muted}}> (from its own fuel, parts and repair history)</span>}</>
              : <> · no vehicle in the fleet has enough cost history yet, so this trip carries no cost</>}
          </div>
        )}

        <div className="field" style={{marginTop:8}}><label>Notes (optional)</label>
          <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></div>

        {err && <div style={{fontSize:12,color:T.danger,marginTop:8}}>{err}</div>}
        <button className="btn" style={{marginTop:10}} disabled={saving} onClick={save}>
          {saving?"Saving…":(form.end_km===""?"Start trip":"Save trip")}
        </button>
      </div>
    )}

    {visible.filter(isOpen).length > 0 && (
      <div className="section" style={{marginBottom:14,borderColor:`${T.warn}55`}}>
        <div className="section-title" style={{color:T.warn}}>Still out ({visible.filter(isOpen).length})</div>
        <div style={{fontSize:12,color:T.muted,marginBottom:10}}>
          Trips started but not closed off. Add the closing odometer when the vehicle is back —
          until then the trip carries no distance or cost.
        </div>
        {visible.filter(isOpen).map(t=>(
          <div key={t.id} style={{padding:"8px 0",borderTop:`1px solid ${T.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <div style={{fontSize:13}}>
                <span style={{fontWeight:600,color:T.cream}}>{vehicleById[t.vehicle_id]?.name||"—"}</span>
                <span style={{color:T.muted}}> · {t.driver_name} · {purposeById[t.purpose_id]?.name||"—"}</span>
                <span style={{color:T.muted}}> · out since {t.trip_date} at {fmtNum(t.start_km)} km</span>
              </div>
              {closing?.id===t.id ? (
                <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                  <input type="number" inputMode="decimal" autoFocus value={closeKm}
                    onChange={e=>setCloseKm(e.target.value)} placeholder="closing km"
                    style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:6,color:T.cream,
                            fontFamily:"'Space Mono'",fontSize:13,padding:"6px 10px",width:130}}/>
                  <button className="btn btn-primary btn-sm" onClick={closeTrip}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={()=>{setClosing(null);setCloseKm("");setCloseErr("");}}>Cancel</button>
                </div>
              ) : (
                <button className="btn btn-sm" onClick={()=>{setClosing(t);setCloseKm("");setCloseErr("");}}>Close trip</button>
              )}
            </div>
            {closing?.id===t.id && closeErr && <div style={{fontSize:12,color:T.danger,marginTop:6}}>{closeErr}</div>}
          </div>
        ))}
      </div>
    )}

    <div className="tbl-wrap"><table className="tbl">
      <thead><tr>
        <th>Date</th><th>Vehicle</th><th>Driver</th><th>Purpose</th>
        <th className="num">Start</th><th className="num">End</th><th className="num">KM</th>
        <th className="num">Cost</th><th>Job card</th><th></th>
      </tr></thead>
      <tbody>
        {visible.map(t=>(
          <tr key={t.id}>
            <td className="mono" style={{fontSize:11}}>{t.trip_date}</td>
            <td style={{fontWeight:600}}>{vehicleById[t.vehicle_id]?.name||"—"}</td>
            <td style={{fontSize:12}}>{t.driver_name}</td>
            <td style={{fontSize:12,color:T.muted}}>{purposeById[t.purpose_id]?.name||"—"}</td>
            <td className="num" style={{color:T.muted,fontSize:11}}>{fmtNum(t.start_km)}</td>
            <td className="num" style={{color:T.muted,fontSize:11}}>{isOpen(t)?"—":fmtNum(t.end_km)}</td>
            <td className="num" style={{fontWeight:600}}>
              {isOpen(t) ? <span style={{color:T.warn,fontWeight:400,fontSize:11}}>still out</span> : fmtNum(tripKm(t))}</td>
            <td className="num" style={{color:tripCost(t)?T.gold:T.border}}>{tripCost(t)?fmtR(tripCost(t)):"—"}</td>
            <td style={{fontSize:11,color:T.muted}}>{t.job_id?(jobById[t.job_id]?.name||"linked"):"—"}</td>
            <td>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>remove(t)}>x</button>}</td>
          </tr>
        ))}
        {visible.length===0 && <tr><td colSpan={10} className="empty">No trips logged yet.</td></tr>}
      </tbody>
    </table></div>
  </>);
}

// Category list is data, not code — Thijs asked for "an option to add
// categories". is_maintenance is a flag rather than a name match, so a company
// can rename it or add a second maintenance-type purpose without a code change.
function TripPurposeManager({ purposes, setPurposes, companyId }) {
  const [name, setName] = useState("");
  const [isMaint, setIsMaint] = useState(false);
  const [saving, setSaving] = useState(false);

  async function add() {
    const n = name.trim();
    if(!n) return;
    if(purposes.some(p=>p.name.toLowerCase()===n.toLowerCase())) { alert("That category already exists."); return; }
    setSaving(true);
    try {
      const row = { id: uid(), company_id: companyId, name: n, is_maintenance: isMaint,
                    active: true, sort_order: (purposes.length?Math.max(...purposes.map(p=>p.sort_order||0)):0)+1 };
      await sb.insert("vehicle_trip_purposes", row);
      setPurposes(p=>[...p, row]);
      setName(""); setIsMaint(false);
    } catch(e){ alert("Could not add: "+e.message); }
    finally { setSaving(false); }
  }

  async function deactivate(p) {
    if(!window.confirm(`Remove "${p.name}"? Trips already logged against it keep their category.`)) return;
    try {
      await sb.patch("vehicle_trip_purposes", p.id, { active:false });
      setPurposes(list=>list.filter(x=>x.id!==p.id));
    } catch(e){ alert("Error: "+e.message); }
  }

  return (
    <div className="section" style={{marginBottom:14}}>
      <div className="section-title">Trip categories</div>
      <div style={{fontSize:12,color:T.muted,marginBottom:10}}>
        Tick "counts as maintenance" for any category whose trips should be attachable to a job card
        and billed to that job. Removing a category hides it from the dropdown; trips already logged
        against it keep it.
      </div>
      {purposes.map(p=>(
        <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          padding:"6px 0",borderTop:`1px solid ${T.border}`}}>
          <div>
            <span style={{fontWeight:600}}>{p.name}</span>
            {p.is_maintenance && <span className="badge" style={{marginLeft:8,background:`${T.gold}22`,color:T.gold,border:`1px solid ${T.gold}55`}}>counts as maintenance</span>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={()=>deactivate(p)}>Remove</button>
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="New category name"
          style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:6,color:T.cream,
                  fontFamily:"'Space Mono'",fontSize:13,padding:"6px 10px",flex:1,minWidth:160}}/>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.muted}}>
          <input type="checkbox" checked={isMaint} onChange={e=>setIsMaint(e.target.checked)}/>
          counts as maintenance
        </label>
        <button className="btn" disabled={saving||!name.trim()} onClick={add}>{saving?"Adding…":"Add"}</button>
      </div>
    </div>
  );
}
