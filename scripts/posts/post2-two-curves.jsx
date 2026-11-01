// Kinetix - Instagram post 02 - "Same website. Two curves."
// 1080x1920 - 60 fps - 18 s. Builds the whole piece in an empty project.
// Run: AfterFX.exe -r scripts/posts/post2-two-curves.jsx
(function () {
  var ROOT = new File($.fileName).parent.parent.parent.absoluteURI + '/';
  var LIB = new File(ROOT + 'public/sfx/lib').fsName + '\\';
  var LOG = [];
  function log(s) { LOG.push(s); }
  function writeLog() { var f = new File(ROOT + 'scripts/out/post2-log.txt'); f.encoding = 'UTF-8'; f.open('w'); f.write(LOG.join('\n')); f.close(); }

  // --------- palette & type ---------
  function hex(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255]; }
  var C = {
    bg: hex('#0A0A0B'), surface: hex('#141416'), surface2: hex('#1C1C1F'), line: hex('#2A2A2E'), dot: hex('#3A3A3E'),
    text: hex('#F2EFE9'), muted: hex('#8A8780'), faint: hex('#55534F'), gold: hex('#D4A64A'), gold2: hex('#F1D28A'), ink: hex('#111111')
  };
  var F = { display: 'ClashDisplayVariable-Semibold', displayMed: 'ClashDisplayVariable-Medium', serif: 'PPFragment-GlareLight', ui: 'Inter-Medium', uiReg: 'Inter-Regular', uiBold: 'Inter-SemiBold', mono: 'CascadiaMono-Regular' };

  var W = 1080, H = 1920, FPS = 60, DUR = 18;
  var EXPO = [0.16, 1, 0.3, 1], INOUT = [0.65, 0, 0.35, 1], SCROLL = [0.22, 1, 0.36, 1], OUTQ = [0.25, 1, 0.5, 1];

  // --------- helpers ---------
  function text(comp, str, font, size, color, pos, just, tracking, name) {
    var L = comp.layers.addText(str);
    var p = L.property('ADBE Text Properties').property('ADBE Text Document');
    var d = p.value;
    d.resetCharStyle();
    d.font = font; d.fontSize = size; d.applyFill = true; d.fillColor = color; d.applyStroke = false;
    d.justification = just === 'right' ? ParagraphJustification.RIGHT_JUSTIFY : just === 'center' ? ParagraphJustification.CENTER_JUSTIFY : ParagraphJustification.LEFT_JUSTIFY;
    d.tracking = tracking || 0;
    p.setValue(d);
    L.property('ADBE Transform Group').property('ADBE Position').setValue(pos);
    if (name) L.name = name;
    return L;
  }
  function shapeLayer(comp, name, pos) {
    var L = comp.layers.addShape();
    L.name = name;
    L.property('ADBE Transform Group').property('ADBE Position').setValue(pos);
    return L;
  }
  function group(L, name) {
    var g = L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    g.name = name || 'Group';
    return g;
  }
  function addRect(g, w, h, r) {
    var R = g.property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Rect');
    R.property('ADBE Vector Rect Size').setValue([w, h]);
    R.property('ADBE Vector Rect Roundness').setValue(r || 0);
    return R;
  }
  function addEllipse(g, w, h) {
    var E = g.property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Ellipse');
    E.property('ADBE Vector Ellipse Size').setValue([w, h]);
    return E;
  }
  function addPath(g, verts, closed, inT, outT) {
    var P = g.property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Group');
    var s = new Shape();
    s.vertices = verts; s.closed = !!closed;
    if (inT) s.inTangents = inT;
    if (outT) s.outTangents = outT;
    P.property('ADBE Vector Shape').setValue(s);
    return P;
  }
  function addFill(g, color) { var f = g.property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Fill'); f.property('ADBE Vector Fill Color').setValue(color); return f; }
  function addStroke(g, color, w) {
    var s = g.property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Stroke');
    s.property('ADBE Vector Stroke Color').setValue(color);
    s.property('ADBE Vector Stroke Width').setValue(w);
    try { s.property('ADBE Vector Stroke Line Cap').setValue(2); s.property('ADBE Vector Stroke Line Join').setValue(2); } catch (e) {}
    return s;
  }
  function addTrim(L) { return L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Filter - Trim'); }
  function tf(L, n) { return L.property('ADBE Transform Group').property(n); }
  function P(L) { return tf(L, 'ADBE Position'); }
  function S(L) { return tf(L, 'ADBE Scale'); }
  function O(L) { return tf(L, 'ADBE Opacity'); }
  function R(L) { return tf(L, 'ADBE Rotate Z'); }

  /** Keyframes with an easing per segment: 'linear', 'hold' or a cubic-bezier [x1,y1,x2,y2]. */
  function keys(prop, times, vals, eases) {
    var idx = [];
    for (var i = 0; i < times.length; i++) { prop.setValueAtTime(times[i], vals[i]); }
    for (var j = 0; j < times.length; j++) idx.push(prop.nearestKeyIndex(times[j]));
    var spatial = prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL;
    for (var k = 0; k < idx.length; k++) {
      if (spatial) { try { prop.setSpatialAutoBezierAtKey(idx[k], false); prop.setSpatialContinuousAtKey(idx[k], false); var z = vals[k] instanceof Array && vals[k].length === 3 ? [0, 0, 0] : [0, 0]; prop.setSpatialTangentsAtKey(idx[k], z, z); } catch (e0) {} }
    }
    for (var s = 0; s < idx.length - 1; s++) {
      var e = eases instanceof Array && !(typeof eases[0] === 'number') ? eases[s] : eases;
      var a = idx[s], b = idx[s + 1];
      if (e === 'linear') { prop.setInterpolationTypeAtKey(a, prop.keyInInterpolationType(a), KeyframeInterpolationType.LINEAR); prop.setInterpolationTypeAtKey(b, KeyframeInterpolationType.LINEAR, prop.keyOutInterpolationType(b)); continue; }
      if (e === 'hold') { prop.setInterpolationTypeAtKey(a, prop.keyInInterpolationType(a), KeyframeInterpolationType.HOLD); continue; }
      prop.setInterpolationTypeAtKey(a, prop.keyInInterpolationType(a), KeyframeInterpolationType.BEZIER);
      prop.setInterpolationTypeAtKey(b, KeyframeInterpolationType.BEZIER, prop.keyOutInterpolationType(b));
      var T = times[s + 1] - times[s], v1 = vals[s], v2 = vals[s + 1];
      var dims = spatial || !(v1 instanceof Array) ? 1 : v1.length;
      var D = [];
      if (spatial) { var sum = 0; for (var q = 0; q < v1.length; q++) sum += (v2[q] - v1[q]) * (v2[q] - v1[q]); D.push(Math.sqrt(sum)); }
      else if (v1 instanceof Array) { for (var q2 = 0; q2 < v1.length; q2++) D.push(v2[q2] - v1[q2]); }
      else D.push(v2 - v1);
      var x1 = Math.max(0.01, e[0]), y1 = e[1], x2 = Math.min(0.99, e[2]), y2 = e[3];
      var outE = [], inE = [];
      for (var d = 0; d < dims; d++) {
        outE.push(new KeyframeEase((y1 / x1) * D[d] / T, Math.max(0.1, Math.min(100, x1 * 100))));
        inE.push(new KeyframeEase(((1 - y2) / (1 - x2)) * D[d] / T, Math.max(0.1, Math.min(100, (1 - x2) * 100))));
      }
      prop.setTemporalEaseAtKey(a, prop.keyInTemporalEase(a), outE);
      prop.setTemporalEaseAtKey(b, inE, prop.keyOutTemporalEase(b));
    }
  }
  function mb(L) { try { L.motionBlur = true; } catch (e) {} }
  function sfx(comp, file, t, db, name) {
    var f = new File(LIB + file.replace(/\//g, '\\'));
    if (!f.exists) { log('missing sfx ' + file); return null; }
    var it = app.project.importFile(new ImportOptions(f));
    it.parentFolder = SFXF;
    var L = comp.layers.add(it);
    L.startTime = t; L.name = 'SFX ' + (name || file);
    L.property('ADBE Audio Group').property('ADBE Audio Levels').setValue([db, db]);
    L.moveToEnd();
    return L;
  }

  // --------- project guard ---------
  if (app.project.numItems > 0) { log('ABORT: project is not empty'); writeLog(); return; }
  app.beginUndoGroup('Kinetix Post 02');
  var FOLDER = app.project.items.addFolder('KX Post 02 \u2014 Two Curves');
  var SFXF = app.project.items.addFolder('SFX'); SFXF.parentFolder = FOLDER;

  // --------- the website (one builder, two easings) ---------
  function buildSite(name, eased) {
    var c = app.project.items.addComp(name, 900, 560, 1, DUR, FPS);
    c.parentFolder = FOLDER; c.motionBlur = true; c.shutterAngle = 180; c.bgColor = C.surface;
    var E = function (bez) { return eased ? bez : 'linear'; };

    // frame
    var frame = shapeLayer(c, 'Frame', [450, 280]);
    var fg = group(frame, 'Frame'); addRect(fg, 896, 556, 26); addFill(fg, C.surface); addStroke(fg, C.line, 2);
    var bar = shapeLayer(c, 'Topbar', [0, 0]);
    var bg1 = group(bar, 'Dots');
    var dx = [34, 54, 74];
    for (var i = 0; i < 3; i++) { var gd = group(bar, 'Dot ' + i); addEllipse(gd, 11, 11); addFill(gd, C.dot); gd.property('ADBE Vector Transform Group').property('ADBE Vector Position').setValue([dx[i], 30]); }
    var gu = group(bar, 'URL'); addRect(gu, 300, 22, 11); addFill(gu, C.surface2); gu.property('ADBE Vector Transform Group').property('ADBE Vector Position').setValue([450, 30]);
    var gl = group(bar, 'Line'); addPath(gl, [[2, 58], [898, 58]], false); addStroke(gl, C.line, 1.5);
    void bg1;

    // scroll root
    var scroll = c.layers.addNull(); scroll.name = 'Scroll'; P(scroll).setValue([0, 0]); tf(scroll, 'ADBE Anchor Point').setValue([0, 0]);
    function kid(L) { L.parent = scroll; mb(L); return L; }

    var logo = kid(text(c, 'SEAM.', F.display, 26, C.text, [48, 112], 'left', 10, 'Logo'));
    var menu = kid(text(c, 'Work     Studio     Contact', F.ui, 16, C.muted, [852, 110], 'right', 20, 'Menu'));
    var h1 = kid(text(c, 'Built along', F.display, 66, C.text, [48, 222], 'left', -10, 'Headline 1'));
    var h2a = kid(text(c, 'the', F.display, 66, C.text, [48, 298], 'left', -10, 'Headline 2'));
    var r = h2a.sourceRectAtTime(0, false);
    var h2b = kid(text(c, 'seams.', F.serif, 74, C.gold, [48 + r.left + r.width + 18, 298], 'left', -10, 'Headline 2 accent'));
    var sub1 = kid(text(c, 'Interfaces that keep the joint visible.', F.uiReg, 17, C.muted, [48, 348], 'left', 0, 'Sub 1'));
    var sub2 = kid(text(c, 'Designed in Tehran. Shipped worldwide.', F.uiReg, 17, C.muted, [48, 374], 'left', 0, 'Sub 2'));
    // button
    var btn = kid(shapeLayer(c, 'Button', [153, 446]));
    var bgp = group(btn, 'Pill'); addRect(bgp, 210, 58, 29); var btnFill = addFill(bgp, C.gold);
    var btnTxt = text(c, 'Start a project  \u2192', F.uiBold, 17, C.ink, [153, 452], 'center', 0, 'Button label');
    btnTxt.parent = btn; mb(btnTxt);
    // card with a gold seam
    var card = kid(shapeLayer(c, 'Card', [700, 300]));
    var cg = group(card, 'Card'); addRect(cg, 290, 330, 22); addFill(cg, C.surface2); addStroke(cg, C.line, 1.5);
    var seamG = group(card, 'Seam');
    addPath(seamG, [[-60, -165], [-30, -90], [-52, -40], [8, 18], [-12, 70], [40, 120], [22, 165]], false);
    addStroke(seamG, C.gold, 3);
    var seamTrim = seamG.property('ADBE Vectors Group').addProperty('ADBE Vector Filter - Trim');
    var cap = text(c, 'OBJECT NO. 001', F.mono, 11, C.muted, [700 - 125, 300 + 145], 'left', 120, 'Card caption'); cap.parent = card;
    // section 2 (revealed by scrolling)
    var s2 = kid(text(c, 'Selected work', F.display, 38, C.text, [48, 640], 'left', -5, 'Section 2 title'));
    var works = ['SEPEHR', 'P4SADX', 'P26'], wcards = [];
    for (var w = 0; w < 3; w++) {
      var wc = kid(shapeLayer(c, 'Work ' + works[w], [173 + w * 277, 790]));
      var wg = group(wc, 'Card'); addRect(wg, 255, 190, 18); addFill(wg, C.surface2); addStroke(wg, C.line, 1.5);
      var wl = group(wc, 'Seam'); addPath(wl, [[-127, 40 - w * 20], [-40, 10], [30, 35 + w * 8], [127, -20]], false); addStroke(wl, C.gold, 2);
      var wt = text(c, works[w], F.mono, 12, C.muted, [173 + w * 277 - 110, 790 + 78], 'left', 140, 'Work label ' + works[w]); wt.parent = wc;
      wcards.push(wc);
    }
    // cursor
    var cur = shapeLayer(c, 'Cursor', [760, 520]); mb(cur);
    var cgp = group(cur, 'Arrow');
    addPath(cgp, [[0, 0], [0, 26], [7, 20], [12, 31], [17, 29], [12, 18], [21, 18]], true);
    addFill(cgp, C.text); addStroke(cgp, C.ink, 1.5);
    var ripple = shapeLayer(c, 'Click ripple', [190, 456]);
    var rg = group(ripple, 'Ring'); var rE = addEllipse(rg, 10, 10); addStroke(rg, C.gold2, 2);

    // -- Round 1: page load (2.0 s) --
    var D1 = 0.9;
    function enter(L, t, dy) {
      var p0 = P(L).value;
      keys(P(L), [t, t + D1], [[p0[0], p0[1] + dy], p0], E(EXPO));
      keys(O(L), [t, t + D1 * 0.7], [0, 100], E(OUTQ));
    }
    enter(logo, 2.0, 30); enter(menu, 2.04, 30);
    enter(h1, 2.12, 46); enter(h2a, 2.22, 46); enter(h2b, 2.26, 46);
    enter(sub1, 2.36, 30); enter(sub2, 2.40, 30);
    enter(btn, 2.48, 34);
    keys(S(card), [2.2, 2.2 + D1], [[92, 92], [100, 100]], E(EXPO));
    enter(card, 2.2, 40);
    keys(seamTrim.property('ADBE Vector Trim End'), [2.7, 3.8], [0, 100], E(EXPO));
    // section 2 starts hidden
    O(s2).setValue(0); for (var w2 = 0; w2 < 3; w2++) O(wcards[w2]).setValue(0);

    // -- Round 2: hover & click (5.6 s) --
    O(cur).setValue(0);
    keys(O(cur), [5.5, 5.7], [0, 100], 'linear');
    keys(P(cur), [5.6, 6.4], [[760, 520], [196, 452]], E(INOUT));
    if (eased) {
      keys(S(btn), [6.4, 6.65, 6.95], [[100, 100], [108, 108], [105, 105]], [EXPO, INOUT]);
    } else keys(S(btn), [6.4, 6.9], [[100, 100], [105, 105]], 'linear');
    keys(btnFill.property('ADBE Vector Fill Color'), [6.4, 6.8], [C.gold, C.gold2], E(OUTQ));
    // click
    if (eased) keys(S(btn), [7.3, 7.4, 7.75], [[105, 105], [96, 96], [105, 105]], [OUTQ, EXPO]);
    else keys(S(btn), [7.3, 7.4, 7.75], [[105, 105], [96, 96], [105, 105]], 'linear');
    keys(S(cur), [7.3, 7.38, 7.55], [[100, 100], [84, 84], [100, 100]], E(OUTQ));
    O(ripple).setValue(0);
    keys(rE.property('ADBE Vector Ellipse Size'), [7.32, 8.1], [[10, 10], [300, 300]], E(EXPO));
    keys(O(ripple), [7.32, 7.36, 8.1], [0, 80, 0], ['linear', E(OUTQ)]);
    keys(P(cur), [7.8, 8.4], [[196, 452], [840, 610]], E(INOUT));

    // -- Round 3: scroll (9.4 s) --
    keys(P(scroll), [9.4, 11.0], [[0, 0], [0, -360]], E(SCROLL));
    keys(O(s2), [9.9, 10.5], [0, 100], E(OUTQ));
    for (var w3 = 0; w3 < 3; w3++) {
      var pp = P(wcards[w3]).value;
      keys(P(wcards[w3]), [10.0 + w3 * 0.1, 10.9 + w3 * 0.1], [[pp[0], pp[1] + 50], pp], E(EXPO));
      keys(O(wcards[w3]), [10.0 + w3 * 0.1, 10.6 + w3 * 0.1], [0, 100], E(OUTQ));
    }
    var all = [logo, menu, h1, h2a, h2b, sub1, sub2, btn, card, s2];
    for (var m = 0; m < all.length; m++) mb(all[m]);
    for (var m2 = 0; m2 < wcards.length; m2++) mb(wcards[m2]);
    return c;
  }

  var siteA = buildSite('Site A \u2014 Linear', false);
  var siteB = buildSite('Site B \u2014 Eased', true);

  // --------- main comp ---------
  var M = app.project.items.addComp('POST 02 \u2014 Same website. Two curves.', W, H, 1, DUR, FPS);
  M.parentFolder = FOLDER; M.motionBlur = true; M.shutterAngle = 180; M.bgColor = C.bg;
  var bgL = M.layers.addSolid(C.bg, 'BG', W, H, 1, DUR);

  // graph widget: axes, curve, moving dot (dot follows the active round's progress)
  function graph(x, y, eased, label) {
    var Lg = shapeLayer(M, 'Graph ' + label, [x, y]);
    var ax = group(Lg, 'Axes'); addPath(ax, [[0, 0], [0, 70], [150, 70]], false); addStroke(ax, C.faint, 1.5);
    var cv = group(Lg, 'Curve');
    if (eased) addPath(cv, [[0, 70], [150, 0]], false, [[0, 0], [-105, 0]], [[24, -70], [0, 0]]);
    else addPath(cv, [[0, 70], [150, 0]], false);
    addStroke(cv, eased ? C.gold : C.muted, 2.5);
    var dot = shapeLayer(M, 'Graph dot ' + label, [x, y + 70]);
    var dg = group(dot, 'Dot'); addEllipse(dg, 11, 11); addFill(dg, eased ? C.gold2 : C.text);
    var curve = eased ? 'var x1=0.16,y1=1,x2=0.3,y2=1;function B(a,b,t){return 3*a*t*(1-t)*(1-t)+3*b*t*t*(1-t)+t*t*t;}function E(p){var lo=0,hi=1,t=p;for(var i=0;i<24;i++){t=(lo+hi)/2;if(B(x1,x2,t)<p)lo=t;else hi=t;}return B(y1,y2,t);}' : 'function E(p){return p;}';
    P(dot).expression = '// KX graph dot\n' + curve + '\nvar R=[[2.0,0.9],[5.6,0.8],[6.4,0.5],[9.4,1.6]];var p=0;for(var i=0;i<R.length;i++){if(time>=R[i][0])p=Math.min(1,(time-R[i][0])/R[i][1]);}\n[' + x + '+p*150,' + (y + 70) + '-E(p)*70];';
    var f = text(M, eased ? 'cubic-bezier(.16, 1, .3, 1)' : 'linear(t)', F.mono, 13, eased ? C.gold : C.muted, [x + 150, y + 96], 'right', 40, 'Formula ' + label);
    return [Lg, dot, f];
  }

  // panel labels + sites
  var labA = text(M, 'A \u2014 LINEAR', F.mono, 22, C.muted, [90, 312], 'left', 160, 'Label A');
  var labB = text(M, 'B \u2014 EASED', F.mono, 22, C.gold, [90, 1062], 'left', 160, 'Label B');
  var gA = graph(840, 252, false, 'A');
  var gB = graph(840, 1002, true, 'B');
  var LA = M.layers.add(siteA); P(LA).setValue([540, 640]); LA.name = 'Site A'; mb(LA);
  var LB = M.layers.add(siteB); P(LB).setValue([540, 1390]); LB.name = 'Site B'; mb(LB);
  var divider = shapeLayer(M, 'Divider', [0, 0]);
  var dvg = group(divider, 'Line'); addPath(dvg, [[90, 985], [990, 985]], false); addStroke(dvg, C.gold, 1.5);
  var dvTrim = addTrim(divider);

  // round chip (bottom)
  var chips = [['01 \u2014 PAGE LOAD', 1.9, 5.3], ['02 \u2014 HOVER & CLICK', 5.3, 9.2], ['03 \u2014 SCROLL', 9.2, 12.4]];
  for (var ci = 0; ci < chips.length; ci++) {
    var ch = text(M, chips[ci][0], F.mono, 24, C.text, [540, 1812], 'center', 200, 'Chip ' + (ci + 1));
    keys(O(ch), [chips[ci][1], chips[ci][1] + 0.25, chips[ci][2] - 0.25, chips[ci][2]], [0, 100, 100, 0], [OUTQ, 'hold', OUTQ]);
    var cp0 = P(ch).value;
    keys(P(ch), [chips[ci][1], chips[ci][1] + 0.5], [[cp0[0], cp0[1] + 24], cp0], EXPO);
  }
  // header (small) after the title moves away
  var head = text(M, 'PS / MOTION STUDY 02', F.mono, 18, C.faint, [90, 150], 'left', 160, 'Header left');
  var head2 = text(M, '60 FPS', F.mono, 18, C.faint, [990, 150], 'right', 160, 'Header right');

  // panel entrance 1.5 -> 2.1 and exit 12.3 -> 12.7
  var panel = [labA, labB, LA, LB, head, head2].concat(gA).concat(gB);
  for (var pi = 0; pi < panel.length; pi++) {
    var Lp = panel[pi];
    keys(O(Lp), [1.5 + pi * 0.03, 1.95 + pi * 0.03, 12.3, 12.65], [0, 100, 100, 0], [OUTQ, 'hold', INOUT]);
  }
  keys(S(LA), [1.5, 2.1, 12.3, 12.7], [[96, 96], [100, 100], [100, 100], [110, 110]], [EXPO, 'hold', INOUT]);
  keys(S(LB), [1.55, 2.15, 12.3, 12.7], [[96, 96], [100, 100], [100, 100], [110, 110]], [EXPO, 'hold', INOUT]);
  keys(dvTrim.property('ADBE Vector Trim End'), [1.6, 2.3], [0, 100], EXPO);
  keys(O(divider), [12.3, 12.6], [100, 0], INOUT);

  // --------- hook: two curves race (0 -> 1.5 s) ---------
  var hook = shapeLayer(M, 'Hook curves', [540, 960]);
  var hl = group(hook, 'Linear'); addPath(hl, [[-400, 420], [400, -420]], false); addStroke(hl, C.faint, 4);
  var hlt = hl.property('ADBE Vectors Group').addProperty('ADBE Vector Filter - Trim');
  var he = group(hook, 'Eased'); addPath(he, [[-400, 420], [400, -420]], false, [[0, 0], [-560, 0]], [[128, -840], [0, 0]]); addStroke(he, C.gold, 6);
  var het = he.property('ADBE Vectors Group').addProperty('ADBE Vector Filter - Trim');
  keys(hlt.property('ADBE Vector Trim End'), [0, 1.1], [0, 100], 'linear');
  keys(het.property('ADBE Vector Trim End'), [0, 1.1], [0, 100], EXPO);
  keys(O(hook), [0, 1.3, 1.65], [100, 100, 0], ['hold', INOUT]);
  var t1 = text(M, 'Same website.', F.display, 112, C.text, [540, 900], 'center', -20, 'Title 1');
  var t2 = text(M, 'Two curves.', F.serif, 128, C.gold, [540, 1040], 'center', -10, 'Title 2');
  keys(P(t1), [0.05, 0.75], [[540, 950], [540, 900]], EXPO); keys(O(t1), [0.05, 0.4], [0, 100], OUTQ);
  keys(P(t2), [0.25, 0.95], [[540, 1090], [540, 1040]], EXPO); keys(O(t2), [0.25, 0.6], [0, 100], OUTQ);
  keys(O(t1), [1.25, 1.55], [100, 0], INOUT); keys(O(t2), [1.3, 1.6], [100, 0], INOUT);
  keys(S(t1), [1.25, 1.6], [[100, 100], [94, 94]], INOUT); keys(S(t2), [1.3, 1.65], [[100, 100], [94, 94]], INOUT);
  mb(t1); mb(t2); mb(hook);

  // --------- your 3 seconds (12.6 -> 15.6) ---------
  var faceFile = new File('C:/Users/Pouya/Downloads/Videos/video-75249.mp4');
  var face = null;
  if (faceFile.exists) {
    var fi = app.project.importFile(new ImportOptions(faceFile)); fi.parentFolder = FOLDER; fi.name = 'REPLACE ME - your 3s clip';
    face = M.layers.add(fi);
    face.name = '\u25B6 YOUR 3s CLIP (replace)'; face.comment = 'Replace with your own 3 second clip saying the line.';
    face.startTime = 12.6 - 0.3; face.inPoint = 12.6; face.outPoint = 15.65;
    var fs = Math.max(W / fi.width, H / fi.height) * 100;
    keys(S(face), [12.6, 15.65], [[fs * 1.08, fs * 1.08], [fs, fs]], OUTQ);
    keys(O(face), [12.6, 12.85, 15.4, 15.65], [0, 100, 100, 0], [OUTQ, 'hold', INOUT]);
    try { face.property('ADBE Audio Group').property('ADBE Audio Levels').setValue([-96, -96]); } catch (eA) {}
  } else log('face placeholder video not found');
  var shade = M.layers.addSolid([0, 0, 0], 'Face shade', W, H, 1, DUR);
  shade.inPoint = 12.6; shade.outPoint = 15.65;
  var mk = shade.property('ADBE Mask Parade').addProperty('ADBE Mask Atom');
  var ms = new Shape(); ms.vertices = [[0, 1150], [W, 1150], [W, H], [0, H]]; ms.closed = true;
  mk.property('ADBE Mask Shape').setValue(ms); mk.property('ADBE Mask Feather').setValue([0, 420]);
  keys(O(shade), [12.6, 12.9, 15.4, 15.65], [0, 85, 85, 0], [OUTQ, 'hold', INOUT]);
  var f1 = text(M, 'Your users feel this.', F.display, 78, C.text, [540, 1560], 'center', -15, 'Face line 1');
  var f2 = text(M, 'Even if they can\u2019t name it.', F.serif, 76, C.gold, [540, 1660], 'center', -5, 'Face line 2');
  f1.inPoint = 12.6; f1.outPoint = 15.65; f2.inPoint = 12.6; f2.outPoint = 15.65;
  keys(P(f1), [12.9, 13.6], [[540, 1600], [540, 1560]], EXPO); keys(O(f1), [12.9, 13.3, 15.35, 15.6], [0, 100, 100, 0], [OUTQ, 'hold', INOUT]);
  keys(P(f2), [13.5, 14.2], [[540, 1700], [540, 1660]], EXPO); keys(O(f2), [13.5, 13.9, 15.35, 15.6], [0, 100, 100, 0], [OUTQ, 'hold', INOUT]);
  mb(f1); mb(f2);

  // --------- end card (15.6 -> 18) and loop back to frame 0 ---------
  var endC = shapeLayer(M, 'End curve', [540, 960]);
  var ee = group(endC, 'Eased'); addPath(ee, [[-400, 420], [400, -420]], false, [[0, 0], [-560, 0]], [[128, -840], [0, 0]]); addStroke(ee, C.gold, 6);
  var eet = ee.property('ADBE Vectors Group').addProperty('ADBE Vector Filter - Trim');
  endC.inPoint = 15.6;
  keys(eet.property('ADBE Vector Trim End'), [15.7, 16.6, 17.5, 18.0], [0, 100, 100, 0], [EXPO, 'hold', INOUT]);
  keys(O(endC), [15.7, 15.9], [0, 35], OUTQ);
  var e1 = text(M, 'Ease is the', F.display, 104, C.text, [540, 900], 'center', -20, 'End 1');
  var e2 = text(M, 'difference.', F.serif, 128, C.gold, [540, 1040], 'center', -10, 'End 2');
  var e3 = text(M, 'SAVE THIS FOR YOUR NEXT BUILD', F.mono, 22, C.muted, [540, 1240], 'center', 220, 'End 3');
  var e4 = text(M, '@pouya.sadeghpour', F.mono, 24, C.text, [540, 1760], 'center', 120, 'Handle');
  var ends = [e1, e2, e3, e4];
  for (var ei = 0; ei < ends.length; ei++) {
    var tE = 15.85 + ei * 0.12, p0 = P(ends[ei]).value;
    ends[ei].inPoint = 15.6;
    keys(P(ends[ei]), [tE, tE + 0.8], [[p0[0], p0[1] + 46], p0], EXPO);
    keys(O(ends[ei]), [tE, tE + 0.35, 17.45, 17.8], [0, 100, 100, 0], [OUTQ, 'hold', INOUT]);
    mb(ends[ei]);
  }

  // --------- finishing: grain + vignette ---------
  var adj = M.layers.addSolid([1, 1, 1], 'Finish (grain + vignette)', W, H, 1, DUR);
  adj.adjustmentLayer = true;
  try { var nz = adj.property('ADBE Effect Parade').addProperty('ADBE Noise'); nz.property(1).setValue(2.2); nz.property(2).setValue(false); } catch (eN) { log('noise ' + eN.message); }
  try { var vg = adj.property('ADBE Effect Parade').addProperty('CC Vignette'); vg.property(1).setValue(22); } catch (eV) { log('vignette ' + eV.message); }
  adj.moveToBeginning();
  bgL.moveToEnd();

  // --------- sound design ---------
  sfx(M, 'whoosh/s-spawn-whoosh.wav', 0.0, -10, 'hook whoosh');
  sfx(M, 'mallet/ani-wine-glass-hard.wav', 0.95, -16, 'curve lands');
  sfx(M, 'whoosh/swish.wav', 1.45, -18, 'panels in');
  var ticks = [2.0, 2.12, 2.24, 2.36, 2.48];
  for (var ti = 0; ti < ticks.length; ti++) sfx(M, ti % 2 ? 'tick/select-002.wav' : 'tick/button-tick.wav', ticks[ti] + 0.05, -20 + ti, 'load tick');
  sfx(M, 'tick/button-tick.wav', 6.4, -16, 'hover');
  sfx(M, 'pop/pop-001.wav', 7.3, -12, 'click');
  sfx(M, 'bubble/bubble-sound.wav', 7.36, -20, 'click ripple');
  sfx(M, 'whoosh/golf-swing-swoosh.wav', 9.35, -16, 'scroll');
  sfx(M, 'tick/select-002.wav', 10.05, -20, 'card'); sfx(M, 'tick/select-002.wav', 10.15, -21, 'card'); sfx(M, 'tick/select-002.wav', 10.25, -22, 'card');
  sfx(M, 'whoosh/s-spawn-whoosh.wav', 12.25, -14, 'to face');
  sfx(M, 'mallet/wine-glass-clink-deeper.wav', 15.75, -12, 'end chime');

  M.openInViewer();
  M.time = 6.6;
  app.endUndoGroup();

  // save the project next to the other Kinetix files
  var dir = new Folder(Folder.myDocuments.fsName + '/Kinetix/Posts');
  if (!dir.exists) dir.create();
  app.project.save(new File(dir.fsName + '/Post02-Two-Curves.aep'));
  log('OK built - layers ' + M.numLayers + ' - saved ' + app.project.file.fsName);
  writeLog();
})();
