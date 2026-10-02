/*  Kinetix - After Effects host script (ExtendScript, ES3).
    The panel calls kx_call(name, jsonArgs); every function lives on KX and
    returns plain data that is sent back as JSON.                           */

// --------- JSON (ExtendScript has no native JSON) ---------
if (typeof KXJSON === 'undefined') {
  KXJSON = {};
  (function () {
    var esc = /[\\"\x00-\x1f]/g;
    var meta = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' };
    function quote(s) {
      esc.lastIndex = 0;
      return esc.test(s) ? '"' + s.replace(esc, function (a) {
        var c = meta[a];
        return typeof c === 'string' ? c : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
      }) + '"' : '"' + s + '"';
    }
    function str(v) {
      var t = typeof v;
      if (v === null || v === undefined) return 'null';
      if (t === 'string') return quote(v);
      if (t === 'number') return isFinite(v) ? String(v) : 'null';
      if (t === 'boolean') return String(v);
      if (v instanceof Array) {
        var a = [];
        for (var i = 0; i < v.length; i++) a.push(str(v[i]));
        return '[' + a.join(',') + ']';
      }
      if (t === 'object') {
        var o = [];
        for (var k in v) if (v.hasOwnProperty(k) && typeof v[k] !== 'function') o.push(quote(k) + ':' + str(v[k]));
        return '{' + o.join(',') + '}';
      }
      return 'null';
    }
    KXJSON.stringify = str;
    KXJSON.parse = function (s) { return eval('(' + s + ')'); };
  })();
}

var KX = KX || {};

function kx_call(name, json) {
  try {
    var fn = KX[name];
    if (!fn) throw new Error('Unknown Kinetix host function: ' + name);
    var args = KXJSON.parse(json);
    var r = fn.apply(null, args);
    return KXJSON.stringify({ ok: true, r: r === undefined ? null : r });
  } catch (e) {
    try { app.endUndoGroup(); } catch (e2) {}
    return KXJSON.stringify({ ok: false, err: (e && e.message ? e.message : String(e)) + (e && e.line ? ' (line ' + e.line + ')' : '') });
  }
}

// --------- helpers ---------
KX._comp = function (spec, create) {
  var c = app.project ? app.project.activeItem : null;
  if (c && c instanceof CompItem) return c;
  if (!create) throw new Error('Open a composition first (click inside a comp timeline).');
  if (!app.project) app.newProject();
  var s = spec || { w: 1920, h: 1080, fps: 30, duration: 10, name: 'Kinetix' };
  c = app.project.items.addComp(s.name || 'Kinetix', Math.round(s.w), Math.round(s.h), 1, Math.max(1, s.duration || 10), s.fps || 30);
  c.openInViewer();
  return c;
};

KX._ensureDuration = function (comp, end) {
  if (end > comp.duration) comp.duration = Math.ceil(end * comp.frameRate + 1) / comp.frameRate;
};

KX._uniqueName = function (comp, base) {
  var name = base, n = 2, taken = {};
  for (var i = 1; i <= comp.numLayers; i++) taken[comp.layer(i).name] = true;
  while (taken[name]) name = base + ' ' + (n++);
  return name;
};

KX._byName = function (comp, name) {
  for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
  return null;
};

KX._contents = function (layer) { return layer.property('ADBE Root Vectors Group'); };

KX._group = function (parentVectors, name) {
  var g = parentVectors.addProperty('ADBE Vector Group');
  g.name = name;
  return g;
};
KX._vectors = function (group) { return group.property('ADBE Vectors Group'); };
KX._xform = function (group) { return group.property('ADBE Vector Transform Group'); };

KX._fill = function (vectors, rgb, opacity) {
  var f = vectors.addProperty('ADBE Vector Graphic - Fill');
  f.property('ADBE Vector Fill Color').setValue([rgb[0], rgb[1], rgb[2], 1]);
  if (opacity !== undefined) f.property('ADBE Vector Fill Opacity').setValue(opacity);
  return f;
};
KX._stroke = function (vectors, rgb, width) {
  var s = vectors.addProperty('ADBE Vector Graphic - Stroke');
  s.property('ADBE Vector Stroke Color').setValue([rgb[0], rgb[1], rgb[2], 1]);
  s.property('ADBE Vector Stroke Width').setValue(width);
  return s;
};

KX._linear = function (prop) {
  var n = prop.numKeys;
  for (var i = 1; i <= n; i++) prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
};

/** Apply a channel {t:[...], v:[...]} to a property, offset by t0. */
KX._keys = function (prop, ch, t0, linear) {
  if (!ch || !ch.t || !ch.t.length) return;
  if (ch.t.length === 1) { prop.setValue(ch.v[0]); return; }
  var times = [];
  for (var i = 0; i < ch.t.length; i++) times.push(ch.t[i] + t0);
  prop.setValuesAtTimes(times, ch.v);
  if (linear) KX._linear(prop);
};

/** Separated X/Y position keys (no spatial curves, so reduced keys stay exact). */
KX._posKeys = function (layer, ch, t0, linear) {
  var pos = layer.property('ADBE Transform Group').property('ADBE Position');
  if (!ch.t.length) return;
  pos.dimensionsSeparated = true;
  var X = layer.property('ADBE Transform Group').property('ADBE Position_0');
  var Y = layer.property('ADBE Transform Group').property('ADBE Position_1');
  var xs = { t: ch.t, v: [] }, ys = { t: ch.t, v: [] };
  for (var i = 0; i < ch.v.length; i++) { xs.v.push(ch.v[i][0]); ys.v.push(ch.v[i][1]); }
  KX._keys(X, xs, t0, linear);
  KX._keys(Y, ys, t0, linear);
};

KX._slider = function (layer, name, value) {
  var fx = layer.property('ADBE Effect Parade');
  var e = fx.addProperty('ADBE Slider Control');
  e.name = name;
  e.property('ADBE Slider Control-0001').setValue(value);
  return e;
};

// --------- comp info ---------
KX.getActiveComp = function () {
  var c = app.project ? app.project.activeItem : null;
  if (!c || !(c instanceof CompItem)) return null;
  return { w: c.width, h: c.height, fps: c.frameRate, duration: c.duration, name: c.name, time: c.time, workStart: c.workAreaStart, workDur: c.workAreaDuration };
};

KX.ping = function () {
  var name = null;
  if (app.project) name = app.project.file ? app.project.file.name : 'Untitled';
  return { version: app.version, project: name };
};

// --------- Bounce ---------
KX.bounceExport = function (p) {
  app.beginUndoGroup('Kinetix Bounce');
  var comp = KX._comp(p.comp, true);
  var t0 = comp.time;
  var linear = p.style !== 'expression';
  var made = [];
  var sel = comp.selectedLayers;
  if (p.target === 'selected' && (!sel || !sel.length)) throw new Error('Select the layer(s) to animate in the timeline first.');

  for (var i = 0; i < p.balls.length; i++) {
    var b = p.balls[i];
    KX._ensureDuration(comp, t0 + b.duration + 0.5);
    if (p.target === 'selected') {
      if (i >= sel.length) break;
      made.push(KX._bounceOnLayer(comp, sel[i], b, t0, p));
    } else {
      made.push(KX._bounceShape(comp, b, t0, p));
    }
  }
  app.endUndoGroup();
  return { layers: made };
};

KX._bounceShape = function (comp, b, t0, p) {
  var layer = comp.layers.addShape();
  layer.name = KX._uniqueName(comp, 'KX ' + b.name);
  layer.startTime = 0;
  layer.label = 9;
  var root = KX._contents(layer);
  var deform = KX._group(root, 'Deform');
  var spin = KX._group(KX._vectors(deform), 'Spin');
  var sv = KX._vectors(spin);
  if (b.marker) {
    var mk = KX._group(sv, 'Marker');
    var me = KX._vectors(mk).addProperty('ADBE Vector Shape - Ellipse');
    me.property('ADBE Vector Ellipse Size').setValue([b.radius * 0.32, b.radius * 0.32]);
    me.property('ADBE Vector Ellipse Position').setValue([b.radius * 0.55, 0]);
    KX._fill(KX._vectors(mk), [0, 0, 0], 35);
  }
  var body = KX._group(sv, 'Body');
  var el = KX._vectors(body).addProperty('ADBE Vector Shape - Ellipse');
  el.property('ADBE Vector Ellipse Size').setValue([b.radius * 2, b.radius * 2]);
  KX._fill(KX._vectors(body), b.color);

  var dx = KX._xform(deform), sx = KX._xform(spin);
  var rotP = dx.property('ADBE Vector Rotation'), sclP = dx.property('ADBE Vector Scale'), spinP = sx.property('ADBE Vector Rotation');
  var tf = layer.property('ADBE Transform Group');
  if (p.style === 'expression' && b.expr) {
    KX._slider(layer, 'Time Scale', 100);
    KX._slider(layer, 'Squash Amount', 100);
    KX._slider(layer, 'Stretch Amount', 100);
    layer.startTime = t0;
    tf.property('ADBE Position').expression = b.expr.pos;
    rotP.expression = b.expr.deformRot;
    sclP.expression = b.expr.deformScale;
    spinP.expression = b.expr.spin;
  } else {
    KX._posKeys(layer, b.pos, t0, true);
    KX._keys(rotP, b.deformRot, t0, true);
    KX._keys(sclP, b.deformScale, t0, true);
    KX._keys(spinP, b.spin, t0, true);
  }
  return layer.name;
};

KX._bounceOnLayer = function (comp, layer, b, t0, p) {
  var nul = comp.layers.addNull();
  nul.name = KX._uniqueName(comp, 'KX Deform - ' + layer.name);
  nul.label = 9;
  nul.moveBefore(layer);
  var ntf = nul.property('ADBE Transform Group');
  ntf.property('ADBE Anchor Point').setValue([0, 0]);
  // centre the layer's anchor on its visible content
  var r = layer.sourceRectAtTime(comp.time, false);
  var ltf = layer.property('ADBE Transform Group');
  if (ltf.property('ADBE Position').dimensionsSeparated) ltf.property('ADBE Position').dimensionsSeparated = false;
  ltf.property('ADBE Anchor Point').setValue([r.left + r.width / 2, r.top + r.height / 2]);
  layer.parent = nul;
  ltf.property('ADBE Position').setValue([0, 0]);
  KX._posKeys(nul, b.pos, t0, true);
  KX._keys(ntf.property('ADBE Rotate Z'), b.deformRot, t0, true);
  KX._keys(ntf.property('ADBE Scale'), b.deformScale, t0, true);
  KX._keys(ltf.property('ADBE Rotate Z'), b.spin, t0, true);
  return nul.name;
};

/** Read radius + position of the selected layer so the panel ball matches it. */
KX.selectedLayerInfo = function () {
  var c = KX._comp(null, false);
  var l = c.selectedLayers[0];
  if (!l) return null;
  var r = l.sourceRectAtTime(c.time, false);
  var s = l.property('ADBE Transform Group').property('ADBE Scale').value;
  var p = l.property('ADBE Transform Group').property('ADBE Position').value;
  return { name: l.name, w: r.width * s[0] / 100, h: r.height * s[1] / 100, x: p[0], y: p[1] };
};

// --------- shared: shapes & keys ---------
KX._shape = function (p) {
  var s = new Shape();
  s.vertices = p.v;
  s.inTangents = p.i;
  s.outTangents = p.o;
  s.closed = p.closed !== false;
  return s;
};

/** Path keys {t:[], v:[PathData]} on a new path inside `vectors`. */
KX._pathKeys = function (vectors, pk, t0, name) {
  var pg = vectors.addProperty('ADBE Vector Shape - Group');
  if (name) pg.name = name;
  var prop = pg.property('ADBE Vector Shape');
  if (pk.t.length === 1) { prop.setValue(KX._shape(pk.v[0])); return prop; }
  var times = [], vals = [];
  for (var i = 0; i < pk.t.length; i++) { times.push(pk.t[i] + t0); vals.push(KX._shape(pk.v[i])); }
  prop.setValuesAtTimes(times, vals);
  return prop;
};

KX._dims = function (prop) {
  var t = prop.propertyValueType;
  if (t === PropertyValueType.ThreeD) return 3;
  if (t === PropertyValueType.TwoD) return 2;
  return 1;
};

/** Apply cubic-bezier style eases between keys (null = linear). */
KX._eases = function (prop, eases) {
  var n = prop.numKeys, d = KX._dims(prop);
  for (var k = 1; k <= n; k++) {
    var outE = eases[k - 1], inE = k > 1 ? eases[k - 2] : null;
    var inType = inE ? KeyframeInterpolationType.BEZIER : KeyframeInterpolationType.LINEAR;
    var outType = outE ? KeyframeInterpolationType.BEZIER : KeyframeInterpolationType.LINEAR;
    if (k === 1) inType = outType;
    if (k === n) outType = inType;
    prop.setInterpolationTypeAtKey(k, inType, outType);
    if (inType === KeyframeInterpolationType.BEZIER || outType === KeyframeInterpolationType.BEZIER) {
      var inInf = inE ? Math.max(0.1, Math.min(100, (1 - inE[2]) * 100)) : 0.1;
      var outInf = outE ? Math.max(0.1, Math.min(100, outE[0] * 100)) : 0.1;
      var ia = [], oa = [];
      for (var j = 0; j < d; j++) { ia.push(new KeyframeEase(0, inInf)); oa.push(new KeyframeEase(0, outInf)); }
      prop.setTemporalEaseAtKey(k, ia, oa);
    }
  }
};

/** Make spatial (position) keys travel in straight lines between keys. */
KX._linearSpatial = function (prop) {
  if (!prop.isSpatial) return;
  for (var k = 1; k <= prop.numKeys; k++) {
    try {
      prop.setSpatialAutoBezierAtKey(k, false);
      prop.setSpatialContinuousAtKey(k, false);
      var z = prop.value.length === 3 ? [0, 0, 0] : [0, 0];
      prop.setSpatialTangentsAtKey(k, z, z);
    } catch (e) {}
  }
};

KX._layerFill = function (layer, rgb, exprColor) {
  var fx = layer.property('ADBE Effect Parade').addProperty('ADBE Fill');
  fx.property('ADBE Fill-0002').setValue([rgb[0], rgb[1], rgb[2], 1]);
  if (exprColor) fx.property('ADBE Fill-0002').expression = exprColor;
  return fx;
};

KX._compById = function (id) {
  try { var it = app.project.itemByID(id); if (it) return it; } catch (e) {}
  for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).id === id) return app.project.item(i);
  throw new Error('Kinetix comp not found (was it deleted?)');
};

// --------- Shapes ---------
KX.shapesExport = function (p) {
  app.beginUndoGroup('Kinetix Shapes');
  var comp = KX._comp(p.comp, true);
  var L = p.layer;
  var layer = comp.layers.addShape();
  layer.name = KX._uniqueName(comp, 'KX ' + L.name);
  layer.label = 11;
  var tf = layer.property('ADBE Transform Group');
  tf.property('ADBE Anchor Point').setValue([0, 0]);
  tf.property('ADBE Position').setValue([0, 0]);
  tf.property('ADBE Opacity').setValue(L.opacity);
  var g = KX._group(KX._contents(layer), L.name);
  var vec = KX._vectors(g);
  var eases = L.xf ? L.xf.ease : null;
  for (var i = 0; i < L.paths.length; i++) {
    var prop = KX._pathKeys(vec, L.paths[i], 0, 'Path ' + (i + 1));
    if (eases && prop.numKeys > 1) KX._eases(prop, eases);
  }
  var fill = KX._fill(vec, L.color);
  try { fill.property('ADBE Vector Fill Rule').setValue(1); } catch (e) {}
  if (L.stroke) KX._stroke(vec, L.stroke, L.strokeW);
  if (L.xf) {
    var X = L.xf;
    KX._keys(tf.property('ADBE Position'), { t: X.t, v: X.pos }, 0, false);
    KX._keys(tf.property('ADBE Rotate Z'), { t: X.t, v: X.rot }, 0, false);
    KX._keys(tf.property('ADBE Scale'), { t: X.t, v: X.scale }, 0, false);
    var pr = [tf.property('ADBE Position'), tf.property('ADBE Rotate Z'), tf.property('ADBE Scale')];
    for (var q = 0; q < pr.length; q++) if (pr[q].numKeys > 1) KX._eases(pr[q], eases);
    KX._linearSpatial(tf.property('ADBE Position'));
  }
  KX._ensureDuration(comp, p.comp.duration);
  app.endUndoGroup();
  return { layer: layer.name };
};

/** Paths of the selected shape layer (for importing into the Shape studio). */
KX.selectedShapePaths = function () {
  var c = KX._comp(null, false);
  var l = c.selectedLayers[0];
  if (!l || !(l instanceof ShapeLayer)) return null;
  var out = [];
  var walk = function (grp) {
    for (var i = 1; i <= grp.numProperties; i++) {
      var pp = grp.property(i);
      if (pp.matchName === 'ADBE Vector Shape - Group') {
        var s = pp.property('ADBE Vector Shape').valueAtTime(c.time, false);
        out.push({ v: s.vertices, i: s.inTangents, o: s.outTangents, closed: s.closed });
      } else if (pp.propertyType !== PropertyType.PROPERTY) walk(pp);
    }
  };
  walk(KX._contents(l));
  var tf = l.property('ADBE Transform Group');
  return { name: l.name, paths: out, pos: tf.property('ADBE Position').value, anchor: tf.property('ADBE Anchor Point').value, scale: tf.property('ADBE Scale').value, rot: tf.property('ADBE Rotate Z').value };
};

// --------- Text Morph ---------
KX._xfPoint = function (layer, t, p) {
  // layer space - comp space for an unparented 2D layer
  var tf = layer.property('ADBE Transform Group');
  var pos = tf.property('ADBE Position').valueAtTime(t, false);
  var anc = tf.property('ADBE Anchor Point').valueAtTime(t, false);
  var sc = tf.property('ADBE Scale').valueAtTime(t, false);
  var r = tf.property('ADBE Rotate Z').valueAtTime(t, false) * Math.PI / 180;
  var x = (p[0] - anc[0]) * sc[0] / 100, y = (p[1] - anc[1]) * sc[1] / 100;
  return [pos[0] + x * Math.cos(r) - y * Math.sin(r), pos[1] + x * Math.sin(r) + y * Math.cos(r)];
};

KX._xfPath = function (layer, t, s) {
  // tangents are relative vectors: transform without translation
  var v = [], ii = [], oo = [];
  var o0 = KX._xfPoint(layer, t, [0, 0]);
  for (var k = 0; k < s.vertices.length; k++) {
    var a = KX._xfPoint(layer, t, s.vertices[k]);
    var ti = KX._xfPoint(layer, t, s.inTangents[k]), to = KX._xfPoint(layer, t, s.outTangents[k]);
    v.push([Math.round(a[0] * 100) / 100, Math.round(a[1] * 100) / 100]);
    ii.push([Math.round((ti[0] - o0[0]) * 100) / 100, Math.round((ti[1] - o0[1]) * 100) / 100]);
    oo.push([Math.round((to[0] - o0[0]) * 100) / 100, Math.round((to[1] - o0[1]) * 100) / 100]);
  }
  return { v: v, i: ii, o: oo, closed: s.closed };
};

KX._hex = function (c) {
  var h = function (x) { var s = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16); return s.length < 2 ? '0' + s : s; };
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
};

KX.textAnalyze = function (opts) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, src = [];
  for (var i = 0; i < sel.length; i++) if (sel[i] instanceof TextLayer) src.push(sel[i]);
  var res = { lines: [], glyphs: {}, warnings: [], comp: { w: comp.width, h: comp.height, fps: comp.frameRate, duration: comp.duration, name: comp.name } };
  if (!src.length) return res;
  for (var s = 0; s < src.length; s++) {
    var L = src[s];
    var td = L.property('ADBE Text Properties').property('ADBE Text Document').value;
    var j = 'left';
    try { if (td.justification === ParagraphJustification.CENTER_JUSTIFY) j = 'center'; else if (td.justification === ParagraphJustification.RIGHT_JUSTIFY) j = 'right'; } catch (e) {}
    var p = L.property('ADBE Transform Group').property('ADBE Position').valueAtTime(L.inPoint, false);
    var col = '#ffffff';
    try { if (td.applyFill) col = KX._hex(td.fillColor); } catch (e) {}
    if (L.parent) res.warnings.push('"' + L.name + '" is parented - glyph positions assume no parent.');
    res.lines.push({ layer: 0, name: L.name, text: String(td.text), t0: L.inPoint, t1: L.outPoint, font: td.font, size: td.fontSize, color: col, x: p[0], y: p[1], justify: j });
  }

  if (opts && opts.outlines === false) {
    for (var z0 = 0; z0 < src.length; z0++) { res.lines[z0].layer = src[z0].index; res.glyphs[String(src[z0].index)] = []; }
    return res;
  }
  app.beginUndoGroup('Kinetix Analyze');
  // outlines: run "Create Shapes from Text" on all of them at once
  var before = {};
  for (var b = 1; b <= comp.numLayers; b++) before[comp.layer(b).id] = true;
  for (var d = 1; d <= comp.numLayers; d++) comp.layer(d).selected = false;
  for (var e2 = 0; e2 < src.length; e2++) src[e2].selected = true;
  comp.openInViewer();
  try { app.activeViewer.setActive(); } catch (eV) {}
  var cmd = app.findMenuCommandId('Create Shapes from Text');
  app.executeCommand(cmd || 3781);
  var created = [];
  for (var c = 1; c <= comp.numLayers; c++) if (!before[comp.layer(c).id]) created.push(comp.layer(c));
  var glyphList = [];
  for (var s2 = 0; s2 < src.length; s2++) {
    var L2 = src[s2], out = null;
    for (var k = 0; k < created.length; k++) {
      if (created[k] && created[k].name.indexOf(L2.name) === 0) { out = created[k]; created[k] = null; break; }
    }
    glyphList.push(out ? KX._readGlyphs(out, L2.inPoint) : []);
    if (!out) res.warnings.push('No outlines for "' + L2.name + '" - preview uses approximate glyphs.');
  }
  for (var r = comp.numLayers; r >= 1; r--) if (!before[comp.layer(r).id]) comp.layer(r).remove();
  app.endUndoGroup();
  for (var z = 0; z < src.length; z++) {
    src[z].selected = true;
    res.lines[z].layer = src[z].index;
    res.glyphs[String(src[z].index)] = glyphList[z];
  }
  return res;
};

/** Character groups of a "Create Shapes from Text" layer, in comp space. */
KX._readGlyphs = function (layer, t) {
  var groups = [], root = KX._contents(layer);
  var walk = function (pg, paths) {
    for (var q = 1; q <= pg.numProperties; q++) {
      var pp = pg.property(q);
      if (pp.matchName === 'ADBE Vector Shape - Group') paths.push(KX._xfPath(layer, t, pp.property('ADBE Vector Shape').valueAtTime(t, false)));
      else if (pp.propertyType !== PropertyType.PROPERTY) walk(pp, paths);
    }
  };
  for (var g = 1; g <= root.numProperties; g++) {
    var grp = root.property(g);
    if (grp.matchName !== 'ADBE Vector Group') continue;
    var paths = [];
    walk(grp, paths);
    if (paths.length) groups.push({ name: grp.name, paths: paths });
  }
  return groups;
};

/** Build one text layer per subtitle (SRT import). Uses a selected text layer as the style template. */
KX.textFromSRT = function (p) {
  var comp = KX._comp(null, false);
  app.beginUndoGroup('Kinetix SRT');
  var tpl = null;
  for (var i = 0; i < comp.selectedLayers.length; i++) if (comp.selectedLayers[i] instanceof TextLayer) { tpl = comp.selectedLayers[i]; break; }
  var made = [];
  for (var k = 0; k < p.items.length; k++) {
    var it = p.items[k];
    var L = comp.layers.addText(it.text);
    var prop = L.property('ADBE Text Properties').property('ADBE Text Document');
    var td = prop.value;
    if (tpl) {
      var tt = tpl.property('ADBE Text Properties').property('ADBE Text Document').value;
      td.font = tt.font; td.fontSize = tt.fontSize; td.fillColor = tt.fillColor; td.applyFill = true; td.tracking = tt.tracking;
    } else { td.fontSize = p.size; td.fillColor = [1, 1, 1]; td.applyFill = true; }
    td.justification = ParagraphJustification.CENTER_JUSTIFY;
    td.text = it.text;
    prop.setValue(td);
    L.property('ADBE Transform Group').property('ADBE Position').setValue(tpl ? tpl.property('ADBE Transform Group').property('ADBE Position').value : [comp.width / 2, p.y]);
    L.inPoint = it.t0; L.outPoint = it.t1;
    L.name = 'SRT ' + (k + 1) + ' - ' + it.text.replace(/[\r\n]+/g, ' ').substring(0, 24);
    made.push(L);
  }
  KX._ensureDuration(comp, p.items[p.items.length - 1].t1 + 0.5);
  for (var d = 1; d <= comp.numLayers; d++) comp.layer(d).selected = false;
  for (var m = 0; m < made.length; m++) made[m].selected = true;
  app.endUndoGroup();
  return made.length;
};

KX.textBegin = function (h) {
  var main = KX._comp(h.comp, false);
  app.beginUndoGroup('Kinetix Text Morph');
  var dur = Math.max(main.duration, h.duration);
  var pc = app.project.items.addComp(h.name, main.width, main.height, main.pixelAspect, dur, main.frameRate);
  pc.bgColor = main.bgColor;
  var ctl = pc.layers.addNull();
  ctl.name = 'KX Controls';
  ctl.label = 9;
  var fx = ctl.property('ADBE Effect Parade');
  var col = function (name, rgb) { var e = fx.addProperty('ADBE Color Control'); e.name = name; e.property('ADBE Color Control-0001').setValue([rgb[0], rgb[1], rgb[2], 1]); };
  col('Text Color', h.textColor);
  col('Box Color', h.boxColor);
  KX._slider(ctl, 'Box Opacity', h.boxOpacity);
  KX._slider(ctl, 'Box Extra Width', 0);
  KX._slider(ctl, 'Box Extra Height', 0);
  KX._slider(ctl, 'Box Extra Roundness', 0);
  KX._slider(ctl, 'Text Opacity', 100);
  // all text lives in a source comp so the whole text can be re-timed (Timewarp) and coloured at once
  var sc = app.project.items.addComp(h.name + ' Text', main.width, main.height, main.pixelAspect, dur, main.frameRate);
  KX._textMain = main.id;
  app.endUndoGroup();
  return { compId: pc.id, srcId: sc.id };
};

KX._TEXT_FILL = 'thisComp.layer("KX Controls").effect("Text Color")("Color")';
KX._BOX_FILL = 'thisComp.layer("KX Controls").effect("Box Color")("Color")';

KX.textLine = function (compId, ln) {
  var pc = KX._compById(compId);
  if (ln.useOrig) return KX._textLineOrig(pc, ln);
  app.beginUndoGroup('Kinetix Text Line');
  var layer = pc.layers.addShape();
  layer.name = ln.name;
  layer.label = 2;
  var tf = layer.property('ADBE Transform Group');
  tf.property('ADBE Anchor Point').setValue([0, 0]);
  tf.property('ADBE Position').setValue([0, 0]);
  var root = KX._contents(layer);
  for (var g = 0; g < ln.glyphs.length; g++) {
    var G = ln.glyphs[g];
    var grp = KX._group(root, G.name);
    var vec = KX._vectors(grp);
    for (var p = 0; p < G.paths.length; p++) {
      var pg = vec.addProperty('ADBE Vector Shape - Group');
      pg.property('ADBE Vector Shape').setValue(KX._shape(G.paths[p]));
    }
    var f = KX._fill(vec, [1, 1, 1]);
    try { f.property('ADBE Vector Fill Rule').setValue(2); } catch (e) {}
    var x = KX._xform(grp);
    x.property('ADBE Vector Anchor').setValue([0, 0]);
    var pos = x.property('ADBE Vector Position');
    KX._keys(pos, G.pos, 0, true);
    KX._linearSpatial(pos);
    KX._keys(x.property('ADBE Vector Scale'), G.scale, 0, true);
    KX._keys(x.property('ADBE Vector Rotation'), G.rot, 0, true);
    KX._keys(x.property('ADBE Vector Group Opacity'), G.op, 0, true);
  }
  layer.inPoint = Math.max(0, ln['in']);
  layer.outPoint = Math.min(pc.duration, ln.out);
  app.endUndoGroup();
  return true;
};

/** Liquid Glass: copy the original text layer (exact typography) into the source comp. */
KX._textLineOrig = function (sc, ln) {
  app.beginUndoGroup('Kinetix Text Line');
  var main = KX._compById(KX._textMain);
  var o = main.layer(ln.orig);
  o.copyToComp(sc);
  var L = sc.layer(1);
  L.enabled = true;
  L.name = ln.name;
  L.startTime = 0;
  L.inPoint = Math.max(0, ln['in']);
  L.outPoint = Math.min(sc.duration, ln.out);
  // white text: the KX Text layer colours everything through the Controls
  try {
    var tp = L.property('ADBE Text Properties').property('ADBE Text Document');
    if (tp.numKeys === 0) { var td = tp.value; td.applyFill = true; td.fillColor = [1, 1, 1]; tp.setValue(td); }
  } catch (e) {}
  var op = L.property('ADBE Transform Group').property('ADBE Opacity');
  var sc2 = L.property('ADBE Transform Group').property('ADBE Scale');
  var base = sc2.value;
  if (ln.fadeIn) {
    op.setValuesAtTimes([ln.fadeIn[0], ln.fadeIn[1]], [0, 100]);
    sc2.setValuesAtTimes([ln.fadeIn[0], ln.fadeIn[1]], [[base[0] * 0.92, base[1] * 0.92], base]);
  }
  if (ln.fadeOut) {
    op.setValuesAtTimes([ln.fadeOut[0], ln.fadeOut[1]], [100, 0]);
    sc2.setValuesAtTimes([ln.fadeOut[0], ln.fadeOut[1]], [base, [base[0] * 1.06, base[1] * 1.06]]);
  }
  app.endUndoGroup();
  return true;
};

KX.textBaked = function (compId, b) {
  var pc = KX._compById(compId);
  app.beginUndoGroup('Kinetix Text Baked');
  var layer = pc.layers.addShape();
  layer.name = b.name;
  layer.label = 11;
  var tf = layer.property('ADBE Transform Group');
  tf.property('ADBE Anchor Point').setValue([0, 0]);
  tf.property('ADBE Position').setValue([0, 0]);
  var grp = KX._group(KX._contents(layer), 'Morph');
  var vec = KX._vectors(grp);
  for (var i = 0; i < b.paths.length; i++) KX._pathKeys(vec, b.paths[i], 0, 'Path ' + (i + 1));
  var f = KX._fill(vec, [1, 1, 1]);
  try { f.property('ADBE Vector Fill Rule').setValue(1); } catch (e) {}
  layer.inPoint = Math.max(0, b['in']);
  layer.outPoint = Math.min(pc.duration, b.out);
  app.endUndoGroup();
  return true;
};

KX.textBox = function (compId, box, h) {
  var pc = KX._compById(compId);
  app.beginUndoGroup('Kinetix Text Box');
  var layer = pc.layers.addShape();
  layer.name = 'KX TextBox';
  layer.label = 14;
  var tf = layer.property('ADBE Transform Group');
  tf.property('ADBE Anchor Point').setValue([0, 0]);
  tf.property('ADBE Position').setValue([0, 0]);
  tf.property('ADBE Opacity').expression = 'thisComp.layer("KX Controls").effect("Box Opacity")("Slider")';
  var grp = KX._group(KX._contents(layer), 'Box');
  var vec = KX._vectors(grp);
  var x = KX._xform(grp);
  if (box.kind === 'rect') {
    var rc = vec.addProperty('ADBE Vector Shape - Rect');
    rc.name = 'Rect';
    var size = rc.property('ADBE Vector Rect Size');
    KX._keys(size, box.size, 0, true);
    size.expression = 'var c = thisComp.layer("KX Controls"); value + [c.effect("Box Extra Width")("Slider"), c.effect("Box Extra Height")("Slider")]';
    var rnd = rc.property('ADBE Vector Rect Roundness');
    KX._keys(rnd, box.round, 0, true);
    rnd.expression = 'value + thisComp.layer("KX Controls").effect("Box Extra Roundness")("Slider")';
    var gp = x.property('ADBE Vector Position');
    KX._keys(gp, box.pos, 0, true);
    KX._linearSpatial(gp);
    KX._keys(x.property('ADBE Vector Scale'), box.scale, 0, true);
  } else {
    KX._pathKeys(vec, box.path, 0, 'Box Path');
  }
  KX._keys(x.property('ADBE Vector Group Opacity'), box.op, 0, true);
  KX._fill(vec, [1, 1, 1]);
  KX._layerFill(layer, h.boxColor, KX._BOX_FILL);
  layer.inPoint = Math.max(0, box['in']);
  layer.outPoint = Math.min(pc.duration, box.out + 1 / pc.frameRate);
  layer.moveToEnd(); // box sits under all text
  app.endUndoGroup();
  return true;
};

KX.textFinish = function (compId, h, srcId) {
  var pc = KX._compById(compId);
  app.beginUndoGroup('Kinetix Text Finish');
  var main = KX._textMain ? KX._compById(KX._textMain) : KX._comp(null, false);
  if (srcId) {
    var sc = KX._compById(srcId);
    var tl = pc.layers.add(sc);
    tl.name = 'KX Text';
    tl.label = 2;
    tl.property('ADBE Transform Group').property('ADBE Opacity').expression = 'thisComp.layer("KX Controls").effect("Text Opacity")("Slider")';
    KX._layerFill(tl, h.textColor, KX._TEXT_FILL);
    if (h.flow && h.flow.length) KX._flowTimewarp(tl, h.flow, sc);
    var box = KX._byName(pc, 'KX TextBox');
    if (box) { box.moveToEnd(); tl.moveBefore(box); }
  }
  var ctl = KX._byName(pc, 'KX Controls');
  if (ctl) ctl.moveToBeginning();
  if (h.disableOriginals) {
    for (var i = 0; i < h.originals.length; i++) {
      try { var L = main.layer(h.originals[i]); if (L) L.enabled = false; } catch (e) {}
    }
  }
  var lay = main.layers.add(pc);
  lay.name = 'Kinetix TextMorph';
  lay.startTime = 0;
  lay.label = 9;
  KX._ensureDuration(main, h.duration);
  main.openInViewer();
  app.endUndoGroup();
  return { layer: lay.name };
};

/**
 * Optical-flow text morph (the Twixtor technique, using AE's own Timewarp):
 * the source hard-cuts from line A to line B at tc; Source Frame is slowed to a
 * crawl across that single cut, so Pixel Motion invents a liquid in-between.
 */
KX._flowTimewarp = function (layer, wins, src) {
  var fps = src.frameRate;
  var fx = layer.property('ADBE Effect Parade').addProperty('ADBE Timewarp');
  fx.name = 'Kinetix Liquid Flow';
  var set = function (name, v) { try { fx.property(name).setValue(v); return true; } catch (e) { return false; } };
  set('Method', 3);          // Pixel Motion
  set('Adjust Time By', 2);  // Source Frame
  set('Vector Detail', 40);
  set('Enable Motion Blur', 1);
  var sf = fx.property('Source Frame');
  var times = [0], vals = [0];
  for (var i = 0; i < wins.length; i++) {
    var w = wins[i];
    var fB = Math.round(w.tc * fps), fA = fB - 1;
    times.push(w.t0); vals.push(fA);
    times.push(w.t1); vals.push(fB);
  }
  var end = src.duration;
  times.push(end); vals.push(end * fps);
  sf.setValuesAtTimes(times, vals);
  for (var k = 1; k <= sf.numKeys; k++) sf.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
  // slow-in / slow-out across each cut, like a speed ramp in Twixtor
  for (var j = 0; j < wins.length; j++) {
    var ka = 2 + j * 2, kb = ka + 1;
    sf.setInterpolationTypeAtKey(ka, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.BEZIER);
    sf.setInterpolationTypeAtKey(kb, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.LINEAR);
    sf.setTemporalEaseAtKey(ka, [new KeyframeEase(0, 33)], [new KeyframeEase(0, 60)]);
    sf.setTemporalEaseAtKey(kb, [new KeyframeEase(0, 60)], [new KeyframeEase(0, 33)]);
  }
  return fx;
};

// --------- Render ---------
KX.defaultRenderFolder = function () {
  if (app.project && app.project.file) return app.project.file.parent.fsName + '/Kinetix Renders';
  return null;
};

KX._hasAudio = function (comp) {
  for (var i = 1; i <= comp.numLayers; i++) { var l = comp.layer(i); if (l.hasAudio && l.audioEnabled) return true; }
  return false;
};

/** Optional wrapper comp for a different size/aspect. mode: fit | fill | blur. */
KX._wrap = function (comp, rf, always) {
  if (!rf || !rf.w) return { comp: comp, temp: false };
  var arC = comp.width / comp.height, arT = rf.w / rf.h;
  var sameAspect = Math.abs(arC - arT) < 0.01;
  if (sameAspect && (!always || (comp.width === rf.w && comp.height === rf.h))) return { comp: comp, temp: false };
  var w = app.project.items.addComp('KX Export ' + rf.w + 'x' + rf.h + ' - ' + comp.name, rf.w, rf.h, 1, comp.duration, comp.frameRate);
  w.workAreaStart = comp.workAreaStart;
  w.workAreaDuration = comp.workAreaDuration;
  var fit = Math.min(rf.w / comp.width, rf.h / comp.height) * 100;
  var fill = Math.max(rf.w / comp.width, rf.h / comp.height) * 100;
  if (!sameAspect && rf.mode === 'blur') {
    var bg = w.layers.add(comp);
    bg.property('ADBE Transform Group').property('ADBE Scale').setValue([fill * 1.08, fill * 1.08]);
    bg.audioEnabled = false;
    var bl = bg.property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2');
    bl.property('ADBE Gaussian Blur 2-0001').setValue(Math.max(30, rf.w / 18));
    try { bl.property('ADBE Gaussian Blur 2-0003').setValue(1); } catch (e) {}
    bg.property('ADBE Transform Group').property('ADBE Opacity').setValue(70);
  }
  var fg = w.layers.add(comp);
  var s = sameAspect ? fit : (rf.mode === 'fill' ? fill : fit);
  fg.property('ADBE Transform Group').property('ADBE Scale').setValue([s, s]);
  fg.moveToBeginning();
  return { comp: w, temp: true };
};

KX._templates = function (om) { try { return om.templates; } catch (e) { return []; } };
KX._applyFirst = function (om, wanted) {
  var list = KX._templates(om);
  var norm = function (x) { return String(x).replace(/\s+/g, ' '); };
  for (var i = 0; i < wanted.length; i++) {
    for (var k = 0; k < list.length; k++) if (norm(list[k]) === norm(wanted[i]) || norm(list[k]).indexOf(norm(wanted[i])) === 0) { om.applyTemplate(list[k]); return list[k]; }
  }
  return null;
};

/** Render `target` alone (other queued items are paused and restored). */
KX._renderOnly = function (target, useWorkArea, out, templates) {
  var rq = app.project.renderQueue;
  var paused = [];
  for (var i = 1; i <= rq.numItems; i++) {
    var it = rq.item(i);
    if (it.status === RQItemStatus.QUEUED) { it.render = false; paused.push(it); }
  }
  var item = rq.items.add(target);
  if (!useWorkArea) { item.timeSpanStart = 0; item.timeSpanDuration = target.duration; }
  var om = item.outputModule(1);
  var used = KX._applyFirst(om, templates);
  if (!used) { item.remove(); throw new Error('None of these output module templates exist: ' + templates.join(', ')); }
  om.file = new File(out);
  var dur = item.timeSpanDuration;
  try { rq.render(); } finally {
    for (var p = 0; p < paused.length; p++) try { paused[p].render = true; } catch (e) {}
  }
  var path = om.file.fsName;
  try { item.remove(); } catch (e2) {}
  return { path: path, duration: dur, template: used };
};

KX.renderIntermediate = function (p) {
  var comp = KX._comp(null, false);
  var hasAudio = KX._hasAudio(comp);
  var wr = KX._wrap(comp, p.reframe, false);
  var w = wr.comp.width, h = wr.comp.height, res;
  try {
    res = KX._renderOnly(wr.comp, p.useWorkArea, p.out, ['Apple ProRes 422 HQ', 'High Quality', 'Lossless']);
  } finally { if (wr.temp) try { wr.comp.remove(); } catch (e) {} }
  return { path: res.path, duration: res.duration, hasAudio: hasAudio, w: w, h: h, comp: comp.name, template: res.template };
};

KX._h264Templates = function (mbps) {
  var pref = mbps >= 25 ? '40' : (mbps >= 10 ? '15' : '5');
  return ['H.264 - Match Render Settings - ' + pref + ' Mbps', 'H.264 - Match Render Settings', 'H.264'];
};

KX.renderNative = function (p) {
  var comp = KX._comp(null, false);
  var wr = KX._wrap(comp, p.reframe, true);
  var res;
  try { res = KX._renderOnly(wr.comp, p.useWorkArea, p.out, KX._h264Templates(p.mbps)); }
  finally { if (wr.temp) try { wr.comp.remove(); } catch (e) {} }
  return { path: res.path };
};

KX.renderAME = function (p) {
  var comp = KX._comp(null, false);
  var wr = KX._wrap(comp, p.reframe, true);
  var rq = app.project.renderQueue;
  var item = rq.items.add(wr.comp);
  if (!p.useWorkArea) { item.timeSpanStart = 0; item.timeSpanDuration = wr.comp.duration; }
  var om = item.outputModule(1);
  KX._applyFirst(om, KX._h264Templates(p.mbps));
  om.file = new File(p.out);
  if (!rq.canQueueInAME) throw new Error('Media Encoder queueing is not available.');
  rq.queueInAME(true);
  return { path: om.file.fsName };
};

KX.listTemplates = function () {
  var c = KX._comp(null, false);
  var it = app.project.renderQueue.items.add(c);
  var t = KX._templates(it.outputModule(1));
  it.remove();
  return t;
};
