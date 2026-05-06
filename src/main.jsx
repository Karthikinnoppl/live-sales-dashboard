import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid
} from 'recharts';
import { RefreshCw, Users, Target, Trophy, AlertCircle, Filter, Search, Download, TrendingUp, UserCheck, XCircle } from 'lucide-react';

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const SHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID || '1CbIkGkSyFi5K1Ups7wgwnCP5vM9vsdNtv44hxNfrqG8';
const OUTBOUND_TABS = ['Adam', 'Patrick', 'Shawn', 'Sam', 'Michael', 'Clinton'];
const SALES_PERSONS = ['Karthik', 'Shawn', 'Sathish'];
const SERVICES_LIST = [
  'TCS - Development',
  'TCS - Marketing',
  'TCS - Dev & Marketing',
  'ConversionBox',
  'Drupal - Development',
  'Drupal - Marketing',
  'Drupal - Dev & Marketing',
];

// Lead Status buckets — all matched against the 'Status' column (lowercase)
const STATUS = {
  NO_SHOW:        v => v === 'no show',
  NOT_RIGHT_FIT:  v => v === 'not a right fitment' || v === 'not the right fitment' || v === 'not right fit' || v === 'not a right fit',
  NOT_INTERESTED: v => v === 'not interested' || v === 'not ready now' || v === 'not interested & not ready now' || v === 'not interested and not ready now',
  PROPOSAL_WON:   v => v === 'proposal won' || v === 'won',
  PROPOSAL_LOST:  v => v === 'proposal lost' || v === 'lost',
  IN_PROGRESS:    v => v === 'in progress',
  FOLLOW_UP:      v => v === 'follow up',
  REQUEST_ACCESS: v => v === 'request access',
  CANCELLED:      v => v === 'cancelled' || v === 'canceled',
};

// Remarks status for "Meeting Happened"
const REMARKS_COMPLETED = v => v === 'completed';

// ─── UTILITIES ─────────────────────────────────────────────────────────────────
const norm  = (v = '') => String(v ?? '').trim();
const normL = (v = '') => norm(v).toLowerCase();
const normK = (v = '') => normL(v).replace(/[^a-z0-9]/g, '');
const pct   = (n, d) => d ? Math.round((n / d) * 1000) / 10 : 0;

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && inQ && n === '"') { cell += '"'; i++; }
    else if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => norm(c)));
}

function mapRows(rows, tabName) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => norm(h));
  const lookup  = Object.fromEntries(headers.map(h => [normK(h), h]));
  return rows.slice(1).map((r, idx) => {
    const item = {};
    headers.forEach((h, i) => { item[h] = norm(r[i]); });
    return {
      id:            `${tabName}-${idx}`,
      outboundRep:   tabName,
      date:          item[lookup['date']] || '',
      name:          item[lookup['name']] || '',
      company:       item[lookup['companyname']] || item[lookup['company']] || '',
      email:         item[lookup['email']] || '',
      leadStatus:    normL(item[lookup['leadstatus']] || item[lookup['status']] || ''),
      remarks:       normL(item[lookup['remarks']] || item[lookup['remark']] || ''),
      salesPerson:   item[lookup['salesperson']] || '',
      services:      item[lookup['services']] || '',
      platform:      item[lookup['ecommerce']] || item[lookup['ecommerceplatform']] || '',
      meetingOn:     item[lookup['meetingon']] || '',
      revenue:       item[lookup['revenue']] || '',
      comments:      item[lookup['comments']] || '',
    };
  }).filter(r => r.company || r.name || r.leadStatus);
}

async function fetchTab(tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Cannot load tab: ${tabName}`);
  const text = await res.text();
  if (text.includes('<!DOCTYPE') || text.includes('ServiceLogin'))
    throw new Error(`${tabName} is not publicly readable`);
  return mapRows(parseCsv(text), tabName);
}

function groupBy(rows, fn) {
  return rows.reduce((acc, r) => {
    const k = norm(fn(r)) || 'Unknown';
    (acc[k] = acc[k] || []).push(r);
    return acc;
  }, {});
}

// ─── CORE METRICS (per spec in the images) ────────────────────────────────────
/**
 * OUTBOUND REP REPORT FORMULAS:
 * - Total Meetings Booked     = total rows
 * - Meeting Happened          = rows where Remarks = 'Completed'
 * - Meeting Happened %        = (Meeting Happened / Total) * 100
 * - No Show Count             = Lead Status='No Show' (regardless of Remarks)
 * - No Show %                 = (No Show / Meeting Happened) * 100
 * - Not Right Fit Count       = Lead Status='Not a Right Fitment' AND Remarks='Completed'
 * - Not Right Fit %           = (Not Right Fit / Meeting Happened) * 100
 * - Not Interested/Not Ready  = Lead Status IN those values AND Remarks='Completed'
 * - Not Interested %          = (Not Interested / Meeting Happened) * 100
 * - Quality Lead              = Meeting Happened - (No Show + Not Right Fit + Not Interested)
 * - Quality Lead %            = (Quality Lead / Meeting Happened) * 100
 * - Closure Rate Count        = Lead Status='Proposal Won' AND Remarks='Completed'
 * - Closure Rate %            = (Closure Count / Quality Lead) * 100
 * - In Progress Count         = Lead Status='In Progress' AND Remarks='Completed'
 * - In Progress %             = (In Progress / Quality Lead) * 100
 * - Follow Up Count           = Lead Status='Follow Up' AND Remarks='Completed'
 * - Follow Up %               = (Follow Up / Quality Lead) * 100
 * - Request Access Count      = Lead Status='Request Access' AND Remarks='Completed'
 * - Request Access %          = (Request Access / Quality Lead) * 100
 */
// ─── SERVICES QUALITY BREAKDOWN ───────────────────────────────────────────────
/**
 * For each service, among Quality Lead rows only (Completed + not excluded):
 *  In Progress, Proposal Won, Proposal Lost, Request Access, Follow Up, Not Ready Now
 *  + count and % of each status out of that service's quality lead total
 */
function calcServiceQualityBreakdown(qualityRows) {
  const svcMap = {};
  qualityRows.forEach(r => {
    const svc = norm(r.services) || 'Unknown';
    if (!svcMap[svc]) svcMap[svc] = [];
    svcMap[svc].push(r);
  });

  return Object.entries(svcMap).map(([service, rows]) => {
    const total        = rows.length;
    const inProgress   = rows.filter(r => STATUS.IN_PROGRESS(r.leadStatus)).length;
    const won          = rows.filter(r => STATUS.PROPOSAL_WON(r.leadStatus)).length;
    const lost         = rows.filter(r => STATUS.PROPOSAL_LOST(r.leadStatus)).length;
    const requestAccess= rows.filter(r => STATUS.REQUEST_ACCESS(r.leadStatus)).length;
    const followUp     = rows.filter(r => STATUS.FOLLOW_UP(r.leadStatus)).length;
    const notReadyNow  = rows.filter(r => r.leadStatus === 'not ready now').length;
    return {
      service, total,
      inProgress,   inProgressPct:    pct(inProgress, total),
      won,          wonPct:           pct(won, total),
      lost,         lostPct:          pct(lost, total),
      requestAccess,requestAccessPct: pct(requestAccess, total),
      followUp,     followUpPct:      pct(followUp, total),
      notReadyNow,  notReadyNowPct:   pct(notReadyNow, total),
    };
  }).sort((a, b) => b.total - a.total);
}

const IS_EXCLUDED_FROM_QUALITY = r =>
  STATUS.NO_SHOW(r.leadStatus) ||
  STATUS.NOT_RIGHT_FIT(r.leadStatus) ||
  STATUS.NOT_INTERESTED(r.leadStatus) ||
  STATUS.CANCELLED(r.leadStatus);

function calcOutboundMetrics(rows) {
  const total           = rows.length;
  const happened        = rows.filter(r => REMARKS_COMPLETED(r.remarks));
  const meetingHappened = happened.length;

  // No Show: purely from Lead Status column across ALL rows
  const noShow          = rows.filter(r => STATUS.NO_SHOW(r.leadStatus)).length;
  // Not Right Fit & Not Interested: only among Completed rows
  const notRightFit     = happened.filter(r => STATUS.NOT_RIGHT_FIT(r.leadStatus)).length;
  const notInterested   = happened.filter(r => STATUS.NOT_INTERESTED(r.leadStatus)).length;

  // Quality Lead = Completed rows that are NOT excluded — direct positive filter, never negative
  const qualityLeadRows = happened.filter(r => !IS_EXCLUDED_FROM_QUALITY(r));
  const qualityLead     = qualityLeadRows.length;

  const closureCount    = qualityLeadRows.filter(r => STATUS.PROPOSAL_WON(r.leadStatus)).length;
  const inProgress      = qualityLeadRows.filter(r => STATUS.IN_PROGRESS(r.leadStatus)).length;
  const followUp        = qualityLeadRows.filter(r => STATUS.FOLLOW_UP(r.leadStatus)).length;
  const requestAccess   = qualityLeadRows.filter(r => STATUS.REQUEST_ACCESS(r.leadStatus)).length;

  return {
    total,
    meetingHappened,
    meetingHappenedPct:  pct(meetingHappened, total),
    noShow,
    noShowPct:           pct(noShow, total),
    notRightFit,
    notRightFitPct:      pct(notRightFit, meetingHappened),
    notInterested,
    notInterestedPct:    pct(notInterested, meetingHappened),
    qualityLead,
    qualityLeadPct:      pct(qualityLead, meetingHappened),
    closureCount,
    closureRatePct:      pct(closureCount, qualityLead),
    inProgress,
    inProgressPct:       pct(inProgress, qualityLead),
    followUp,
    followUpPct:         pct(followUp, qualityLead),
    requestAccess,
    requestAccessPct:    pct(requestAccess, qualityLead),
  };
}

/**
 * SALESPERSON REPORT FORMULAS:
 * - Total Meetings             = rows assigned to that salesperson AND Remarks='Completed'
 * - Total Valid Meetings        = Total - (No Show + Not Right Fit + Not Ready Now + Not Interested) where Remarks='Completed'
 * - Closure Count              = Lead Status='Proposal Won' AND Remarks='Completed'
 * - Closure %                  = (Closure / Total Valid) * 100
 * - Request Access Count       = Lead Status='Request Access' AND Remarks='Completed'
 * - Request Access %           = (Request Access / Total Valid) * 100
 * - Follow Up Count            = Lead Status='Follow Up' AND Remarks='Completed'
 * - Follow Up %                = (Follow Up / Total Valid) * 100
 * - In Progress Count          = Lead Status='In Progress' AND Remarks='Completed'
 * - In Progress %              = (In Progress / Total Valid) * 100
 */
function calcSalesMetrics(rows) {
  // Sales only counts rows where Remarks='Completed'
  const completed     = rows.filter(r => REMARKS_COMPLETED(r.remarks));
  const total         = completed.length;

  // Valid = Completed rows that are NOT excluded (same logic as Quality Lead)
  const validRows     = completed.filter(r => !IS_EXCLUDED_FROM_QUALITY(r));
  const validMeetings = validRows.length;

  const closureCount  = validRows.filter(r => STATUS.PROPOSAL_WON(r.leadStatus)).length;
  const requestAccess = validRows.filter(r => STATUS.REQUEST_ACCESS(r.leadStatus)).length;
  const followUp      = validRows.filter(r => STATUS.FOLLOW_UP(r.leadStatus)).length;
  const inProgress    = validRows.filter(r => STATUS.IN_PROGRESS(r.leadStatus)).length;

  return {
    total,
    validMeetings,
    closureCount,
    closurePct:        pct(closureCount, validMeetings),
    requestAccess,
    requestAccessPct:  pct(requestAccess, validMeetings),
    followUp,
    followUpPct:       pct(followUp, validMeetings),
    inProgress,
    inProgressPct:     pct(inProgress, validMeetings),
  };
}

// ─── CHART COLORS ─────────────────────────────────────────────────────────────
const PALETTE = ['#6366f1','#22d3ee','#f59e0b','#10b981','#f43f5e','#a78bfa','#fb923c','#34d399'];

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, accent = '#6366f1' }) {
  return (
    <div style={{
      background: '#1e1e2e', borderRadius: 12, padding: '18px 20px',
      display: 'flex', alignItems: 'center', gap: 14,
      border: `1px solid #2a2a3e`, boxShadow: '0 2px 12px #0004'
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: accent + '22', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accent, flexShrink: 0
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 style={{
      fontSize: 16, fontWeight: 600, color: '#a5b4fc',
      margin: '28px 0 12px', textTransform: 'uppercase',
      letterSpacing: 2, borderLeft: '3px solid #6366f1', paddingLeft: 10
    }}>{children}</h2>
  );
}

const TH = ({ children }) => (
  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11,
    color: '#888', textTransform: 'uppercase', letterSpacing: 1,
    background: '#16161f', fontWeight: 600, whiteSpace: 'nowrap' }}>
    {children}
  </th>
);
const TD = ({ children, bold, center }) => (
  <td style={{ padding: '9px 14px', fontSize: 13, color: bold ? '#f1f5f9' : '#aaa',
    fontWeight: bold ? 600 : 400, textAlign: center ? 'center' : 'left',
    borderBottom: '1px solid #1e1e2e', whiteSpace: 'nowrap' }}>
    {children}
  </td>
);

function PctBadge({ value }) {
  const color = value >= 60 ? '#10b981' : value >= 30 ? '#f59e0b' : '#f43f5e';
  return (
    <span style={{
      background: color + '22', color, borderRadius: 6,
      padding: '2px 8px', fontSize: 12, fontWeight: 600
    }}>{value}%</span>
  );
}

// ─── OUTBOUND REP TABLE ───────────────────────────────────────────────────────
function OutboundTable({ title, data }) {
  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a3e', marginBottom: 24 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #2a2a3e' }}>
        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>{title}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <TH>Rep</TH>
              <TH>Total Booked</TH>
              <TH>Happened</TH>
              <TH>Happened%</TH>
              <TH>No Show</TH>
              <TH>No Show%</TH>
              <TH>Not Right Fit</TH>
              <TH>Not Fit%</TH>
              <TH>Not Interested</TH>
              <TH>Not Int%</TH>
              <TH>Quality Lead</TH>
              <TH>Quality%</TH>
              <TH>Won</TH>
              <TH>Closure%</TH>
              <TH>In Progress</TH>
              <TH>Prog%</TH>
              <TH>Follow Up</TH>
              <TH>FU%</TH>
              <TH>Req Access</TH>
              <TH>RA%</TH>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={r.name} style={{ background: i % 2 === 0 ? '#1a1a2e' : '#1e1e2e' }}>
                <TD bold>{r.name}</TD>
                <TD center>{r.total}</TD>
                <TD center>{r.meetingHappened}</TD>
                <TD center><PctBadge value={r.meetingHappenedPct}/></TD>
                <TD center>{r.noShow}</TD>
                <TD center><PctBadge value={r.noShowPct}/></TD>
                <TD center>{r.notRightFit}</TD>
                <TD center><PctBadge value={r.notRightFitPct}/></TD>
                <TD center>{r.notInterested}</TD>
                <TD center><PctBadge value={r.notInterestedPct}/></TD>
                <TD center bold>{r.qualityLead}</TD>
                <TD center><PctBadge value={r.qualityLeadPct}/></TD>
                <TD center bold>{r.closureCount}</TD>
                <TD center><PctBadge value={r.closureRatePct}/></TD>
                <TD center>{r.inProgress}</TD>
                <TD center><PctBadge value={r.inProgressPct}/></TD>
                <TD center>{r.followUp}</TD>
                <TD center><PctBadge value={r.followUpPct}/></TD>
                <TD center>{r.requestAccess}</TD>
                <TD center><PctBadge value={r.requestAccessPct}/></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SALESPERSON TABLE ────────────────────────────────────────────────────────
function SalesTable({ title, data }) {
  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a3e', marginBottom: 24 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #2a2a3e' }}>
        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>{title}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <TH>Salesperson</TH>
              <TH>Total Meetings</TH>
              <TH>Valid Meetings</TH>
              <TH>Won</TH>
              <TH>Closure%</TH>
              <TH>Req Access</TH>
              <TH>RA%</TH>
              <TH>Follow Up</TH>
              <TH>FU%</TH>
              <TH>In Progress</TH>
              <TH>Prog%</TH>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={r.name} style={{ background: i % 2 === 0 ? '#1a1a2e' : '#1e1e2e' }}>
                <TD bold>{r.name}</TD>
                <TD center>{r.total}</TD>
                <TD center bold>{r.validMeetings}</TD>
                <TD center bold>{r.closureCount}</TD>
                <TD center><PctBadge value={r.closurePct}/></TD>
                <TD center>{r.requestAccess}</TD>
                <TD center><PctBadge value={r.requestAccessPct}/></TD>
                <TD center>{r.followUp}</TD>
                <TD center><PctBadge value={r.followUpPct}/></TD>
                <TD center>{r.inProgress}</TD>
                <TD center><PctBadge value={r.inProgressPct}/></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SALES BY OUTBOUND BREAKDOWN ──────────────────────────────────────────────
function SalesByOutboundTable({ rows }) {
  const outboundReps = OUTBOUND_TABS;
  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a3e', marginBottom: 24 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #2a2a3e' }}>
        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>
          Salesperson Performance by Outbound Rep
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <TH>Salesperson</TH>
              {outboundReps.map(rep => <TH key={rep}>{rep} (Valid / Won)</TH>)}
              <TH>Total Valid</TH>
              <TH>Total Won</TH>
            </tr>
          </thead>
          <tbody>
            {SALES_PERSONS.map((sp, i) => {
              const spRows = rows.filter(r => normL(r.salesPerson) === normL(sp));
              let totalValid = 0, totalWon = 0;
              return (
                <tr key={sp} style={{ background: i % 2 === 0 ? '#1a1a2e' : '#1e1e2e' }}>
                  <TD bold>{sp}</TD>
                  {outboundReps.map(rep => {
                    const repRows = spRows.filter(r => r.outboundRep === rep);
                    const m = calcSalesMetrics(repRows);
                    totalValid += m.validMeetings;
                    totalWon   += m.closureCount;
                    return (
                      <TD key={rep} center>
                        <span style={{ color: '#a5b4fc' }}>{m.validMeetings}</span>
                        <span style={{ color: '#555', margin: '0 4px' }}>/</span>
                        <span style={{ color: '#10b981', fontWeight: 700 }}>{m.closureCount}</span>
                      </TD>
                    );
                  })}
                  <TD center bold>{totalValid}</TD>
                  <TD center bold>{totalWon}</TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SERVICES QUALITY BREAKDOWN TABLE & MINI DASHBOARD ──────────────────────
function ServicesQualitySection({ qualityRows }) {
  const data = calcServiceQualityBreakdown(qualityRows);
  const total = qualityRows.length;

  // Bar chart data — each service as a bar group
  const chartData = data.map(d => ({
    name: d.service.replace(' - ', '\n'),
    'In Progress': d.inProgress,
    'Won':         d.won,
    'Lost':        d.lost,
    'Req Access':  d.requestAccess,
    'Follow Up':   d.followUp,
    'Not Ready':   d.notReadyNow,
  }));

  const STATUS_COLORS = {
    'In Progress': '#6366f1',
    'Won':         '#10b981',
    'Lost':        '#f43f5e',
    'Req Access':  '#a78bfa',
    'Follow Up':   '#22d3ee',
    'Not Ready':   '#fb923c',
  };

  return (
    <div>
      {/* Mini stat cards per service */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 10, marginBottom: 20 }}>
        {data.map(d => (
          <div key={d.service} style={{
            background: '#1e1e2e', borderRadius: 10, padding: '14px 16px',
            border: '1px solid #2a2a3e'
          }}>
            <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              {d.service}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9' }}>{d.total}</div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
              {pct(d.total, total)}% of quality leads
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                { label: 'In Progress', val: d.inProgress, pct: d.inProgressPct,   color: '#6366f1' },
                { label: 'Won',         val: d.won,        pct: d.wonPct,           color: '#10b981' },
                { label: 'Lost',        val: d.lost,       pct: d.lostPct,          color: '#f43f5e' },
                { label: 'Req Access',  val: d.requestAccess, pct: d.requestAccessPct, color: '#a78bfa' },
                { label: 'Follow Up',   val: d.followUp,   pct: d.followUpPct,      color: '#22d3ee' },
                { label: 'Not Ready',   val: d.notReadyNow,pct: d.notReadyNowPct,   color: '#fb923c' },
              ].map(s => s.val > 0 && (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: s.color }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: '#aaa' }}>
                    {s.val} <span style={{ color: '#555' }}>({s.pct}%)</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Stacked bar chart */}
      <div style={{ background: '#1e1e2e', borderRadius: 12, padding: 20,
        border: '1px solid #2a2a3e', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: 16 }}>
          Quality Lead Status by Service
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e"/>
            <XAxis dataKey="name" stroke="#555" tick={{ fill: '#888', fontSize: 11 }}
              angle={-25} textAnchor="end" interval={0}/>
            <YAxis stroke="#555" tick={{ fill: '#888', fontSize: 11 }}/>
            <Tooltip contentStyle={{ background: '#1e1e2e', border: '1px solid #3a3a5e', borderRadius: 8 }}/>
            <Legend wrapperStyle={{ fontSize: 12, color: '#888', paddingTop: 16 }}/>
            {Object.entries(STATUS_COLORS).map(([key, color]) => (
              <Bar key={key} dataKey={key} stackId="a" fill={color}/>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed table */}
      <div style={{ background: '#1a1a2e', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a3e' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <TH>Service</TH>
                <TH>Quality Leads</TH>
                <TH>% of Total</TH>
                <TH>In Progress</TH>
                <TH>IP%</TH>
                <TH>Proposal Won</TH>
                <TH>Won%</TH>
                <TH>Proposal Lost</TH>
                <TH>Lost%</TH>
                <TH>Request Access</TH>
                <TH>RA%</TH>
                <TH>Follow Up</TH>
                <TH>FU%</TH>
                <TH>Not Ready Now</TH>
                <TH>NRN%</TH>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={r.service} style={{ background: i % 2 === 0 ? '#1a1a2e' : '#1e1e2e' }}>
                  <TD bold>{r.service}</TD>
                  <TD center bold>{r.total}</TD>
                  <TD center><PctBadge value={pct(r.total, total)}/></TD>
                  <TD center>{r.inProgress}</TD>
                  <TD center><PctBadge value={r.inProgressPct}/></TD>
                  <TD center bold>{r.won}</TD>
                  <TD center><PctBadge value={r.wonPct}/></TD>
                  <TD center>{r.lost}</TD>
                  <TD center><PctBadge value={r.lostPct}/></TD>
                  <TD center>{r.requestAccess}</TD>
                  <TD center><PctBadge value={r.requestAccessPct}/></TD>
                  <TD center>{r.followUp}</TD>
                  <TD center><PctBadge value={r.followUpPct}/></TD>
                  <TD center>{r.notReadyNow}</TD>
                  <TD center><PctBadge value={r.notReadyNowPct}/></TD>
                </tr>
              ))}
              {/* Totals row */}
              <tr style={{ background: '#16161f', borderTop: '2px solid #3a3a5e' }}>
                <TD bold>TOTAL</TD>
                <TD center bold>{total}</TD>
                <TD center><PctBadge value={100}/></TD>
                <TD center bold>{data.reduce((s,r)=>s+r.inProgress,0)}</TD>
                <TD center><PctBadge value={pct(data.reduce((s,r)=>s+r.inProgress,0), total)}/></TD>
                <TD center bold>{data.reduce((s,r)=>s+r.won,0)}</TD>
                <TD center><PctBadge value={pct(data.reduce((s,r)=>s+r.won,0), total)}/></TD>
                <TD center bold>{data.reduce((s,r)=>s+r.lost,0)}</TD>
                <TD center><PctBadge value={pct(data.reduce((s,r)=>s+r.lost,0), total)}/></TD>
                <TD center bold>{data.reduce((s,r)=>s+r.requestAccess,0)}</TD>
                <TD center><PctBadge value={pct(data.reduce((s,r)=>s+r.requestAccess,0), total)}/></TD>
                <TD center bold>{data.reduce((s,r)=>s+r.followUp,0)}</TD>
                <TD center><PctBadge value={pct(data.reduce((s,r)=>s+r.followUp,0), total)}/></TD>
                <TD center bold>{data.reduce((s,r)=>s+r.notReadyNow,0)}</TD>
                <TD center><PctBadge value={pct(data.reduce((s,r)=>s+r.notReadyNow,0), total)}/></TD>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── LEAD DETAILS TABLE ───────────────────────────────────────────────────────
function LeadTable({ rows }) {
  const statusColor = ls => {
    if (STATUS.PROPOSAL_WON(ls))    return '#10b981';  // green
    if (STATUS.PROPOSAL_LOST(ls))   return '#f43f5e';  // red
    if (STATUS.NO_SHOW(ls))         return '#ef4444';  // red
    if (STATUS.CANCELLED(ls))       return '#dc2626';  // dark red
    if (STATUS.NOT_RIGHT_FIT(ls))   return '#f59e0b';  // amber
    if (STATUS.NOT_INTERESTED(ls))  return '#fb923c';  // orange
    if (STATUS.IN_PROGRESS(ls))     return '#6366f1';  // indigo
    if (STATUS.FOLLOW_UP(ls))       return '#22d3ee';  // cyan
    if (STATUS.REQUEST_ACCESS(ls))  return '#a78bfa';  // purple
    return '#888';
  };
  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a3e' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <TH>Rep</TH><TH>Company</TH><TH>Lead Status</TH>
              <TH>Remarks</TH><TH>Sales Person</TH><TH>Services</TH><TH>Meeting On</TH>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 150).map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 === 0 ? '#1a1a2e' : '#1e1e2e' }}>
                <TD>{r.outboundRep}</TD>
                <TD bold>{r.company || r.name}</TD>
                <TD>
                  <span style={{
                    background: statusColor(r.leadStatus) + '22',
                    color: statusColor(r.leadStatus),
                    borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600
                  }}>{r.leadStatus || 'Blank'}</span>
                </TD>
                <TD>
                  <span style={{
                    background: REMARKS_COMPLETED(r.remarks) ? '#10b98122' : '#88888822',
                    color: REMARKS_COMPLETED(r.remarks) ? '#10b981' : '#888',
                    borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600
                  }}>{r.remarks || '—'}</span>
                </TD>
                <TD>{r.salesPerson}</TD>
                <TD>{r.services}</TD>
                <TD>{r.meetingOn}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 150 && (
        <div style={{ padding: '10px 20px', color: '#666', fontSize: 12 }}>
          Showing 150 of {rows.length} rows
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function App() {
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [errors, setErrors]         = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeView, setActiveView] = useState('overall'); // 'overall' | rep name
  const [filter, setFilter]         = useState({ salesperson: 'All', status: 'All', search: '' });

  async function load() {
    setLoading(true); setErrors([]);
    const results = await Promise.allSettled(OUTBOUND_TABS.map(fetchTab));
    setRows(results.flatMap(r => r.status === 'fulfilled' ? r.value : []));
    setErrors(results.filter(r => r.status === 'rejected').map(r => r.reason.message));
    setLastUpdated(new Date()); setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Rows for current view (all reps or single rep)
  const viewRows = useMemo(() =>
    activeView === 'overall' ? rows : rows.filter(r => r.outboundRep === activeView),
  [rows, activeView]);

  // Apply filters
  const filtered = useMemo(() => viewRows.filter(r =>
    (filter.salesperson === 'All' || normL(r.salesPerson) === normL(filter.salesperson)) &&
    (filter.status === 'All' || r.leadStatus === filter.status) &&
    (!filter.search || [r.company, r.name, r.leadStatus, r.salesPerson, r.services, r.remarks]
      .join(' ').toLowerCase().includes(filter.search.toLowerCase()))
  ), [viewRows, filter]);

  // Outbound report data
  const outboundTableData = useMemo(() => {
    if (activeView === 'overall') {
      // All reps + overall row
      const perRep = OUTBOUND_TABS.map(rep => ({
        name: rep,
        ...calcOutboundMetrics(filtered.filter(r => r.outboundRep === rep))
      }));
      const overall = { name: 'OVERALL', ...calcOutboundMetrics(filtered) };
      return [...perRep, overall];
    } else {
      return [{ name: activeView, ...calcOutboundMetrics(filtered) }];
    }
  }, [filtered, activeView]);

  // Salesperson report data
  const salesTableData = useMemo(() => {
    const allSPs = [...new Set(filtered.map(r => norm(r.salesPerson)).filter(Boolean))];
    const perSP = allSPs.map(sp => ({
      name: sp,
      ...calcSalesMetrics(filtered.filter(r => normL(r.salesPerson) === normL(sp)))
    })).sort((a, b) => b.total - a.total);
    const overall = { name: 'OVERALL', ...calcSalesMetrics(filtered) };
    return [...perSP, overall];
  }, [filtered]);

  // Quality Lead rows — Completed + not excluded — used for services breakdown
  const qualityLeadRows = useMemo(() =>
    filtered
      .filter(r => REMARKS_COMPLETED(r.remarks))
      .filter(r => !IS_EXCLUDED_FROM_QUALITY(r)),
  [filtered]);

  // Summary stats (overall)
  const totals = useMemo(() => calcOutboundMetrics(filtered), [filtered]);

  // Status breakdown for pie chart
  const statusPie = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const k = r.leadStatus || 'Blank';
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Meeting trend (by meetingOn date)
  const trend = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const k = r.meetingOn || r.date || 'No Date';
      if (!map[k]) map[k] = { name: k, total: 0, happened: 0, quality: 0, won: 0 };
      map[k].total++;
      if (REMARKS_COMPLETED(r.remarks)) {
        map[k].happened++;
        if (!STATUS.NO_SHOW(r.leadStatus) && !STATUS.NOT_RIGHT_FIT(r.leadStatus) && !STATUS.NOT_INTERESTED(r.leadStatus))
          map[k].quality++;
        if (STATUS.PROPOSAL_WON(r.leadStatus)) map[k].won++;
      }
    });
    return Object.values(map).filter(d => d.name !== 'No Date').slice(-30);
  }, [filtered]);

  // Unique statuses for filter
  const uniqueStatuses = useMemo(() =>
    ['All', ...[...new Set(rows.map(r => r.leadStatus).filter(Boolean))].sort()],
  [rows]);

  const exportCsv = () => {
    const header = ['Rep','Company','Name','Lead Status','Remarks','Sales Person','Services','Meeting On','Revenue'];
    const body   = filtered.map(r => [r.outboundRep,r.company,r.name,r.leadStatus,r.remarks,r.salesPerson,r.services,r.meetingOn,r.revenue]);
    const csv    = [header,...body].map(row => row.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = `dashboard-${activeView}-export.csv`; a.click();
  };

  const btnStyle = (active) => ({
    padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
    fontWeight: 600, transition: 'all .15s',
    background: active ? '#6366f1' : '#2a2a3e',
    color: active ? '#fff' : '#888',
  });

  return (
    <div style={{ background: '#12121c', minHeight: '100vh', color: '#e2e8f0', fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      {/* HEADER */}
      <div style={{
        background: 'linear-gradient(135deg,#1e1e3a 0%,#1a1a2e 100%)',
        borderBottom: '1px solid #2a2a3e', padding: '20px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: -0.5 }}>
            2026 Meeting Details Dashboard
          </h1>
          <p style={{ margin: '4px 0 0', color: '#6366f1', fontSize: 13 }}>
            Live outbound & sales reporting · {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>
        <button onClick={load} style={{
          ...btnStyle(false), display: 'flex', alignItems: 'center', gap: 6
        }}>
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}/>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* ERRORS */}
        {errors.length > 0 && (
          <div style={{ background: '#f43f5e22', border: '1px solid #f43f5e44', borderRadius: 10,
            padding: '12px 16px', marginBottom: 16, color: '#f43f5e', fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16}/> Some tabs could not load: {errors.join(', ')}
          </div>
        )}

        {/* VIEW SWITCHER */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          <button style={btnStyle(activeView === 'overall')} onClick={() => setActiveView('overall')}>Overall</button>
          {OUTBOUND_TABS.map(rep => (
            <button key={rep} style={btnStyle(activeView === rep)} onClick={() => setActiveView(rep)}>{rep}</button>
          ))}
        </div>

        {/* FILTERS */}
        <div style={{ background: '#1e1e2e', borderRadius: 10, padding: '14px 18px',
          display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
          marginBottom: 24, border: '1px solid #2a2a3e' }}>
          <Filter size={15} color="#6366f1"/>
          <select value={filter.salesperson}
            onChange={e => setFilter({...filter, salesperson: e.target.value})}
            style={{ background: '#2a2a3e', color: '#ccc', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
            <option>All</option>
            {SALES_PERSONS.map(sp => <option key={sp}>{sp}</option>)}
          </select>
          <select value={filter.status}
            onChange={e => setFilter({...filter, status: e.target.value})}
            style={{ background: '#2a2a3e', color: '#ccc', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
            {uniqueStatuses.map(s => <option key={s}>{s}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            background: '#2a2a3e', borderRadius: 6, padding: '0 10px', flex: 1, minWidth: 200 }}>
            <Search size={13} color="#666"/>
            <input placeholder="Search company, status, remarks..."
              value={filter.search}
              onChange={e => setFilter({...filter, search: e.target.value})}
              style={{ background: 'none', border: 'none', color: '#ccc', padding: '7px 0',
                outline: 'none', fontSize: 13, width: '100%' }}/>
          </div>
          <button onClick={exportCsv} style={{
            ...btnStyle(false), display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Download size={13}/> Export CSV
          </button>
        </div>

        {/* STAT CARDS — Row 1: Meeting funnel */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: 12, marginBottom: 12 }}>
          <StatCard label="Total Booked" value={totals.total} icon={<Users size={20}/>} accent="#6366f1"/>
          <StatCard label="Meeting Happened" value={totals.meetingHappened}
            sub={`${totals.meetingHappenedPct}% of total`} icon={<UserCheck size={20}/>} accent="#22d3ee"/>
          <StatCard label="Quality Leads" value={totals.qualityLead}
            sub={`${totals.qualityLeadPct}% of happened`} icon={<Target size={20}/>} accent="#10b981"/>
          <StatCard label="Proposal Won" value={totals.closureCount}
            sub={`${totals.closureRatePct}% closure rate`} icon={<Trophy size={20}/>} accent="#f59e0b"/>
          <StatCard label="In Progress" value={totals.inProgress}
            sub={`${totals.inProgressPct}% of quality`} icon={<TrendingUp size={20}/>} accent="#a78bfa"/>
        </div>
        {/* STAT CARDS — Row 2: Disqualified / pipeline */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: 12, marginBottom: 28 }}>
          <StatCard label="No Show" value={totals.noShow}
            sub={`${totals.noShowPct}% of total`} icon={<XCircle size={20}/>} accent="#f43f5e"/>
          <StatCard label="Not a Right Fitment" value={totals.notRightFit}
            sub={`${totals.notRightFitPct}% of happened`} icon={<XCircle size={20}/>} accent="#f59e0b"/>
          <StatCard label="Not Interested / Not Ready" value={totals.notInterested}
            sub={`${totals.notInterestedPct}% of happened`} icon={<XCircle size={20}/>} accent="#fb923c"/>
          <StatCard label="Request Access" value={totals.requestAccess}
            sub={`${totals.requestAccessPct}% of quality`} icon={<Target size={20}/>} accent="#a78bfa"/>
          <StatCard label="Follow Up" value={totals.followUp}
            sub={`${totals.followUpPct}% of quality`} icon={<TrendingUp size={20}/>} accent="#22d3ee"/>
        </div>

        {/* CHARTS */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
          <div style={{ background: '#1e1e2e', borderRadius: 12, padding: '20px', border: '1px solid #2a2a3e' }}>
            <div style={{ fontWeight: 700, marginBottom: 16, color: '#e2e8f0' }}>Quality Lead Breakdown</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={outboundTableData.filter(r => r.name !== 'OVERALL')}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e"/>
                <XAxis dataKey="name" stroke="#555" tick={{ fill: '#888', fontSize: 12 }}/>
                <YAxis stroke="#555" tick={{ fill: '#888', fontSize: 12 }}/>
                <Tooltip contentStyle={{ background: '#1e1e2e', border: '1px solid #3a3a5e', borderRadius: 8 }}
                  labelStyle={{ color: '#ccc' }}/>
                <Bar dataKey="meetingHappened" name="Happened" fill="#6366f1"/>
                <Bar dataKey="qualityLead" name="Quality" fill="#10b981"/>
                <Bar dataKey="closureCount" name="Won" fill="#f59e0b"/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background: '#1e1e2e', borderRadius: 12, padding: '20px', border: '1px solid #2a2a3e' }}>
            <div style={{ fontWeight: 700, marginBottom: 16, color: '#e2e8f0' }}>Lead Status Distribution</div>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" outerRadius={90} label={({name,percent})=>`${(percent*100).toFixed(0)}%`}>
                  {statusPie.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]}/>)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1e1e2e', border: '1px solid #3a3a5e', borderRadius: 8 }}/>
                <Legend wrapperStyle={{ fontSize: 12, color: '#888' }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* MEETING TREND */}
        <div style={{ background: '#1e1e2e', borderRadius: 12, padding: '20px', border: '1px solid #2a2a3e', marginBottom: 28 }}>
          <div style={{ fontWeight: 700, marginBottom: 16, color: '#e2e8f0' }}>Meeting Trend</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e"/>
              <XAxis dataKey="name" stroke="#555" tick={{ fill: '#888', fontSize: 11 }}/>
              <YAxis stroke="#555" tick={{ fill: '#888', fontSize: 11 }}/>
              <Tooltip contentStyle={{ background: '#1e1e2e', border: '1px solid #3a3a5e', borderRadius: 8 }}/>
              <Line type="monotone" dataKey="total" stroke="#6366f1" name="Total" dot={false}/>
              <Line type="monotone" dataKey="happened" stroke="#22d3ee" name="Happened" dot={false}/>
              <Line type="monotone" dataKey="quality" stroke="#10b981" name="Quality" dot={false}/>
              <Line type="monotone" dataKey="won" stroke="#f59e0b" name="Won" dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* OUTBOUND REP REPORT */}
        <SectionTitle>Outbound Rep Report — Lead Quality</SectionTitle>
        <OutboundTable
          title={activeView === 'overall' ? 'All Outbound Reps + Overall' : `${activeView} — Lead Quality`}
          data={outboundTableData}
        />

        {/* SALESPERSON REPORT */}
        <SectionTitle>Salesperson Report</SectionTitle>
        <SalesTable
          title={`Salesperson Performance${activeView !== 'overall' ? ` (${activeView}'s meetings)` : ''}`}
          data={salesTableData}
        />

        {/* SALES BY OUTBOUND (only in overall view) */}
        {activeView === 'overall' && (
          <>
            <SectionTitle>Salesperson × Outbound Rep Breakdown</SectionTitle>
            <SalesByOutboundTable rows={filtered}/>
          </>
        )}

        {/* SERVICES QUALITY BREAKDOWN */}
        <SectionTitle>Quality Leads — Breakdown by Service ({qualityLeadRows.length} quality leads)</SectionTitle>
        <ServicesQualitySection qualityRows={qualityLeadRows}/>

        {/* LEAD DETAILS */}
        <SectionTitle>Lead Details ({filtered.length} records)</SectionTitle>
        <LeadTable rows={filtered}/>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #12121c; }
        ::-webkit-scrollbar-thumb { background: #3a3a5e; border-radius: 4px; }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
