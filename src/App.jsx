import { useState, useEffect, useCallback, useMemo } from "react";
import { sb, LOCATIONS, LOC_COLORS } from "./sb.js";
import { supabase } from "./supabaseClient.js";
import { T, css } from "./theme.js";
import { LOGO_DATA } from "./logo.js";
import Login from "./Login.jsx";
import SetPassword from "./SetPassword.jsx";
import { CompanyProvider, useCompany } from "./CompanyContext.jsx";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtR = n => `R ${Number(n).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtL = n => `${Number(n).toLocaleString()} L`;
const uid   = () => crypto.randomUUID();

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
function DieselInventory({ locId, loc, setLoc, fleet, isAdmin }) {
  const [tab, setTab]             = useState("issues");
  const [showDelivery, setShowDelivery] = useState(false);
  const [showIssue,    setShowIssue]    = useState(false);
  const [showDip,      setShowDip]      = useState(false);
  const [dForm, setDForm] = useState({date:today(),litres:"",pricePerLitre:"",supplier:"",invoiceNo:"",notes:""});
  const [iForm, setIForm] = useState({date:today(),open:"",close:"",litres:"",vehicle:"",mileage:"",notes:""});
  const [dipForm,setDipForm]=useState({date:today(),litres:"",notes:""});

  const { dieselDeliveries:deliveries, dieselIssues:issues, dieselDips:dips, dieselOpening:opening } = loc;
  const upd = patch => setLoc(l=>({...l,...patch}));

  const totalDelivered = deliveries.reduce((s,d)=>s+(d.litres||0),0);
  const totalIssued    = issues.reduce((s,i)=>s+(i.litres||0),0);
  const theoretical    = (opening||0)+totalDelivered-totalIssued;
  const lastDip        = dips.length>0?dips[dips.length-1].litres:null;
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
    setDForm({date:today(),litres:"",pricePerLitre:"",supplier:"",invoiceNo:"",notes:""});setShowDelivery(false);
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
            <thead><tr><th>Date</th><th className="num">Litres</th><th className="num">Price/L</th><th className="num">Total</th><th>Supplier</th><th>Invoice</th><th>Notes</th><th></th></tr></thead>
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
                  <td><button className="btn btn-danger btn-sm" onClick={()=>upd({dieselDeliveries:deliveries.filter(x=>x.id!==d.id)})}>x</button></td>
                </tr>
              ))}
              {deliveries.length===0&&<tr><td colSpan={8} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No deliveries recorded yet</td></tr>}
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
              <input type="number" value={loc.dieselOpening} onChange={e=>upd({dieselOpening:parseFloat(e.target.value)||0})}
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
              {dips.map(d=>{
                const v=d.litres-theoretical;const ok=Math.abs(v)<50;
                return(
                  <tr key={d.id}>
                    <td className="mono" style={{fontSize:12}}>{d.date}</td>
                    <td className="num" style={{fontWeight:700}}>{fmtL(d.litres)}</td>
                    <td className="num" style={{color:T.muted}}>{fmtL(Math.max(0,theoretical))}</td>
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
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={dForm.date} onChange={v=>setDForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Litres Delivered</label><input type="number" placeholder="e.g. 5000" value={dForm.litres} onChange={e=>setDForm(f=>({...f,litres:e.target.value}))}/></div>
              <div className="field"><label>Price / Litre (R)</label><input type="number" step="0.01" value={dForm.pricePerLitre} onChange={e=>setDForm(f=>({...f,pricePerLitre:e.target.value}))}/></div>
              <div className="field"><label>Supplier</label><input type="text" placeholder="e.g. Engen" value={dForm.supplier} onChange={e=>setDForm(f=>({...f,supplier:e.target.value}))}/></div>
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
              <div className="field"><label>Opening Meter</label><input type="number" value={iForm.open} onChange={e=>setIForm(f=>({...f,open:e.target.value}))}/></div>
              <div className="field"><label>Closing Meter</label><input type="number" value={iForm.close} onChange={e=>setIForm(f=>({...f,close:e.target.value,litres:String((parseFloat(e.target.value)||0)-(parseFloat(f.open)||0))}))}/></div>
              <div className="field"><label>Litres (auto-calc)</label><input type="number" value={iForm.litres} onChange={e=>setIForm(f=>({...f,litres:e.target.value}))}/></div>
              <div className="field"><label>Mileage / Hours</label><input type="text" value={iForm.mileage} onChange={e=>setIForm(f=>({...f,mileage:e.target.value}))}/></div>
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
              <div className="field"><label>Dip Reading (L)</label><input type="number" value={dipForm.litres} onChange={e=>setDipForm(f=>({...f,litres:e.target.value}))}/></div>
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
    </>
  );
}

// ─── PETROL INVENTORY ────────────────────────────────────────────────────────
function PetrolInventory({ loc, setLoc, fleet }) {
  const [tab,setTab]=[...useState("issues")];
  const [showPurchase,setShowPurchase]=useState(false);
  const [showIssue,setShowIssue]=useState(false);
  const [pForm,setPForm]=useState({date:today(),litres:"",pricePerLitre:"",station:"",notes:"",
    issueNow:false,issueVehicle:"",issueLitres:"",issueMileage:""});
  const [iForm,setIForm]=useState({date:today(),litres:"",vehicle:"",mileage:"",notes:""});

  const {petrolPurchases:purchases,petrolIssues:issues,petrolOpening:opening}=loc;
  const upd=patch=>setLoc(l=>({...l,...patch}));
  const petrolFleet=fleet.filter(v=>v.fuel==="petrol");

  const totalPurchased=purchases.reduce((s,p)=>s+(p.litres||0),0);
  const totalIssued   =issues.reduce((s,i)=>s+Math.abs(i.litres<0?i.litres:0),0);
  const theoretical   =(opening||0)+totalPurchased-totalIssued;
  const totalSpend    =purchases.reduce((s,p)=>s+(p.litres||0)*(p.pricePerLitre||0),0);
  const wavg          =totalPurchased>0?totalSpend/totalPurchased:0;

  const byVehicle=useMemo(()=>{
    const m={};
    issues.forEach(i=>{if(!i.vehicle)return;m[i.vehicle]=(m[i.vehicle]||0)+Math.abs(i.litres<0?i.litres:0);});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  },[issues]);

  const blankPForm = {date:today(),litres:"",pricePerLitre:"",station:"",notes:"",
    issueNow:false,issueVehicle:"",issueLitres:"",issueMileage:""};

  const addPurchase=()=>{
    const purchaseRow = {date:pForm.date,litres:parseFloat(pForm.litres)||0,pricePerLitre:parseFloat(pForm.pricePerLitre)||0,
      station:pForm.station,notes:pForm.notes,id:uid()};
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
            <thead><tr><th>Date</th><th className="num">Litres</th><th className="num">Price/L</th><th className="num">Total</th><th>Station</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {purchases.map(p=>(
                <tr key={p.id}>
                  <td className="mono" style={{fontSize:12}}>{p.date}</td>
                  <td className="num ok" style={{fontWeight:700}}>{fmtL(p.litres)}</td>
                  <td className="num">R {parseFloat(p.pricePerLitre||0).toFixed(2)}</td>
                  <td className="num">{fmtR((p.litres||0)*(p.pricePerLitre||0))}</td>
                  <td style={{fontSize:12}}>{p.station||<span style={{color:T.muted}}>—</span>}</td>
                  <td style={{fontSize:12,color:T.muted}}>{p.notes}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={()=>upd({petrolPurchases:purchases.filter(x=>x.id!==p.id)})}>x</button></td>
                </tr>
              ))}
              {purchases.length===0&&<tr><td colSpan={7} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No purchases yet</td></tr>}
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
              <input type="number" value={loc.petrolOpening} onChange={e=>upd({petrolOpening:parseFloat(e.target.value)||0})}
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
            <div className="grid2">
              <div className="field"><label>Date</label><DateField value={pForm.date} onChange={v=>setPForm(f=>({...f,date:v}))}/></div>
              <div className="field"><label>Litres</label><input type="number" value={pForm.litres} onChange={e=>setPForm(f=>({...f,litres:e.target.value}))}/></div>
              <div className="field"><label>Price / Litre (R)</label><input type="number" step="0.01" value={pForm.pricePerLitre} onChange={e=>setPForm(f=>({...f,pricePerLitre:e.target.value}))}/></div>
              <div className="field"><label>Filling Station</label><input type="text" placeholder="e.g. BP Modimolle" value={pForm.station} onChange={e=>setPForm(f=>({...f,station:e.target.value}))}/></div>
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
                    <input type="number" placeholder={pForm.litres||"0"} value={pForm.issueLitres}
                      onChange={e=>setPForm(f=>({...f,issueLitres:e.target.value}))}/>
                  </div>
                </div>
                <div className="field" style={{marginBottom:0}}>
                  <label>Mileage / Hours</label>
                  <input type="text" value={pForm.issueMileage} onChange={e=>setPForm(f=>({...f,issueMileage:e.target.value}))}/>
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
              <div className="field"><label>Litres</label><input type="number" value={iForm.litres} onChange={e=>setIForm(f=>({...f,litres:e.target.value}))}/></div>
              <div className="field"><label>Mileage / Hours</label><input type="text" value={iForm.mileage} onChange={e=>setIForm(f=>({...f,mileage:e.target.value}))}/></div>
            </div>
            <div className="field"><label>Notes</label><input type="text" value={iForm.notes} onChange={e=>setIForm(f=>({...f,notes:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={addIssue}>Save</button><button className="btn btn-ghost" onClick={()=>setShowIssue(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── PARTS & STOCK ───────────────────────────────────────────────────────────
function PartsStock({ loc, locId, setLoc, isAdmin, fleet, companyId }) {
  const parts=loc.parts;
  const partIssues=loc.partIssues||[];
  const upd=patch=>setLoc(l=>({...l,...patch}));
  const [showForm,setShowForm]=useState(false);
  const [showIssue,setShowIssue]=useState(false);
  const [issueBusy,setIssueBusy]=useState(false);
  const [form,setForm]=useState({description:"",storeroom:"",shelf:"",location:"",unit:"each",openCost:"",openQty:"",purchaseQty:"",purchaseCost:"",purchaseFrom:"",closingQty:""});
  const [issueForm,setIssueForm]=useState({partId:"",vehicle:"",qty:"",date:today()});

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

  const totalValue=parts.reduce((s,p)=>{
    const w=p.openQty>0||p.purchaseQty>0?((p.openCost*p.openQty)+p.purchaseCost)/Math.max(1,p.openQty+p.purchaseQty):p.openCost;
    return s+(p.closingQty||0)*w;
  },0);
  const totalPurchases=parts.reduce((s,p)=>s+(p.purchaseCost||0),0);

  const recentIssues = useMemo(()=>{
    return [...partIssues].sort((a,b)=>{
      const da=parseDMY(a.date), db=parseDMY(b.date);
      return (db?db.getTime():0)-(da?da.getTime():0);
    }).slice(0,25);
  },[partIssues]);
  const partName = id => parts.find(p=>p.id===id)?.description || "(deleted part)";
  const vehicleName = id => (fleet||[]).find(v=>v.id===id)?.name || id || "—";
  const partUnitCost = id => parts.find(p=>p.id===id)?.openCost || 0;

  return(
    <>
      <div className="strip">
        <div className="strip-item"><div className="strip-label">Closing Stock Value</div><div className="strip-val">{fmtR(totalValue)}</div></div>
        <div className="strip-item"><div className="strip-label">Purchases This Month</div><div className="strip-val">{fmtR(totalPurchases)}</div></div>
        <div className="strip-item"><div className="strip-label">Line Items</div><div className="strip-val">{parts.length}</div></div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button className="btn btn-ghost" onClick={()=>{setIssueForm({partId:"",vehicle:"",qty:"",date:today()});setShowIssue(true);}}>Issue Part</button>
          <button className="btn btn-primary" onClick={()=>setShowForm(true)}>+ Add Part</button>
        </div>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Description</th><th>Location</th><th>Unit</th><th className="num">Open Qty</th><th className="num">Open Cost</th><th className="num">Purchased</th><th className="num">Purchase Cost</th><th>From</th><th className="num">Closing Qty</th><th className="num">Value</th><th></th></tr></thead>
        <tbody>
          {parts.map(p=>{
            const w=p.openQty>0||p.purchaseQty>0?((p.openCost*p.openQty)+p.purchaseCost)/Math.max(1,p.openQty+p.purchaseQty):p.openCost;
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
                <td className="num">{fmtR((p.closingQty||0)*w)}</td>
                <td>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>upd({parts:parts.filter(x=>x.id!==p.id)})}>x</button>}</td>
              </tr>
            );
          })}
          {parts.length===0&&<tr><td colSpan={11} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No parts recorded at this location</td></tr>}
        </tbody>
      </table></div>

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
              <div className="field"><label>Opening Cost (R)</label><input type="number" value={form.openCost} onChange={e=>setForm(f=>({...f,openCost:e.target.value}))}/></div>
              <div className="field"><label>Opening Qty</label><input type="number" value={form.openQty} onChange={e=>setForm(f=>({...f,openQty:e.target.value}))}/></div>
              <div className="field"><label>Purchase Qty</label><input type="number" value={form.purchaseQty} onChange={e=>setForm(f=>({...f,purchaseQty:e.target.value}))}/></div>
              <div className="field"><label>Purchase Cost (R excl VAT)</label><input type="number" value={form.purchaseCost} onChange={e=>setForm(f=>({...f,purchaseCost:e.target.value}))}/></div>
              <div className="field"><label>Closing Qty (Count)</label><input type="number" value={form.closingQty} onChange={e=>setForm(f=>({...f,closingQty:e.target.value}))}/></div>
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
            <div className="field"><label>Quantity</label><input type="number" min="0" value={issueForm.qty} onChange={e=>setIssueForm(f=>({...f,qty:e.target.value}))}/></div>
            <div style={{display:"flex",gap:9}}><button className="btn btn-primary" onClick={issuePart} disabled={issueBusy}>{issueBusy?"Issuing...":"Issue Part"}</button><button className="btn btn-ghost" onClick={()=>setShowIssue(false)} disabled={issueBusy}>Cancel</button></div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── REPAIRS ─────────────────────────────────────────────────────────────────
const BLANK_REPAIR = () => ({date:today(),vehicle:"",workshop:"",invoiceNo:"",description:"",labourCost:"",partsCost:"",otherCost:"",invoiceReceived:false,notes:""});
function Repairs({ loc, setLoc, fleet, isAdmin }) {
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
        <thead><tr><th>Date</th><th>Vehicle</th><th>Workshop</th><th>Description</th><th className="num">Labour</th><th className="num">Parts</th><th className="num">Total</th><th>Invoice</th><th></th></tr></thead>
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
              <td onClick={e=>e.stopPropagation()}>{isAdmin && <button className="btn btn-danger btn-sm" onClick={()=>upd({repairs:repairs.filter(x=>x.id!==r.id)})}>x</button>}</td>
            </tr>
          ))}
          {repairs.length===0&&<tr><td colSpan={9} className="empty"><div className="empty-icon" style={{fontSize:20,opacity:.3}}>[ ]</div>No repairs logged at this location</td></tr>}
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
              <div className="field"><label>Labour (R)</label><input type="number" min="0" value={form.labourCost} onChange={e=>setForm(f=>({...f,labourCost:e.target.value}))}/></div>
              <div className="field"><label>Parts (R)</label><input type="number" min="0" value={form.partsCost} onChange={e=>setForm(f=>({...f,partsCost:e.target.value}))}/></div>
              <div className="field"><label>Other (R)</label><input type="number" min="0" value={form.otherCost} onChange={e=>setForm(f=>({...f,otherCost:e.target.value}))}/></div>
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
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [detailVehicle, setDetailVehicle] = useState(null);
  const BLANK_V = { name:"", id:"", category:"vehicle", fuel:"diesel",
    license_expiry:"", last_service_date:"", last_service_km:"",
    service_interval_months:"", service_interval_km:"",
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

  const vehicles   = fleet.filter(v => v.category === "vehicle");
  const equipment  = fleet.filter(v => v.category === "equipment");

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
                <input type="number" min="0" placeholder="e.g. 12" value={form.service_interval_months}
                  onChange={e=>setForm(f=>({...f,service_interval_months:e.target.value}))}/>
              </div>
              <div className="field"><label>Odometer at Last Service (km)</label>
                <input type="number" min="0" placeholder="e.g. 82000" value={form.last_service_km}
                  onChange={e=>setForm(f=>({...f,last_service_km:e.target.value}))}/>
              </div>
              <div className="field"><label>Interval (km)</label>
                <input type="number" min="0" placeholder="e.g. 10000" value={form.service_interval_km}
                  onChange={e=>setForm(f=>({...f,service_interval_km:e.target.value}))}/>
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
function CostSummary({ locData, fleet, serviceJobs }) {
  const [viewLoc, setViewLoc]         = useState("all");
  const [detailVehicle, setDetailVehicle] = useState(null);
  const [costTab, setCostTab]         = useState("lifetime"); // "lifetime" | "monthly"
  const [monthCursor, setMonthCursor] = useState(() => { const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()}; });
  const DIESEL_PRICE = 20.5;
  const PETROL_PRICE = 21.5;

  const locsToShow = viewLoc === "all" ? LOCATIONS.map(l=>l.id) : [viewLoc];

  // Shared per-vehicle cost aggregation, used by both tabs.
  // inMonth: null = no filter (lifetime), or a (dateStr) => boolean predicate.
  // Parts costs have no per-transaction date in the data model (see note below),
  // so they can only ever be included when inMonth is null.
  const computeCosts = (inMonth) => {
    const m = {};
    fleet.forEach(v => {
      m[v.id] = { fuel:0, parts:0, repairs:0, name:v.name, fuel_type:v.fuel, category:v.category, odomReadings:[] };
    });

    locsToShow.forEach(lid => {
      const loc = locData[lid];
      if (!loc) return;

      loc.dieselIssues.forEach(e => {
        if (inMonth && !inMonth(e.date)) return;
        if (e.vehicle && m[e.vehicle]) {
          m[e.vehicle].fuel += (e.litres||0) * DIESEL_PRICE;
          const km = parseFloat(e.mileage);
          if (!isNaN(km) && km > 0) m[e.vehicle].odomReadings.push(km);
        }
      });
      loc.petrolIssues.forEach(e => {
        if (inMonth && !inMonth(e.date)) return;
        if (e.vehicle && m[e.vehicle]) {
          m[e.vehicle].fuel += Math.abs(e.litres < 0 ? e.litres : 0) * PETROL_PRICE;
          const km = parseFloat(e.mileage);
          if (!isNaN(km) && km > 0) m[e.vehicle].odomReadings.push(km);
        }
      });
      loc.repairs.forEach(e => {
        if (inMonth && !inMonth(e.date)) return;
        if (m[e.vehicle]) m[e.vehicle].repairs += e.totalCost||0;
      });
      // Each part issue now carries its own date, same as fuel and repairs —
      // no more special-casing needed here. Migrated historical rows (from
      // before this tracking existed) have date = null, so inMonth correctly
      // excludes them from any specific month while lifetime (inMonth=null)
      // still counts them in full.
      (loc.partIssues||[]).forEach(iss => {
        if (inMonth && !inMonth(iss.date)) return;
        if (m[iss.vehicle]) {
          const unitCost = loc.parts.find(p=>p.id===iss.partId)?.openCost || 0;
          m[iss.vehicle].parts += iss.qty * unitCost;
        }
      });
    });

    return Object.entries(m).map(([id, d]) => {
      const total = d.fuel + d.parts + d.repairs;
      const readings = d.odomReadings;
      const kmDriven = readings.length >= 2 ? Math.max(...readings) - Math.min(...readings) : null;
      const costPerKm = kmDriven && kmDriven > 0 ? total / kmDriven : null;
      return { id, ...d, total, kmDriven, costPerKm };
    })
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);
  };

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
          <div className="strip-item"><div className="strip-label">Diesel Rate</div><div className="strip-val" style={{color:T.fuel_d}}>R{DIESEL_PRICE}/L</div></div>
          <div className="strip-item"><div className="strip-label">Petrol Rate</div><div className="strip-val" style={{color:T.fuel_p}}>R{PETROL_PRICE}/L</div></div>
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
  { id:"fleet",     label:"Fleet",         section:"Management", adminOnly:true  },
  { id:"costs",     label:"Cost Summary",  section:"Reports",    adminOnly:true  },
];

const emptyLoc = () => ({
  dieselDeliveries:[], dieselIssues:[], dieselDips:[], dieselOpening:0,
  petrolPurchases:[], petrolIssues:[], petrolOpening:0,
  parts:[], partIssues:[], repairs:[],
});

// ─── SUPABASE SYNC ────────────────────────────────────────────────────────────
async function syncLocChanges(locId, companyId, oldLoc, newLoc) {
  const added   = (o,n) => n.filter(x => !o.find(y=>y.id===x.id));
  const removed = (o,n) => o.filter(x => !n.find(y=>y.id===x.id));

  for (const r of added(oldLoc.dieselDeliveries, newLoc.dieselDeliveries))
    await sb.insert("diesel_deliveries",{id:r.id,location_id:locId,company_id:companyId,date:r.date,litres:r.litres,price_per_litre:r.pricePerLitre,supplier:r.supplier||null,invoice_no:r.invoiceNo||null,notes:r.notes||null});
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
    await sb.insert("petrol_purchases",{id:r.id,location_id:locId,company_id:companyId,date:r.date,litres:r.litres,price_per_litre:r.pricePerLitre,station:r.station||null,notes:r.notes||null});
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
    await sb.insert("repairs",{id:r.id,location_id:locId,company_id:companyId,date:r.date,vehicle_id:r.vehicle||null,workshop:r.workshop||null,invoice_no:r.invoiceNo||null,description:r.description||null,labour_cost:r.labourCost||0,parts_cost:r.partsCost||0,other_cost:r.otherCost||0,total_cost:r.totalCost||0,invoice_received:r.invoiceReceived||false,notes:r.notes||null});
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

function AuthenticatedApp() {
  const {
    loading: companyLoading,
    error: companyError,
    availableCompanies,
    companyId,
    companyName,
    role,
    switchCompany,
  } = useCompany();

  const [page,    setPage]    = useState("dashboard");
  const [locId,   setLocId]   = useState("ZC");
  const [fleet,   setFleet]   = useState([]);
  const [locData, setLocData] = useState({ ZC:emptyLoc(), EC:emptyLoc(), SC:emptyLoc() });
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [serviceJobs, setServiceJobs] = useState({});

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
      const [fleetRows,dDel,dIss,dDips,dOpen,pPurch,pIss,pOpen,partsRows,partIssRows,repRows] = await Promise.all([
        sb.select("fleet", cf),
        sb.select("diesel_deliveries", cf),
        sb.select("diesel_issues", cf),
        sb.select("diesel_dips", cf),
        sb.select("diesel_opening", cf),
        sb.select("petrol_purchases", cf),
        sb.select("petrol_issues", cf),
        sb.select("petrol_opening", cf),
        sb.select("parts", cf),
        sb.select("parts_issues", cf),
        sb.select("repairs", cf),
      ]);

      setFleet(fleetRows.map(r=>({
        id:r.id, name:r.name, category:r.category, fuel:r.fuel,
        license_expiry:          r.license_expiry || "",
        last_service_date:       r.last_service_date || "",
        last_service_km:         r.last_service_km == null ? null : +r.last_service_km,
        service_interval_months: r.service_interval_months == null ? null : +r.service_interval_months,
        service_interval_km:     r.service_interval_km == null ? null : +r.service_interval_km,
        self_serviced:           !!r.self_serviced,
        service_location_id:     r.service_location_id || "",
      })));

      const nd = { ZC:emptyLoc(), EC:emptyLoc(), SC:emptyLoc() };
      LOCATIONS.forEach(l => {
        const lid = l.id;
        nd[lid].dieselDeliveries = dDel.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,litres:+r.litres,pricePerLitre:+r.price_per_litre,supplier:r.supplier||"",invoiceNo:r.invoice_no||"",notes:r.notes||""}));
        nd[lid].dieselIssues     = dIss.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,open:+r.open_meter,close:+r.close_meter,litres:+r.litres,vehicle:r.vehicle_id||"",mileage:r.mileage||"",notes:r.notes||""}));
        nd[lid].dieselDips       = dDips.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,litres:+r.litres,notes:r.notes||""}));
        nd[lid].dieselOpening    = +(dOpen.find(r=>r.location_id===lid)?.litres||0);
        nd[lid].petrolPurchases  = pPurch.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,litres:+r.litres,pricePerLitre:+r.price_per_litre,station:r.station||"",notes:r.notes||""}));
        nd[lid].petrolIssues     = pIss.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,litres:+r.litres,vehicle:r.vehicle_id||"",mileage:r.mileage||"",notes:r.notes||""}));
        nd[lid].petrolOpening    = +(pOpen.find(r=>r.location_id===lid)?.litres||0);
        nd[lid].parts            = partsRows.filter(r=>r.location_id===lid).map(r=>({id:r.id,description:r.description,storeroom:r.storeroom||"",shelf:r.shelf||"",location:r.position||"",unit:r.unit||"each",openCost:+r.open_cost,openQty:+r.open_qty,purchaseQty:+r.purchase_qty,purchaseCost:+r.purchase_cost,purchaseFrom:r.purchase_from||"",closingQty:+r.closing_qty,issues:r.issues||{}}));
        nd[lid].partIssues       = partIssRows.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date||"",partId:r.part_id,vehicle:r.vehicle_id||"",qty:+r.qty,notes:r.notes||""}));
        nd[lid].repairs          = repRows.filter(r=>r.location_id===lid).map(r=>({id:r.id,date:r.date,vehicle:r.vehicle_id||"",workshop:r.workshop||"",invoiceNo:r.invoice_no||"",description:r.description||"",labourCost:+r.labour_cost,partsCost:+r.parts_cost,otherCost:+r.other_cost,totalCost:+r.total_cost,invoiceReceived:r.invoice_received||false,notes:r.notes||""}));
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

  const visiblePages = PAGES.filter(p => isAdmin || !p.adminOnly);
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

  // Bottom nav pages (most used on mobile — keep to 5 max)
  const BOTTOM_NAV = isAdmin
    ? [
        { id:"diesel",    label:"Diesel"   },
        { id:"petrol",    label:"Petrol"   },
        { id:"repairs",   label:"Repairs"  },
        { id:"fleet",     label:"Fleet"    },
        { id:"costs",     label:"Costs"    },
      ]
    : [
        { id:"diesel",    label:"Diesel"   },
        { id:"petrol",    label:"Petrol"   },
        { id:"parts",     label:"Parts"    },
        { id:"repairs",   label:"Repairs"  },
      ];

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
              <span className="month-badge">{monthLabel}</span>
              <button onClick={logout} title="Sign out"
                style={{background:"none",border:"1px solid #3A3850",borderRadius:6,color:"#8A8899",fontSize:11,fontWeight:600,cursor:"pointer",padding:"5px 10px",flexShrink:0}}>
                Log out
              </button>
            </div>
          </div>

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
            {page==="diesel"    && <DieselInventory locId={locId} loc={loc} setLoc={setLoc} fleet={fleet} isAdmin={isAdmin}/>}
            {page==="petrol"    && <PetrolInventory loc={loc} setLoc={setLoc} fleet={fleet}/>}
            {page==="parts"     && <PartsStock loc={loc} locId={locId} setLoc={setLoc} isAdmin={isAdmin} fleet={fleet} companyId={companyId}/>}
            {page==="repairs"   && <Repairs loc={loc} setLoc={setLoc} fleet={fleet} isAdmin={isAdmin}/>}
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

        {/* ── MOBILE BOTTOM NAV ── */}
        <nav className="bottom-nav">
          {BOTTOM_NAV.map(p=>(
            <button key={p.id} className={`bn-item${page===p.id?" active":""}`} onClick={()=>setPage(p.id)}>
              {p.label}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
