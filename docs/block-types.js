// Summit Block System Reference — source file
// Edit the blocks array below, then run: node block-types.js
// Requires: npm install docx
// Output: Summit_Block_System.docx

const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, ShadingType } = require('docx');
const fs = require('fs');

const blocks = [
  { label: 'Base', weeks: '4–8', deload: '5–6 weeks', context: 'Foundation phase. Emphasise volume over intensity. Focus on movement quality, technique, and building work capacity. ARC climbing, density climbing, volume.', ewma: 'Normal thresholds apply.', assessment: 'General fitness baseline: max hang, bodyweight, wellness trend.' },
  { label: 'Endurance', weeks: '3–6', deload: '4–5 weeks', context: 'Build sustained output capacity. Longer routes, circuits, ARC at moderate intensity. Higher intensity than Base. Train recovery between hard moves.', ewma: 'Normal thresholds apply.', assessment: 'Critical force, endurance hang test, sustained output test.' },
  { label: 'Strength', weeks: '3–5', deload: '3–4 weeks', context: 'Work on muscular strength and build maximum finger force and recruitment. Primarily bouldering and some hangboarding. Use heavy loads with full rest between efforts. Off-wall exercise expected. Slightly elevated load ratios are expected.', ewma: 'Amber > 1.3 as usual. Slightly elevated ratios are expected during this phase — treat as a heads-up, not a stop sign.', assessment: 'Max hang, weighted pull-up, Tindeq peak force.' },
  { label: 'Power', weeks: '2–4', deload: '3–4 weeks', context: 'Develop rate of force development and explosiveness. Dynamic movement, campusing, short problems with full rest between attempts. Build on a strength foundation.', ewma: 'Normal thresholds apply.', assessment: 'Tindeq RFD, explosive pull-up.' },
  { label: 'Power Endurance', weeks: '2–4', deload: '3–4 weeks', context: 'Train sustained hard moves over longer sequences. 4x4s, circuits, 30/30 intervals. Useful for rope climbing or longer boulder problems.', ewma: 'Normal thresholds apply.', assessment: 'Critical force, endurance repeater test.' },
  { label: 'Performance / Peak', weeks: '2–6', deload: '2–3 weeks', context: 'Taper into project season. Prioritise freshness over fitness: reduce volume, maintain intensity. Focus on what gets you psyched in climbing.', ewma: 'Track ratio trending toward < 1.0 approaching target date.', assessment: 'Wellness baseline, force marker consistency.' },
  { label: 'Outdoor', weeks: 'Open', deload: 'Suppressed', context: 'Unstructured climbing outside. Load is harder to quantify — use as general context only. Antagonist nudge suppressed during this block.', ewma: 'Relaxed — load harder to quantify outdoors.', assessment: 'None required.' },
  { label: 'Deload', weeks: '1', deload: 'N/A', context: 'Active recovery. Target 40–60% of recent weekly load average. Connective tissue adapts during rest, not training.', ewma: 'Target ratio < 0.8 for the week.', assessment: 'None required.' },
  { label: 'Injury Management', weeks: 'Open', deload: '2–3 weeks', context: 'Maintain fitness while protecting the injury. Minimise finger load. Monitor pain against load carefully in the Injury Tracker.', ewma: 'Flag conservatively. Protect the injury above all else.', assessment: 'Injury pain baseline, force asymmetry, finger soreness trend.' },
];

const DISCIPLINE_PATHS = [
  { name: 'Sport Climbing / All-Around', path: 'Base → Strength → Power Endurance → Endurance → Performance → Outdoor' },
  { name: 'Bouldering', path: 'Base → Strength → Power → (Power Endurance) → Performance → Outdoor' },
];

const GENERAL_PRINCIPLES = [
  'Plan a deload week every 3–6 weeks depending on block intensity.',
  'Use pre and post-block assessments to track whether the block worked (Tindeq, RFD, max hang, etc.).',
  'Skip phases that do not apply to your goals or discipline.',
  'Treat suggested week counts as starting points — adjust based on feel and performance.',
  'EWMA thresholds stay fixed (amber > 1.3) across all blocks. Block context explains what to expect, not different rules.',
  'Finger AU tracks load on the wall only. Total AU includes all sessions. Both matter for different reasons.',
];

const COL = [1300, 800, 900, 2900, 2400, 2200];
const HEADERS = ['Block', 'Weeks', 'Deload Every', 'Context', 'EWMA / Load Behaviour', 'Assessment Focus'];

function mkHeader() {
  return new TableRow({
    tableHeader: true,
    children: HEADERS.map((h, i) => new TableCell({
      width: { size: COL[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: '1e293b' },
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, color: 'f0f6ff', size: 18, font: 'Calibri' })],
      })],
    })),
  });
}

function mkRow(b, i) {
  const fill = i % 2 === 0 ? 'ffffff' : 'f8fafc';
  const vals = [b.label, b.weeks, b.deload, b.context, b.ewma, b.assessment];
  return new TableRow({
    children: vals.map((v, ci) => new TableCell({
      width: { size: COL[ci], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: v, size: 17, font: 'Calibri', color: '1e293b', bold: ci === 0 })],
      })],
    })),
  });
}

const doc = new Document({
  sections: [{
    properties: {
      page: {
        size: { width: 20160, height: 12240 },
        margin: { top: 720, bottom: 720, left: 720, right: 720 },
      },
    },
    children: [
      new Paragraph({
        children: [new TextRun({ text: 'Summit — Block System Reference', bold: true, size: 32, font: 'Calibri', color: '0f172a' })],
        spacing: { after: 160 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Starting points, not rules. Spend more time in any phase based on your goals and weaknesses. The best training plan is one you will actually follow.', italics: true, size: 18, font: 'Calibri', color: '64748b' })],
        spacing: { after: 360 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Block Types', bold: true, size: 24, font: 'Calibri', color: '0f172a' })],
        spacing: { after: 180 },
      }),
      new Table({
        width: { size: 10500, type: WidthType.DXA },
        columnWidths: COL,
        rows: [mkHeader(), ...blocks.map((b, i) => mkRow(b, i))],
      }),
      new Paragraph({ children: [], spacing: { after: 400 } }),
      new Paragraph({
        children: [new TextRun({ text: 'Discipline Paths', bold: true, size: 24, font: 'Calibri', color: '0f172a' })],
        spacing: { after: 180 },
      }),
      ...DISCIPLINE_PATHS.map(({ name, path }) => new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: `${name}:  `, bold: true, size: 18, font: 'Calibri', color: '0f172a' }),
          new TextRun({ text: path, size: 18, font: 'Calibri', color: '0369a1' }),
        ],
      })),
      new Paragraph({ children: [], spacing: { after: 300 } }),
      new Paragraph({
        children: [new TextRun({ text: 'General Principles', bold: true, size: 24, font: 'Calibri', color: '0f172a' })],
        spacing: { after: 180 },
      }),
      ...GENERAL_PRINCIPLES.map(t => new Paragraph({
        spacing: { after: 90 },
        children: [new TextRun({ text: `• ${t}`, size: 18, font: 'Calibri', color: '1e293b' })],
      })),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('Summit_Block_System.docx', buf);
  console.log('Done — Summit_Block_System.docx generated');
}).catch(e => console.error(e));
