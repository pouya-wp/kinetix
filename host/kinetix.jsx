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
    var nm;
    if (p.target === 'selected') {
      if (i >= sel.length) break;
      nm = KX._bounceOnLayer(comp, sel[i], b, t0, p);
    } else {
      nm = KX._bounceShape(comp, b, t0, p);
    }
    made.push(nm);
    var ml = KX._byName(comp, nm);
    if (ml && b.markers) for (var m = 0; m < b.markers.length; m++) { try { ml.property('ADBE Marker').setValueAtTime(t0 + b.markers[m].t, new MarkerValue(b.markers[m].comment)); } catch (eM) {} }
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
  KX._textBoxLayer = null;
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
  KX._slider(ctl, 'Text Opacity', 100);
  // all text lives in a source comp so the whole text can be re-timed (Timewarp) and coloured at once
  var sc = app.project.items.addComp(h.name + ' Text', main.width, main.height, main.pixelAspect, dur, main.frameRate);
  sc.comment = 'kinetix-text-source';
  KX._textMain = main.id;
  app.endUndoGroup();
  return { compId: pc.id, srcId: sc.id };
};

KX._TEXT_FILL = 'thisComp.layer("KX Controls").effect("Text Color")("Color")';

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

/** Text box lives in the MAIN comp (its own layer, own controls) so it can become an
 *  adjustment layer, take a glass effect, track mattes, etc. */
KX.textBox = function (compId, box, h) {
  var main = KX._textMain ? KX._compById(KX._textMain) : KX._comp(null, false);
  app.beginUndoGroup('Kinetix Text Box');
  var layer = main.layers.addShape();
  layer.name = KX._uniqueName(main, 'KX TextBox');
  layer.label = 14;
  var tf = layer.property('ADBE Transform Group');
  tf.property('ADBE Anchor Point').setValue([0, 0]);
  tf.property('ADBE Position').setValue([0, 0]);
  tf.property('ADBE Opacity').setValue(h.boxOpacity);
  KX._slider(layer, 'Box Extra Width', 0);
  KX._slider(layer, 'Box Extra Height', 0);
  KX._slider(layer, 'Box Extra Roundness', 0);
  var grp = KX._group(KX._contents(layer), 'Box');
  var vec = KX._vectors(grp);
  var x = KX._xform(grp);
  if (box.kind === 'rect') {
    var rc = vec.addProperty('ADBE Vector Shape - Rect');
    rc.name = 'Rect';
    var size = rc.property('ADBE Vector Rect Size');
    KX._keys(size, box.size, 0, true);
    size.expression = 'value + [effect("Box Extra Width")("Slider"), effect("Box Extra Height")("Slider")]';
    var rnd = rc.property('ADBE Vector Rect Roundness');
    KX._keys(rnd, box.round, 0, true);
    rnd.expression = 'value + effect("Box Extra Roundness")("Slider")';
    var gp = x.property('ADBE Vector Position');
    KX._keys(gp, box.pos, 0, true);
    KX._linearSpatial(gp);
    KX._keys(x.property('ADBE Vector Scale'), box.scale, 0, true);
  } else {
    KX._pathKeys(vec, box.path, 0, 'Box Path');
  }
  KX._keys(x.property('ADBE Vector Group Opacity'), box.op, 0, true);
  KX._fill(vec, h.boxColor);
  layer.inPoint = Math.max(0, box['in']);
  layer.outPoint = Math.min(main.duration, box.out + 1 / main.frameRate);
  KX._textBoxLayer = layer;
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
    // order matters: morph (Timewarp) first, then colour the result
    if (h.flow && h.flow.length) KX._flowTimewarp(tl, h.flow, sc);
    KX._layerFill(tl, h.textColor, KX._TEXT_FILL);
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
  if (KX._textBoxLayer) { try { KX._textBoxLayer.moveAfter(lay); } catch (eB) {} KX._textBoxLayer = null; }
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


// --------- Fonts & live text style ---------
/** Installed fonts (AE 2024+ exposes app.fonts). */
KX.listFonts = function () {
  var out = [];
  try {
    var fams = app.fonts.allFonts;
    for (var i = 0; i < fams.length; i++) {
      var fam = fams[i];
      for (var k = 0; k < fam.length; k++) out.push({ ps: fam[k].postScriptName, family: fam[k].familyName, style: fam[k].styleName });
    }
  } catch (e) {}
  return out;
};

KX._styleText = function (L, st) {
  var prop = L.property('ADBE Text Properties').property('ADBE Text Document');
  var apply = function (td) {
    if (st.font) td.font = st.font;
    if (st.size > 0) td.fontSize = st.size;
    if (st.tracking !== null && st.tracking !== undefined) td.tracking = st.tracking;
    if (st.caps !== null && st.caps !== undefined) td.allCaps = !!st.caps;
    return td;
  };
  if (prop.numKeys > 0) {
    for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtKey(k, apply(prop.keyValue(k)));
  } else prop.setValue(apply(prop.value));
};

/**
 * Apply font / size / tracking / caps.
 * target 'selected' = selected text layers in the active comp,
 * target 'built' = every line inside Kinetix text-source comps (live Liquid Glass updates).
 */
KX.textApplyStyle = function (st) {
  app.beginUndoGroup('Kinetix Font');
  var n = 0, comps = [];
  if (st.target === 'built') {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.comment === 'kinetix-text-source') comps.push(it);
    }
    if (!comps.length) throw new Error('No built Text Morph found - build one first.');
    for (var c = 0; c < comps.length; c++)
      for (var l = 1; l <= comps[c].numLayers; l++) if (comps[c].layer(l) instanceof TextLayer) { KX._styleText(comps[c].layer(l), st); n++; }
  } else {
    var comp = KX._comp(null, false);
    var sel = comp.selectedLayers;
    for (var s2 = 0; s2 < sel.length; s2++) if (sel[s2] instanceof TextLayer) { KX._styleText(sel[s2], st); n++; }
    if (!n) throw new Error('Select text layers first.');
  }
  app.endUndoGroup();
  return { layers: n, comps: comps.length };
};

// --------- Animate: eases, expressions, in/out ---------
KX._layerOf = function (prop) { return prop.propertyGroup(prop.propertyDepth); };

KX._easeDims = function (prop) {
  var t = prop.propertyValueType;
  if (t === PropertyValueType.TwoD) return 2;
  if (t === PropertyValueType.ThreeD) return 3;
  return 1;
};

/** Native keyframe ease from a cubic-bezier [x1,y1,x2,y2] on every pair of selected keys. */
KX.easeApplyKeys = function (p) {
  var comp = KX._comp(null, false);
  var props = comp.selectedProperties, nProps = 0, nKeys = 0;
  var b = p.bezier, x1 = Math.max(0.001, b[0]), y1 = b[1], x2 = Math.min(0.999, b[2]), y2 = b[3];
  app.beginUndoGroup('Kinetix Ease');
  for (var i = 0; i < props.length; i++) {
    var pr = props[i];
    if (pr.propertyType !== PropertyType.PROPERTY || pr.numKeys < 2) continue;
    var sel = pr.selectedKeys;
    if (!sel || sel.length < 2) continue;
    var dims = KX._easeDims(pr), touched = false;
    for (var s = 0; s < sel.length - 1; s++) {
      var k = sel[s], k2 = sel[s + 1];
      if (k2 !== k + 1) continue;
      var dt = pr.keyTime(k2) - pr.keyTime(k);
      if (dt <= 0) continue;
      var va = pr.keyValue(k), vb = pr.keyValue(k2), avg = [];
      if (pr.propertyValueType === PropertyValueType.SHAPE || pr.propertyValueType === PropertyValueType.COLOR || pr.propertyValueType === PropertyValueType.CUSTOM_VALUE || pr.propertyValueType === PropertyValueType.MARKER) {
        avg = [0];
      } else if (pr.isSpatial) {
        var d2 = 0;
        for (var q = 0; q < va.length; q++) d2 += (vb[q] - va[q]) * (vb[q] - va[q]);
        avg = [Math.sqrt(d2) / dt];
      } else if (dims === 1) {
        avg = [((vb instanceof Array ? vb[0] : vb) - (va instanceof Array ? va[0] : va)) / dt];
      } else {
        for (var q2 = 0; q2 < dims; q2++) avg.push((vb[q2] - va[q2]) / dt);
      }
      var outE = [], inE = [];
      for (var dd = 0; dd < avg.length; dd++) {
        outE.push(new KeyframeEase((y1 / x1) * avg[dd], Math.max(0.1, Math.min(100, x1 * 100))));
        inE.push(new KeyframeEase(((1 - y2) / (1 - x2)) * avg[dd], Math.max(0.1, Math.min(100, (1 - x2) * 100))));
      }
      var inK = pr.keyInInterpolationType(k), outK2 = pr.keyOutInterpolationType(k2);
      pr.setInterpolationTypeAtKey(k, inK, KeyframeInterpolationType.BEZIER);
      pr.setInterpolationTypeAtKey(k2, KeyframeInterpolationType.BEZIER, outK2);
      pr.setTemporalEaseAtKey(k, pr.keyInTemporalEase(k), outE);
      pr.setTemporalEaseAtKey(k2, inE, pr.keyOutTemporalEase(k2));
      nKeys += 2; touched = true;
    }
    if (touched) nProps++;
  }
  app.endUndoGroup();
  if (!nProps) throw new Error('Select at least two neighbouring keyframes on a property.');
  return { keys: nKeys, props: nProps };
};

KX._ensureSlider = function (layer, name, value) {
  var fx = layer.property('ADBE Effect Parade');
  var e = null;
  for (var i = 1; i <= fx.numProperties; i++) if (fx.property(i).name === name) { e = fx.property(i); break; }
  if (!e) { e = fx.addProperty('ADBE Slider Control'); e.name = name; }
  e.property('ADBE Slider Control-0001').setValue(value);
  return e;
};

KX._TF = { position: 'ADBE Position', scale: 'ADBE Scale', rotation: 'ADBE Rotate Z', opacity: 'ADBE Opacity', rotationX: 'ADBE Rotate X', rotationY: 'ADBE Rotate Y', anchor: 'ADBE Anchor Point' };

KX._tfProp = function (layer, key) {
  var tf = layer.property('ADBE Transform Group');
  if (key === 'position') {
    var pos = tf.property('ADBE Position');
    if (pos.dimensionsSeparated) {
      // only re-join when it is safe (no keys on the separate dimensions)
      if (tf.property('ADBE Position_0').numKeys === 0 && tf.property('ADBE Position_1').numKeys === 0) pos.dimensionsSeparated = false;
      else return null;
    }
    return pos;
  }
  return tf.property(KX._TF[key]);
};

/** Put an expression on the selected properties, or on one transform property of each selected layer. */
KX.exprApply = function (p) {
  var comp = KX._comp(null, false);
  app.beginUndoGroup('Kinetix ' + (p.label || 'Expression'));
  var n = 0, i, layer, pr;
  var withControls = function (ly) { if (p.controls) for (var c = 0; c < p.controls.length; c++) KX._ensureSlider(ly, p.controls[c].name, p.controls[c].value); };
  if (p.target === 'selectedProps') {
    var props = comp.selectedProperties;
    for (i = 0; i < props.length; i++) {
      pr = props[i];
      if (pr.propertyType !== PropertyType.PROPERTY || !pr.canSetExpression) continue;
      withControls(KX._layerOf(pr));
      pr.expression = p.expr;
      n++;
    }
    if (!n) { app.endUndoGroup(); throw new Error('Select one or more properties (e.g. Position) in the timeline first.'); }
  } else {
    var sel = comp.selectedLayers;
    for (i = 0; i < sel.length; i++) {
      layer = sel[i];
      pr = KX._tfProp(layer, p.prop);
      if (!pr || !pr.canSetExpression) continue;
      withControls(layer);
      pr.expression = p.expr;
      n++;
    }
    if (!n) { app.endUndoGroup(); throw new Error('Select one or more layers first.'); }
  }
  app.endUndoGroup();
  return { props: n };
};

KX._ANIM_CTL = { 'KX In Duration': 1, 'KX Out Duration': 1, 'KX Strength': 1 };

KX._animClearLayer = function (layer) {
  var tf = layer.property('ADBE Transform Group');
  for (var k in KX._TF) {
    if (!KX._TF.hasOwnProperty(k)) continue;
    try { var pr = tf.property(KX._TF[k]); if (pr && pr.expression && pr.expression.indexOf('KX-ANIM') >= 0) pr.expression = ''; } catch (e) {}
  }
  var fx = layer.property('ADBE Effect Parade');
  for (var i = fx.numProperties; i >= 1; i--) {
    var ef = fx.property(i), kill = !!KX._ANIM_CTL[ef.name];
    if (!kill) {
      for (var j = 1; j <= ef.numProperties; j++) {
        try { var q = ef.property(j); if (q.expression && q.expression.indexOf('KX-ANIM') >= 0) { kill = true; break; } } catch (e2) {}
      }
    }
    if (kill) ef.remove();
  }
};

KX._fxProp = function (ef, name) {
  try { var p = ef.property(name); if (p) return p; } catch (e) {}
  for (var i = 1; i <= ef.numProperties; i++) { var q = ef.property(i); if (q.name === name) return q; }
  return null;
};

KX.animApply = function (r) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, n = 0, warn = [];
  if (!sel.length) throw new Error('Select one or more layers first.');
  app.beginUndoGroup('Kinetix In/Out');
  for (var i = 0; i < sel.length; i++) {
    var layer = sel[i];
    if (layer instanceof CameraLayer || layer instanceof LightLayer) continue;
    KX._animClearLayer(layer);
    if (r.needs3D && !layer.threeDLayer) layer.threeDLayer = true;
    for (var c = 0; c < r.controls.length; c++) KX._ensureSlider(layer, r.controls[c].name, r.controls[c].value);
    for (var p = 0; p < r.props.length; p++) {
      var pr = KX._tfProp(layer, r.props[p].key);
      if (!pr) { warn.push(layer.name + ': position has keyframes on separated dimensions'); continue; }
      if (pr.expression && pr.expression.indexOf('KX-') < 0) { warn.push(layer.name + ': kept existing ' + r.props[p].key + ' expression'); continue; }
      pr.expression = r.props[p].expr;
    }
    for (var f = 0; f < r.fx.length; f++) {
      var F = r.fx[f], ef;
      try { ef = layer.property('ADBE Effect Parade').addProperty(F.match); } catch (e) { warn.push('Effect not available: ' + F.match); continue; }
      ef.name = F.name;
      for (var sk in F.set) if (F.set.hasOwnProperty(sk)) { var sp = KX._fxProp(ef, sk); if (sp) try { sp.setValue(F.set[sk]); } catch (e3) {} }
      for (var ek in F.expr) if (F.expr.hasOwnProperty(ek)) { var xp = KX._fxProp(ef, ek); if (xp) try { xp.expression = F.expr[ek]; } catch (e4) { warn.push(F.name + '/' + ek + ': ' + e4.message); } }
    }
    n++;
  }
  app.endUndoGroup();
  return { layers: n, warnings: warn };
};

KX.animClear = function () {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers;
  app.beginUndoGroup('Kinetix Clear In/Out');
  for (var i = 0; i < sel.length; i++) KX._animClearLayer(sel[i]);
  app.endUndoGroup();
  return { layers: sel.length };
};

// --------- Camera & 3D (works on AE's own camera / 3D layers) ---------
KX.RIG = 'KX Camera Rig';

/** Evaluate an expression in the comp at its current time (via a temporary 3D point control). */
KX._evalExpr = function (comp, expr) {
  var n = comp.layers.addNull();
  try {
    var pc = n.property('ADBE Effect Parade').addProperty('ADBE Point3D Control');
    var p = pc.property(1);
    p.expression = expr;
    var v = p.valueAtTime(comp.time, false);
    return [v[0], v[1], v[2]];
  } finally { n.remove(); }
};

KX._rig = function (comp) {
  var sel = comp.selectedLayers;
  for (var i = 0; i < sel.length; i++) if (sel[i].name.indexOf(KX.RIG) === 0) return sel[i];
  for (var j = 1; j <= comp.numLayers; j++) if (comp.layer(j).name.indexOf(KX.RIG) === 0) return comp.layer(j);
  return null;
};

KX._rigCam = function (comp, rig) {
  if (!rig) return null;
  for (var j = 1; j <= comp.numLayers; j++) {
    var L = comp.layer(j);
    if (L instanceof CameraLayer && L.comment === 'kx-rig:' + rig.name) return L;
  }
  return null;
};

KX._cam = function (comp) {
  var rig = KX._rig(comp);
  var c = KX._rigCam(comp, rig);
  if (c) return c;
  var sel = comp.selectedLayers;
  for (var i = 0; i < sel.length; i++) if (sel[i] instanceof CameraLayer) return sel[i];
  return comp.activeCamera;
};

KX._slv = function (layer, name) { return layer.property('ADBE Effect Parade').property(name).property('ADBE Slider Control-0001'); };

KX.camScene = function () {
  var comp = KX._comp(null, false);
  var res = { comp: { w: comp.width, h: comp.height, fps: comp.frameRate, time: comp.time, duration: comp.duration, name: comp.name }, rig: null, cameras: [], layers: [], cam: null };
  var rig = KX._rig(comp);
  if (rig) {
    var pos = rig.property('ADBE Transform Group').property('ADBE Position').valueAtTime(comp.time, false);
    var g = function (n) { try { return KX._slv(rig, n).valueAtTime(comp.time, false); } catch (e) { return 0; } };
    res.rig = { name: rig.name, pos: pos, distance: g('Distance'), orbit: g('Orbit'), tilt: g('Tilt'), roll: g('Roll'), focal: g('Focal Length (mm)'), pan: g('Pan'), look: g('Look'), overshoot: g('Overshoot') };
  }
  var cam = KX._cam(comp);
  res.cam = cam ? KX._evalExpr(comp, 'var C=thisComp.layer(' + KXJSON.stringify(cam.name) + ');C.toWorld([0,0,0]);') : [comp.width / 2, comp.height / 2, -comp.width * 50 / 36];
  for (var i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i);
    if (L instanceof CameraLayer) { res.cameras.push({ index: i, name: L.name, active: comp.activeCamera === L }); continue; }
    if (L instanceof LightLayer) continue;
    if (L.name.indexOf('KX Camera') === 0) continue;
    var tf = L.property('ADBE Transform Group');
    var r = { left: 0, top: 0, width: 100, height: 100 };
    try { r = L.sourceRectAtTime(comp.time, false); } catch (e2) {}
    var p = tf.property('ADBE Position').valueAtTime(comp.time, false);
    var s = tf.property('ADBE Scale').valueAtTime(comp.time, false);
    var rot = [0, 0, 0];
    try { rot = [tf.property('ADBE Rotate X').valueAtTime(comp.time, false), tf.property('ADBE Rotate Y').valueAtTime(comp.time, false), tf.property('ADBE Rotate Z').valueAtTime(comp.time, false)]; } catch (e3) {}
    res.layers.push({ index: i, name: L.name, threeD: L.threeDLayer, pos: [p[0], p[1], p.length > 2 ? p[2] : 0], scale: [s[0], s[1], s.length > 2 ? s[2] : 100], rot: rot, w: r.width, h: r.height, sel: L.selected, kind: L instanceof TextLayer ? 'text' : L instanceof ShapeLayer ? 'shape' : 'footage' });
  }
  return res;
};

KX._newNull3D = function (comp, name, parent) {
  var n = comp.layers.addNull();
  n.name = name;
  n.threeDLayer = true;
  n.label = 9;
  n.shy = false;
  n.property('ADBE Transform Group').property('ADBE Anchor Point').setValue([0, 0, 0]);
  if (parent) { n.parent = parent; n.property('ADBE Transform Group').property('ADBE Position').setValue([0, 0, 0]); }
  return n;
};

/** Universal rig: Rig (target, orbit) > Tilt > Shake > one-node Camera, all driven by sliders. */
KX.camRig = function (p) {
  var comp = KX._comp(null, false);
  var existing = KX._rig(comp);
  if (existing && !p.forceNew) return { rig: existing.name, existed: true };
  app.beginUndoGroup('Kinetix Camera Rig');
  var name = KX._uniqueName(comp, KX.RIG);
  var L = '"' + name + '"';
  var rig = KX._newNull3D(comp, name, null);
  rig.property('ADBE Transform Group').property('ADBE Position').setValue([comp.width / 2, comp.height / 2, 0]);
  var mm = p.lens || 50;
  var zoom = comp.width * mm / 36;
  KX._slider(rig, 'Distance', zoom);
  KX._slider(rig, 'Orbit', 0);
  KX._slider(rig, 'Tilt', 0);
  KX._slider(rig, 'Roll', 0);
  KX._slider(rig, 'Pan', 0);
  KX._slider(rig, 'Look', 0);
  KX._slider(rig, 'Focal Length (mm)', mm);
  KX._slider(rig, 'Overshoot', 0);
  rig.property('ADBE Transform Group').property('ADBE Rotate Y').expression = '// KX-RIG\neffect("Orbit")("Slider")';
  var tilt = KX._newNull3D(comp, name + ' Tilt', rig);
  tilt.property('ADBE Transform Group').property('ADBE Rotate X').expression = '// KX-RIG\n-thisComp.layer(' + L + ').effect("Tilt")("Slider")';
  var shake = KX._newNull3D(comp, name + ' Shake', tilt);
  var cam = comp.layers.addCamera(name + ' Cam', [comp.width / 2, comp.height / 2]);
  cam.comment = 'kx-rig:' + name;
  cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
  cam.parent = shake;
  var ct = cam.property('ADBE Transform Group');
  ct.property('ADBE Orientation').setValue([0, 0, 0]);
  ct.property('ADBE Position').expression = '// KX-RIG\n[0,0,-thisComp.layer(' + L + ').effect("Distance")("Slider")]';
  ct.property('ADBE Rotate Y').expression = '// KX-RIG\nthisComp.layer(' + L + ').effect("Pan")("Slider")';
  ct.property('ADBE Rotate X').expression = '// KX-RIG\n-thisComp.layer(' + L + ').effect("Look")("Slider")';
  ct.property('ADBE Rotate Z').expression = '// KX-RIG\nthisComp.layer(' + L + ').effect("Roll")("Slider")';
  var co = cam.property('ADBE Camera Options Group');
  co.property('ADBE Camera Zoom').expression = '// KX-RIG\nthisComp.width*thisComp.layer(' + L + ').effect("Focal Length (mm)")("Slider")/36';
  if (p.dof) co.property('ADBE Camera Depth of Field').setValue(1);
  // hide helper nulls from the timeline clutter
  tilt.shy = true; shake.shy = true;
  cam.moveToBeginning(); rig.moveToBeginning();
  app.endUndoGroup();
  return { rig: name, existed: false };
};

KX.camCreate = function (p) {
  var comp = KX._comp(null, false);
  app.beginUndoGroup('Kinetix Camera');
  var cam = comp.layers.addCamera(KX._uniqueName(comp, p.type === 'two' ? 'KX Camera 2-Node' : 'KX Camera 1-Node'), [comp.width / 2, comp.height / 2]);
  if (p.type !== 'two') cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
  cam.property('ADBE Camera Options Group').property('ADBE Camera Zoom').setValue(comp.width * (p.lens || 50) / 36);
  cam.property('ADBE Transform Group').property('ADBE Position').setValue([comp.width / 2, comp.height / 2, -comp.width * (p.lens || 50) / 36]);
  app.endUndoGroup();
  return { camera: cam.name };
};

KX._rigProp = function (rig, target) {
  var tf = rig.property('ADBE Transform Group');
  switch (target) {
    case 'distance': return KX._slv(rig, 'Distance');
    case 'orbit': return KX._slv(rig, 'Orbit');
    case 'tilt': return KX._slv(rig, 'Tilt');
    case 'roll': return KX._slv(rig, 'Roll');
    case 'pan': return KX._slv(rig, 'Pan');
    case 'look': return KX._slv(rig, 'Look');
    case 'focal': return KX._slv(rig, 'Focal Length (mm)');
    default: return tf.property('ADBE Position');
  }
};

KX._OVERSHOOT = '\n// KX-PHYS\nvar amp=thisComp.layer("%RIG%").effect("Overshoot")("Slider")/100*0.09,fr=1.8,dc=5.5;var n=0;if(numKeys>0){n=nearestKey(time).index;if(key(n).time>time)n--;}' +
  'if(n>1&&amp>0&&time>key(n).time){var t=time-key(n).time,vel=velocityAtTime(key(n).time-thisComp.frameDuration/10),w=amp*Math.sin(fr*t*2*Math.PI)/Math.exp(dc*t);(value instanceof Array)?add(value,mul(vel,w)):value+vel*w;}else value;';

/** Keyframe rig controls from their value at t0 to a target value at t0+dur, with ease. */
KX.camKeys = function (p) {
  var comp = KX._comp(null, false);
  var rig = KX._rig(comp);
  if (!rig) { KX.camRig({ lens: 50 }); rig = KX._rig(comp); }
  app.beginUndoGroup('Kinetix Camera Move');
  var t0 = (p.t0 === null || p.t0 === undefined) ? comp.time : p.t0;
  var t1 = t0 + Math.max(1 / comp.frameRate, p.dur);
  KX._ensureDuration(comp, t1 + 0.5);
  var touched = [];
  for (var i = 0; i < p.ops.length; i++) {
    var o = p.ops[i];
    var prop = KX._rigProp(rig, o.target);
    var cur = prop.valueAtTime(t0, false);
    var from = cur, to;
    if (o.target === 'rigX' || o.target === 'rigY' || o.target === 'rigZ') {
      var ax = o.target === 'rigX' ? 0 : o.target === 'rigY' ? 1 : 2;
      to = [cur[0], cur[1], cur[2]];
      to[ax] = o.op === 'set' ? o.value : o.op === 'mul' ? cur[ax] * o.value : cur[ax] + o.value;
    } else {
      if (o.from !== null && o.from !== undefined) from = o.from;
      to = o.op === 'set' ? o.value : o.op === 'mul' ? from * o.value : from + o.value;
    }
    var k0 = prop.addKey(t0); prop.setValueAtKey(k0, from);
    var k1 = prop.addKey(t1); prop.setValueAtKey(k1, to);
    touched.push(prop);
    if (prop.isSpatial) KX._linearSpatial(prop);
  }
  // ease every touched property between the two new keys
  for (var j = 0; j < touched.length; j++) {
    var pr = touched[j];
    var a = pr.nearestKeyIndex(t0), b = pr.nearestKeyIndex(t1);
    var bz = p.bezier || [0.33, 0, 0.67, 1];
    var dt = t1 - t0, va = pr.keyValue(a), vb = pr.keyValue(b), avg;
    if (pr.isSpatial) { var d2 = 0; for (var q = 0; q < va.length; q++) d2 += (vb[q] - va[q]) * (vb[q] - va[q]); avg = Math.sqrt(d2) / dt; }
    else avg = ((vb instanceof Array ? vb[0] : vb) - (va instanceof Array ? va[0] : va)) / dt;
    var x1 = Math.max(0.001, bz[0]), y1 = bz[1], x2 = Math.min(0.999, bz[2]), y2 = bz[3];
    pr.setInterpolationTypeAtKey(a, pr.keyInInterpolationType(a), KeyframeInterpolationType.BEZIER);
    pr.setInterpolationTypeAtKey(b, KeyframeInterpolationType.BEZIER, pr.keyOutInterpolationType(b));
    pr.setTemporalEaseAtKey(a, pr.keyInTemporalEase(a), [new KeyframeEase((y1 / x1) * avg, Math.max(0.1, x1 * 100))]);
    pr.setTemporalEaseAtKey(b, [new KeyframeEase(((1 - y2) / (1 - x2)) * avg, Math.max(0.1, (1 - x2) * 100))], pr.keyOutTemporalEase(b));
    if (p.physical) pr.expression = KX._OVERSHOOT.replace(/%RIG%/g, rig.name);
  }
  if (p.physical) KX._slv(rig, 'Overshoot').setValue(p.physical);
  if (p.marker) { try { var mv = new MarkerValue('KX:cam ' + p.marker); mv.duration = t1 - t0; rig.property('ADBE Marker').setValueAtTime(t0, mv); } catch (eM) {} }
  app.endUndoGroup();
  return { rig: rig.name, t0: t0, t1: t1 };
};

KX.camSetRig = function (p) {
  var comp = KX._comp(null, false);
  var rig = KX._rig(comp);
  if (!rig) throw new Error('Create a Kinetix rig first.');
  app.beginUndoGroup('Kinetix Rig');
  for (var k in p) {
    if (!p.hasOwnProperty(k)) continue;
    var prop = KX._rigProp(rig, k);
    if (prop.numKeys > 0) prop.setValueAtTime(comp.time, p[k]); else prop.setValue(p[k]);
  }
  app.endUndoGroup();
  return true;
};

KX.camLens = function (p) {
  var comp = KX._comp(null, false);
  var rig = KX._rig(comp);
  app.beginUndoGroup('Kinetix Lens');
  if (rig) {
    var f = KX._slv(rig, 'Focal Length (mm)');
    if (f.numKeys > 0) f.setValueAtTime(comp.time, p.mm); else f.setValue(p.mm);
  } else {
    var cam = KX._cam(comp);
    if (!cam) { app.endUndoGroup(); throw new Error('No camera in this comp - create one first.'); }
    var z = cam.property('ADBE Camera Options Group').property('ADBE Camera Zoom');
    var v = comp.width * p.mm / 36;
    if (z.numKeys > 0) z.setValueAtTime(comp.time, v); else z.setValue(v);
  }
  app.endUndoGroup();
  return true;
};

/** Write positions / scales / rotations for many layers at once. */
KX.camLayout = function (p) {
  var comp = KX._comp(null, false);
  app.beginUndoGroup('Kinetix 3D Layout');
  for (var i = 0; i < p.items.length; i++) {
    var it = p.items[i], L = comp.layer(it.index);
    if (!L || L instanceof CameraLayer || L instanceof LightLayer) continue;
    if (!L.threeDLayer) L.threeDLayer = true;
    var tf = L.property('ADBE Transform Group');
    var setv = function (prop, v) { if (prop.numKeys > 0) prop.setValueAtTime(comp.time, v); else prop.setValue(v); };
    var pos = tf.property('ADBE Position');
    if (pos.dimensionsSeparated) pos.dimensionsSeparated = false;
    setv(pos, it.pos);
    if (it.scale) setv(tf.property('ADBE Scale'), it.scale);
    if (it.rot) { setv(tf.property('ADBE Rotate X'), it.rot[0]); setv(tf.property('ADBE Rotate Y'), it.rot[1]); setv(tf.property('ADBE Rotate Z'), it.rot[2]); }
    if (p.face !== undefined) L.autoOrient = p.face ? AutoOrientType.CAMERA_OR_POINT_OF_INTEREST : AutoOrientType.NO_AUTO_ORIENT;
  }
  app.endUndoGroup();
  return { layers: p.items.length };
};

KX.camMake3D = function (p) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, n = 0;
  app.beginUndoGroup('Kinetix 3D');
  for (var i = 0; i < sel.length; i++) { if (sel[i] instanceof CameraLayer || sel[i] instanceof LightLayer) continue; sel[i].threeDLayer = p.on; n++; }
  app.endUndoGroup();
  return { layers: n };
};

KX._camExprName = function (comp) {
  var cam = KX._cam(comp);
  if (!cam) throw new Error('No camera in this comp - create one first.');
  return cam;
};

/** Depth of field: auto-focus on a layer, rack focus between layers, or off. */
KX.camFocus = function (p) {
  var comp = KX._comp(null, false);
  var cam = KX._camExprName(comp);
  app.beginUndoGroup('Kinetix Focus');
  var co = cam.property('ADBE Camera Options Group');
  var fd = co.property('ADBE Camera Focus Distance'), ap = co.property('ADBE Camera Aperture');
  if (p.mode === 'off') { co.property('ADBE Camera Depth of Field').setValue(0); fd.expression = ''; app.endUndoGroup(); return true; }
  co.property('ADBE Camera Depth of Field').setValue(1);
  if (p.blur) co.property('ADBE Camera Blur Level').setValue(p.blur);
  if (p.fstop) ap.expression = '// KX-FOCUS\ncameraOption.zoom/' + p.fstop;
  var dist = 'function D(n){var L=thisComp.layer(n),c=toWorld([0,0,0]),v=normalize(toWorldVec([0,0,1]));return Math.max(1,dot(sub(L.toWorld(L.anchorPoint),c),v));}\n';
  if (p.mode === 'auto') {
    fd.expression = '// KX-FOCUS\n' + dist + 'D(' + KXJSON.stringify(p.layers[0]) + ');';
  } else {
    // rack focus: hold on each layer, then pull focus to the next over `pull` seconds
    fd.expression = '// KX-FOCUS rack\n' + dist + 'var N=' + KXJSON.stringify(p.layers) + ',T=' + KXJSON.stringify(p.times) + ',P=' + (p.pull || 0.6) + ';\n' +
      'var i=0;while(i<T.length-1&&time>=T[i+1])i++;var d=D(N[i]);if(i<T.length-1&&time>T[i+1]-P)d=ease(time,T[i+1]-P,T[i+1],D(N[i]),D(N[i+1]));d;';
  }
  app.endUndoGroup();
  return true;
};

/** Shake: expressions on the rig's shake null (or a new parent null for a plain camera). */
KX.camShake = function (p) {
  var comp = KX._comp(null, false);
  app.beginUndoGroup('Kinetix Camera Shake');
  var rig = KX._rig(comp), sh = null;
  if (rig) sh = KX._byName(comp, rig.name + ' Shake');
  if (!sh) {
    var cam = KX._camExprName(comp);
    sh = KX._newNull3D(comp, KX._uniqueName(comp, 'KX Camera Shake'), null);
    sh.moveBefore(cam);
    if (cam.parent) sh.parent = cam.parent;
    cam.parent = sh;
  }
  KX._ensureSlider(sh, 'KX Shake Amount', p.amount);
  KX._ensureSlider(sh, 'KX Shake Speed', p.speed);
  KX._ensureSlider(sh, 'KX Shake Seed', p.seed);
  var tf = sh.property('ADBE Transform Group');
  if (p.clear) { tf.property('ADBE Position').expression = ''; tf.property('ADBE Rotate X').expression = ''; tf.property('ADBE Rotate Y').expression = ''; tf.property('ADBE Rotate Z').expression = ''; }
  else {
    tf.property('ADBE Position').expression = p.pos;
    tf.property('ADBE Rotate X').expression = p.rx;
    tf.property('ADBE Rotate Y').expression = p.ry;
    tf.property('ADBE Rotate Z').expression = p.rz;
    if (p.atTime) { sh.inPoint = 0; }
  }
  app.endUndoGroup();
  return { layer: sh.name };
};

/** Fit the rig (or camera) so the selected layers fill the frame. */
KX.camFrame = function (p) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, xs = [], ys = [], zs = [];
  for (var i = 0; i < sel.length; i++) {
    var L = sel[i];
    if (L instanceof CameraLayer || L instanceof LightLayer || L.name.indexOf('KX Camera') === 0) continue;
    var r = L.sourceRectAtTime(comp.time, false), tf = L.property('ADBE Transform Group');
    var pos = tf.property('ADBE Position').valueAtTime(comp.time, false), sc = tf.property('ADBE Scale').valueAtTime(comp.time, false);
    var w = r.width * Math.abs(sc[0]) / 100, h = r.height * Math.abs(sc[1]) / 100;
    xs.push(pos[0] - w / 2, pos[0] + w / 2); ys.push(pos[1] - h / 2, pos[1] + h / 2); zs.push(pos.length > 2 ? pos[2] : 0);
  }
  if (!xs.length) throw new Error('Select the layers to frame.');
  var mn = function (a) { var m = a[0]; for (var k = 1; k < a.length; k++) if (a[k] < m) m = a[k]; return m; };
  var mx = function (a) { var m = a[0]; for (var k = 1; k < a.length; k++) if (a[k] > m) m = a[k]; return m; };
  var cx = (mn(xs) + mx(xs)) / 2, cy = (mn(ys) + mx(ys)) / 2, cz = 0;
  for (var z = 0; z < zs.length; z++) cz += zs[z] / zs.length;
  var bw = (mx(xs) - mn(xs)) * (p.margin || 1.15), bh = (mx(ys) - mn(ys)) * (p.margin || 1.15);
  var rig = KX._rig(comp);
  if (!rig) { KX.camRig({ lens: 50 }); rig = KX._rig(comp); }
  var mm = KX._slv(rig, 'Focal Length (mm)').valueAtTime(comp.time, false), zoom = comp.width * mm / 36;
  var dist = Math.max((bw / 2) * zoom / (comp.width / 2), (bh / 2) * zoom / (comp.height / 2));
  app.beginUndoGroup('Kinetix Frame');
  var pp = rig.property('ADBE Transform Group').property('ADBE Position'), dd = KX._slv(rig, 'Distance');
  if (pp.numKeys > 0) pp.setValueAtTime(comp.time, [cx, cy, cz]); else pp.setValue([cx, cy, cz]);
  if (dd.numKeys > 0) dd.setValueAtTime(comp.time, dist); else dd.setValue(dist);
  app.endUndoGroup();
  return { center: [cx, cy, cz], distance: dist };
};

/** Visit the selected layers one by one (selection order). */
KX.camTour = function (p) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, stops = [];
  for (var i = 0; i < sel.length; i++) {
    var L = sel[i];
    if (L instanceof CameraLayer || L instanceof LightLayer || L.name.indexOf('KX Camera') === 0) continue;
    var r = L.sourceRectAtTime(comp.time, false), tf = L.property('ADBE Transform Group');
    var pos = tf.property('ADBE Position').valueAtTime(comp.time, false), sc = tf.property('ADBE Scale').valueAtTime(comp.time, false);
    stops.push({ pos: [pos[0], pos[1], pos.length > 2 ? pos[2] : 0], w: r.width * Math.abs(sc[0]) / 100, h: r.height * Math.abs(sc[1]) / 100 });
  }
  if (stops.length < 2) throw new Error('Select two or more layers (in the order to visit them).');
  var rig = KX._rig(comp);
  if (!rig) { KX.camRig({ lens: 50 }); rig = KX._rig(comp); }
  app.beginUndoGroup('Kinetix Camera Tour');
  var pp = rig.property('ADBE Transform Group').property('ADBE Position'), dd = KX._slv(rig, 'Distance'), oo = KX._slv(rig, 'Orbit');
  var mm = KX._slv(rig, 'Focal Length (mm)').valueAtTime(comp.time, false), zoom = comp.width * mm / 36;
  var t = comp.time;
  var bz = p.bezier || [0.65, 0, 0.25, 1];
  for (var s = 0; s < stops.length; s++) {
    var S = stops[s];
    var dist = Math.max((S.w * 0.65) * zoom / (comp.width / 2), (S.h * 0.65) * zoom / (comp.height / 2));
    var orbit = p.orbit ? (s % 2 ? -1 : 1) * p.orbit : 0;
    var keys = [[pp, S.pos], [dd, dist], [oo, orbit]];
    for (var q = 0; q < keys.length; q++) {
      var a = keys[q][0].addKey(t); keys[q][0].setValueAtKey(a, keys[q][1]);
      var b = keys[q][0].addKey(t + p.hold); keys[q][0].setValueAtKey(b, keys[q][1]);
    }
    t += p.hold + (s < stops.length - 1 ? p.travel : 0);
  }
  KX._linearSpatial(pp);
  var props = [pp, dd, oo];
  for (var z = 0; z < props.length; z++) {
    var pr = props[z];
    for (var k = 1; k <= pr.numKeys; k++) {
      pr.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
      var e1 = [new KeyframeEase(0, Math.max(0.1, (1 - bz[2]) * 100))], e2 = [new KeyframeEase(0, Math.max(0.1, bz[0] * 100))];
      pr.setTemporalEaseAtKey(k, e1, e2);
    }
  }
  KX._ensureDuration(comp, t + 0.5);
  app.endUndoGroup();
  return { stops: stops.length, end: t };
};

/** The rig follows a layer with smoothing. */
KX.camFollow = function (p) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, target = null;
  for (var i = 0; i < sel.length; i++) if (!(sel[i] instanceof CameraLayer) && sel[i].name.indexOf('KX Camera') !== 0) { target = sel[i]; break; }
  var rig = KX._rig(comp);
  if (!rig) { KX.camRig({ lens: 50 }); rig = KX._rig(comp); }
  app.beginUndoGroup('Kinetix Follow');
  var pp = rig.property('ADBE Transform Group').property('ADBE Position');
  if (p.off || !target) { pp.expression = ''; app.endUndoGroup(); return { following: null }; }
  pp.expression = '// KX-FOLLOW\nvar L=thisComp.layer(' + KXJSON.stringify(target.name) + '),s=' + (p.smooth || 0.3) + ',n=8,acc=[0,0,0];' +
    'for(var i=0;i<n;i++){var t=time-s*i/n;var q=L.toWorld(L.anchorPoint,t);acc=add(acc,q);}mul(acc,1/n);';
  app.endUndoGroup();
  return { following: target.name };
};

/** Opacity expressions on the selected 3D layers: hide behind camera, or fade/blur with distance. */
KX.camDepthFx = function (p) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, n = 0;
  app.beginUndoGroup('Kinetix Depth FX');
  for (var i = 0; i < sel.length; i++) {
    var L = sel[i];
    if (L instanceof CameraLayer || L instanceof LightLayer) continue;
    if (!L.threeDLayer) L.threeDLayer = true;
    var op = L.property('ADBE Transform Group').property('ADBE Opacity');
    var D = 'var C=thisComp.activeCamera,c=C.toWorld([0,0,0]),d=length(toWorld(anchorPoint),c);';
    if (p.mode === 'cull') op.expression = '// KX-CULL\nvar C=thisComp.activeCamera;var v=sub(toWorld(anchorPoint),C.toWorld([0,0,0]));dot(v,C.toWorldVec([0,0,1]))<0?0:value;';
    else if (p.mode === 'fade') op.expression = '// KX-DEPTH\n' + D + 'value*linear(d,' + p.near + ',' + p.far + ',1,0);';
    else if (p.mode === 'fog') {
      op.expression = '// KX-DEPTH\n' + D + 'value*linear(d,' + p.near + ',' + p.far + ',1,0.35);';
      var fx = L.property('ADBE Effect Parade');
      var bl = null;
      for (var j = 1; j <= fx.numProperties; j++) if (fx.property(j).name === 'KX Depth Blur') bl = fx.property(j);
      if (!bl) { bl = fx.addProperty('ADBE Box Blur2'); bl.name = 'KX Depth Blur'; }
      bl.property(1).expression = '// KX-DEPTH\n' + D + 'linear(d,' + p.near + ',' + p.far + ',0,' + (p.blur || 20) + ');';
    } else op.expression = '';
    n++;
  }
  app.endUndoGroup();
  return { layers: n };
};

KX.camMotionBlur = function (p) {
  var comp = KX._comp(null, false);
  app.beginUndoGroup('Kinetix Motion Blur');
  comp.motionBlur = p.on;
  if (p.angle) comp.shutterAngle = p.angle;
  var n = 0;
  for (var i = 1; i <= comp.numLayers; i++) { var L = comp.layer(i); if (L instanceof CameraLayer || L instanceof LightLayer) continue; if (L.threeDLayer || L.selected) { L.motionBlur = p.on; n++; } }
  app.endUndoGroup();
  return { layers: n };
};

/** Bake every expression on the rig / camera layers into per-frame keyframes. */
KX.camBake = function () {
  var comp = KX._comp(null, false);
  var rig = KX._rig(comp), layers = [];
  for (var i = 1; i <= comp.numLayers; i++) { var L = comp.layer(i); if (L.name.indexOf('KX Camera') === 0 || L instanceof CameraLayer) layers.push(L); }
  app.beginUndoGroup('Kinetix Bake Camera');
  var n = 0, t0 = comp.workAreaStart, t1 = comp.workAreaStart + comp.workAreaDuration, fd = comp.frameDuration;
  var bake = function (prop) {
    if (prop.propertyType === PropertyType.PROPERTY) {
      if (!prop.expressionEnabled || !prop.expression || !prop.canVaryOverTime) return;
      var times = [], vals = [];
      for (var t = t0; t <= t1 + 1e-6; t += fd) { times.push(t); vals.push(prop.valueAtTime(t, false)); }
      prop.expression = '';
      while (prop.numKeys > 0) prop.removeKey(1);
      prop.setValuesAtTimes(times, vals);
      n++;
    } else for (var k = 1; k <= prop.numProperties; k++) bake(prop.property(k));
  };
  for (var j = 0; j < layers.length; j++) { bake(layers[j].property('ADBE Transform Group')); try { bake(layers[j].property('ADBE Camera Options Group')); } catch (e) {} }
  app.endUndoGroup();
  return { props: n };
};

/** Smooth the selected keyframed properties (removes jitter between keys). */
KX.camSmooth = function (p) {
  var comp = KX._comp(null, false);
  var props = comp.selectedProperties, n = 0, s = p.strength || 0.5;
  app.beginUndoGroup('Kinetix Smooth');
  for (var i = 0; i < props.length; i++) {
    var pr = props[i];
    if (pr.propertyType !== PropertyType.PROPERTY || pr.numKeys < 3) continue;
    var vals = [];
    for (var k = 1; k <= pr.numKeys; k++) vals.push(pr.keyValue(k));
    for (var k2 = 2; k2 < pr.numKeys; k2++) {
      var a = vals[k2 - 2], b = vals[k2 - 1], c = vals[k2], v;
      if (b instanceof Array) { v = []; for (var d = 0; d < b.length; d++) v.push(b[d] * (1 - s) + (a[d] + c[d]) / 2 * s); }
      else v = b * (1 - s) + (a + c) / 2 * s;
      pr.setValueAtKey(k2, v);
    }
    n++;
  }
  app.endUndoGroup();
  if (!n) throw new Error('Select properties with 3 or more keyframes.');
  return { props: n };
};

/** Cut between the selected cameras at the comp markers (in selection order). */
KX.camCuts = function () {
  var comp = KX._comp(null, false);
  var cams = [];
  for (var i = 0; i < comp.selectedLayers.length; i++) if (comp.selectedLayers[i] instanceof CameraLayer) cams.push(comp.selectedLayers[i]);
  if (cams.length < 2) throw new Error('Select two or more cameras (in shot order).');
  var mk = comp.markerProperty, times = [];
  for (var m = 1; m <= mk.numKeys; m++) times.push(mk.keyTime(m));
  if (times.length < cams.length - 1) throw new Error('Add ' + (cams.length - 1) + ' comp markers where the cuts should happen.');
  app.beginUndoGroup('Kinetix Camera Cuts');
  for (var c = 0; c < cams.length; c++) {
    cams[c].inPoint = c === 0 ? 0 : times[c - 1];
    cams[c].outPoint = c === cams.length - 1 ? comp.duration : times[c];
  }
  app.endUndoGroup();
  return { cameras: cams.length };
};

// --------- Type animator (live AE text animators) ---------
KX._TYPE_PROPS = { pos: 'ADBE Text Position 3D', scale: 'ADBE Text Scale 3D', rot: 'ADBE Text Rotation', rotX: 'ADBE Text Rotation X', rotY: 'ADBE Text Rotation Y',
  opacity: 'ADBE Text Opacity', blur: 'ADBE Text Blur', tracking: 'ADBE Text Tracking Amount', skew: 'ADBE Text Skew', charOffset: 'ADBE Text Character Offset', fillHue: 'ADBE Text Fill Hue' };

KX._typeClearLayer = function (L) {
  var an = L.property('ADBE Text Properties').property('ADBE Text Animators');
  for (var i = an.numProperties; i >= 1; i--) if (an.property(i).name.indexOf('KX Type') === 0) an.property(i).remove();
  var fx = L.property('ADBE Effect Parade');
  for (var j = fx.numProperties; j >= 1; j--) if (fx.property(j).name.indexOf('KX Type') === 0) fx.property(j).remove();
};

KX.typeApply = function (r) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, n = 0;
  app.beginUndoGroup('Kinetix Type');
  for (var s = 0; s < sel.length; s++) {
    var L = sel[s];
    if (!(L instanceof TextLayer)) continue;
    KX._typeClearLayer(L);
    for (var c = 0; c < r.controls.length; c++) KX._ensureSlider(L, r.controls[c].name, r.controls[c].value);
    if (r.threeD) { try { L.threeDPerChar = true; } catch (e3) {} }
    try {
      var mo = L.property('ADBE Text Properties').property('ADBE Text More Options');
      mo.property('ADBE Text Anchor Point Option').setValue(r.grouping);
      mo.property('ADBE Text Anchor Point Align').setValue([0, -50]);
    } catch (e4) {}
    var animators = function () { return L.property('ADBE Text Properties').property('ADBE Text Animators'); };
    for (var a = 0; a < r.animators.length; a++) {
      var spec = r.animators[a];
      animators().addProperty('ADBE Text Animator');
      var ai = animators().numProperties;
      animators().property(ai).name = spec.name;
      for (var k in spec.props) {
        if (!spec.props.hasOwnProperty(k) || !KX._TYPE_PROPS[k]) continue;
        var mn = KX._TYPE_PROPS[k], v = spec.props[k];
        try {
          animators().property(ai).property('ADBE Text Animator Properties').addProperty(mn);
          var pr = animators().property(ai).property('ADBE Text Animator Properties').property(mn);
          if (k === 'blur') v = [v, v];
          pr.setValue(v);
        } catch (e5) {}
      }
      animators().property(ai).property('ADBE Text Selectors').addProperty('ADBE Text Expressible Selector');
      var sels = animators().property(ai).property('ADBE Text Selectors'), ex = null;
      for (var q = 1; q <= sels.numProperties; q++) if (sels.property(q).matchName === 'ADBE Text Expressible Selector') ex = sels.property(q);
      try { ex.property('ADBE Text Range Type2').setValue(spec.basedOn); } catch (e6) {}
      ex.property('ADBE Text Expressible Amount').expression = spec.amount;
    }
    n++;
  }
  app.endUndoGroup();
  if (!n) throw new Error('Select one or more text layers first.');
  return { layers: n };
};

KX.typeClear = function () {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, n = 0;
  app.beginUndoGroup('Kinetix Type Clear');
  for (var s = 0; s < sel.length; s++) if (sel[s] instanceof TextLayer) { KX._typeClearLayer(sel[s]); n++; }
  app.endUndoGroup();
  return { layers: n };
};

// --------- Physics ---------
KX.physScene = function () {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, out = [];
  for (var i = 0; i < sel.length; i++) {
    var L = sel[i];
    if (L instanceof CameraLayer || L instanceof LightLayer) continue;
    var tf = L.property('ADBE Transform Group');
    var r = L.sourceRectAtTime(comp.time, false);
    var pos = tf.property('ADBE Position').valueAtTime(comp.time, false), an = tf.property('ADBE Anchor Point').valueAtTime(comp.time, false);
    var sc = tf.property('ADBE Scale').valueAtTime(comp.time, false), rot = tf.property('ADBE Rotate Z').valueAtTime(comp.time, false);
    var a = rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    var lx = (r.left + r.width / 2 - an[0]) * sc[0] / 100, ly = (r.top + r.height / 2 - an[1]) * sc[1] / 100;
    var ox = lx * ca - ly * sa, oy = lx * sa + ly * ca;
    out.push({ index: L.index, name: L.name, cx: pos[0] + ox, cy: pos[1] + oy, w: r.width * Math.abs(sc[0]) / 100, h: r.height * Math.abs(sc[1]) / 100, rot: rot, offX: ox, offY: oy, pos: pos,
      kind: L instanceof TextLayer ? 'text' : L instanceof ShapeLayer ? 'shape' : 'footage' });
  }
  return { comp: { w: comp.width, h: comp.height, fps: comp.frameRate, time: comp.time }, layers: out };
};

KX.physBake = function (p) {
  var comp = KX._comp(null, false);
  var t0 = comp.time, n = 0;
  app.beginUndoGroup('Kinetix Physics');
  for (var i = 0; i < p.items.length; i++) {
    var it = p.items[i], L = comp.layer(it.index);
    if (!L) continue;
    var tf = L.property('ADBE Transform Group'), pos = tf.property('ADBE Position');
    if (pos.dimensionsSeparated) pos.dimensionsSeparated = false;
    var z = L.threeDLayer ? pos.valueAtTime(t0, false)[2] : null;
    var vals = [];
    for (var k = 0; k < it.pos.v.length; k++) vals.push(z === null ? it.pos.v[k] : [it.pos.v[k][0], it.pos.v[k][1], z]);
    KX._keys(pos, { t: it.pos.t, v: vals }, t0, true);
    KX._linearSpatial(pos);
    KX._keys(tf.property('ADBE Rotate Z'), it.rot, t0, true);
    KX._ensureDuration(comp, t0 + it.pos.t[it.pos.t.length - 1] + 0.5);
    n++;
  }
  for (var h = 0; h < p.hits.length; h++) {
    var H = p.hits[h], HL = comp.layer(H.index);
    if (!HL) continue;
    try { HL.property('ADBE Marker').setValueAtTime(t0 + H.t, new MarkerValue('KX:hit ' + H.speed + ' x' + Math.round(H.x * 100))); } catch (e) {}
  }
  app.endUndoGroup();
  return { layers: n };
};

// --------- Sound Lab / Auto-SFX ---------
KX.sfxFolder = function () {
  if (app.project && app.project.file) return app.project.file.parent.fsName + '/Kinetix SFX';
  return null;
};

KX._projFolder = function (name) {
  for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof FolderItem && it.name === name) return it; }
  return app.project.items.addFolder(name);
};

/** Collect animation events: Kinetix markers, keyframed moves and layer in/out animations. */
KX.sfxScan = function (p) {
  var comp = KX._comp(null, false);
  var ev = [], W = comp.width;
  var layers = [];
  if (p.scope === 'selected') layers = comp.selectedLayers; else for (var i = 1; i <= comp.numLayers; i++) layers.push(comp.layer(i));
  for (var l = 0; l < layers.length; l++) {
    var L = layers[l];
    if (L.hasAudio && !L.hasVideo) continue;
    if (!L.enabled && !(L instanceof CameraLayer) && L.name.indexOf('KX Camera') !== 0) continue;
    var tf = null;
    try { tf = L.property('ADBE Transform Group'); } catch (e0) {}
    var px = 0.5;
    try { px = tf.property('ADBE Position').valueAtTime(comp.time, false)[0] / W; } catch (e1) {}
    if (p.markers) {
      var mk = L.property('ADBE Marker');
      for (var m = 1; m <= mk.numKeys; m++) {
        var c = String(mk.keyValue(m).comment);
        if (c.indexOf('KX:') !== 0) continue;
        var kind = c.split(' ')[0].substring(3), parts = c.split(' '), strength = 0.6, x = px;
        for (var q = 1; q < parts.length; q++) {
          if (parts[q].charAt(0) === 'x') x = parseFloat(parts[q].substring(1)) / 100;
          else if (!isNaN(parseFloat(parts[q]))) strength = Math.min(1, parseFloat(parts[q]) / 40);
        }
        ev.push({ t: mk.keyTime(m), dur: mk.keyValue(m).duration, kind: kind, strength: strength, x: x, layer: L.name });
      }
    }
    if (p.keys && tf) {
      var pos = tf.property('ADBE Position');
      if (pos.dimensionsSeparated) pos = tf.property('ADBE Position_0');
      for (var k = 1; k < pos.numKeys; k++) {
        var a = pos.keyValue(k), b = pos.keyValue(k + 1), dt = pos.keyTime(k + 1) - pos.keyTime(k);
        var d = (a instanceof Array) ? Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])) : Math.abs(b - a);
        if (d < 40 || dt <= 0 || dt > 3 || pos.numKeys > 30) continue;
        ev.push({ t: pos.keyTime(k), dur: dt, kind: 'move', strength: Math.min(1, d / dt / 3000), x: ((a instanceof Array ? a[0] : a) + (b instanceof Array ? b[0] : b)) / 2 / W, layer: L.name });
      }
      var sc = tf.property('ADBE Scale');
      for (var s = 1; s < sc.numKeys; s++) {
        var sa = sc.keyValue(s)[0], sb = sc.keyValue(s + 1)[0];
        if (sa < 20 && sb > 60) ev.push({ t: sc.keyTime(s), dur: sc.keyTime(s + 1) - sc.keyTime(s), kind: 'pop', strength: 0.7, x: px, layer: L.name });
      }
    }
    if (p.inout && tf) {
      var fx = L.property('ADBE Effect Parade'), hasAnim = false, outD = 0;
      try { for (var f = 1; f <= fx.numProperties; f++) { if (fx.property(f).name === 'KX In Duration' && fx.property(f).property(1).value > 0) hasAnim = true; if (fx.property(f).name === 'KX Out Duration') outD = fx.property(f).property(1).value; } } catch (e2) {}
      if (hasAnim) ev.push({ t: L.inPoint, dur: 0.3, kind: 'in', strength: 0.6, x: px, layer: L.name });
      if (outD > 0) ev.push({ t: L.outPoint - outD, dur: outD, kind: 'out', strength: 0.5, x: px, layer: L.name });
    }
  }
  return ev;
};

/** Import WAV files and place them as audio layers (volume in dB, pan -1..1). */
KX.sfxPlace = function (p) {
  var comp = KX._comp(null, false);
  app.beginUndoGroup('Kinetix SFX');
  var folder = KX._projFolder('Kinetix SFX'), n = 0;
  for (var i = 0; i < p.files.length; i++) {
    var F = p.files[i];
    var item = app.project.importFile(new ImportOptions(new File(F.path)));
    item.parentFolder = folder;
    var L = comp.layers.add(item);
    L.startTime = (F.t === null || F.t === undefined) ? comp.time : F.t;
    L.name = KX._uniqueName(comp, F.name);
    L.label = 4;
    try { L.property('ADBE Audio Group').property('ADBE Audio Levels').setValue([F.db, F.db]); } catch (e) {}
    if (F.pan && Math.abs(F.pan) > 0.02) {
      try {
        var sm = L.property('ADBE Effect Parade').addProperty('ADBE Aud Stereo Mixer');
        var lv = 100 - Math.max(0, F.pan) * 100, rv = 100 + Math.min(0, F.pan) * 100;
        sm.property(1).setValue(lv); sm.property(2).setValue(rv);
      } catch (e2) {}
    }
    L.moveToEnd();
    n++;
  }
  app.endUndoGroup();
  return { layers: n };
};

// --------- Styles & gradients ---------
KX._addFx = function (layer, alts) {
  var fx = layer.property('ADBE Effect Parade');
  for (var i = 0; i < alts.length; i++) {
    try { if (fx.canAddProperty(alts[i])) return { fx: fx.addProperty(alts[i]), used: alts[i] }; } catch (e) {}
  }
  return null;
};

KX._clearStyle = function (L) {
  var fx = L.property('ADBE Effect Parade');
  for (var i = fx.numProperties; i >= 1; i--) if (fx.property(i).name.indexOf('KX Style') === 0 || fx.property(i).name.indexOf('KX Gradient') === 0) fx.property(i).remove();
};

KX.styleApply = function (p) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, n = 0, missing = {};
  if (!sel.length) throw new Error('Select one or more layers first.');
  app.beginUndoGroup('Kinetix Style ' + p.name);
  for (var s = 0; s < sel.length; s++) {
    var L = sel[s];
    if (L instanceof CameraLayer || L instanceof LightLayer) continue;
    if (p.clear) KX._clearStyle(L);
    for (var f = 0; f < p.fx.length; f++) {
      var F = p.fx[f], got = KX._addFx(L, F.match);
      if (!got) { missing[F.match[0]] = 1; continue; }
      if (got.used !== F.match[0]) missing[F.match[0]] = 1;
      var ef = got.fx;
      ef.name = F.name;
      if (got.used === 'ADBE Set Matte3') { try { ef.property(1).setValue(L.index); } catch (eS) {} }
      if (F.props) for (var k in F.props) if (F.props.hasOwnProperty(k)) { var pr = KX._fxProp(ef, k); if (pr) try { pr.setValue(F.props[k]); } catch (e1) {} }
      if (F.expr) for (var x in F.expr) if (F.expr.hasOwnProperty(x)) { var xp = KX._fxProp(ef, x); if (xp) try { xp.expression = F.expr[x]; } catch (e2) {} }
    }
    if (p.text && L instanceof TextLayer) {
      var tp = L.property('ADBE Text Properties').property('ADBE Text Document'), td = tp.value;
      if (p.text.stroke) { td.applyStroke = true; td.strokeColor = [p.text.stroke[0][0], p.text.stroke[0][1], p.text.stroke[0][2]]; td.strokeWidth = p.text.stroke[1]; try { td.strokeOverFill = false; } catch (e3) {} }
      if (p.text.fill) { td.applyFill = true; td.fillColor = [p.text.fill[0], p.text.fill[1], p.text.fill[2]]; }
      if (tp.numKeys === 0) tp.setValue(td);
    }
    if (p.extrude) {
      try { comp.renderer = 'ADBE Advanced 3d'; } catch (e4) {}
      L.threeDLayer = true;
      try { L.property('ADBE Extrsn Options Group').property('ADBE Extrsn Depth').setValue(p.extrude); } catch (e5) {}
    }
    n++;
  }
  app.endUndoGroup();
  var miss = [];
  for (var m in missing) if (missing.hasOwnProperty(m)) miss.push(m);
  return { layers: n, missing: miss };
};

/** Gradient on the selected layers: Ramp (2 colours), image matte (any gradient) or comp background. */
KX.gradApply = function (p) {
  var comp = KX._comp(null, false);
  var sel = comp.selectedLayers, n = 0;
  app.beginUndoGroup('Kinetix Gradient');
  var item = null;
  if (p.png) { item = app.project.importFile(new ImportOptions(new File(p.png))); item.parentFolder = KX._projFolder('Kinetix Gradients'); }
  if (p.mode === 'background') {
    var bg = comp.layers.add(item);
    bg.name = KX._uniqueName(comp, 'KX Gradient BG - ' + p.name);
    var sz = Math.max(comp.width, comp.height) * 1.5 / item.width * 100;
    bg.property('ADBE Transform Group').property('ADBE Scale').setValue([sz, sz]);
    bg.property('ADBE Transform Group').property('ADBE Position').setValue([comp.width / 2, comp.height / 2]);
    if (p.animate) bg.property('ADBE Transform Group').property('ADBE Rotate Z').expression = '// KX-GRAD\nvalue+time*6;';
    bg.moveToEnd();
    app.endUndoGroup();
    return { layers: 1 };
  }
  if (!sel.length) { app.endUndoGroup(); throw new Error('Select one or more layers first.'); }
  for (var s = 0; s < sel.length; s++) {
    var L = sel[s];
    if (L instanceof CameraLayer || L instanceof LightLayer) continue;
    if (p.mode === 'fill') {
      KX._clearStyle(L);
      var fx = L.property('ADBE Effect Parade');
      var rp = fx.addProperty('ADBE Ramp'); rp.name = 'KX Gradient';
      KX._fxProp(rp, 'Start Color').setValue(p.stops[0]);
      KX._fxProp(rp, 'End Color').setValue(p.stops[p.stops.length - 1]);
      KX._fxProp(rp, 'Ramp Shape').setValue(p.radial ? 2 : 1);
      var a = (p.angle - 90) * Math.PI / 180;
      KX._fxProp(rp, 'Start of Ramp').expression = '// KX-GRAD\nvar r=sourceRectAtTime(time,false),c=[r.left+r.width/2,r.top+r.height/2],R=Math.max(r.width,r.height)/2;' + (p.radial ? 'c;' : 'c-[Math.cos(' + a + '),Math.sin(' + a + ')]*R;');
      KX._fxProp(rp, 'End of Ramp').expression = '// KX-GRAD\nvar r=sourceRectAtTime(time,false),c=[r.left+r.width/2,r.top+r.height/2],R=Math.max(r.width,r.height)/2;' + (p.radial ? 'c+[R,0];' : 'c+[Math.cos(' + a + '),Math.sin(' + a + ')]*R;');
      var sm = fx.addProperty('ADBE Set Matte3'); sm.name = 'KX Gradient Matte';
      sm.property(1).setValue(L.index);
      KX._fxProp(sm, 'Use For Matte').setValue(4);
    } else {
      // gradient image above the layer, matted by it and following it
      var g = comp.layers.add(item);
      g.name = KX._uniqueName(comp, 'KX Gradient - ' + L.name);
      g.moveBefore(L);
      var r = L.sourceRectAtTime(comp.time, false), tf = L.property('ADBE Transform Group');
      var pos = tf.property('ADBE Position').valueAtTime(comp.time, false), an = tf.property('ADBE Anchor Point').valueAtTime(comp.time, false), sc = tf.property('ADBE Scale').valueAtTime(comp.time, false);
      var cx = pos[0] + (r.left + r.width / 2 - an[0]) * sc[0] / 100, cy = pos[1] + (r.top + r.height / 2 - an[1]) * sc[1] / 100;
      var cover = Math.max(r.width * Math.abs(sc[0]), r.height * Math.abs(sc[1])) / 100 * 1.25 / item.width * 100;
      if (L.threeDLayer) g.threeDLayer = true;
      g.property('ADBE Transform Group').property('ADBE Position').setValue(L.threeDLayer ? [cx, cy, pos[2]] : [cx, cy]);
      g.property('ADBE Transform Group').property('ADBE Scale').setValue([cover, cover]);
      g.parent = L;
      if (p.animate) g.property('ADBE Transform Group').property('ADBE Rotate Z').expression = '// KX-GRAD\nvalue+time*20;';
      try { g.setTrackMatte(L, TrackMatteType.ALPHA); } catch (eT) { g.trackMatteType = TrackMatteType.ALPHA; }
    }
    n++;
  }
  app.endUndoGroup();
  return { layers: n };
};

// --------- Shape-layer outlines for physics (exact, per frame) ---------
KX._mMul = function (a, b) { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; };
KX._mApply = function (m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; };
KX._groupMatrix = function (xf, t) {
  var an = xf.property('ADBE Vector Anchor').valueAtTime(t, false), ps = xf.property('ADBE Vector Position').valueAtTime(t, false);
  var sc = xf.property('ADBE Vector Scale').valueAtTime(t, false), r = xf.property('ADBE Vector Rotation').valueAtTime(t, false) * Math.PI / 180;
  var c = Math.cos(r), s = Math.sin(r), sx = sc[0] / 100, sy = sc[1] / 100;
  // T(pos) * R * S * T(-anchor)
  var m = [c * sx, s * sx, -s * sy, c * sy, 0, 0];
  m[4] = ps[0] - (m[0] * an[0] + m[2] * an[1]);
  m[5] = ps[1] - (m[1] * an[0] + m[3] * an[1]);
  return m;
};

KX._bez = function (s, steps) {
  var out = [], v = s.vertices, ii = s.inTangents, oo = s.outTangents, n = v.length;
  if (!n) return out;
  var segs = s.closed ? n : n - 1;
  for (var k = 0; k < segs; k++) {
    var a = v[k], b = v[(k + 1) % n], c1 = [a[0] + oo[k][0], a[1] + oo[k][1]], c2 = [b[0] + ii[(k + 1) % n][0], b[1] + ii[(k + 1) % n][1]];
    var straight = !oo[k][0] && !oo[k][1] && !ii[(k + 1) % n][0] && !ii[(k + 1) % n][1];
    var st = straight ? 1 : steps;
    for (var j = 0; j < st; j++) {
      var t = j / st, u = 1 - t;
      out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
    }
  }
  return out;
};

/** All filled outlines of a shape layer at time t, in layer space. */
KX._shapeOutlines = function (layer, t) {
  var polys = [];
  var walk = function (vectors, m) {
    for (var i = 1; i <= vectors.numProperties; i++) {
      var p = vectors.property(i), pts = null;
      try { if (!p.enabled) continue; } catch (e0) {}
      var mn = p.matchName;
      if (mn === 'ADBE Vector Group') {
        walk(p.property('ADBE Vectors Group'), KX._mMul(m, KX._groupMatrix(p.property('ADBE Vector Transform Group'), t)));
        continue;
      }
      if (mn === 'ADBE Vector Shape - Group') pts = KX._bez(p.property('ADBE Vector Shape').valueAtTime(t, false), 8);
      else if (mn === 'ADBE Vector Shape - Rect') {
        var sz = p.property('ADBE Vector Rect Size').valueAtTime(t, false), ps = p.property('ADBE Vector Rect Position').valueAtTime(t, false);
        var rr = Math.min(p.property('ADBE Vector Rect Roundness').valueAtTime(t, false), sz[0] / 2, sz[1] / 2), hw = sz[0] / 2, hh = sz[1] / 2;
        pts = [];
        var cs = [[hw - rr, -hh + rr, -90], [hw - rr, hh - rr, 0], [-hw + rr, hh - rr, 90], [-hw + rr, -hh + rr, 180]];
        for (var q = 0; q < 4; q++) for (var a = 0; a <= 6; a++) { var ang = (cs[q][2] + a * 15) * Math.PI / 180; pts.push([ps[0] + cs[q][0] + Math.cos(ang) * rr, ps[1] + cs[q][1] + Math.sin(ang) * rr]); }
      } else if (mn === 'ADBE Vector Shape - Ellipse') {
        var es = p.property('ADBE Vector Ellipse Size').valueAtTime(t, false), ep = p.property('ADBE Vector Ellipse Position').valueAtTime(t, false);
        pts = [];
        for (var e = 0; e < 32; e++) { var ea = e / 32 * Math.PI * 2; pts.push([ep[0] + Math.cos(ea) * es[0] / 2, ep[1] + Math.sin(ea) * es[1] / 2]); }
      } else if (mn === 'ADBE Vector Shape - Star') {
        var type = p.property('ADBE Vector Star Type').valueAtTime(t, false), np = Math.max(3, Math.round(p.property('ADBE Vector Star Points').valueAtTime(t, false)));
        var sp = p.property('ADBE Vector Star Position').valueAtTime(t, false), srot = p.property('ADBE Vector Star Rotation').valueAtTime(t, false) * Math.PI / 180;
        var ro = p.property('ADBE Vector Star Outer Radius').valueAtTime(t, false), ri = type === 1 ? p.property('ADBE Vector Star Inner Radius').valueAtTime(t, false) : ro;
        var cnt = type === 1 ? np * 2 : np;
        pts = [];
        for (var s2 = 0; s2 < cnt; s2++) { var sa = -Math.PI / 2 + srot + s2 / cnt * Math.PI * 2, rad = (type === 1 && s2 % 2) ? ri : ro; pts.push([sp[0] + Math.cos(sa) * rad, sp[1] + Math.sin(sa) * rad]); }
      }
      if (pts && pts.length > 2) {
        var w = [];
        for (var z = 0; z < pts.length; z++) { var r = KX._mApply(m, pts[z]); w.push([Math.round(r[0] * 10) / 10, Math.round(r[1] * 10) / 10]); }
        polys.push(w);
      }
    }
  };
  walk(KX._contents(layer), [1, 0, 0, 1, 0, 0]);
  return polys;
};

/** Does anything inside the shape layer animate (keys or expressions)? */
KX._shapeAnimated = function (layer) {
  var found = false;
  var walk = function (g) {
    for (var i = 1; i <= g.numProperties && !found; i++) {
      var p = g.property(i);
      if (p.propertyType === PropertyType.PROPERTY) { try { if (p.numKeys > 0 || (p.expressionEnabled && p.expression)) found = true; } catch (e) {} }
      else walk(p);
    }
  };
  walk(KX._contents(layer));
  return found;
};

/** physScene with exact outlines: shape layers get their real (and morphing) geometry. */
KX.physScene2 = function (p) {
  var base = KX.physScene();
  var comp = KX._comp(null, false), fps = comp.frameRate, n = Math.min(900, Math.ceil(p.duration * fps) + 1);
  for (var i = 0; i < base.layers.length; i++) {
    var B = base.layers[i], L = comp.layer(B.index);
    var tf = L.property('ADBE Transform Group');
    B.anchor = tf.property('ADBE Anchor Point').valueAtTime(comp.time, false);
    B.scale = tf.property('ADBE Scale').valueAtTime(comp.time, false);
    if (!(L instanceof ShapeLayer)) continue;
    var frames = [];
    if (KX._shapeAnimated(L)) { for (var f = 0; f < n; f++) frames.push(KX._shapeOutlines(L, comp.time + f / fps)); B.morphing = true; }
    else frames.push(KX._shapeOutlines(L, comp.time));
    B.outlines = frames;
  }
  return base;
};
