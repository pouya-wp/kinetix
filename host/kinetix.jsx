/*  Kinetix — After Effects host script (ExtendScript, ES3).
    The panel calls kx_call(name, jsonArgs); every function lives on KX and
    returns plain data that is sent back as JSON.                           */

// ───────── JSON (ExtendScript has no native JSON) ─────────
if (typeof KXJSON === 'undefined') {
  KXJSON = {};
  (function () {
    var esc = /[\\\"\u0000-\u001f\u007f-\u009f­؀-؄܏឴឵‌-‏ - ⁠-⁯﻿￰-￿]/g;
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

// ───────── helpers ─────────
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

// ───────── comp info ─────────
KX.getActiveComp = function () {
  var c = app.project ? app.project.activeItem : null;
  if (!c || !(c instanceof CompItem)) return null;
  return { w: c.width, h: c.height, fps: c.frameRate, duration: c.duration, name: c.name, time: c.time, workStart: c.workAreaStart, workDur: c.workAreaDuration };
};

KX.ping = function () { return { version: app.version, project: app.project ? app.project.file ? app.project.file.name : 'Untitled' : null }; };

// ───────── Bounce ─────────
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
  nul.name = KX._uniqueName(comp, 'KX Deform · ' + layer.name);
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
