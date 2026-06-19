import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell, ComposedChart, Area } from "recharts";
import { Activity, ChevronLeft, ChevronRight, Plus, Trash2, TrendingUp, AlertTriangle, CheckCircle, MinusCircle, Heart, BarChart3, Mountain, Settings, X, ChevronDown, ChevronUp, Check, Download, Upload, Loader, Users } from "lucide-react";
import { supabase } from './supabase';

// ─── Supabase Storage Layer ───
async function dbGet(table, userId, fallback) {
  try {
    const { data, error } = await supabase.from(table).select('data').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data?.data ?? fallback;
  } catch { return fallback; }
}

async function dbSet(table, userId, value) {
  try {
    const { error } = await supabase.from(table).upsert({ user_id: userId, data: value }, { onConflict: 'user_id' });
    if (error) throw error;
  } catch (e) { console.error(`DB save error (${table}):`, e); }
}

async function getProfile(userId) {
  const { data } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle();
  return data?.username ?? null;
}

async function upsertProfile(userId, username) {
  await supabase.from('profiles').upsert({ id: userId, username }, { onConflict: 'id' });
}

// Returns { id, username }[]
async function getAllUsers() {
  const { data } = await supabase.from('profiles').select('id, username').order('username');
  return data || [];
}

const emptyProfile = () => ({
  bodyweight: "", height: "", sex: "", age: "", dominantHand: "",
  climbingYears: "", trainingYears: "", discipline: [],
  onsightGradeSport: "", flashGradeBoulder: "", completed: false,
  nudgeState: {},
});

async function loadUserData(userId) {
  const [daily, climbs, assess, injury, sett, prof] = await Promise.all([
    dbGet('daily_logs', userId, {}),
    dbGet('climb_logs', userId, {}),
    dbGet('assessments', userId, []),
    dbGet('injury_logs', userId, []),
    dbGet('settings', userId, { instrument: 'Tindeq', unit: 'lbs' }),
    dbGet('athlete_data', userId, emptyProfile()),
  ]);
  return { daily, climbs, assess, injury, settings: sett, profile: prof };
}

// ─── Helpers ───
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtShort = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const avg = (a, b) => { const na = Number(a) || 0, nb = Number(b) || 0; if (na && nb) return (na + nb) / 2; return na || nb || 0; };
const pctCalc = (post, bl) => (bl && post) ? Math.round((post / bl) * 100) : null;

function computeEWMA(data, dates) {
  const lA = .25, lC = .069; let a = 0, c = 0, r = {};
  dates.forEach((d, i) => { const l = data[d]?.sessionLoad || 0; if (i === 0) { a = l; c = l; } else { a = lA * l + (1 - lA) * a; c = lC * l + (1 - lC) * c; } r[d] = { acute: Math.round(a * 10) / 10, chronic: Math.round(c * 10) / 10, ratio: c > 0 ? Math.round(a / c * 100) / 100 : 0 }; });
  return r;
}

const hoursToScore = (h) => { const n = Number(h); if (!n || n <= 0) return 0; if (n < 4) return 1; if (n < 5) return 2; if (n < 5.5) return 3; if (n < 6) return 4; if (n < 6.5) return 5; if (n < 7) return 6; if (n < 7.5) return 7; if (n < 8) return 8; if (n < 9) return 9; return 10; };

const dayMarkerAvg = (dd, type) => {
  if (!dd) return 0;
  if (type === "Tindeq") {
    const gf = gripFields("tindeq", dd.tindeqGripType, dd.tindeqIntensity);
    const l = Number(dd[gf.L]) || Number(dd.tindeqPeakL) || Number(dd.tindeqHCL) || 0;
    const r = Number(dd[gf.R]) || Number(dd.tindeqPeakR) || Number(dd.tindeqHCR) || 0;
    return avg(l, r);
  }
  if (type === "Dynamometer") return avg(dd.gripL, dd.gripR);
  return 0;
};

// ─── Z-Score Helpers ───
const BASELINE_DAYS = 21;
const rollingStats = (values, window = 28) => {
  const recent = values.slice(-window);
  if (recent.length < 5) return null; // not enough data
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
  const sd = Math.sqrt(variance);
  return { mean: Math.round(mean * 100) / 100, sd: Math.round(sd * 100) / 100 };
};

const zScore = (value, mean, sd) => {
  if (!sd || sd === 0) return 0;
  return Math.round(((value - mean) / sd) * 10) / 10;
};

const WELLNESS_ITEMS = [
  { key: "sleepQuality", label: "Sleep", invertArrow: false },
  { key: "sleepDuration", label: "Sleep hrs", invertArrow: false, isHours: true },
  { key: "soreness", label: "Soreness", invertArrow: true },
  { key: "fingerSoreness", label: "Finger soreness", invertArrow: true },
  { key: "stress", label: "Stress", invertArrow: true },
  { key: "motivation", label: "Motivation", invertArrow: false },
];

// ─── Defaults ───
const emptyDay = () => ({ sleepQuality: "", sleepDuration: "", soreness: "", fingerSoreness: "", stress: "", motivation: "", conditions: "", hrv: "", markerType: "Tindeq", tindeqGripType: "Half Crimp", tindeqIntensity: "Try Hard", gripL: "", gripR: "", tindeqHC50L: "", tindeqHC50R: "", tindeqHCTHL: "", tindeqHCTHR: "", tindeqOH50L: "", tindeqOH50R: "", tindeqOHTHL: "", tindeqOHTHR: "", sessions: [], notes: "" });
const emptySession = () => ({ sessionType: "", sessionDuration: "", sessionRPE: "", notes: "", outdoor: false });
const emptyClimb = () => ({ route: "", type: "", gradeSport: "", gradeBoulder: "", styles: [], sendType: "", wallAngle: "", rpe: "", attempts: "", moves: "", sent: false, instrument: "Tindeq", tindeqGripType: "Half Crimp", tindeqIntensity: "Try Hard", postHC50L: "", postHC50R: "", postHCTHL: "", postHCTHR: "", postOH50L: "", postOH50R: "", postOHTHL: "", postOHTHR: "", postRFDL: "", postRFDR: "", postGripL: "", postGripR: "", notes: "" });
const emptyAssess = () => ({ date: "", bodyweight: "", maxHang: "", weightedPullup: "", tindeqGripType: "Half Crimp", tindeqIntensity: "Try Hard", tindeqHC50L: "", tindeqHC50R: "", tindeqHCTHL: "", tindeqHCTHR: "", tindeqOH50L: "", tindeqOH50R: "", tindeqOHTHL: "", tindeqOHTHR: "", tindeqRFDL: "", tindeqRFDR: "", criticalForce: "", gripL: "", gripR: "", shoulderRatio: "", notes: "" });
const emptyInjury = () => ({ date: "", condition: "", lThumb: 0, lIndex: 0, lMiddle: 0, lRing: 0, lPinky: 0, rThumb: 0, rIndex: 0, rMiddle: 0, rRing: 0, rPinky: 0, elbowL: 0, elbowR: 0, shoulderL: 0, shoulderR: 0, details: "", notes: "" });

// ─── Constants ───
const SPORT_GRADES = ["5.6", "5.7", "5.8", "5.9", "5.10a", "5.10b", "5.10c", "5.10d", "5.11a", "5.11b", "5.11c", "5.11d", "5.12a", "5.12b", "5.12c", "5.12d", "5.13a", "5.13b", "5.13c", "5.13d", "5.14a", "5.14b", "5.14c", "5.14d", "5.15a", "5.15b", "5.15c"];
const BOULDER_GRADES = ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "V13", "V14", "V15", "V16"];
const STYLES = ["Crimpy", "Slopey", "Pinchy", "Overhang", "Vertical", "Slab", "Endurance", "Power", "Compression", "Dyno", "Campus", "One Foot"];
const SEND_TYPES = ["Redpoint", "Flash", "Onsight", "Attempt", "Hang", "Project", "Repeat"];
const CLIMB_TYPES = ["Bouldering — Power", "Bouldering — Power Endurance", "Sport Climbing — Rope", "Sport Climbing — Circuit", "Hangboard", "Conditioning", "Antagonist", "Cardio", "Other"];
const SESSION_TYPES = [...CLIMB_TYPES, "Rest"];
const OUTDOOR_SESSION_TYPES = new Set(["Bouldering — Power", "Bouldering — Power Endurance", "Sport Climbing — Rope"]);
const CONDITION_COLORS = { Hot: "bg-amber-500/20 text-amber-300 border-amber-500/30", Warm: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", Cool: "bg-sky-500/20 text-sky-300 border-sky-500/30", Cold: "bg-violet-500/20 text-violet-300 border-violet-500/30" };
const CLIMBING_SESSION_TYPES = new Set(["Bouldering — Power", "Bouldering — Power Endurance", "Sport Climbing — Rope", "Sport Climbing — Circuit"]);
const WALL_ANGLES = ["Slab", "Vertical", "Slight OH", "Steep OH", "Roof"];

// ─── UI Components ───
const Badge = ({ children, color = "gray" }) => {
  const c = { green: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", yellow: "bg-amber-500/20 text-amber-300 border-amber-500/30", red: "bg-red-500/20 text-red-300 border-red-500/30", gray: "bg-slate-600/30 text-slate-400 border-slate-500/30", blue: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${c[color]}`}>{children}</span>;
};
const Card = ({ children, className = "", onClick }) => (
  <div className={`bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-5 ${onClick ? "cursor-pointer hover:border-slate-600 transition-all" : ""} ${className}`} onClick={onClick}>{children}</div>
);
const Input = ({ label, value, onChange, type = "text", placeholder = "", min, max, step, className = "" }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    {label && <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} min={min} max={max} step={step}
      className="bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 placeholder-slate-600 transition-all" />
  </div>
);
const Select = ({ label, value, onChange, options, placeholder = "Select...", className = "" }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    {label && <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>}
    <select value={value} onChange={e => onChange(e.target.value)}
      className="bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none transition-all">
      <option value="">{placeholder}</option>
      {options.map((o, i) => <option key={o} value={o} style={{ background: i % 2 === 0 ? "#1e293b" : "#0f172a" }}>{o}</option>)}
    </select>
  </div>
);
const ForcePair = ({ labelL, labelR, valueL, valueR, onChangeL, onChangeR, step = "0.1" }) => (
  <div className="grid grid-cols-2 gap-3">
    <Input label={labelL} value={valueL} onChange={onChangeL} type="number" step={step} />
    <Input label={labelR} value={valueR} onChange={onChangeR} type="number" step={step} />
  </div>
);
const StylePicker = ({ selected = [], onChange }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Styles (tap to toggle)</label>
    <div className="flex flex-wrap gap-1.5">
      {STYLES.map(s => {
        const active = selected.includes(s);
        return <button key={s} onClick={() => onChange(active ? selected.filter(x => x !== s) : [...selected, s])}
          className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${active ? "bg-sky-500/25 text-sky-300 border-sky-500/40" : "bg-slate-800/60 text-slate-500 border-slate-700/40 hover:border-slate-600"}`}>{s}</button>;
      })}
    </div>
  </div>
);
const WellnessRow = ({ label, value, onChange, lowLabel = "", highLabel = "" }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-300">{label}</span>
      <span className={`text-xs font-bold font-mono ${!value ? "text-slate-600" : value <= 3 ? "text-red-400" : value <= 5 ? "text-amber-400" : value <= 7 ? "text-sky-400" : "text-emerald-400"}`}>{value || "—"}/10</span>
    </div>
    <div className="flex gap-[3px]">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => (
        <button key={v} onClick={() => onChange(v)}
          className={`flex-1 h-8 rounded text-[10px] font-bold transition-all ${value === v ? (v <= 3 ? "bg-red-500 text-white shadow-lg shadow-red-500/30" : v <= 5 ? "bg-amber-500 text-white shadow-lg shadow-amber-500/30" : v <= 7 ? "bg-sky-500 text-white shadow-lg shadow-sky-500/30" : "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30") : "bg-slate-800/80 text-slate-600 hover:bg-slate-700 border border-slate-700/40"}`}>{v}</button>
      ))}
    </div>
    {(lowLabel || highLabel) && <div className="flex justify-between text-[9px] text-slate-600 px-0.5"><span>{lowLabel}</span><span>{highLabel}</span></div>}
  </div>
);
const SleepSlider = ({ value, onChange }) => {
  const hrs = Number(value) || 0; const score = hoursToScore(hrs);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300">Sleep Duration</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold font-mono text-slate-200">{hrs > 0 ? `${hrs}h` : "—"}</span>
          <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${score <= 3 ? "bg-red-500/20 text-red-400" : score <= 5 ? "bg-amber-500/20 text-amber-400" : score <= 7 ? "bg-sky-500/20 text-sky-400" : "bg-emerald-500/20 text-emerald-400"}`}>{score > 0 ? `${score}/10` : "—"}</span>
        </div>
      </div>
      <input type="range" min={0} max={12} step={0.25} value={hrs} onChange={e => onChange(e.target.value)}
        className="w-full h-2 rounded-full appearance-none cursor-pointer"
        style={{ background: `linear-gradient(to right, ${hrs === 0 ? '#334155' : hrs < 5 ? '#ef4444' : hrs < 6.5 ? '#eab308' : hrs < 8 ? '#38bdf8' : '#22c55e'} ${hrs / 12 * 100}%, #334155 ${hrs / 12 * 100}%)` }} />
      <div className="flex justify-between text-[9px] text-slate-600 px-0.5"><span>0h</span><span>4h</span><span>6h</span><span>8h</span><span>10h</span><span>12h</span></div>
    </div>
  );
};
const PainSlider = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-slate-400 w-16 shrink-0">{label}</span>
    <input type="range" min={0} max={10} value={value} onChange={e => onChange(parseInt(e.target.value))}
      className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-red-500"
      style={{ background: `linear-gradient(to right, ${value === 0 ? '#334155' : value <= 3 ? '#22c55e' : value <= 6 ? '#eab308' : '#ef4444'} ${value * 10}%, #334155 ${value * 10}%)` }} />
    <span className={`text-xs font-bold w-5 text-right ${value === 0 ? "text-slate-600" : value <= 3 ? "text-emerald-400" : value <= 6 ? "text-amber-400" : "text-red-400"}`}>{value}</span>
  </div>
);
const InstrumentToggle = ({ value, onChange }) => (
  <div className="flex gap-1 bg-slate-900/60 rounded-lg p-0.5 border border-slate-700/40">
    {["Tindeq", "Dynamometer"].map(opt => (
      <button key={opt} onClick={() => onChange(opt)}
        className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all ${value === opt ? "bg-sky-500/20 text-sky-300 border border-sky-500/30" : "text-slate-500 hover:text-slate-300"}`}>{opt}</button>
    ))}
  </div>
);
const GripPositionToggle = ({ gripType, intensity, onChangeType, onChangeIntensity }) => (
  <div className="space-y-1.5">
    <div className="flex gap-1 bg-slate-900/60 rounded-lg p-0.5 border border-slate-700/40">
      {["Half Crimp", "Open Hand"].map(opt => (
        <button key={opt} onClick={() => onChangeType(opt)}
          className={`flex-1 py-1.5 px-1.5 rounded-md text-[10px] font-semibold transition-all ${gripType === opt ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-slate-500 hover:text-slate-300"}`}>{opt === "Half Crimp" ? "Half Crimp" : "Open Hand"}</button>
      ))}
    </div>
    <div className="flex gap-1 bg-slate-900/60 rounded-lg p-0.5 border border-slate-700/40">
      {["50%", "Try Hard"].map(opt => (
        <button key={opt} onClick={() => onChangeIntensity(opt)}
          className={`flex-1 py-1.5 px-1.5 rounded-md text-[10px] font-semibold transition-all ${intensity === opt ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "text-slate-500 hover:text-slate-300"}`}>{opt}</button>
      ))}
    </div>
  </div>
);
const gripAbbr = (type, int) => `${type === "Half Crimp" ? "HC" : "OH"} ${int === "Try Hard" ? "TH" : "50%"}`;
const gripKey = (type, int) => `${type === "Half Crimp" ? "HC" : "OH"}${int === "Try Hard" ? "TH" : "50"}`;
const gripFields = (prefix, type, int) => {
  const k = gripKey(type || "Half Crimp", int || "50%");
  return { L: `${prefix}${k}L`, R: `${prefix}${k}R` };
};
const SentToggle = ({ sent, onChange }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Sent?</label>
    <button onClick={() => onChange(!sent)}
      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all border ${sent ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10" : "bg-slate-900/60 text-slate-500 border-slate-600/50 hover:border-slate-500"}`}>
      {sent ? <><Check size={14} /> Sent</> : "Not yet"}
    </button>
  </div>
);

// ─── Profile Setup Screen ───
function ProfileSetupScreen({ profile, setProfile, settings, userId, onClose }) {
  const [form, setForm] = useState({ ...profile });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const unit = settings?.unit || "lbs";

  function save() {
    const saved = { ...form, completed: true };
    setProfile(saved);
    if (userId) dbSet('athlete_data', userId, saved);
    if (onClose) onClose();
  }
  function skip() {
    const saved = { ...profile, completed: true };
    setProfile(saved);
    if (userId) dbSet('athlete_data', userId, saved);
    if (onClose) onClose();
  }

  const Toggle = ({ field, options }) => (
    <div className="flex gap-1 bg-slate-900/60 rounded-lg p-0.5 border border-slate-700/40">
      {options.map(opt => (
        <button key={opt} onClick={() => set(field, form[field] === opt ? "" : opt)}
          className={`flex-1 py-1.5 px-1 rounded-md text-[10px] font-semibold transition-all ${form[field] === opt ? "bg-sky-500/20 text-sky-300 border border-sky-500/30" : "text-slate-500 hover:text-slate-300"}`}>{opt}</button>
      ))}
    </div>
  );

  const content = (
    <div className="space-y-6 px-4 py-6 max-w-md w-full mx-auto">
      <div className="text-center space-y-1">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center mx-auto mb-3"><Mountain size={24} className="text-white" /></div>
        <h2 className="text-xl font-bold text-slate-200">Set up your profile</h2>
        <p className="text-xs text-slate-500">All fields optional — you can edit this anytime in Settings.</p>
      </div>

      <div className="space-y-4">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Physical Stats</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Bodyweight ({unit})</label>
            <p className="text-[10px] text-slate-600 mb-1.5">Used to personalise protein, carb, and hydration targets</p>
            <input type="number" value={form.bodyweight} onChange={e => set("bodyweight", e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none" placeholder="—" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Height (cm)</label>
            <p className="text-[10px] text-slate-600 mb-1.5">Used for BMI context in recovery nudges</p>
            <input type="number" value={form.height} onChange={e => set("height", e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none" placeholder="—" />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Sex</label>
          <Toggle field="sex" options={["Male", "Female", "Prefer not to say"]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Age</label>
            <input type="number" value={form.age} onChange={e => set("age", e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none" placeholder="—" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Dominant Hand</label>
            <p className="text-[10px] text-slate-600 mb-1.5">Helps interpret left/right force asymmetries in your force marker</p>
            <Toggle field="dominantHand" options={["Left", "Right"]} />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Climbing Background</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Years Climbing</label>
            <input type="number" value={form.climbingYears} onChange={e => set("climbingYears", e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none" placeholder="—" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Years of Structured Training</label>
            <p className="text-[10px] text-slate-600 mb-1.5">Years of structured training programs, separate from general climbing</p>
            <input type="number" value={form.trainingYears} onChange={e => set("trainingYears", e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none" placeholder="—" />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Primary Discipline</label>
          <div className="flex flex-wrap gap-1.5">
            {["Bouldering", "Sport", "Trad", "Speed"].map(opt => {
              const active = (form.discipline || []).includes(opt);
              return <button key={opt} onClick={() => set("discipline", active ? form.discipline.filter(x => x !== opt) : [...(form.discipline || []), opt])}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${active ? "bg-sky-500/25 text-sky-300 border-sky-500/40" : "bg-slate-800/60 text-slate-500 border-slate-700/40 hover:border-slate-600"}`}>{opt}</button>;
            })}
          </div>
        </div>
        <p className="text-[10px] text-slate-600">Grades are subjective interpretations of physical challenge, but let's track them 🙂</p>
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Onsight Grade — Sport</label>
          <p className="text-[10px] text-slate-600 mb-1.5">Hardest grade you can climb first try with no beta</p>
          <select value={form.onsightGradeSport} onChange={e => set("onsightGradeSport", e.target.value)}
            className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none">
            <option value="">Select...</option>
            {SPORT_GRADES.map((g, i) => <option key={g} value={g} style={{ background: i % 2 === 0 ? "#1e293b" : "#0f172a" }}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Flash Grade — Boulder</label>
          <p className="text-[10px] text-slate-600 mb-1.5">Hardest grade you can climb first try with no beta</p>
          <select value={form.flashGradeBoulder} onChange={e => set("flashGradeBoulder", e.target.value)}
            className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none">
            <option value="">Select...</option>
            {BOULDER_GRADES.map((g, i) => <option key={g} value={g} style={{ background: i % 2 === 0 ? "#1e293b" : "#0f172a" }}>{g}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-2 pt-2">
        <button onClick={save} className="w-full py-3 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-semibold transition-all">Save Profile</button>
        {!onClose && <button onClick={skip} className="w-full py-2 text-slate-500 hover:text-slate-300 text-xs transition-all">Skip for now</button>}
      </div>
    </div>
  );

  if (onClose) return (
    <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-sm flex items-start justify-center overflow-y-auto" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="w-full max-w-md mx-auto my-4">
        <div className="flex items-center justify-between px-4 pt-4 mb-2">
          <span className="text-sm font-semibold text-slate-300">Edit Profile</span>
          <button onClick={onClose}><X size={18} className="text-slate-500" /></button>
        </div>
        {content}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 overflow-y-auto" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
      {content}
    </div>
  );
}

// ─── Main App ───
export default function ClimbingTracker() {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [displayName, setDisplayName] = useState(null);
  // Auth form state
  const [authMode, setAuthMode] = useState("signin"); // "signin" | "signup"
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [tab, setTab] = useState("today");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [dailyData, setDailyData] = useState({});
  const [climbData, setClimbData] = useState({});
  const [assessData, setAssessData] = useState([]);
  const [injuryData, setInjuryData] = useState([]);
  const [settings, setSettings] = useState({ instrument: "Tindeq", unit: "lbs" });
  const [profile, setProfile] = useState(emptyProfile());
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [dataStatus, setDataStatus] = useState(null);
  const initialized = useRef(false);
  const saveTimers = useRef({});

  // Coach View state — coachUsers is { id, username }[]
  const [coachUsers, setCoachUsers] = useState([]);
  const [coachViewUser, setCoachViewUser] = useState(null); // null | { id, username }
  const [coachData, setCoachData] = useState(null);

  // Listen to Supabase auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const uid = session.user.id;
        setUserId(uid);
        setLoading(true);
        const name = await getProfile(uid);
        if (name) {
          setDisplayName(name);
          await loadDataForUser(uid);
        } else {
          // Authenticated but no profile yet — profile screen will show
          setLoading(false);
        }
      } else {
        setUserId(null);
        setDisplayName(null);
        initialized.current = false;
        setDailyData({});
        setClimbData({});
        setAssessData([]);
        setInjuryData([]);
        setSettings({ instrument: "Tindeq", unit: "lbs" });
        setLoading(false);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) setLoading(false);
    });
    // Hard safety net: if auth + data fetch takes longer than 8 s (e.g. slow
    // network on first launch from home screen), stop the spinner so the user
    // sees the sign-in screen rather than an infinite wheel.
    const launchTimeout = setTimeout(() => setLoading(false), 8000);
    return () => { subscription.unsubscribe(); clearTimeout(launchTimeout); };
  }, []);

  // Load data for a user — wrapped in a 6s timeout so a slow/offline network
  // never leaves the app stuck on the loading screen after launch.
  async function loadDataForUser(uid) {
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 6000)
      );
      const data = await Promise.race([loadUserData(uid), timeout]);
      setDailyData(data.daily);
      setClimbData(data.climbs);
      setAssessData(data.assess);
      setInjuryData(data.injury);
      setSettings(data.settings);
      setProfile(data.profile);
      console.log('Profile loaded:', data.profile);
      // Migrate discipline from old string format to array
      if (typeof data.profile.discipline === "string") {
        const d = data.profile.discipline;
        const migrated = { ...data.profile, discipline: d === "All" ? ["Bouldering", "Sport", "Trad", "Speed"] : d ? [d] : [] };
        setProfile(migrated);
        dbSet('athlete_data', uid, migrated);
      }
      initialized.current = true;
    } catch {
      // Offline or slow — open with empty local state; data will sync when
      // connectivity resumes and the user triggers a save.
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn() {
    setAuthError(null); setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    if (error) { setAuthError(error.message); setAuthLoading(false); }
  }

  async function handleSignUp() {
    if (!authName.trim()) { setAuthError("Display name is required"); return; }
    setAuthError(null); setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
    if (error) { setAuthError(error.message); setAuthLoading(false); return; }
    if (data.user) await upsertProfile(data.user.id, authName.trim());
    setAuthLoading(false);
  }

  async function handleSignOut() {
    initialized.current = false;
    await supabase.auth.signOut();
    setTab("today");
  }

  // Debounced save — batches rapid edits into a single Supabase upsert per table
  const TABLE_MAP = { daily: "daily_logs", climbs: "climb_logs", assess: "assessments", injury: "injury_logs", settings: "settings", profile: "athlete_data" };
  const debouncedSave = useCallback((key, value) => {
    if (!initialized.current || !userId) return;
    const table = TABLE_MAP[key]; if (!table) return;
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => dbSet(table, userId, value), 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => { debouncedSave("daily", dailyData); }, [dailyData, debouncedSave]);
  useEffect(() => { debouncedSave("climbs", climbData); }, [climbData, debouncedSave]);
  useEffect(() => { debouncedSave("assess", assessData); }, [assessData, debouncedSave]);
  useEffect(() => { debouncedSave("injury", injuryData); }, [injuryData, debouncedSave]);
  useEffect(() => { debouncedSave("settings", settings); }, [settings, debouncedSave]);
  useEffect(() => { debouncedSave("profile", profile); }, [profile, debouncedSave]);

  // Load Coach View user list
  useEffect(() => {
    if (tab === "coach") {
      getAllUsers().then(users => setCoachUsers(users));
    }
  }, [tab]);

  const updateDay = useCallback((date, field, value) => {
    setDailyData(prev => ({ ...prev, [date]: { ...(prev[date] || emptyDay()), [field]: value } }));
  }, []);

  // Cross-populate: daily marker → climb baseline
  useEffect(() => {
    const dd = dailyData[selectedDate]; if (!dd) return;
    const dc = climbData[selectedDate]; if (!dc) return;
    const inst = dd.markerType || settings.instrument;
    if (inst === "Tindeq") {
      const gf = gripFields("tindeq", dd.tindeqGripType, dd.tindeqIntensity);
      const valL = dd[gf.L]; const valR = dd[gf.R];
      if ((valL || valR) && (dc.baselineL == null || dc.baselineL === "") && (dc.baselineR == null || dc.baselineR === "")) {
        setClimbData(prev => ({ ...prev, [selectedDate]: { ...prev[selectedDate], baselineL: valL || "", baselineR: valR || "", baselineInstrument: "Tindeq", baselineGripType: dd.tindeqGripType || "Half Crimp", baselineIntensity: dd.tindeqIntensity || "Try Hard" } }));
      }
    }
    if (inst === "Dynamometer" && (dd.gripL || dd.gripR) && (dc.baselineGripL == null || dc.baselineGripL === "") && (dc.baselineGripR == null || dc.baselineGripR === "")) {
      setClimbData(prev => ({ ...prev, [selectedDate]: { ...prev[selectedDate], baselineGripL: dd.gripL || "", baselineGripR: dd.gripR || "", baselineInstrument: "Dynamometer" } }));
    }
  }, [dailyData, selectedDate, climbData, settings.instrument]);

  const day = dailyData[selectedDate] || emptyDay();
  const sleepScore = hoursToScore(day.sleepDuration);
  const wf = [day.sleepQuality, sleepScore || "", day.soreness, day.fingerSoreness, day.stress, day.motivation];
  const wFilled = wf.filter(v => v !== "" && v !== 0);
  const wellnessTotal = wFilled.reduce((a, b) => a + Number(b), 0);
  const wellnessCount = wFilled.length;
  // Backward compat: migrate old single-session data into sessions array
  const daySessions = useMemo(() => {
    const d = dailyData[selectedDate] || emptyDay();
    if (d.sessions && d.sessions.length > 0) return d.sessions;
    // Old format: single session fields at top level
    if (d.sessionDuration || d.sessionRPE || d.sessionType) {
      return [{ sessionType: d.sessionType || "", sessionDuration: d.sessionDuration || "", sessionRPE: d.sessionRPE || "", notes: "" }];
    }
    return [];
  }, [dailyData, selectedDate]);

  const sessionLoad = daySessions.reduce((total, s) => {
    const l = (Number(s.sessionDuration) || 0) * (Number(s.sessionRPE) || 0);
    return total + l;
  }, 0);

  useEffect(() => {
    if (sessionLoad > 0 && dailyData[selectedDate]?.sessionLoad !== sessionLoad)
      setDailyData(prev => ({ ...prev, [selectedDate]: { ...(prev[selectedDate] || emptyDay()), sessionLoad } }));
  }, [sessionLoad, selectedDate]);

  const datesSorted = useMemo(() => Object.keys(dailyData).sort(), [dailyData]);
  const ewmaData = useMemo(() => computeEWMA(dailyData, datesSorted), [dailyData, datesSorted]);
  const todayEWMA = ewmaData[selectedDate] || { acute: 0, chronic: 0, ratio: 0 };

  const readiness = useMemo(() => {
  const getReadiness = () => {
    if (wellnessCount < 4) return { flag: "—", color: "gray", label: "Incomplete", items: [], isBaseline: false, baselineDay: 0 };

    // Count days with data
    const daysWithData = datesSorted.filter(d => {
      const dd = dailyData[d];
      return dd && [dd.sleepQuality, dd.sleepDuration, dd.soreness, dd.fingerSoreness, dd.stress, dd.motivation].filter(v => v !== "").length >= 4;
    }).length;
    const isBaseline = daysWithData < BASELINE_DAYS;

    // Force marker deviation
    const mt = day.markerType || "Tindeq";
    const forceVals = datesSorted.filter(d => d < selectedDate).map(d => dayMarkerAvg(dailyData[d], mt)).filter(v => v > 0);
    const curForce = dayMarkerAvg(day, mt);
    let forceZFlag = null;
    if (forceVals.length >= 5 && curForce > 0) {
      const fStats = rollingStats(forceVals, 14);
      if (fStats && fStats.sd > 0) {
        const fz = zScore(curForce, fStats.mean, fStats.sd);
        if (fz < -1.5) forceZFlag = { label: "Force", arrow: "↓↓", z: fz, pct: Math.round(((curForce - fStats.mean) / fStats.mean) * 100) };
        else if (fz < -1) forceZFlag = { label: "Force", arrow: "↓", z: fz, pct: Math.round(((curForce - fStats.mean) / fStats.mean) * 100) };
      } else {
        // No SD yet, use simple % drop
        const slice14 = forceVals.slice(-14);
        if (!slice14.length) return;
        const avg14 = slice14.reduce((a, b) => a + b, 0) / slice14.length;
        const pctDrop = (curForce - avg14) / avg14;
        if (pctDrop < -0.15) forceZFlag = { label: "Force", arrow: "↓↓", z: null, pct: Math.round(pctDrop * 100) };
        else if (pctDrop < -0.1) forceZFlag = { label: "Force", arrow: "↓", z: null, pct: Math.round(pctDrop * 100) };
      }
    }

    // HRV Z-score (optional — only if athlete logs HRV)
    let hrvZFlag = null;
    const hrvVals = datesSorted.filter(d => d < selectedDate).map(d => Number(dailyData[d]?.hrv) || 0).filter(v => v > 0);
    const curHRV = Number(day.hrv) || 0;
    if (hrvVals.length >= 5 && curHRV > 0) {
      const hStats = rollingStats(hrvVals, 14);
      if (hStats && hStats.sd > 0) {
        const hz = zScore(curHRV, hStats.mean, hStats.sd);
        if (hz < -1.5) hrvZFlag = { label: "HRV", arrow: "↓↓", z: hz, pct: null };
        else if (hz < -1) hrvZFlag = { label: "HRV", arrow: "↓", z: hz, pct: null };
      }
    }

    // During baseline period, use simplified logic
    if (isBaseline) {
      const flagged = [];
      if (forceZFlag) flagged.push(forceZFlag);
      if (hrvZFlag) flagged.push(hrvZFlag);
      // Simple fixed thresholds during baseline
      if (wellnessTotal < 36 && flagged.length > 0) return { flag: "REST", color: "red", label: `${flagged.length + 1} markers below baseline`, items: [{ label: "Wellness", arrow: "↓↓", z: null, pct: null }, ...flagged], isBaseline: true, baselineDay: daysWithData };
      if (wellnessTotal < 36) return { flag: "CAUTION", color: "yellow", label: "1 item below norm", items: [{ label: "Wellness", arrow: "↓", z: null, pct: null }], isBaseline: true, baselineDay: daysWithData };
      if (flagged.length > 0) return { flag: "CAUTION", color: "yellow", label: `${flagged.length} markers below baseline`, items: flagged, isBaseline: true, baselineDay: daysWithData };
      return { flag: "GO", color: "green", label: "Ready to perform", items: [], isBaseline: true, baselineDay: daysWithData };
    }

    // Z-score per wellness item
    const flaggedItems = [];
    WELLNESS_ITEMS.forEach(item => {
      const vals = datesSorted.filter(d => d < selectedDate).map(d => {
        const dd = dailyData[d]; if (!dd) return null;
        const v = item.isHours ? hoursToScore(dd[item.key]) : Number(dd[item.key]);
        return (v && v > 0) ? v : null;
      }).filter(v => v !== null);

      const currentVal = item.isHours ? hoursToScore(day[item.key]) : Number(day[item.key]);
      if (!currentVal || vals.length < 7) return;

      const stats = rollingStats(vals);
      if (!stats || stats.sd === 0) return;

      const z = zScore(currentVal, stats.mean, stats.sd);
      if (z < -1) {
        const arrow = z < -1.5 ? (item.invertArrow ? "↑↑" : "↓↓") : (item.invertArrow ? "↑" : "↓");
        flaggedItems.push({ label: item.label, arrow, z });
      }
    });

    if (forceZFlag) flaggedItems.push(forceZFlag);
    if (hrvZFlag) flaggedItems.push(hrvZFlag);

    const severeCount = flaggedItems.filter(i => i.arrow.length === 2).length;
    const totalFlagged = flaggedItems.length;

    if (severeCount >= 2 || (totalFlagged >= 3) || (severeCount >= 1 && totalFlagged >= 2)) {
      return { flag: "REST", color: "red", label: `${totalFlagged} markers below baseline`, items: flaggedItems, isBaseline: false, baselineDay: daysWithData };
    }
    if (totalFlagged > 0) {
      return { flag: "CAUTION", color: "yellow", label: `${totalFlagged} item${totalFlagged > 1 ? "s" : ""} below norm`, items: flaggedItems, isBaseline: false, baselineDay: daysWithData };
    }
    return { flag: "GO", color: "green", label: "Ready to perform", items: [], isBaseline: false, baselineDay: daysWithData };
  };
  return getReadiness();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyData, selectedDate, settings.instrument, wellnessCount, wellnessTotal, day, datesSorted]);
  const shiftDate = (days) => { const d = new Date(selectedDate + "T12:00:00"); d.setDate(d.getDate() + days); setSelectedDate(d.toISOString().slice(0, 10)); };

  const showStatus = (type, msg) => {
    setDataStatus({ type, msg });
    setTimeout(() => setDataStatus(null), 3000);
  };

  // Export
  const handleExport = async () => {
    const data = { version: 7, user: displayName, exportDate: new Date().toISOString(), daily: dailyData, climbs: climbData, assess: assessData, injury: injuryData, settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `summit-${displayName}-${todayStr()}.json`; a.click();
    URL.revokeObjectURL(url);
    showStatus("success", "Exported successfully");
  };

  // Import
  const handleImport = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.daily) setDailyData(data.daily);
        if (data.climbs) setClimbData(data.climbs);
        if (data.assess) setAssessData(data.assess);
        if (data.injury) setInjuryData(data.injury);
        if (data.settings) setSettings(data.settings);
        showStatus("success", `Imported ${Object.keys(data.daily || {}).length} days`);
      } catch { showStatus("error", "Import failed — invalid file"); }
    };
    reader.readAsText(file);
  };

  const navTabs = [
    { id: "today", label: "Today", icon: Activity },
    { id: "climbs", label: "Climbs", icon: Mountain },
    { id: "assess", label: "Assess", icon: TrendingUp },
    { id: "injury", label: "Injury", icon: Heart },
    { id: "dashboard", label: "Dash", icon: BarChart3 },
    { id: "coach", label: "Coach", icon: Users },
  ];

  // Loading screen
  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center mx-auto"><Mountain size={24} className="text-white" /></div>
        <div className="text-lg font-bold text-slate-200">Summit</div>
        {displayName && <div className="text-sm text-slate-500">{displayName}</div>}
        <Loader size={18} className="text-sky-400 animate-spin mx-auto" />
      </div>
    </div>
  );

  // Auth screen — sign in / sign up
  if (!userId) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
      <div className="text-center space-y-6 px-8 max-w-sm w-full">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center mx-auto"><Mountain size={32} className="text-white" /></div>
        <div><h1 className="text-2xl font-bold text-slate-200">Summit</h1><p className="text-sm text-slate-500 mt-1">Climbing Performance Tracker</p></div>
        <div className="flex gap-1 bg-slate-900/50 rounded-xl p-1">
          {["signin", "signup"].map(m => <button key={m} onClick={() => { setAuthMode(m); setAuthError(null); }} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${authMode === m ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"}`}>{m === "signin" ? "Sign In" : "Create Account"}</button>)}
        </div>
        <div className="space-y-3">
          {authMode === "signup" && (
            <input type="text" value={authName} onChange={e => setAuthName(e.target.value)} placeholder="Display name" maxLength={40}
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 placeholder-slate-600" />
          )}
          <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="Email"
            className="w-full bg-slate-900/60 border border-slate-600/50 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 placeholder-slate-600"
            onKeyDown={e => { if (e.key === "Enter") authMode === "signin" ? handleSignIn() : handleSignUp(); }} />
          <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="Password"
            className="w-full bg-slate-900/60 border border-slate-600/50 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 placeholder-slate-600"
            onKeyDown={e => { if (e.key === "Enter") authMode === "signin" ? handleSignIn() : handleSignUp(); }} />
          {authError && <p className="text-xs text-red-400 text-left">{authError}</p>}
          <button onClick={authMode === "signin" ? handleSignIn : handleSignUp}
            disabled={authLoading || !authEmail.trim() || !authPassword.trim()}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${(!authLoading && authEmail.trim() && authPassword.trim()) ? "bg-sky-500 text-white hover:bg-sky-600" : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}>
            {authLoading ? <Loader size={14} className="animate-spin" /> : authMode === "signin" ? "Sign In" : "Create Account"}
          </button>
          <p className="text-[10px] text-slate-600">Your data is securely stored in Supabase and tied to your account.</p>
        </div>
      </div>
    </div>
  );

  // New user — authenticated but no profile yet
  if (userId && !displayName) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="text-center space-y-6 px-8 max-w-sm w-full">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center mx-auto"><Mountain size={32} className="text-white" /></div>
        <div><h1 className="text-2xl font-bold text-slate-200">One more step</h1><p className="text-sm text-slate-500 mt-1">Choose a display name for your profile</p></div>
        <div className="space-y-3">
          <input type="text" value={authName} onChange={e => setAuthName(e.target.value)} placeholder="Display name" maxLength={40}
            className="w-full bg-slate-900/60 border border-slate-600/50 rounded-xl px-4 py-3 text-center text-slate-200 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 placeholder-slate-600"
            onKeyDown={async e => { if (e.key === "Enter" && authName.trim()) { await upsertProfile(userId, authName.trim()); setDisplayName(authName.trim()); loadDataForUser(userId); } }} />
          {authError && <p className="text-xs text-red-400">{authError}</p>}
          <button onClick={async () => { if (!authName.trim()) return; await upsertProfile(userId, authName.trim()); setDisplayName(authName.trim()); loadDataForUser(userId); }}
            disabled={!authName.trim()}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${authName.trim() ? "bg-sky-500 text-white hover:bg-sky-600" : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}>Start Tracking</button>
        </div>
      </div>
    </div>
  );

  if (!profile.completed) return <ProfileSetupScreen profile={profile} setProfile={setProfile} settings={settings} userId={userId} />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-xl border-b border-slate-800/50">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center"><Mountain size={16} className="text-white" /></div><h1 className="text-lg font-bold tracking-tight">Summit</h1></div>
          <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-lg hover:bg-slate-800"><Settings size={18} className="text-slate-400" /></button>
        </div>
      </header>
      {showSettings && <div className="max-w-2xl mx-auto px-4 py-4 bg-slate-900/50 border-b border-slate-800/50 space-y-4">
        <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-300">Settings</span><button onClick={() => setShowSettings(false)}><X size={16} className="text-slate-500" /></button></div>
        <div><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Logged in as</div><div className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-700/40"><span className="text-sm font-semibold text-slate-200">{displayName}</span><div className="flex gap-3"><button onClick={() => { setShowSettings(false); setShowProfileEdit(true); }} className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold">Edit Profile</button><button onClick={handleSignOut} className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold">Sign Out</button></div></div></div>
        <div><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Default Instrument</div><InstrumentToggle value={settings.instrument} onChange={v => setSettings(p => ({ ...p, instrument: v }))} /></div>
        <div><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Units</div><div className="flex gap-1 bg-slate-900/60 rounded-lg p-0.5 border border-slate-700/40">{["lbs", "kg"].map(u => <button key={u} onClick={() => setSettings(p => ({ ...p, unit: u }))} className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all ${settings.unit === u ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "text-slate-500 hover:text-slate-300"}`}>{u}</button>)}</div></div>
        <div><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Data Management</div>
          <div className="flex gap-2">
            <button onClick={handleExport} className="flex-1 py-2 bg-sky-500/10 border border-sky-500/20 rounded-lg text-xs text-sky-400 hover:bg-sky-500/20 transition-all font-semibold flex items-center justify-center gap-1"><Download size={12} />Export</button>
            <label className="flex-1 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 hover:bg-emerald-500/20 transition-all font-semibold text-center cursor-pointer flex items-center justify-center gap-1"><Upload size={12} />Import<input type="file" accept=".json" className="hidden" onChange={e => { if (e.target.files[0]) handleImport(e.target.files[0]); }} /></label>
          </div>
          {dataStatus && <p className={`text-[10px] mt-1.5 font-semibold ${dataStatus.type === "error" ? "text-red-400" : "text-emerald-400"}`}>{dataStatus.msg}</p>}
          {!dataStatus && <p className="text-[10px] text-slate-600 mt-1">{Object.keys(dailyData).length} days logged</p>}
        </div>
      </div>}
      <main className="max-w-2xl mx-auto px-4 py-4 pb-24">
        {tab === "today" && <TodayView {...{ selectedDate, shiftDate, day, updateDay, wellnessTotal, wellnessCount, readiness, sessionLoad, todayEWMA, settings, dailyData, daySessions, setDailyData, profile, setProfile, datesSorted }} />}
        {tab === "climbs" && <ClimbView {...{ selectedDate, shiftDate, climbData, setClimbData, settings, dailyData, setDailyData }} />}
        {tab === "assess" && <AssessView {...{ assessData, setAssessData, settings }} />}
        {tab === "injury" && <InjuryView {...{ injuryData, setInjuryData, dailyData, ewmaData, datesSorted }} />}
        {tab === "dashboard" && <DashboardView {...{ dailyData, ewmaData, datesSorted, assessData, climbData }} />}
        {tab === "coach" && <CoachView {...{ coachUsers, currentUser: displayName, loadUserData, coachViewUser, setCoachViewUser, coachData, setCoachData }} />}
      </main>
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800/50 z-50">
        <div className="max-w-2xl mx-auto flex">
          {navTabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-colors ${tab === t.id ? "text-sky-400" : "text-slate-600 hover:text-slate-400"}`}><t.icon size={20} strokeWidth={tab === t.id ? 2.5 : 1.5} /><span className="text-[10px] font-medium">{t.label}</span></button>)}
        </div>
      </nav>
      {showProfileEdit && <ProfileSetupScreen profile={profile} setProfile={setProfile} settings={settings} userId={userId} onClose={() => setShowProfileEdit(false)} />}
    </div>
  );
}

// ─── TODAY VIEW ───
const nudgeVariants = {
  'rest-high-load': [
    "EWMA ratio is elevated and multiple markers are flagged — full rest today lets adaptation catch up to the load you've put in.",
    "Load has been running hot for several days. The fitness gains happen during recovery, not the next session — today is a rest day.",
  ],
  'hydration-force-drop': [
    "Force marker has dropped several days running. Even mild fluid loss measurably reduces grip strength — check your daily intake.",
    "A multi-day force decline often tracks with hydration status before anything else. Worth ruling out before assuming fatigue.",
  ],
  'nutrition-rest-day': [
    "Rest days are still active recovery for connective tissue — protein intake today matters as much as on a training day.",
    "Tendon repair continues on rest days. Don't let today's protein intake drop just because you're not climbing.",
  ],
  'rest-deload': [
    "Load is sitting below your usual baseline — a natural deload window. Good time to catch up on sleep debt.",
    "You're in a lighter load phase right now. Fitness built over weeks doesn't disappear in a few light days — let recovery lead.",
  ],
  'rest-low-sleep': [
    "Short sleep affects grip strength and reaction time more than most athletes expect. Consider trimming intensity today, not just volume.",
    "Sleep debt compounds. If you climb today, technique-focused volume is a safer bet than max effort attempts.",
  ],
  'nutrition-carb-window': [
    "Yesterday's session was a big one — carbohydrate intake today supports glycogen recovery during this window.",
    "Heavy load yesterday draws down glycogen stores. Today's carb intake matters more than usual for tomorrow's session.",
  ],
  'hydration-load-spike': [
    "Training load is trending above baseline. Fluid needs scale with load — make sure intake is keeping pace.",
    "When load climbs, hydration demands climb with it. Don't let intake stay flat while volume goes up.",
  ],
};

function getNudge({ readiness, todayEWMA, day, dailyData, datesSorted, selectedDate, settings, profile }) {
  const now = new Date();
  const nudgeState = profile?.nudgeState || {};
  const triggers = [
    { key: 'rest-high-load',      active: todayEWMA.ratio > 1.3 && readiness.flag === "REST" },
    { key: 'hydration-force-drop', active: (() => {
        const mt = day.markerType || settings.instrument;
        const recent = datesSorted.filter(d => d < selectedDate).slice(-4).map(d => dayMarkerAvg(dailyData[d], mt)).filter(v => v > 0);
        return recent.length >= 3 && recent[recent.length - 1] < recent[0] * 0.92;
      })() },
    { key: 'nutrition-rest-day',  active: day.sessions?.length > 0 && day.sessions.every(s => s.sessionType === "Rest") },
    { key: 'rest-deload',         active: todayEWMA.chronic > 0 && todayEWMA.ratio < 0.7 },
    { key: 'rest-low-sleep',      active: Number(day.sleepDuration) > 0 && Number(day.sleepDuration) < 6 },
    { key: 'nutrition-carb-window', active: (() => {
        const yesterday = datesSorted[datesSorted.indexOf(selectedDate) - 1];
        return yesterday && (dailyData[yesterday]?.sessionLoad || 0) > 300;
      })() },
    { key: 'hydration-load-spike', active: todayEWMA.ratio > 1.1 && todayEWMA.acute > todayEWMA.chronic },
  ];
  for (const { key, active } of triggers) {
    if (!active) continue;
    const state = nudgeState[key] || {};
    if (state.dismissedUntil && new Date(state.dismissedUntil) > now) continue;
    const variants = nudgeVariants[key];
    // Only advance variant when the active trigger key changed from last shown
    const lastKey = nudgeState._lastKey;
    const currentVariant = state.lastVariant ?? 0;
    const variant = lastKey !== key ? (currentVariant + 1) % variants.length : currentVariant;
    return { key, text: variants[variant], variant };
  }
  return null;
}

function TodayView({ selectedDate, shiftDate, day, updateDay, wellnessTotal, wellnessCount, readiness, sessionLoad, todayEWMA, settings, dailyData, daySessions, setDailyData, profile, setProfile, datesSorted }) {
  const [mode, setMode] = useState("quick"); // "quick" or "full"
  const [section, setSection] = useState("wellness");
  const isToday = selectedDate === todayStr();
  const unit = settings.unit || "lbs";

  const nudge = getNudge({ readiness, todayEWMA, day, dailyData, datesSorted, selectedDate, settings, profile });
  const persistedNudgeKey = useRef(profile?.nudgeState?._lastKey ?? null);

  // When the active nudge key changes, persist the new variant and lastKey
  useEffect(() => {
    if (!nudge) return;
    if (persistedNudgeKey.current === nudge.key) return;
    persistedNudgeKey.current = nudge.key;
    setProfile(prev => ({
      ...prev,
      nudgeState: {
        ...prev.nudgeState,
        _lastKey: nudge.key,
        [nudge.key]: { ...(prev.nudgeState?.[nudge.key] || {}), lastVariant: nudge.variant },
      },
    }));
  }, [nudge?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const nudgeDismiss = nudge ? () => {
    const dismissedUntil = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    persistedNudgeKey.current = null;
    setProfile(prev => ({
      ...prev,
      nudgeState: {
        ...prev.nudgeState,
        _lastKey: null,
        [nudge.key]: { ...(prev.nudgeState?.[nudge.key] || {}), dismissedUntil, lastVariant: nudge.variant },
      },
    }));
  } : null;

  // Quick session helpers
  const quickAddSession = (type) => {
    setDailyData(prev => {
      const d = prev[selectedDate] || emptyDay();
      const sessions = [...(d.sessions?.length > 0 ? d.sessions : []), { ...emptySession(), sessionType: type }];
      return { ...prev, [selectedDate]: { ...d, sessions } };
    });
  };
  const quickUpdateSession = (idx, f, v) => {
    setDailyData(prev => {
      const d = prev[selectedDate] || emptyDay();
      const sessions = [...(d.sessions?.length > 0 ? d.sessions : daySessions)];
      sessions[idx] = { ...sessions[idx], [f]: v };
      return { ...prev, [selectedDate]: { ...d, sessions } };
    });
  };
  const quickRemoveSession = (idx) => {
    setDailyData(prev => {
      const d = prev[selectedDate] || emptyDay();
      const sessions = [...(d.sessions?.length > 0 ? d.sessions : daySessions)].filter((_, i) => i !== idx);
      return { ...prev, [selectedDate]: { ...d, sessions } };
    });
  };
  const logRestDay = () => {
    setDailyData(prev => {
      const d = prev[selectedDate] || emptyDay();
      return { ...prev, [selectedDate]: { ...d, sessions: [{ ...emptySession(), sessionType: "Rest" }] } };
    });
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => shiftDate(-1)} className="p-2 rounded-lg hover:bg-slate-800"><ChevronLeft size={20} className="text-slate-400" /></button>
        <div className="text-center"><div className="text-lg font-bold">{isToday ? "Today" : fmtDate(selectedDate)}</div>{isToday && <div className="text-xs text-slate-500">{fmtDate(selectedDate)}</div>}</div>
        <button onClick={() => shiftDate(1)} className="p-2 rounded-lg hover:bg-slate-800"><ChevronRight size={20} className="text-slate-400" /></button>
      </div>
      <Card className={`border-l-4 ${readiness.color === "green" ? "border-l-emerald-500" : readiness.color === "yellow" ? "border-l-amber-500" : readiness.color === "red" ? "border-l-red-500" : "border-l-slate-600"}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Readiness</div>
            <div className="flex items-center gap-2">
              {readiness.color === "green" ? <CheckCircle size={22} className="text-emerald-400" /> : readiness.color === "yellow" ? <MinusCircle size={22} className="text-amber-400" /> : readiness.color === "red" ? <AlertTriangle size={22} className="text-red-400" /> : <MinusCircle size={22} className="text-slate-500" />}
              <span className={`text-2xl font-bold ${readiness.color === "green" ? "text-emerald-400" : readiness.color === "yellow" ? "text-amber-400" : readiness.color === "red" ? "text-red-400" : "text-slate-500"}`}>{readiness.flag}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">{readiness.label}</div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-[10px] text-slate-500">Wellness</div>
            <div className="text-xl font-bold font-mono">{wellnessCount === 6 ? wellnessTotal : "—"}<span className="text-sm text-slate-600">/60</span></div>
            {sessionLoad > 0 && <><div className="text-[10px] text-slate-500 mt-2">Load</div><div className="text-lg font-bold text-sky-400 font-mono">{sessionLoad}<span className="text-xs text-slate-600"> AU</span></div></>}
          </div>
        </div>
        {readiness.items.length > 0 && (
          <div className={`mt-2.5 text-xs ${readiness.color === "red" ? "text-red-400" : "text-amber-400"}`}>
            • {readiness.items.map((item, i) => (
              <span key={i}>{i > 0 && " · "}{item.label} {item.arrow} {item.z !== null ? `(${item.z > 0 ? "+" : ""}${item.z} SD)` : item.pct !== null ? `(${item.pct}%)` : ""}</span>
            ))}
          </div>
        )}
        {readiness.isBaseline && (
          <div className="mt-2.5 text-[10px] text-slate-500 flex items-center gap-1.5">
            <Loader size={10} className="animate-spin" /> Baseline: day {readiness.baselineDay}/{BASELINE_DAYS} — flags improve with more data
          </div>
        )}
        {todayEWMA.chronic > 0 && <div className="mt-3 pt-3 border-t border-slate-700/30 flex gap-4 text-xs"><div><span className="text-slate-500">Acute </span><span className="font-mono font-bold text-sky-400">{todayEWMA.acute}</span></div><div><span className="text-slate-500">Chronic </span><span className="font-mono font-bold text-slate-300">{todayEWMA.chronic}</span></div><div><span className="text-slate-500">Ratio </span><span className={`font-mono font-bold ${todayEWMA.ratio > 1.3 ? "text-amber-400" : todayEWMA.ratio < 0.8 ? "text-sky-400" : "text-emerald-400"}`}>{todayEWMA.ratio}</span></div></div>}
      </Card>
      {/* Nudge card */}
      {nudge && (() => {
        const [category] = nudge.key.split('-');
        const accent = category === 'rest' ? 'border-l-amber-500' : category === 'hydration' ? 'border-l-sky-500' : 'border-l-emerald-500';
        const label = category === 'rest' ? 'Recovery' : category === 'hydration' ? 'Hydration' : 'Nutrition';
        const labelColor = category === 'rest' ? 'text-amber-400' : category === 'hydration' ? 'text-sky-400' : 'text-emerald-400';
        return (
          <Card className={`border-l-4 ${accent}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`text-[10px] uppercase tracking-wider font-semibold mb-1 ${labelColor}`}>{label}</div>
                <div className="text-sm text-slate-300 leading-relaxed">{nudge.text}</div>
              </div>
              <button onClick={nudgeDismiss} className="flex-shrink-0 p-1 rounded hover:bg-slate-700/60 text-slate-500 hover:text-slate-300 transition-colors"><X size={14} /></button>
            </div>
          </Card>
        );
      })()}
      {/* Mode toggle */}
      <div className="flex gap-1 bg-slate-900/50 rounded-xl p-1">
        <button onClick={() => setMode("quick")} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${mode === "quick" ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"}`}>Quick Log</button>
        <button onClick={() => setMode("full")} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${mode === "full" ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"}`}>Full Detail</button>
      </div>

      {mode === "quick" && <>
        {/* Quick wellness */}
        <Card>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-4">Wellness <span className="text-slate-600">(1=poor, 10=excellent)</span></div>
          <div className="space-y-4">
            <WellnessRow label="Sleep Quality" value={day.sleepQuality} onChange={v => updateDay(selectedDate, "sleepQuality", v)} lowLabel="Terrible" highLabel="Excellent" />
            <SleepSlider value={day.sleepDuration} onChange={v => updateDay(selectedDate, "sleepDuration", v)} />
            <WellnessRow label="Muscle Soreness" value={day.soreness} onChange={v => updateDay(selectedDate, "soreness", v)} lowLabel="Extremely sore" highLabel="No soreness" />
            <WellnessRow label="Finger Soreness" value={day.fingerSoreness} onChange={v => updateDay(selectedDate, "fingerSoreness", v)} lowLabel="Extremely sore" highLabel="No soreness" />
            <WellnessRow label="Stress" value={day.stress} onChange={v => updateDay(selectedDate, "stress", v)} lowLabel="Extremely stressed" highLabel="No stress" />
            <WellnessRow label="Motivation" value={day.motivation} onChange={v => updateDay(selectedDate, "motivation", v)} lowLabel="Not motivated at all" highLabel="Extremely motivated" />
          </div>
          {/* Optional HRV */}
          <div className="mt-4 pt-3 border-t border-slate-700/30">
            <Input label="Morning HRV (ms, optional)" value={day.hrv} onChange={v => updateDay(selectedDate, "hrv", v)} type="number" placeholder="e.g., 65" />
          </div>
          <div className="mt-4 pt-3 border-t border-slate-700/30">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Today's Conditions <span className="text-slate-600">(optional)</span></label>
            <div className="flex gap-1 bg-slate-900/60 rounded-lg p-0.5 border border-slate-700/40">
              {["Hot", "Warm", "Cool", "Cold"].map(opt => (
                <button key={opt} onClick={() => updateDay(selectedDate, "conditions", day.conditions === opt ? "" : opt)}
                  className={`flex-1 py-1.5 px-1 rounded-md text-[10px] font-semibold transition-all ${day.conditions === opt ? `${CONDITION_COLORS[opt]} border` : "text-slate-500 hover:text-slate-300"}`}>{opt}</button>
              ))}
            </div>
          </div>
        </Card>

        {/* Quick session */}
        <Card>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Session</div>
          {daySessions.length === 0 && (
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap">
                {["Bouldering — Power", "Sport Climbing — Rope", "Hangboard", "Conditioning"].map(t => (
                  <button key={t} onClick={() => quickAddSession(t)} className="px-3 py-1.5 bg-slate-900/60 border border-slate-700/40 rounded-lg text-[10px] text-slate-400 hover:text-sky-400 hover:border-sky-500/30 transition-all">{t.split(" — ")[0]}</button>
                ))}
              </div>
              <button onClick={logRestDay} className="w-full py-2 bg-slate-900/40 border border-slate-700/30 rounded-lg text-xs text-slate-500 hover:text-emerald-400 hover:border-emerald-500/30 transition-all">Rest Day</button>
            </div>
          )}
          {daySessions.map((sess, idx) => {
            const sLoad = (Number(sess.sessionDuration) || 0) * (Number(sess.sessionRPE) || 0);
            return <div key={idx} className={`${idx > 0 ? "mt-3 pt-3 border-t border-slate-700/30" : ""}`}>
              <div className="flex items-center justify-between mb-2">
                <Select value={sess.sessionType} onChange={v => quickUpdateSession(idx, "sessionType", v)} options={SESSION_TYPES} placeholder="Type..." className="flex-1" />
                {daySessions.length > 1 && <button onClick={() => quickRemoveSession(idx)} className="ml-2 text-red-400/40 hover:text-red-400"><Trash2 size={14} /></button>}
              </div>
              {sess.sessionType !== "Rest" && <div className="flex gap-2 items-end">
                <Input label="Min" value={sess.sessionDuration} onChange={v => quickUpdateSession(idx, "sessionDuration", v)} type="number" step="10" className="flex-1" />
                <Input label="RPE" value={sess.sessionRPE} onChange={v => quickUpdateSession(idx, "sessionRPE", v)} type="number" min="1" max="10" className="flex-1" />
                {OUTDOOR_SESSION_TYPES.has(sess.sessionType) && <div className="flex flex-col gap-1 pb-0.5">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Outdoor</label>
                  <button onClick={() => quickUpdateSession(idx, "outdoor", !sess.outdoor)}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all border ${sess.outdoor ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10" : "bg-slate-900/60 text-slate-500 border-slate-600/50 hover:border-slate-500"}`}>
                    {sess.outdoor ? <><Check size={12} /> Yes</> : "No"}
                  </button>
                </div>}
                {sLoad > 0 && <div className="pb-2 text-sm font-bold text-sky-400 font-mono whitespace-nowrap">{sLoad} AU</div>}
              </div>}
            </div>;
          })}
          {daySessions.length > 0 && daySessions[0].sessionType !== "Rest" && (
            <button onClick={() => quickAddSession("")} className="mt-2 w-full py-1.5 text-[10px] text-slate-500 hover:text-sky-400 transition-all">+ Another session</button>
          )}
          {sessionLoad > 0 && daySessions.length > 1 && <div className="mt-2 flex justify-between text-xs"><span className="text-slate-500">Total</span><span className="font-bold text-sky-400 font-mono">{sessionLoad} AU</span></div>}
        </Card>
      </>}

      {mode === "full" && <>
        <div className="flex gap-1 bg-slate-900/50 rounded-xl p-1">
          {[{ id: "wellness", label: "Wellness" }, { id: "marker", label: "Force Marker" }, { id: "session", label: "Session" }].map(s => (
            <button key={s.id} onClick={() => setSection(s.id)} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${section === s.id ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"}`}>{s.label}</button>
          ))}
        </div>
      {section === "wellness" && <Card>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-4">Morning Wellness <span className="text-slate-600">(1=poor, 10=excellent)</span></div>
        <div className="space-y-4">
          <WellnessRow label="Sleep Quality" value={day.sleepQuality} onChange={v => updateDay(selectedDate, "sleepQuality", v)} lowLabel="Terrible" highLabel="Excellent" />
          <SleepSlider value={day.sleepDuration} onChange={v => updateDay(selectedDate, "sleepDuration", v)} />
          <WellnessRow label="Muscle Soreness" value={day.soreness} onChange={v => updateDay(selectedDate, "soreness", v)} lowLabel="Extremely sore" highLabel="No soreness" />
          <WellnessRow label="Finger Soreness" value={day.fingerSoreness} onChange={v => updateDay(selectedDate, "fingerSoreness", v)} lowLabel="Extremely sore" highLabel="No soreness" />
          <WellnessRow label="Stress" value={day.stress} onChange={v => updateDay(selectedDate, "stress", v)} lowLabel="Extremely stressed" highLabel="No stress" />
          <WellnessRow label="Motivation" value={day.motivation} onChange={v => updateDay(selectedDate, "motivation", v)} lowLabel="Not motivated at all" highLabel="Extremely motivated" />
        </div>
        <div className="mt-4 pt-3 border-t border-slate-700/30">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Today's Conditions <span className="text-slate-600">(optional)</span></label>
          <div className="flex gap-1 bg-slate-900/60 rounded-lg p-0.5 border border-slate-700/40">
            {["Hot", "Warm", "Cool", "Cold"].map(opt => (
              <button key={opt} onClick={() => updateDay(selectedDate, "conditions", day.conditions === opt ? "" : opt)}
                className={`flex-1 py-1.5 px-1 rounded-md text-[10px] font-semibold transition-all ${day.conditions === opt ? `${CONDITION_COLORS[opt]} border` : "text-slate-500 hover:text-slate-300"}`}>{opt}</button>
            ))}
          </div>
        </div>
      </Card>}
      {section === "marker" && <Card>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Objective Readiness Marker</div>
        <p className="text-[10px] text-slate-600 mb-4">Cold pull — peak force only, both hands. RFD tracked post-warmup.</p>
        <div className="mb-4"><label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Instrument</label><InstrumentToggle value={day.markerType || settings.instrument} onChange={v => updateDay(selectedDate, "markerType", v)} /></div>
        {(day.markerType === "Dynamometer") && <ForcePair labelL={`Grip Left (${unit})`} labelR={`Grip Right (${unit})`} valueL={day.gripL} valueR={day.gripR} onChangeL={v => updateDay(selectedDate, "gripL", v)} onChangeR={v => updateDay(selectedDate, "gripR", v)} />}
        {(day.markerType === "Tindeq" || !day.markerType) && <>
          <div className="mb-3"><label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Grip Position</label><GripPositionToggle gripType={day.tindeqGripType || "Half Crimp"} intensity={day.tindeqIntensity || "Try Hard"} onChangeType={v => updateDay(selectedDate, "tindeqGripType", v)} onChangeIntensity={v => updateDay(selectedDate, "tindeqIntensity", v)} /></div>
          <ForcePair labelL={`Peak L — ${gripAbbr(day.tindeqGripType || "Half Crimp", day.tindeqIntensity || "Try Hard")} (${unit})`} labelR={`Peak R — ${gripAbbr(day.tindeqGripType || "Half Crimp", day.tindeqIntensity || "Try Hard")} (${unit})`} valueL={day[gripFields("tindeq", day.tindeqGripType, day.tindeqIntensity).L] || ""} valueR={day[gripFields("tindeq", day.tindeqGripType, day.tindeqIntensity).R] || ""} onChangeL={v => updateDay(selectedDate, gripFields("tindeq", day.tindeqGripType, day.tindeqIntensity).L, v)} onChangeR={v => updateDay(selectedDate, gripFields("tindeq", day.tindeqGripType, day.tindeqIntensity).R, v)} />
        </>}
        {(() => {
          const allDates = Object.keys(dailyData).sort();
          const mt = day.markerType || "Tindeq";
          const intensity = day.tindeqIntensity || "Try Hard";
          // For Tindeq, compare to same grip+intensity combo. For dynamometer, simple.
          const sameIntensityVals = mt === "Tindeq"
            ? allDates.map(d => {
                const ddd = dailyData[d]; if (!ddd) return 0;
                if ((ddd.tindeqIntensity || "Try Hard") !== intensity) return 0;
                return dayMarkerAvg(ddd, mt);
              }).filter(v => v > 0)
            : allDates.map(d => dayMarkerAvg(dailyData[d], mt)).filter(v => v > 0);
          const maxV = sameIntensityVals.length ? Math.max(...sameIntensityVals) : 0;
          const curAvg = dayMarkerAvg(day, mt);
          const p = curAvg && maxV ? Math.round(curAvg / maxV * 100) : null;
          const curL = mt === "Tindeq" ? Number(day[gripFields("tindeq", day.tindeqGripType, day.tindeqIntensity).L]) : Number(day.gripL);
          const curR = mt === "Tindeq" ? Number(day[gripFields("tindeq", day.tindeqGripType, day.tindeqIntensity).R]) : Number(day.gripR);
          if (!p) return null;
          return <div className="mt-3 bg-slate-900/40 rounded-lg p-3 space-y-1.5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">% of Personal Peak <span className="text-slate-600 normal-case">({mt === "Tindeq" ? intensity : "Dynamometer"})</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-400">Average</span><span className={`font-mono font-bold ${p >= 95 ? "text-emerald-400" : p >= 85 ? "text-sky-400" : p >= 75 ? "text-amber-400" : "text-red-400"}`}>{p}%</span></div>
            {curL > 0 && curR > 0 && <div className="flex gap-4 text-xs text-slate-500">
              <span>L: <span className="font-mono text-slate-300">{curL} {unit}</span></span>
              <span>R: <span className="font-mono text-slate-300">{curR} {unit}</span></span>
              {Math.abs(curL - curR) / Math.max(curL, curR) > 0.1 && <span className="text-amber-400 font-bold">⚠ &gt;10% asymmetry</span>}
            </div>}
          </div>;
        })()}
        <div className="mt-4 pt-3 border-t border-slate-700/30">
          <Input label="Morning HRV (ms, optional)" value={day.hrv} onChange={v => updateDay(selectedDate, "hrv", v)} type="number" placeholder="e.g., 65" />
          <p className="text-[10px] text-slate-600 mt-1">From Polar, Garmin, Apple Watch, or HRV4Training</p>
        </div>
      </Card>}
      {section === "session" && <div className="space-y-3">
        {daySessions.map((sess, idx) => {
          const sLoad = (Number(sess.sessionDuration) || 0) * (Number(sess.sessionRPE) || 0);
          const updateSess = (f, v) => {
            setDailyData(prev => {
              const d = prev[selectedDate] || emptyDay();
              const sessions = [...(d.sessions && d.sessions.length > 0 ? d.sessions : daySessions)];
              sessions[idx] = { ...sessions[idx], [f]: v };
              return { ...prev, [selectedDate]: { ...d, sessions, sessionDuration: undefined, sessionRPE: undefined, sessionType: undefined } };
            });
          };
          const removeSess = () => {
            setDailyData(prev => {
              const d = prev[selectedDate] || emptyDay();
              const sessions = [...(d.sessions && d.sessions.length > 0 ? d.sessions : daySessions)].filter((_, i) => i !== idx);
              return { ...prev, [selectedDate]: { ...d, sessions } };
            });
          };
          return <Card key={idx}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Session {idx + 1}</div>
              {daySessions.length > 1 && <button onClick={removeSess} className="text-red-400/50 hover:text-red-400"><Trash2 size={13} /></button>}
            </div>
            <Select label="Session Type" value={sess.sessionType} onChange={v => updateSess("sessionType", v)} options={SESSION_TYPES} className="mb-3" />
            {sess.sessionType !== "Rest" && <>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Input label="Duration (min)" value={sess.sessionDuration} onChange={v => updateSess("sessionDuration", v)} type="number" step="10" />
                <Input label="RPE (1-10)" value={sess.sessionRPE} onChange={v => updateSess("sessionRPE", v)} type="number" min="1" max="10" />
              </div>
              {sLoad > 0 && <div className="bg-slate-900/50 rounded-lg p-2.5 flex items-center justify-between mb-3"><span className="text-xs text-slate-500">Load</span><span className="text-sm font-bold text-sky-400 font-mono">{sLoad}<span className="text-xs text-slate-600"> AU</span></span></div>}
              {OUTDOOR_SESSION_TYPES.has(sess.sessionType) && <div className="flex flex-col gap-1 mb-3">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Outdoor</label>
                <button onClick={() => updateSess("outdoor", !sess.outdoor)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all border ${sess.outdoor ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10" : "bg-slate-900/60 text-slate-500 border-slate-600/50 hover:border-slate-500"}`}>
                  {sess.outdoor ? <><Check size={14} /> Outdoor</> : "Indoor"}
                </button>
              </div>}
            </>}
            <Input label="Notes" value={sess.notes} onChange={v => updateSess("notes", v)} placeholder="Session notes..." />
          </Card>;
        })}
        <button onClick={() => {
          setDailyData(prev => {
            const d = prev[selectedDate] || emptyDay();
            const sessions = [...(d.sessions && d.sessions.length > 0 ? d.sessions : daySessions), emptySession()];
            return { ...prev, [selectedDate]: { ...d, sessions } };
          });
        }} className="w-full py-2.5 border-2 border-dashed border-slate-700/50 rounded-xl text-slate-500 hover:text-sky-400 hover:border-sky-500/30 transition-all flex items-center justify-center gap-2 text-xs font-medium"><Plus size={14} /> Add Session</button>
        {sessionLoad > 0 && daySessions.length > 1 && <div className="bg-slate-900/50 rounded-lg p-3 flex items-center justify-between"><span className="text-xs text-slate-500">Total Day Load</span><span className="text-lg font-bold text-sky-400 font-mono">{sessionLoad}<span className="text-xs text-slate-600"> AU</span></span></div>}
        <Input label="Day Notes" value={day.notes} onChange={v => updateDay(selectedDate, "notes", v)} placeholder="General notes for the day..." />
      </div>}
      </>}
    </div>
  );
}

// ─── CLIMB VIEW ───
function ClimbView({ selectedDate, shiftDate, climbData, setClimbData, settings, dailyData, setDailyData }) {
  const isToday = selectedDate === todayStr();
  const unit = settings.unit || "lbs";
  const dc = climbData[selectedDate] || { baselineInstrument: settings.instrument, baselineL: "", baselineR: "", baselineGripL: "", baselineGripR: "", climbs: [] };
  const [expanded, setExpanded] = useState(null);

  const updateDC = (f, v) => {
    setClimbData(prev => {
      const current = prev[selectedDate] || { baselineInstrument: settings.instrument, baselineL: "", baselineR: "", baselineGripL: "", baselineGripR: "", climbs: [] };
      return { ...prev, [selectedDate]: { ...current, [f]: v } };
    });
  };

  // Cross-populate: climb baseline → daily marker
  useEffect(() => {
    const dcNow = climbData[selectedDate]; if (!dcNow) return;
    const dayNow = dailyData[selectedDate] || emptyDay();
    const gt = dcNow.baselineGripType || dayNow.tindeqGripType || "Half Crimp";
    const gi = dcNow.baselineIntensity || dayNow.tindeqIntensity || "Try Hard";
    const gf = gripFields("tindeq", gt, gi);
    if (dcNow.baselineL && !dayNow[gf.L]) setDailyData(prev => ({ ...prev, [selectedDate]: { ...(prev[selectedDate] || emptyDay()), [gf.L]: dcNow.baselineL, tindeqGripType: gt, tindeqIntensity: gi, markerType: "Tindeq" } }));
    if (dcNow.baselineR && !dayNow[gf.R]) setDailyData(prev => ({ ...prev, [selectedDate]: { ...(prev[selectedDate] || emptyDay()), [gf.R]: dcNow.baselineR, tindeqGripType: gt, tindeqIntensity: gi, markerType: "Tindeq" } }));
    if (dcNow.baselineGripL && !dayNow.gripL) setDailyData(prev => ({ ...prev, [selectedDate]: { ...(prev[selectedDate] || emptyDay()), gripL: dcNow.baselineGripL, markerType: "Dynamometer" } }));
    if (dcNow.baselineGripR && !dayNow.gripR) setDailyData(prev => ({ ...prev, [selectedDate]: { ...(prev[selectedDate] || emptyDay()), gripR: dcNow.baselineGripR, markerType: "Dynamometer" } }));
  }, [climbData, selectedDate, dailyData]);

  const lastGradeFor = (type) => {
    const allDates = Object.keys(climbData).sort().reverse();
    for (const d of allDates) {
      const climbs = climbData[d]?.climbs || [];
      for (let i = climbs.length - 1; i >= 0; i--) {
        const c = climbs[i];
        if (type === "sport" && c.gradeSport) return c.gradeSport;
        if (type === "boulder" && c.gradeBoulder) return c.gradeBoulder;
      }
    }
    return type === "sport" ? "" : "";
  };
  const quickAddSport = () => { const grade = lastGradeFor("sport"); setClimbData(prev => { const current = prev[selectedDate] || { baselineInstrument: settings.instrument, baselineL: "", baselineR: "", baselineGripL: "", baselineGripR: "", climbs: [] }; const nc = [...current.climbs, { ...emptyClimb(), instrument: current.baselineInstrument || settings.instrument, type: "Sport Climbing — Rope", gradeSport: grade, styles: [], sent: false, attempts: "1" }]; setExpanded(nc.length - 1); return { ...prev, [selectedDate]: { ...current, climbs: nc } }; }); };
  const quickAddBoulder = () => { const grade = lastGradeFor("boulder"); setClimbData(prev => { const current = prev[selectedDate] || { baselineInstrument: settings.instrument, baselineL: "", baselineR: "", baselineGripL: "", baselineGripR: "", climbs: [] }; const nc = [...current.climbs, { ...emptyClimb(), instrument: current.baselineInstrument || settings.instrument, type: "Bouldering — Power", gradeBoulder: grade, styles: [], sent: false, attempts: "1" }]; setExpanded(nc.length - 1); return { ...prev, [selectedDate]: { ...current, climbs: nc } }; }); };
  const updateClimb = (i, f, v) => { setClimbData(prev => { const current = prev[selectedDate]; if (!current) return prev; const nc = [...current.climbs]; nc[i] = { ...nc[i], [f]: v }; return { ...prev, [selectedDate]: { ...current, climbs: nc } }; }); };
  const removeClimb = (i) => { setClimbData(prev => { const current = prev[selectedDate]; if (!current) return prev; return { ...prev, [selectedDate]: { ...current, climbs: current.climbs.filter((_, j) => j !== i) } }; }); setExpanded(null); };

  const climbForceAvg = (climb) => {
    if (climb.instrument === "Dynamometer") return avg(climb.postGripL, climb.postGripR);
    const gf = gripFields("post", climb.tindeqGripType, climb.tindeqIntensity);
    const l = Number(climb[gf.L]) || Number(climb.postPeakL) || 0;
    const r = Number(climb[gf.R]) || Number(climb.postPeakR) || 0;
    return avg(l, r);
  };
  const baselineAvg = () => (dc.baselineInstrument || settings.instrument) === "Dynamometer" ? avg(dc.baselineGripL, dc.baselineGripR) : avg(dc.baselineL, dc.baselineR);
  const forcePct = (climb) => pctCalc(climbForceAvg(climb), baselineAvg());

  const dayData = dailyData[selectedDate] || emptyDay();
  const dayGf = gripFields("tindeq", dayData.tindeqGripType, dayData.tindeqIntensity);
  const hasMarker = !!(dayData[dayGf.L] || dayData[dayGf.R] || dayData.gripL || dayData.gripR);
  const baselineEmpty = !(dc.baselineL || dc.baselineR || dc.baselineGripL || dc.baselineGripR);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => shiftDate(-1)} className="p-2 rounded-lg hover:bg-slate-800"><ChevronLeft size={20} className="text-slate-400" /></button>
        <div className="text-center"><div className="text-lg font-bold">{isToday ? "Today" : fmtDate(selectedDate)}</div><div className="text-xs text-slate-500">Climb Log</div></div>
        <button onClick={() => shiftDate(1)} className="p-2 rounded-lg hover:bg-slate-800"><ChevronRight size={20} className="text-slate-400" /></button>
      </div>
      <Card>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Post-Warmup Baseline</div>
        {hasMarker && baselineEmpty && <button onClick={() => {
          const gf = gripFields("tindeq", dayData.tindeqGripType, dayData.tindeqIntensity);
          if (dayData[gf.L]) updateDC("baselineL", dayData[gf.L]);
          if (dayData[gf.R]) updateDC("baselineR", dayData[gf.R]);
          if (dayData.gripL) updateDC("baselineGripL", dayData.gripL);
          if (dayData.gripR) updateDC("baselineGripR", dayData.gripR);
          updateDC("baselineInstrument", dayData.markerType || settings.instrument);
        }} className="w-full mb-3 py-2 bg-sky-500/10 border border-sky-500/20 rounded-lg text-xs text-sky-400 hover:bg-sky-500/20 transition-all">Use morning marker as baseline</button>}
        <div className="mb-3"><label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Instrument</label><InstrumentToggle value={dc.baselineInstrument || settings.instrument} onChange={v => updateDC("baselineInstrument", v)} /></div>
        {(dc.baselineInstrument || settings.instrument) === "Tindeq" && <>
          <div className="mb-3"><label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Grip Position</label><GripPositionToggle gripType={dc.baselineGripType || "Half Crimp"} intensity={dc.baselineIntensity || "Try Hard"} onChangeType={v => updateDC("baselineGripType", v)} onChangeIntensity={v => updateDC("baselineIntensity", v)} /></div>
          <ForcePair labelL={`Peak L — ${gripAbbr(dc.baselineGripType || "Half Crimp", dc.baselineIntensity || "Try Hard")} (${unit})`} labelR={`Peak R — ${gripAbbr(dc.baselineGripType || "Half Crimp", dc.baselineIntensity || "Try Hard")} (${unit})`} valueL={dc.baselineL} valueR={dc.baselineR} onChangeL={v => updateDC("baselineL", v)} onChangeR={v => updateDC("baselineR", v)} />
        </>}
        {(dc.baselineInstrument || settings.instrument) === "Dynamometer" && <ForcePair labelL={`Grip L (${unit})`} labelR={`Grip R (${unit})`} valueL={dc.baselineGripL} valueR={dc.baselineGripR} onChangeL={v => updateDC("baselineGripL", v)} onChangeR={v => updateDC("baselineGripR", v)} />}
      </Card>

      {dc.climbs.map((climb, idx) => {
        const p = forcePct(climb); const cost = p !== null ? 100 - p : null; const isExp = expanded === idx;
        return (
          <Card key={idx}>
            <button onClick={() => setExpanded(isExp ? null : idx)} className="w-full flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${climb.sent ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-slate-700/50 text-slate-400"}`}>{idx + 1}</div>
                <div className="text-left">
                  <div className="text-sm font-semibold flex items-center gap-1.5">{climb.route || "Unnamed"}{climb.sent && <Check size={12} className="text-emerald-400" />}</div>
                  <div className="flex gap-1.5 mt-0.5 flex-wrap">
                    {climb.gradeSport && <Badge color="blue">{climb.gradeSport}</Badge>}
                    {climb.gradeBoulder && <Badge color="blue">{climb.gradeBoulder}</Badge>}
                    {climb.attempts && <Badge>{climb.attempts} att</Badge>}
                    {climb.moves && <Badge>{climb.moves} moves</Badge>}
                    {p !== null && <Badge color={p >= 90 ? "green" : p >= 80 ? "yellow" : "red"}>{p}%</Badge>}
                    {climb.styles?.length > 0 && <Badge color="gray">{climb.styles.length > 2 ? `${climb.styles.slice(0, 2).join(", ")}+${climb.styles.length - 2}` : climb.styles.join(", ")}</Badge>}
                  </div>
                </div>
              </div>
              {isExp ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
            </button>
            {isExp && <div className="mt-4 pt-4 border-t border-slate-700/30 space-y-3">
              <div className="grid grid-cols-2 gap-3"><Input label="Route / Problem" value={climb.route} onChange={v => updateClimb(idx, "route", v)} /><Select label="Type" value={climb.type} onChange={v => updateClimb(idx, "type", v)} options={CLIMB_TYPES} /></div>
              <div className="grid grid-cols-2 gap-3"><Select label="Grade (Sport)" value={climb.gradeSport} onChange={v => updateClimb(idx, "gradeSport", v)} options={SPORT_GRADES} /><Select label="Grade (Boulder)" value={climb.gradeBoulder} onChange={v => updateClimb(idx, "gradeBoulder", v)} options={BOULDER_GRADES} /></div>
              <StylePicker selected={climb.styles || []} onChange={v => updateClimb(idx, "styles", v)} />
              <div className="grid grid-cols-2 gap-3"><Select label="Send Type" value={climb.sendType} onChange={v => updateClimb(idx, "sendType", v)} options={SEND_TYPES} /><Select label="Wall Angle" value={climb.wallAngle} onChange={v => updateClimb(idx, "wallAngle", v)} options={WALL_ANGLES} /></div>
              <div className="grid grid-cols-4 gap-3">
                <Input label="RPE (1-10)" value={climb.rpe} onChange={v => updateClimb(idx, "rpe", v)} type="number" min="1" max="10" />
                <Input label="# Attempts" value={climb.attempts} onChange={v => updateClimb(idx, "attempts", v)} type="number" min="1" />
                <Input label="# Moves" value={climb.moves} onChange={v => updateClimb(idx, "moves", v)} type="number" min="1" />
                <SentToggle sent={climb.sent} onChange={v => updateClimb(idx, "sent", v)} />
              </div>
              <div className="bg-slate-900/40 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Post-Climb Force (L/R)</div>
                  {baselineEmpty && <span className="text-[10px] text-amber-500/80">Log a baseline above to see % cost</span>}
                </div>
                <InstrumentToggle value={climb.instrument || settings.instrument} onChange={v => updateClimb(idx, "instrument", v)} />
                {climb.instrument === "Tindeq" && <>
                  <div className="mb-1"><label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Grip Position</label><GripPositionToggle gripType={climb.tindeqGripType || "Half Crimp"} intensity={climb.tindeqIntensity || "Try Hard"} onChangeType={v => updateClimb(idx, "tindeqGripType", v)} onChangeIntensity={v => updateClimb(idx, "tindeqIntensity", v)} /></div>
                  <ForcePair labelL={`Peak L — ${gripAbbr(climb.tindeqGripType || "Half Crimp", climb.tindeqIntensity || "Try Hard")} (${unit})`} labelR={`Peak R — ${gripAbbr(climb.tindeqGripType || "Half Crimp", climb.tindeqIntensity || "Try Hard")} (${unit})`} valueL={climb[gripFields("post", climb.tindeqGripType, climb.tindeqIntensity).L] || ""} valueR={climb[gripFields("post", climb.tindeqGripType, climb.tindeqIntensity).R] || ""} onChangeL={v => updateClimb(idx, gripFields("post", climb.tindeqGripType, climb.tindeqIntensity).L, v)} onChangeR={v => updateClimb(idx, gripFields("post", climb.tindeqGripType, climb.tindeqIntensity).R, v)} />
                  <ForcePair labelL="RFD L (N/s)" labelR="RFD R (N/s)" valueL={climb.postRFDL} valueR={climb.postRFDR} onChangeL={v => updateClimb(idx, "postRFDL", v)} onChangeR={v => updateClimb(idx, "postRFDR", v)} step="1" />
                </>}
                {climb.instrument === "Dynamometer" && <ForcePair labelL={`Grip L (${unit})`} labelR={`Grip R (${unit})`} valueL={climb.postGripL} valueR={climb.postGripR} onChangeL={v => updateClimb(idx, "postGripL", v)} onChangeR={v => updateClimb(idx, "postGripR", v)} />}
                {p !== null && <div className="flex gap-4 text-sm">
                  <div><span className="text-slate-500 text-xs">% baseline (avg): </span><span className={`font-mono font-bold ${p >= 90 ? "text-emerald-400" : p >= 80 ? "text-sky-400" : p >= 70 ? "text-amber-400" : "text-red-400"}`}>{p}%</span></div>
                  <div><span className="text-slate-500 text-xs">Cost: </span><span className={`font-mono font-bold ${cost > 15 ? "text-red-400" : cost > 8 ? "text-amber-400" : "text-emerald-400"}`}>{cost}%</span></div>
                </div>}
              </div>
              <Input label="Notes" value={climb.notes} onChange={v => updateClimb(idx, "notes", v)} placeholder="Beta, conditions..." />
              <button onClick={() => removeClimb(idx)} className="flex items-center gap-1.5 text-xs text-red-400/60 hover:text-red-400"><Trash2 size={13} /> Remove</button>
            </div>}
          </Card>
        );
      })}
      <div className="space-y-2">
        <div className="flex gap-2">
          <button onClick={quickAddSport} className="flex-1 py-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400 hover:bg-sky-500/20 transition-all flex items-center justify-center gap-1.5 text-xs font-semibold"><Plus size={14} /> Sport{lastGradeFor("sport") ? ` ${lastGradeFor("sport")}` : ""}</button>
          <button onClick={quickAddBoulder} className="flex-1 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-1.5 text-xs font-semibold"><Plus size={14} /> Boulder{lastGradeFor("boulder") ? ` ${lastGradeFor("boulder")}` : ""}</button>
        </div>
        <button onClick={() => { setClimbData(prev => { const current = prev[selectedDate] || { baselineInstrument: settings.instrument, baselineL: "", baselineR: "", baselineGripL: "", baselineGripR: "", climbs: [] }; const nc = [...current.climbs, { ...emptyClimb(), instrument: current.baselineInstrument || settings.instrument }]; setExpanded(nc.length - 1); return { ...prev, [selectedDate]: { ...current, climbs: nc } }; }); }}
          className="w-full py-2.5 border-2 border-dashed border-slate-700/50 rounded-xl text-slate-500 hover:text-sky-400 hover:border-sky-500/30 transition-all flex items-center justify-center gap-2 text-xs font-medium"><Plus size={14} /> Custom {dc.climbs.length > 0 && `(${dc.climbs.length} logged)`}</button>
      </div>
    </div>
  );
}

// ─── ASSESS VIEW ───
function AssessView({ assessData, setAssessData, settings }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...emptyAssess(), date: todayStr() });
  const unit = settings.unit || "lbs";
  const startNew = () => { setForm({ ...emptyAssess(), date: todayStr() }); setEditing("new"); };
  const saveA = () => { if (editing === "new") setAssessData(p => [...p, form]); else setAssessData(p => p.map((a, i) => i === editing ? form : a)); setEditing(null); };
  const d = (c, p, f) => (!p || !c[f] || !p[f]) ? null : Math.round((Number(c[f]) - Number(p[f])) * 10) / 10;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Progress Assessments</h2><button onClick={startNew} className="px-3 py-1.5 bg-sky-500/20 text-sky-400 rounded-lg text-xs font-semibold hover:bg-sky-500/30 flex items-center gap-1.5"><Plus size={14} /> New Test</button></div>
      {editing !== null && <Card>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-4">{editing === "new" ? "New Assessment" : "Edit Assessment"}</div>
        <div className="space-y-3">
          <Input label="Date" value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} type="date" />
          <Input label={`Bodyweight (${unit})`} value={form.bodyweight} onChange={v => setForm(p => ({ ...p, bodyweight: v }))} type="number" step="0.1" />
          <div className="grid grid-cols-2 gap-3"><Input label={`Max Hang 20mm (${unit} added)`} value={form.maxHang} onChange={v => setForm(p => ({ ...p, maxHang: v }))} type="number" step="0.5" /><Input label={`Weighted Pull-Up (${unit})`} value={form.weightedPullup} onChange={v => setForm(p => ({ ...p, weightedPullup: v }))} type="number" step="0.5" /></div>
          <div><label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Tindeq Grip Position</label><GripPositionToggle gripType={form.tindeqGripType || "Half Crimp"} intensity={form.tindeqIntensity || "Try Hard"} onChangeType={v => setForm(p => ({ ...p, tindeqGripType: v }))} onChangeIntensity={v => setForm(p => ({ ...p, tindeqIntensity: v }))} /></div>
          <ForcePair labelL={`Tindeq Peak L — ${gripAbbr(form.tindeqGripType || "Half Crimp", form.tindeqIntensity || "Try Hard")} (${unit})`} labelR={`Tindeq Peak R — ${gripAbbr(form.tindeqGripType || "Half Crimp", form.tindeqIntensity || "Try Hard")} (${unit})`} valueL={form[gripFields("tindeq", form.tindeqGripType, form.tindeqIntensity).L] || ""} valueR={form[gripFields("tindeq", form.tindeqGripType, form.tindeqIntensity).R] || ""} onChangeL={v => setForm(p => ({ ...p, [gripFields("tindeq", form.tindeqGripType, form.tindeqIntensity).L]: v }))} onChangeR={v => setForm(p => ({ ...p, [gripFields("tindeq", form.tindeqGripType, form.tindeqIntensity).R]: v }))} />
          <ForcePair labelL="Tindeq RFD L (N/s)" labelR="Tindeq RFD R (N/s)" valueL={form.tindeqRFDL} valueR={form.tindeqRFDR} onChangeL={v => setForm(p => ({ ...p, tindeqRFDL: v }))} onChangeR={v => setForm(p => ({ ...p, tindeqRFDR: v }))} step="1" />
          <Input label={`Critical Force (${unit})`} value={form.criticalForce} onChange={v => setForm(p => ({ ...p, criticalForce: v }))} type="number" step="0.1" />
          <ForcePair labelL={`Grip L (${unit})`} labelR={`Grip R (${unit})`} valueL={form.gripL} valueR={form.gripR} onChangeL={v => setForm(p => ({ ...p, gripL: v }))} onChangeR={v => setForm(p => ({ ...p, gripR: v }))} />
          <Input label="Shoulder ER:IR" value={form.shoulderRatio} onChange={v => setForm(p => ({ ...p, shoulderRatio: v }))} type="number" step="0.01" />
          <Input label="Notes" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} />
          <div className="flex gap-2"><button onClick={saveA} className="flex-1 py-2 bg-sky-500 text-white rounded-lg text-sm font-semibold hover:bg-sky-600">Save</button><button onClick={() => setEditing(null)} className="px-4 py-2 text-slate-400 text-sm">Cancel</button></div>
        </div>
      </Card>}
      {[...assessData].reverse().map((a, ri) => {
        const i = assessData.length - 1 - ri; const prev = i > 0 ? assessData[i - 1] : null;
        const gf = gripFields("tindeq", a.tindeqGripType, a.tindeqIntensity);
        const peakAvg = avg(a[gf.L], a[gf.R]) || avg(a.tindeqPeakL, a.tindeqPeakR);
        const prevGf = prev ? gripFields("tindeq", prev.tindeqGripType, prev.tindeqIntensity) : null;
        const prevPeakAvg = prev ? (avg(prev[prevGf.L], prev[prevGf.R]) || avg(prev.tindeqPeakL, prev.tindeqPeakR)) : 0;
        const ga = a.gripL && a.gripR ? Math.round(Math.abs(Number(a.gripL) - Number(a.gripR)) / Math.max(Number(a.gripL), Number(a.gripR)) * 100) : null;
        const taL = Number(a[gf.L]) || Number(a.tindeqPeakL); const taR = Number(a[gf.R]) || Number(a.tindeqPeakR);
        const ta = taL && taR ? Math.round(Math.abs(taL - taR) / Math.max(taL, taR) * 100) : null;
        return <Card key={i} onClick={() => { setForm(a); setEditing(i); }}>
          <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold">{a.date ? fmtDate(a.date) : `Test ${i + 1}`}</div>{a.bodyweight && <span className="text-xs text-slate-500">{a.bodyweight} {unit}</span>}</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {a.maxHang && <div><div className="text-[10px] text-slate-500">Max Hang</div><div className="text-sm font-bold font-mono">+{a.maxHang}<span className="text-xs text-slate-600">{unit}</span></div>{d(a, prev, "maxHang") !== null && <div className={`text-[10px] font-bold ${d(a, prev, "maxHang") >= 0 ? "text-emerald-400" : "text-red-400"}`}>{d(a, prev, "maxHang") >= 0 ? "+" : ""}{d(a, prev, "maxHang")}</div>}</div>}
            {peakAvg > 0 && <div><div className="text-[10px] text-slate-500">Peak Force</div><div className="text-sm font-bold font-mono">{Math.round(peakAvg * 10) / 10}<span className="text-xs text-slate-600">{unit}</span></div>{prevPeakAvg > 0 && <div className={`text-[10px] font-bold ${peakAvg >= prevPeakAvg ? "text-emerald-400" : "text-red-400"}`}>{peakAvg >= prevPeakAvg ? "+" : ""}{Math.round((peakAvg - prevPeakAvg) * 10) / 10}</div>}</div>}
            {a.criticalForce && <div><div className="text-[10px] text-slate-500">Critical Force</div><div className="text-sm font-bold font-mono">{a.criticalForce}<span className="text-xs text-slate-600">{unit}</span></div>{d(a, prev, "criticalForce") !== null && <div className={`text-[10px] font-bold ${d(a, prev, "criticalForce") >= 0 ? "text-emerald-400" : "text-red-400"}`}>{d(a, prev, "criticalForce") >= 0 ? "+" : ""}{d(a, prev, "criticalForce")}</div>}</div>}
          </div>
          <div className="mt-2 flex gap-4 text-xs flex-wrap">
            {ga !== null && <span><span className="text-slate-500">Grip L/R: </span><span className={`font-bold ${ga > 10 ? "text-red-400" : "text-emerald-400"}`}>{ga}%</span>{ga > 10 && <span className="text-red-400/60 ml-0.5">⚠</span>}</span>}
            {ta !== null && <span><span className="text-slate-500">Tindeq L/R: </span><span className={`font-bold ${ta > 10 ? "text-red-400" : "text-emerald-400"}`}>{ta}%</span>{ta > 10 && <span className="text-red-400/60 ml-0.5">⚠</span>}</span>}
          </div>
        </Card>;
      })}
      {assessData.length === 0 && <div className="text-center text-slate-600 py-8 text-sm">No assessments yet.</div>}
    </div>
  );
}

// ─── INJURY VIEW ───
function InjuryView({ injuryData, setInjuryData, dailyData, ewmaData, datesSorted }) {
  const [form, setForm] = useState({ ...emptyInjury(), date: todayStr() });
  const [editing, setEditing] = useState(null); // null = new entry, number = editing index
  const [view, setView] = useState("log");
  const [chartAxis, setChartAxis] = useState("load"); // "load" or "rpe"

  const saveNew = () => { setInjuryData(p => [...p, form]); setForm({ ...emptyInjury(), date: todayStr(), condition: form.condition }); setEditing(null); };
  const saveEdit = () => { if (editing !== null) setInjuryData(p => p.map((x, i) => i === editing ? form : x)); setForm({ ...emptyInjury(), date: todayStr() }); setEditing(null); };
  const deleteEntry = (idx) => { setInjuryData(p => p.filter((_, i) => i !== idx)); setEditing(null); setForm({ ...emptyInjury(), date: todayStr() }); };

  const flags = [];
  if (Math.max(form.lThumb, form.lIndex, form.lMiddle, form.lRing, form.lPinky, form.rThumb, form.rIndex, form.rMiddle, form.rRing, form.rPinky) >= 3) flags.push("Finger ≥3");
  if (Math.max(form.elbowL, form.elbowR) >= 3) flags.push("Elbow ≥3");
  if (Math.max(form.shoulderL, form.shoulderR) >= 3) flags.push("Shoulder ≥3");

  const maxPainOfEntry = (e) => Math.max(e.lThumb || 0, e.lIndex || 0, e.lMiddle || 0, e.lRing || 0, e.lPinky || 0, e.rThumb || 0, e.rIndex || 0, e.rMiddle || 0, e.rRing || 0, e.rPinky || 0, e.elbowL || 0, e.elbowR || 0, e.shoulderL || 0, e.shoulderR || 0);

  // Existing condition names for dropdown
  const existingConditions = useMemo(() => {
    const names = new Set();
    injuryData.forEach(e => { if (e.condition?.trim()) names.add(e.condition.trim()); });
    return [...names].sort();
  }, [injuryData]);

  // Group entries by condition
  const conditions = useMemo(() => {
    const grouped = {};
    injuryData.forEach(e => {
      const c = (e.condition || "").trim();
      if (!c) return;
      if (!grouped[c]) grouped[c] = [];
      grouped[c].push(e);
    });
    return Object.entries(grouped).map(([name, entries]) => {
      const sorted = entries.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const first = sorted[0]?.date;
      const last = sorted[sorted.length - 1]?.date;
      const daysActive = first && last ? Math.round((new Date(last) - new Date(first)) / (1000 * 60 * 60 * 24)) + 1 : 1;
      const currentPain = maxPainOfEntry(sorted[sorted.length - 1]);
      const peakPain = Math.max(...sorted.map(maxPainOfEntry));
      const firstPain = maxPainOfEntry(sorted[0]);
      const trend = currentPain - firstPain;
      return { name, entries: sorted, first, last, daysActive, currentPain, peakPain, trend };
    }).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  }, [injuryData]);

  // Get max RPE for a given date from sessions
  const getMaxRPE = (date) => {
    const dd = dailyData[date]; if (!dd) return 0;
    const sessions = dd.sessions?.length > 0 ? dd.sessions : (dd.sessionRPE ? [{ sessionRPE: dd.sessionRPE }] : []);
    return Math.max(0, ...sessions.map(s => Number(s.sessionRPE) || 0));
  };

  // Start a new update for an existing condition
  const addUpdateForCondition = (condName) => {
    setForm({ ...emptyInjury(), date: todayStr(), condition: condName });
    setEditing(null);
    setView("log");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Injury Tracker</h2><button onClick={() => { setForm({ ...emptyInjury(), date: todayStr() }); setEditing(null); setView("log"); }} className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-semibold hover:bg-red-500/30 flex items-center gap-1.5"><Plus size={14} /> New</button></div>
      <div className="flex gap-1 bg-slate-900/50 rounded-xl p-1">
        {[{ id: "log", label: "Log Entry" }, { id: "timeline", label: `Conditions (${conditions.length})` }].map(s => (
          <button key={s.id} onClick={() => setView(s.id)} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${view === s.id ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"}`}>{s.label}</button>
        ))}
      </div>

      {view === "log" && <>
        <Card>
          {editing !== null && <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 mb-3 text-xs text-amber-400">Editing entry from {form.date ? fmtDate(form.date) : "unknown date"}</div>}
          <div className="grid grid-cols-2 gap-3 mb-1">
            <Input label="Date" value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} type="date" />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Condition</label>
              {existingConditions.length > 0 ? (
                <select value={form.condition} onChange={e => setForm(p => ({ ...p, condition: e.target.value === "__new__" ? "" : e.target.value }))}
                  className="bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 appearance-none transition-all">
                  <option value="">+ New condition</option>
                  {existingConditions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <Input value={form.condition} onChange={v => setForm(p => ({ ...p, condition: v }))} placeholder="e.g., Left A2 pulley" />
              )}
            </div>
          </div>
          {form.condition === "" && existingConditions.length > 0 && (
            <Input label="New Condition Name" value={form.condition} onChange={v => setForm(p => ({ ...p, condition: v }))} placeholder="e.g., Left A2 pulley" className="mb-3" />
          )}
          <p className="text-[10px] text-slate-600 mb-4">Same name = tracked together over time</p>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Left Hand</div>
          <div className="space-y-1.5 mb-4">{[["lThumb", "Thumb"], ["lIndex", "Index"], ["lMiddle", "Middle"], ["lRing", "Ring"], ["lPinky", "Pinky"]].map(([k, l]) => <PainSlider key={k} label={l} value={form[k]} onChange={v => setForm(p => ({ ...p, [k]: v }))} />)}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Right Hand</div>
          <div className="space-y-1.5 mb-4">{[["rThumb", "Thumb"], ["rIndex", "Index"], ["rMiddle", "Middle"], ["rRing", "Ring"], ["rPinky", "Pinky"]].map(([k, l]) => <PainSlider key={k} label={l} value={form[k]} onChange={v => setForm(p => ({ ...p, [k]: v }))} />)}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Elbow & Shoulder</div>
          <div className="space-y-1.5 mb-4">
            <PainSlider label="Elbow L" value={form.elbowL} onChange={v => setForm(p => ({ ...p, elbowL: v }))} />
            <PainSlider label="Elbow R" value={form.elbowR} onChange={v => setForm(p => ({ ...p, elbowR: v }))} />
            <PainSlider label="Shoulder L" value={form.shoulderL} onChange={v => setForm(p => ({ ...p, shoulderL: v }))} />
            <PainSlider label="Shoulder R" value={form.shoulderR} onChange={v => setForm(p => ({ ...p, shoulderR: v }))} />
          </div>
          {flags.length > 0 && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-3 flex items-center gap-2"><AlertTriangle size={16} className="text-red-400 shrink-0" /><span className="text-xs text-red-400 font-medium">{flags.join(" • ")}</span></div>}
          <Input label="Location Details" value={form.details} onChange={v => setForm(p => ({ ...p, details: v }))} placeholder="e.g., A2 pulley left ring" className="mb-3" />
          <Input label="Notes / Action Plan" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Rest, tape, physio..." className="mb-3" />
          {editing !== null ? (
            <div className="flex gap-2">
              <button onClick={saveEdit} className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600">Update Entry</button>
              <button onClick={() => { setEditing(null); setForm({ ...emptyInjury(), date: todayStr() }); }} className="px-4 py-2 text-slate-400 text-sm">Cancel</button>
            </div>
          ) : (
            <button onClick={saveNew} className="w-full py-2 bg-sky-500 text-white rounded-lg text-sm font-semibold hover:bg-sky-600">Save New Entry</button>
          )}
        </Card>
        {[...injuryData].reverse().map((e, ri) => {
          const idx = injuryData.length - 1 - ri;
          const mp = maxPainOfEntry(e);
          return <Card key={ri}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{e.date ? fmtDate(e.date) : "Entry"}</div>
                {e.condition && <div className="text-[10px] text-slate-500 mt-0.5">{e.condition}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge color={mp >= 5 ? "red" : mp >= 3 ? "yellow" : "green"}>Max: {mp}/10</Badge>
              </div>
            </div>
            {e.details && <div className="text-xs text-slate-500 mt-1">{e.details}</div>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setForm(e); setEditing(idx); }} className="text-[10px] text-slate-500 hover:text-amber-400">Edit</button>
              <button onClick={() => addUpdateForCondition(e.condition || "")} className="text-[10px] text-slate-500 hover:text-sky-400">+ Add Update</button>
              <button onClick={() => deleteEntry(idx)} className="text-[10px] text-slate-500 hover:text-red-400 ml-auto">Delete</button>
            </div>
          </Card>;
        })}
      </>}

      {view === "timeline" && <>
        {conditions.length === 0 && <Card><div className="text-center text-slate-500 py-6 text-sm">No conditions tracked yet.<div className="text-[10px] text-slate-600 mt-2">Add a condition name to entries to track them over time.</div></div></Card>}
        {conditions.length > 0 && <div className="flex gap-1 bg-slate-900/50 rounded-lg p-0.5 border border-slate-700/40">
          {[{ id: "load", label: "vs Chronic Load" }, { id: "rpe", label: "vs Session RPE" }].map(opt => (
            <button key={opt.id} onClick={() => setChartAxis(opt.id)}
              className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all ${chartAxis === opt.id ? "bg-sky-500/20 text-sky-300 border border-sky-500/30" : "text-slate-500 hover:text-slate-300"}`}>{opt.label}</button>
          ))}
        </div>}
        {conditions.map(cond => {
          // Body part definitions with colors
          const PARTS = [
            { key: "lThumb", label: "L Thumb", color: "#ef4444" },
            { key: "lIndex", label: "L Index", color: "#f97316" },
            { key: "lMiddle", label: "L Middle", color: "#eab308" },
            { key: "lRing", label: "L Ring", color: "#84cc16" },
            { key: "lPinky", label: "L Pinky", color: "#22c55e" },
            { key: "rThumb", label: "R Thumb", color: "#06b6d4" },
            { key: "rIndex", label: "R Index", color: "#3b82f6" },
            { key: "rMiddle", label: "R Middle", color: "#8b5cf6" },
            { key: "rRing", label: "R Ring", color: "#a855f7" },
            { key: "rPinky", label: "R Pinky", color: "#d946ef" },
            { key: "elbowL", label: "L Elbow", color: "#f43f5e" },
            { key: "elbowR", label: "R Elbow", color: "#fb923c" },
            { key: "shoulderL", label: "L Shoulder", color: "#2dd4bf" },
            { key: "shoulderR", label: "R Shoulder", color: "#38bdf8" },
          ];
          // Find which body parts have any non-zero pain in this condition's entries
          const activeParts = PARTS.filter(p => cond.entries.some(e => (e[p.key] || 0) > 0));

          const startDate = cond.first; const endDate = cond.last;
          const today = todayStr();
          const extendToToday = today > endDate && (new Date(today) - new Date(endDate)) / (1000 * 60 * 60 * 24) < 30;
          const datesForChart = datesSorted.filter(d => d >= startDate && d <= (extendToToday ? today : endDate));
          // Build entry lookup by date — store full entry, not just max
          const entryByDate = {}; cond.entries.forEach(e => { entryByDate[e.date] = e; });
          const chartData = datesForChart.map(d => {
            const row = { date: fmtShort(d), secondary: chartAxis === "load" ? (ewmaData[d]?.chronic || 0) : getMaxRPE(d) };
            const entry = entryByDate[d];
            activeParts.forEach(p => { row[p.key] = entry ? (entry[p.key] || null) : null; });
            return row;
          });
          // Add entries not in datesSorted
          cond.entries.forEach(e => {
            if (!chartData.find(c => c.date === fmtShort(e.date))) {
              const row = { date: fmtShort(e.date), secondary: 0 };
              activeParts.forEach(p => { row[p.key] = e[p.key] || null; });
              chartData.push(row);
            }
          });
          chartData.sort((a, b) => a.date.localeCompare(b.date));
          const trendColor = cond.trend < 0 ? "text-emerald-400" : cond.trend > 0 ? "text-red-400" : "text-slate-400";
          const trendArrow = cond.trend < 0 ? "↓" : cond.trend > 0 ? "↑" : "→";
          const secondaryLabel = chartAxis === "load" ? "Chronic Load" : "Session RPE";
          return <Card key={cond.name}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold">{cond.name}</div>
                <div className="text-[10px] text-slate-500">{cond.daysActive} days · {cond.entries.length} entries · {activeParts.length} areas</div>
              </div>
              <div className="text-right">
                <Badge color={cond.currentPain >= 5 ? "red" : cond.currentPain >= 3 ? "yellow" : "green"}>Now: {cond.currentPain}/10</Badge>
                <div className={`text-[10px] font-bold mt-1 ${trendColor}`}>{trendArrow} {cond.trend > 0 ? "+" : ""}{cond.trend} since start</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(160, 120 + activeParts.length * 8)}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis yAxisId="left" domain={[0, 10]} tick={{ fill: "#94a3b8", fontSize: 9 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#38bdf8", fontSize: 9 }} domain={chartAxis === "rpe" ? [0, 10] : undefined} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }} />
                <Area yAxisId="right" type="monotone" dataKey="secondary" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.1} strokeWidth={1} name={secondaryLabel} />
                {activeParts.map(p => (
                  <Line key={p.key} yAxisId="left" type="monotone" dataKey={p.key} stroke={p.color} strokeWidth={2} dot={{ r: 3 }} connectNulls name={p.label} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[10px] text-slate-500 justify-center">
              {activeParts.map(p => <span key={p.key}><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: p.color }} />{p.label}</span>)}
              <span><span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />{secondaryLabel}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-[10px] text-slate-600">First: {fmtDate(cond.first)} · Peak: {cond.peakPain}/10</div>
              <button onClick={() => addUpdateForCondition(cond.name)} className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold">+ Add Update</button>
            </div>
          </Card>;
        })}
      </>}
    </div>
  );
}

// ─── DASHBOARD VIEW ───
function DashboardView({ dailyData, ewmaData, datesSorted, assessData, climbData }) {
  const [chart, setChart] = useState("ewma");
  const [range, setRange] = useState(60);
  const rangeDates = range === "all" ? datesSorted : datesSorted.slice(-range);
  const ewmaCD = useMemo(() => rangeDates.map(d => ({ date: fmtShort(d), acute: ewmaData[d]?.acute || 0, chronic: ewmaData[d]?.chronic || 0, ratio: ewmaData[d]?.ratio || 0 })), [rangeDates, ewmaData]);
  const wellCD = useMemo(() => rangeDates.map(d => { const dd = dailyData[d]; if (!dd) return null; const ss = hoursToScore(dd.sleepDuration); const v = [dd.sleepQuality, ss || "", dd.soreness, dd.fingerSoreness, dd.stress, dd.motivation].filter(x => x !== "" && x !== 0); if (v.length !== 6) return null; return { date: fmtShort(d), wellness: v.reduce((a, b) => a + Number(b), 0) }; }).filter(Boolean), [rangeDates, dailyData]);
  const forceCD = useMemo(() => rangeDates.map(d => { const dd = dailyData[d]; if (!dd) return null; const gf = gripFields("tindeq", dd.tindeqGripType, dd.tindeqIntensity); const tL = Number(dd[gf.L]) || Number(dd.tindeqPeakL) || null; const tR = Number(dd[gf.R]) || Number(dd.tindeqPeakR) || null; const gL = Number(dd.gripL) || null; const gR = Number(dd.gripR) || null; const tAvg = (tL && tR) ? Math.round((tL + tR) / 2 * 10) / 10 : null; const gAvg = (gL && gR) ? Math.round((gL + gR) / 2 * 10) / 10 : null; if (!tL && !tR && !gL && !gR) return null; return { date: fmtShort(d), tindeqL: tL, tindeqR: tR, tindeqAvg: tAvg, gripL: gL, gripR: gR, gripAvg: gAvg }; }).filter(Boolean), [rangeDates, dailyData]);
  const styleCostCD = useMemo(() => { const byStyle = {}; Object.values(climbData).forEach(dc => { const blAvg = (dc.baselineInstrument === "Dynamometer") ? avg(dc.baselineGripL, dc.baselineGripR) : avg(dc.baselineL, dc.baselineR); dc.climbs?.forEach(c => { const cgf = gripFields("post", c.tindeqGripType, c.tindeqIntensity); const postAvg = c.instrument === "Dynamometer" ? avg(c.postGripL, c.postGripR) : (avg(c[cgf.L], c[cgf.R]) || avg(c.postPeakL, c.postPeakR)); if (!blAvg || !postAvg) return; const cost = Math.round(((blAvg - postAvg) / blAvg) * 100); (c.styles || []).forEach(s => { if (!byStyle[s]) byStyle[s] = []; byStyle[s].push(cost); }); }); }); return Object.entries(byStyle).map(([style, costs]) => ({ style, avgCost: Math.round(costs.reduce((a, b) => a + b, 0) / costs.length), count: costs.length })).sort((a, b) => b.avgCost - a.avgCost); }, [climbData]);
  const gradeAttCD = useMemo(() => { const all = []; Object.entries(climbData).forEach(([date, dc]) => { dc.climbs?.forEach(c => { if (!c.sent || !c.attempts) return; const grade = c.gradeSport || c.gradeBoulder; if (!grade) return; all.push({ grade, attempts: Number(c.attempts), date: fmtShort(date), route: c.route || "Unnamed" }); }); }); return all; }, [climbData]);
  const assessCD = useMemo(() => assessData.filter(a => a.date).map(a => { const gf = gripFields("tindeq", a.tindeqGripType, a.tindeqIntensity); return { date: fmtShort(a.date), maxHang: Number(a.maxHang) || null, peakForce: avg(a[gf.L], a[gf.R]) || avg(a.tindeqPeakL, a.tindeqPeakR) || null, critForce: Number(a.criticalForce) || null }; }), [assessData]);
  const totalClimbs = Object.values(climbData).reduce((a, d) => a + (d.climbs?.length || 0), 0);
  const totalSends = Object.values(climbData).reduce((a, d) => a + (d.climbs?.filter(c => c.sent).length || 0), 0);

  const currentStreak = useMemo(() => {
    if (!datesSorted.length) return 0;
    let streak = 0;
    const today = todayStr();
    let cursor = new Date(today + "T12:00:00");
    while (true) {
      const d = cursor.toISOString().slice(0, 10);
      const dd = dailyData[d];
      const hasSessions = dd?.sessions?.some(s => s.sessionType && s.sessionType !== "Rest") || (dd?.sessionDuration && dd.sessionType !== "Rest");
      if (!hasSessions) break;
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }, [dailyData, datesSorted]);

  const personalRecords = useMemo(() => {
    const sportGradeIdx = (g) => SPORT_GRADES.indexOf(g);
    const boulderGradeIdx = (g) => BOULDER_GRADES.indexOf(g);
    let bestSport = "", bestBoulder = "", bestForce = 0, bestMaxHang = 0;
    Object.values(climbData).forEach(dc => {
      dc.climbs?.forEach(c => {
        if (!c.sent) return;
        if (c.gradeSport && sportGradeIdx(c.gradeSport) > sportGradeIdx(bestSport)) bestSport = c.gradeSport;
        if (c.gradeBoulder && boulderGradeIdx(c.gradeBoulder) > boulderGradeIdx(bestBoulder)) bestBoulder = c.gradeBoulder;
      });
    });
    Object.values(dailyData).forEach(dd => {
      if (!dd) return;
      const gf = gripFields("tindeq", dd.tindeqGripType, dd.tindeqIntensity);
      const f = dayMarkerAvg(dd, dd.markerType || "Tindeq");
      if (f > bestForce) bestForce = f;
    });
    assessData.forEach(a => { const h = Number(a.maxHang); if (h > bestMaxHang) bestMaxHang = h; });
    return { bestSport, bestBoulder, bestForce: bestForce ? Math.round(bestForce * 10) / 10 : null, bestMaxHang: bestMaxHang || null };
  }, [climbData, dailyData, assessData]);

  const tabs = [{ id: "ewma", l: "Load" }, { id: "wellness", l: "Wellness" }, { id: "force", l: "Force" }, { id: "style", l: "Style" }, { id: "grade", l: "Grades" }, { id: "assess", l: "Progress" }];

  const ttStyle = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Dashboard</h2>
        <div className="flex gap-0.5 bg-slate-900/50 rounded-lg p-0.5">
          {[{ v: 30, l: "30d" }, { v: 60, l: "60d" }, { v: 90, l: "90d" }, { v: "all", l: "All" }].map(r => (
            <button key={r.v} onClick={() => setRange(r.v)} className={`px-2 py-1 rounded-md text-[9px] font-semibold transition-all ${range === r.v ? "bg-slate-700/60 text-white" : "text-slate-600 hover:text-slate-300"}`}>{r.l}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Card className="text-center py-3 px-1"><div className="text-[10px] text-slate-500 uppercase">Days</div><div className="text-lg font-bold text-sky-400 font-mono">{datesSorted.length}</div></Card>
        <Card className="text-center py-3 px-1"><div className="text-[10px] text-slate-500 uppercase">Climbs</div><div className="text-lg font-bold text-emerald-400 font-mono">{totalClimbs}</div></Card>
        <Card className="text-center py-3 px-1"><div className="text-[10px] text-slate-500 uppercase">Sends</div><div className="text-lg font-bold text-amber-400 font-mono">{totalSends}</div></Card>
        <Card className="text-center py-3 px-1"><div className="text-[10px] text-slate-500 uppercase">Streak</div><div className={`text-lg font-bold font-mono ${currentStreak >= 7 ? "text-emerald-400" : currentStreak >= 3 ? "text-sky-400" : currentStreak > 0 ? "text-slate-300" : "text-slate-600"}`}>{currentStreak}<span className="text-xs text-slate-600">d</span></div></Card>
      </div>
      {(personalRecords.bestSport || personalRecords.bestBoulder || personalRecords.bestForce || personalRecords.bestMaxHang) && (
        <Card>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Personal Records</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {personalRecords.bestSport && <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Sport (sent)</span><span className="text-sm font-bold text-sky-400 font-mono">{personalRecords.bestSport}</span></div>}
            {personalRecords.bestBoulder && <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Boulder (sent)</span><span className="text-sm font-bold text-emerald-400 font-mono">{personalRecords.bestBoulder}</span></div>}
            {personalRecords.bestForce && <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Peak force</span><span className="text-sm font-bold text-violet-400 font-mono">{personalRecords.bestForce}</span></div>}
            {personalRecords.bestMaxHang && <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Max hang add.</span><span className="text-sm font-bold text-amber-400 font-mono">+{personalRecords.bestMaxHang}</span></div>}
          </div>
        </Card>
      )}
      <div className="flex gap-1 bg-slate-900/50 rounded-xl p-1 flex-wrap">{tabs.map(t => <button key={t.id} onClick={() => setChart(t.id)} className={`flex-1 py-2 rounded-lg text-[10px] font-semibold transition-all min-w-0 ${chart === t.id ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"}`}>{t.l}</button>)}</div>
      <Card className="p-3">
        {chart === "ewma" && <>{ewmaCD.length > 1 ? <><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">EWMA Acute vs Chronic</div><ResponsiveContainer width="100%" height={240}><LineChart data={ewmaCD} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fill: "#64748b", fontSize: 9 }} /><Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} /><Line type="monotone" dataKey="acute" stroke="#38bdf8" strokeWidth={2} dot={false} name="Acute" /><Line type="monotone" dataKey="chronic" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Chronic" /></LineChart></ResponsiveContainer></> : <div className="text-center text-slate-600 py-12 text-sm">Log 2+ days</div>}</>}
        {chart === "wellness" && <>{wellCD.length > 1 ? <><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Daily Wellness (/60)</div><ResponsiveContainer width="100%" height={240}><LineChart data={wellCD} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 60]} tick={{ fill: "#64748b", fontSize: 9 }} /><Tooltip contentStyle={ttStyle} /><Line type="monotone" dataKey="wellness" stroke="#22c55e" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></> : <div className="text-center text-slate-600 py-12 text-sm">Log wellness</div>}</>}
        {chart === "force" && <>{forceCD.length > 1 ? <><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Daily Force — Left / Right / Average</div><ResponsiveContainer width="100%" height={280}><LineChart data={forceCD} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fill: "#64748b", fontSize: 9 }} /><Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} />{forceCD.some(d => d.tindeqL) && <Line type="monotone" dataKey="tindeqL" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Tindeq L" />}{forceCD.some(d => d.tindeqR) && <Line type="monotone" dataKey="tindeqR" stroke="#0ea5e9" strokeWidth={1.5} dot={false} name="Tindeq R" />}{forceCD.some(d => d.tindeqAvg) && <Line type="monotone" dataKey="tindeqAvg" stroke="#7dd3fc" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Tindeq Avg" />}{forceCD.some(d => d.gripL) && <Line type="monotone" dataKey="gripL" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="Grip L" />}{forceCD.some(d => d.gripR) && <Line type="monotone" dataKey="gripR" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="Grip R" />}{forceCD.some(d => d.gripAvg) && <Line type="monotone" dataKey="gripAvg" stroke="#c4b5fd" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Grip Avg" />}</LineChart></ResponsiveContainer></> : <div className="text-center text-slate-600 py-12 text-sm">Log force</div>}</>}
        {chart === "style" && <>{styleCostCD.length > 0 ? <><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Avg Force Cost by Style</div><ResponsiveContainer width="100%" height={240}><BarChart data={styleCostCD} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis type="number" tick={{ fill: "#64748b", fontSize: 9 }} domain={[0, 'auto']} /><YAxis type="category" dataKey="style" tick={{ fill: "#94a3b8", fontSize: 10 }} width={80} /><Tooltip contentStyle={ttStyle} formatter={(v, n, p) => [`${v}% (${p.payload.count} climbs)`, "Avg Cost"]} /><Bar dataKey="avgCost" fill="#f59e0b" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></> : <div className="text-center text-slate-600 py-12 text-sm">Log climbs with styles + force</div>}</>}
        {chart === "grade" && <>{gradeAttCD.length > 0 ? <><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Grade vs Attempts to Send</div><ResponsiveContainer width="100%" height={240}><BarChart data={gradeAttCD} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="grade" tick={{ fill: "#64748b", fontSize: 9 }} /><YAxis tick={{ fill: "#64748b", fontSize: 9 }} /><Tooltip contentStyle={ttStyle} formatter={(v, n, p) => [`${v} attempts`, p.payload.route]} /><Bar dataKey="attempts" radius={[4, 4, 0, 0]}>{gradeAttCD.map((e, i) => <Cell key={i} fill={e.attempts <= 1 ? "#22c55e" : e.attempts <= 3 ? "#38bdf8" : e.attempts <= 5 ? "#f59e0b" : "#ef4444"} />)}</Bar></BarChart></ResponsiveContainer><div className="flex gap-3 mt-2 text-[10px] text-slate-500 justify-center flex-wrap"><span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />Flash</span><span><span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />2-3</span><span><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />4-5</span><span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />6+</span></div></> : <div className="text-center text-slate-600 py-12 text-sm">Log sent climbs with attempts</div>}</>}
        {chart === "assess" && <>{assessCD.length > 1 ? <><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Assessment Trends</div><ResponsiveContainer width="100%" height={240}><LineChart data={assessCD} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} /><YAxis tick={{ fill: "#64748b", fontSize: 9 }} /><Tooltip contentStyle={ttStyle} /><Legend wrapperStyle={{ fontSize: 10 }} />{assessCD.some(d => d.maxHang) && <Line type="monotone" dataKey="maxHang" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} name="Max Hang" />}{assessCD.some(d => d.peakForce) && <Line type="monotone" dataKey="peakForce" stroke="#38bdf8" strokeWidth={2} dot={{ r: 4 }} name="Peak Force (avg)" />}{assessCD.some(d => d.critForce) && <Line type="monotone" dataKey="critForce" stroke="#a78bfa" strokeWidth={2} dot={{ r: 4 }} name="Critical Force" />}</LineChart></ResponsiveContainer></> : <div className="text-center text-slate-600 py-12 text-sm">{assessCD.length === 1 ? "Need 2+ assessments" : "Log assessments"}</div>}</>}
      </Card>
      {ewmaCD.length > 1 && <Card className="p-3"><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">EWMA Ratio</div><ResponsiveContainer width="100%" height={160}><LineChart data={ewmaCD} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 2]} tick={{ fill: "#64748b", fontSize: 9 }} /><Tooltip contentStyle={ttStyle} /><Line type="monotone" dataKey="ratio" stroke="#f59e0b" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer><div className="flex gap-4 mt-2 text-[10px] text-slate-500 justify-center"><span><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />0.8–1.3</span><span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />&gt;1.3</span><span><span className="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1" />&lt;0.8</span></div></Card>}
    </div>
  );
}

// ─── COACH VIEW ───
function CoachView({ coachUsers, currentUser, loadUserData, coachViewUser, setCoachViewUser, coachData, setCoachData }) {
  const [loadingUser, setLoadingUser] = useState(false);

  // user: { id, username }
  const drillDown = async (user) => {
    setLoadingUser(true);
    const data = await loadUserData(user.id);
    setCoachData(data);
    setCoachViewUser(user);
    setLoadingUser(false);
  };

  // Summary view — cards for all users
  if (!coachViewUser) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Coach View</h2>
        <p className="text-xs text-slate-500">{coachUsers.length} athlete{coachUsers.length !== 1 ? "s" : ""} registered</p>
        {coachUsers.length === 0 && <Card><div className="text-center text-slate-500 py-8 text-sm">No athletes yet. Athletes will appear here once they sign up and start logging.</div></Card>}
        {coachUsers.map(user => (
          <CoachUserCard key={user.id} userId={user.id} username={user.username} isSelf={user.username === currentUser} onDrillDown={() => drillDown(user)} />
        ))}
      </div>
    );
  }

  // Drill-down view — a specific user's data
  if (loadingUser) return (
    <div className="text-center py-12"><Loader size={24} className="text-sky-400 animate-spin mx-auto mb-3" /><div className="text-sm text-slate-500">Loading {coachViewUser.username}'s data...</div></div>
  );

  if (!coachData) return null;

  const dd = coachData.daily || {};
  const dates = Object.keys(dd).sort();
  const ewma = computeEWMA(dd, dates);
  const lastDate = dates.length > 0 ? dates[dates.length - 1] : null;
  const lastDay = lastDate ? dd[lastDate] : null;
  const lastEWMA = lastDate ? ewma[lastDate] : null;
  const totalClimbs = Object.values(coachData.climbs || {}).reduce((a, d) => a + (d.climbs?.length || 0), 0);
  const totalSends = Object.values(coachData.climbs || {}).reduce((a, d) => a + (d.climbs?.filter(c => c.sent).length || 0), 0);
  const lastWellness = lastDay ? [lastDay.sleepQuality, hoursToScore(lastDay.sleepDuration), lastDay.soreness, lastDay.fingerSoreness, lastDay.stress, lastDay.motivation].filter(v => v !== "" && v !== 0) : [];
  const wellnessTotal = lastWellness.reduce((a, b) => a + Number(b), 0);

  // Injury conditions
  const activeInjuries = (coachData.injury || []).filter(e => e.condition).reduce((acc, e) => {
    const c = e.condition.trim();
    if (!acc[c]) acc[c] = { pain: 0, date: e.date };
    const mp = Math.max(e.lThumb||0,e.lIndex||0,e.lMiddle||0,e.lRing||0,e.lPinky||0,e.rThumb||0,e.rIndex||0,e.rMiddle||0,e.rRing||0,e.rPinky||0,e.elbowL||0,e.elbowR||0,e.shoulderL||0,e.shoulderR||0);
    if (e.date >= (acc[c].date || "")) { acc[c] = { pain: mp, date: e.date }; }
    return acc;
  }, {});
  const activeInjuryList = Object.entries(activeInjuries).filter(([_, v]) => v.pain > 0);

  // Force chart data
  const forceCD = dates.slice(-30).map(d => {
    const day = dd[d]; if (!day) return null;
    const mt = day.markerType || "Tindeq";
    const val = dayMarkerAvg(day, mt);
    return val > 0 ? { date: fmtShort(d), force: Math.round(val * 10) / 10 } : null;
  }).filter(Boolean);

  // EWMA chart data
  const ewmaCD = dates.slice(-30).map(d => ({ date: fmtShort(d), acute: ewma[d]?.acute || 0, chronic: ewma[d]?.chronic || 0 }));

  const ttStyle = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };

  return (
    <div className="space-y-4">
      <button onClick={() => { setCoachViewUser(null); setCoachData(null); }} className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300">
        <ChevronLeft size={14} /> All Athletes
      </button>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center text-white font-bold text-lg">{coachViewUser.username.charAt(0).toUpperCase()}</div>
        <div><h2 className="text-lg font-bold">{coachViewUser.username}</h2><div className="text-xs text-slate-500">{dates.length} days logged · {totalClimbs} climbs · {totalSends} sends</div></div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card className="text-center py-3 px-1"><div className="text-[10px] text-slate-500 uppercase">Wellness</div><div className="text-lg font-bold text-emerald-400 font-mono">{lastWellness.length === 6 ? wellnessTotal : "—"}<span className="text-xs text-slate-600">/60</span></div></Card>
        <Card className="text-center py-3 px-1"><div className="text-[10px] text-slate-500 uppercase">EWMA</div><div className={`text-lg font-bold font-mono ${lastEWMA?.ratio > 1.3 ? "text-amber-400" : lastEWMA?.ratio < 0.8 ? "text-sky-400" : "text-emerald-400"}`}>{lastEWMA?.ratio || "—"}</div></Card>
        <Card className="text-center py-3 px-1"><div className="text-[10px] text-slate-500 uppercase">Last Active</div><div className="text-sm font-bold text-slate-300">{lastDate ? fmtShort(lastDate) : "—"}</div></Card>
      </div>

      {activeInjuryList.length > 0 && <Card className="border-l-4 border-l-red-500">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Active Injuries</div>
        {activeInjuryList.map(([name, v]) => (
          <div key={name} className="flex items-center justify-between text-sm py-1">
            <span className="text-slate-300">{name}</span>
            <Badge color={v.pain >= 5 ? "red" : v.pain >= 3 ? "yellow" : "green"}>{v.pain}/10</Badge>
          </div>
        ))}
      </Card>}

      {ewmaCD.length > 1 && <Card className="p-3">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Training Load (30d)</div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={ewmaCD} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#64748b", fontSize: 9 }} />
            <Tooltip contentStyle={ttStyle} />
            <Line type="monotone" dataKey="acute" stroke="#38bdf8" strokeWidth={2} dot={false} name="Acute" />
            <Line type="monotone" dataKey="chronic" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Chronic" />
          </LineChart>
        </ResponsiveContainer>
      </Card>}

      {forceCD.length > 1 && <Card className="p-3">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Force Marker (30d)</div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={forceCD} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#64748b", fontSize: 9 }} />
            <Tooltip contentStyle={ttStyle} />
            <Line type="monotone" dataKey="force" stroke="#38bdf8" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>}

      {(coachData.assess || []).length > 0 && <Card>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Latest Assessment</div>
        {(() => {
          const a = coachData.assess[coachData.assess.length - 1]; const unit = coachData.settings?.unit || "lbs";
          return <div className="grid grid-cols-3 gap-3 text-center">
            {a.maxHang && <div><div className="text-[10px] text-slate-500">Max Hang</div><div className="text-sm font-bold font-mono">+{a.maxHang} {unit}</div></div>}
            {a.criticalForce && <div><div className="text-[10px] text-slate-500">Critical Force</div><div className="text-sm font-bold font-mono">{a.criticalForce} {unit}</div></div>}
            {a.bodyweight && <div><div className="text-[10px] text-slate-500">Bodyweight</div><div className="text-sm font-bold font-mono">{a.bodyweight} {unit}</div></div>}
          </div>;
        })()}
      </Card>}
    </div>
  );
}

// ─── COACH USER CARD (summary for one athlete) ───
function CoachUserCard({ userId, username, isSelf, onDrillDown }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    loadUserData(userId).then(data => {
      const dates = Object.keys(data.daily || {}).sort();
      const lastDate = dates.length > 0 ? dates[dates.length - 1] : null;
      const ewma = computeEWMA(data.daily || {}, dates);
      const lastEWMA = lastDate ? ewma[lastDate] : null;
      const totalClimbs = Object.values(data.climbs || {}).reduce((a, d) => a + (d.climbs?.length || 0), 0);
      setSummary({ dates: dates.length, lastDate, ratio: lastEWMA?.ratio, totalClimbs });
    });
  }, [userId]);

  return (
    <Card onClick={onDrillDown}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center text-white font-bold text-lg shrink-0">{username.charAt(0).toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2">{username}{isSelf && <Badge color="blue">You</Badge>}</div>
          {summary ? (
            <div className="flex gap-3 text-[10px] text-slate-500 mt-0.5">
              <span>{summary.dates} days</span>
              <span>{summary.totalClimbs} climbs</span>
              {summary.ratio && <span className={summary.ratio > 1.3 ? "text-amber-400" : summary.ratio < 0.8 ? "text-sky-400" : "text-emerald-400"}>EWMA {summary.ratio}</span>}
              {summary.lastDate && <span>Last: {fmtShort(summary.lastDate)}</span>}
            </div>
          ) : <div className="text-[10px] text-slate-600 mt-0.5">Loading...</div>}
        </div>
        <ChevronRight size={16} className="text-slate-600 shrink-0" />
      </div>
    </Card>
  );
}
