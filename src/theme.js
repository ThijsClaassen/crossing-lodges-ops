// ─── DESIGN TOKENS — Crossing Lodges brand palette ───────────────────────────
// Logo colours: navy #3C3B5A (C + LODGES), slate #6B6A59 (rossing + South Africa)
// UI palette: deep navy backgrounds, warm slate panels, gold accent for interactive
export const T = {
  bg:       "#1E1D2B",   // deep navy — darkened logo navy
  panel:    "#28273A",   // slightly lighter navy for cards/sidebar
  border:   "#3A3850",   // muted navy border
  navy:     "#3C3B5A",   // exact logo navy
  navyLt:   "#4E4D72",   // hover states
  slate:    "#6B6A59",   // logo slate grey
  gold:     "#B8935A",   // warm gold accent (safari feel, brand-compatible)
  goldLt:   "#D4AF7A",   // gold hover
  cream:    "#F0EDE6",   // warm off-white text
  muted:    "#8A8899",   // muted text on dark
  danger:   "#C05858",
  ok:       "#5A9B72",
  fuel_d:   "#5B8CC4",   // diesel blue
  fuel_p:   "#C06060",   // petrol red
};

// Base64-encode the logo PNG path for inline use


export const css = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Space+Mono&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:${T.bg};color:${T.cream};font-family:'Inter',sans-serif;min-height:100vh;-webkit-tap-highlight-color:transparent}
  .mono{font-family:'Space Mono',monospace}
  .serif{font-family:'Cormorant Garamond',serif}

  /* ── DESKTOP LAYOUT ── */
  .shell{display:flex;height:100vh;overflow:hidden}
  .sidebar{width:230px;background:${T.panel};border-right:1px solid ${T.border};display:flex;flex-direction:column;flex-shrink:0}
  .main{flex:1;overflow-y:auto;background:${T.bg}}
  .bottom-nav{display:none}

  /* Logo */
  .logo{padding:20px 18px 16px;border-bottom:1px solid ${T.border};display:flex;flex-direction:column;align-items:center;gap:10px}
  .logo img{width:148px;height:auto;filter:brightness(0) invert(1) opacity(0.92)}
  .logo-sub{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${T.gold};font-weight:600;font-family:'Inter',sans-serif;text-align:center}

  /* Location switcher */
  .loc-switcher{padding:12px 13px;border-bottom:1px solid ${T.border};display:flex;flex-direction:column;gap:3px}
  .loc-label{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:${T.muted};font-weight:600;margin-bottom:5px;padding-left:2px}
  .loc-btn{padding:7px 11px;border-radius:6px;border:1px solid transparent;font-family:'Inter',sans-serif;font-size:12px;font-weight:500;cursor:pointer;text-align:left;transition:all .15s;background:transparent;color:${T.muted};display:flex;align-items:center;gap:8px}
  .loc-btn:hover{color:${T.cream};background:rgba(255,255,255,.04)}
  .loc-btn.active-ZC{background:rgba(184,147,90,.15);border-color:rgba(184,147,90,.45);color:${T.gold}}
  .loc-btn.active-EC{background:rgba(91,140,196,.15);border-color:rgba(91,140,196,.45);color:${T.fuel_d}}
  .loc-btn.active-SC{background:rgba(107,140,110,.15);border-color:rgba(107,140,110,.45);color:#7BAE7F}
  .loc-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}

  /* Nav */
  .nav{flex:1;padding:8px 0;overflow-y:auto}
  .nav-section{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:${T.muted};padding:12px 18px 3px;font-weight:600;opacity:.7}
  .nav-item{display:flex;align-items:center;gap:9px;padding:9px 18px;cursor:pointer;font-size:13px;font-weight:500;color:${T.muted};transition:all .15s;border:none;background:none;width:100%;text-align:left;letter-spacing:.01em}
  .nav-item:hover{color:${T.cream};background:rgba(184,147,90,.06)}
  .nav-item.active{color:${T.gold};background:rgba(184,147,90,.12);border-right:2px solid ${T.gold};font-weight:600}
  .nav-icon{font-size:15px;width:17px;text-align:center;opacity:.85}

  /* Topbar */
  .topbar{background:${T.panel};border-bottom:1px solid ${T.border};padding:14px 28px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;gap:12px}
  .page-title{font-size:20px;font-weight:600;color:${T.cream};font-family:'Cormorant Garamond',serif;letter-spacing:.02em}
  .loc-badge{font-size:11px;font-weight:600;padding:4px 12px;border-radius:4px;letter-spacing:.04em;white-space:nowrap}
  .month-badge{background:rgba(184,147,90,.18);border:1px solid rgba(184,147,90,.45);color:${T.gold};font-size:11px;font-weight:600;padding:4px 12px;border-radius:4px;letter-spacing:.06em}

  /* KPI cards */
  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:22px 28px 0}
  .kpi{background:${T.panel};border:1px solid ${T.border};border-radius:8px;padding:16px 18px;position:relative;overflow:hidden}
  .kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent,${T.gold})}
  .kpi-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${T.muted};font-weight:600;margin-bottom:6px}
  .kpi-value{font-size:24px;font-weight:700;color:${T.cream};font-family:'Space Mono',monospace}
  .kpi-sub{font-size:11px;color:${T.muted};margin-top:3px}

  /* Section */
  .section{padding:22px 28px}
  .section-title{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${T.gold};margin-bottom:12px;opacity:.9}

  /* Tables — scrollable on mobile */
  .tbl-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .tbl{width:100%;border-collapse:collapse;font-size:13px;min-width:540px}
  .tbl th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${T.muted};font-weight:600;padding:7px 11px;border-bottom:1px solid ${T.border};white-space:nowrap}
  .tbl td{padding:9px 11px;border-bottom:1px solid rgba(58,56,80,.5);color:${T.cream};vertical-align:middle}
  .tbl tr:hover td{background:rgba(184,147,90,.04)}
  .tbl .num{font-family:'Space Mono',monospace;text-align:right}
  .ok{color:${T.ok}} .bad{color:${T.danger}}

  /* Badges */
  .badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;letter-spacing:.04em}
  .badge-d{background:rgba(91,140,196,.2);color:${T.fuel_d};border:1px solid rgba(91,140,196,.3)}
  .badge-p{background:rgba(192,96,96,.2);color:${T.fuel_p};border:1px solid rgba(192,96,96,.3)}
  .badge-v{background:rgba(90,155,114,.15);color:${T.ok};border:1px solid rgba(90,155,114,.3)}
  .badge-neu{background:rgba(138,136,153,.15);color:${T.muted};border:1px solid rgba(138,136,153,.3)}
  .badge-e{background:rgba(184,147,90,.15);color:${T.gold};border:1px solid rgba(184,147,90,.3)}
  .badge-loc{font-size:10px;font-weight:600;padding:2px 8px;border-radius:3px}

  /* Gauges */
  .gauge-wrap{background:${T.border};border-radius:4px;height:6px;width:100%;overflow:hidden}
  .gauge-fill{height:100%;border-radius:4px;transition:width .4s}

  /* Tabs */
  .tabs{display:flex;border-bottom:1px solid ${T.border};margin-bottom:18px;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .tab{padding:9px 17px;font-size:12px;font-weight:600;letter-spacing:.04em;cursor:pointer;border:none;background:none;color:${T.muted};border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;flex-shrink:0}
  .tab.active{color:${T.gold};border-bottom-color:${T.gold}}
  .tab:hover:not(.active){color:${T.cream}}

  /* Form fields */
  .field{margin-bottom:13px}
  .field label{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${T.muted};font-weight:600;margin-bottom:4px}
  .field input,.field select,.field textarea{width:100%;background:rgba(0,0,0,.25);border:1px solid ${T.border};border-radius:6px;padding:10px 11px;color:${T.cream};font-family:'Inter',sans-serif;font-size:16px;outline:none;transition:border .15s}
  .field input:focus,.field select:focus,.field textarea:focus{border-color:${T.gold}}
  .field select option{background:${T.panel}}
  .field textarea{resize:vertical;font-size:14px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:11px}

  /* Buttons */
  .btn{display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:6px;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .15s;letter-spacing:.01em}
  .btn-primary{background:${T.navy};color:${T.cream};border:1px solid ${T.navyLt}}
  .btn-primary:hover{background:${T.navyLt}}
  .btn-ghost{background:transparent;color:${T.muted};border:1px solid ${T.border}}
  .btn-ghost:hover{color:${T.cream};border-color:${T.muted}}
  .btn-danger{background:rgba(192,88,88,.15);color:${T.danger};border:1px solid rgba(192,88,88,.35)}
  .btn-sm{padding:5px 10px;font-size:11px}

  /* Modal */
  .overlay{position:fixed;inset:0;background:rgba(10,9,20,.85);z-index:200;display:flex;align-items:flex-end;justify-content:center;padding:0}
  .modal{background:${T.panel};border:1px solid ${T.border};border-radius:16px 16px 0 0;width:100%;max-width:600px;padding:24px 20px 32px;max-height:92vh;overflow-y:auto}
  .modal-title{font-size:18px;font-weight:600;color:${T.cream};margin-bottom:18px;display:flex;align-items:center;gap:8px;font-family:'Cormorant Garamond',serif;letter-spacing:.02em}
  .modal-title span{color:${T.gold}}

  /* Vehicle cards */
  .vcard{background:${T.panel};border:1px solid ${T.border};border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px}
  .vcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}

  /* Summary strip */
  .strip{background:rgba(184,147,90,.06);border:1px solid rgba(184,147,90,.2);border-radius:8px;padding:12px 14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
  .strip-item{text-align:center;min-width:70px}
  .strip-label{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:${T.muted};font-weight:600}
  .strip-val{font-size:16px;font-weight:700;color:${T.gold};font-family:'Space Mono',monospace;margin-top:1px}

  /* Empty states */
  .empty{padding:36px;text-align:center;color:${T.muted};font-size:13px}
  .empty-icon{font-size:34px;margin-bottom:10px;opacity:.35}

  /* Info box */
  .info-box{background:rgba(184,147,90,.08);border:1px solid rgba(184,147,90,.25);border-radius:6px;padding:9px 13px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}

  /* Scrollbar */
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}

  /* ── MOBILE STYLES (<= 768px) ── */
  @media (max-width: 768px) {
    /* Hide desktop sidebar, show bottom nav */
    .sidebar{display:none}
    .bottom-nav{
      display:flex;position:fixed;bottom:0;left:0;right:0;
      background:${T.panel};border-top:1px solid ${T.border};
      z-index:100;padding:8px 12px;padding-bottom:calc(8px + env(safe-area-inset-bottom));
    }
    /* Bottom nav is a single "Menu" button rather than a row of tabs — with
       up to 7 tabs, a horizontal strip either clips items off the edge of
       the screen or needs a swipe gesture nobody discovers on their own.
       Tapping it opens a bottom sheet (.nav-sheet) listing every tab for
       the current role, same grouping as the desktop sidebar. */
    .nav-menu-btn{
      width:100%;display:flex;align-items:center;justify-content:center;gap:8px;
      padding:11px 14px;border-radius:10px;border:1px solid ${T.gold};
      background:rgba(184,147,90,.12);color:${T.goldLt};
      font-family:'Inter',sans-serif;font-weight:700;font-size:14px;cursor:pointer;
    }
    .nav-overlay{
      position:fixed;inset:0;background:rgba(0,0,0,.55);
      display:flex;align-items:flex-end;justify-content:center;z-index:200;
    }
    .nav-sheet{
      width:100%;max-width:560px;max-height:75vh;overflow-y:auto;
      background:${T.panel};border:1px solid ${T.border};border-bottom:none;
      border-radius:16px 16px 0 0;
    }
    .nav-sheet-header{
      display:flex;justify-content:space-between;align-items:center;padding:14px 16px;
      border-bottom:1px solid ${T.border};position:sticky;top:0;background:${T.panel};
    }
    .nav-sheet-title{font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:600;color:${T.goldLt}}
    .nav-sheet-close{
      padding:5px 12px;border-radius:8px;border:1px solid ${T.border};
      background:transparent;color:${T.cream};font-family:'Inter',sans-serif;
      font-size:13px;cursor:pointer;
    }
    .nav-sheet-item{
      display:block;width:100%;text-align:left;padding:14px 16px;border:none;
      border-bottom:1px solid ${T.border};background:none;color:${T.cream};
      font-family:'Inter',sans-serif;font-weight:500;font-size:14px;cursor:pointer;
    }
    .nav-sheet-item.active{background:rgba(184,147,90,.12);color:${T.goldLt};font-weight:700}

    /* Main fills full screen minus top/bottom bars */
    .main{padding-bottom:78px}

    /* Topbar compact */
    .topbar{padding:10px 14px;gap:8px}
    .page-title{font-size:16px}
    .month-badge{font-size:10px;padding:3px 8px}
    .loc-badge{font-size:10px;padding:3px 8px}

    /* Mobile location bar — horizontal strip below topbar */
    .mobile-loc-bar{
      display:flex;gap:6px;padding:8px 14px;
      background:${T.panel};border-bottom:1px solid ${T.border};
      overflow-x:auto;-webkit-overflow-scrolling:touch;
    }
    .mobile-loc-btn{
      flex-shrink:0;padding:5px 12px;border-radius:20px;border:1px solid transparent;
      font-family:'Inter',sans-serif;font-size:11px;font-weight:600;cursor:pointer;
      background:transparent;color:${T.muted};display:flex;align-items:center;gap:5px;
      white-space:nowrap;
    }
    .mobile-loc-btn.active-ZC{background:rgba(184,147,90,.18);border-color:rgba(184,147,90,.5);color:${T.gold}}
    .mobile-loc-btn.active-EC{background:rgba(91,140,196,.18);border-color:rgba(91,140,196,.5);color:${T.fuel_d}}
    .mobile-loc-btn.active-SC{background:rgba(107,140,110,.18);border-color:rgba(107,140,110,.5);color:#7BAE7F}

    /* Section padding tighter on mobile */
    .section{padding:14px}
    .kpi-row{grid-template-columns:1fr 1fr;gap:10px;padding:14px 14px 0}
    .kpi{padding:12px 14px}
    .kpi-value{font-size:18px}

    /* Grids collapse to single column on mobile */
    .grid2{grid-template-columns:1fr}
    .grid3{grid-template-columns:1fr}

    /* Modal slides up from bottom, full width */
    .overlay{align-items:flex-end;padding:0}
    .modal{border-radius:16px 16px 0 0;max-height:88vh;padding:20px 16px 40px}

    /* Strip wraps nicely */
    .strip{gap:10px;padding:10px 12px}
    .strip-val{font-size:14px}

    /* Tables get horizontal scroll wrapper */
    .tbl{font-size:12px;min-width:480px}
    .tbl th{padding:6px 8px;font-size:9px}
    .tbl td{padding:8px 8px}

    /* Inputs larger touch targets */
    .field input,.field select,.field textarea{padding:12px 11px;font-size:16px}
    .btn{padding:12px 16px;font-size:13px}
    .btn-sm{padding:6px 10px;font-size:11px}

    /* Hide desktop-only loc section label */
    .desktop-only{display:none}
  }

  /* Hide mobile elements on desktop */
  .mobile-loc-bar{display:none}
  @media (min-width: 769px) {
    .mobile-loc-bar{display:none !important}
    .nav-overlay{display:none !important}
  }
`;
