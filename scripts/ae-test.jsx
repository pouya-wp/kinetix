// Kinetix integration test, phase 1. Run with:  AfterFX.exe -r scripts/ae-test.jsx
// Goes through kx_call exactly like the panel does and writes scripts/out/ae-log.txt.
(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  $.evalFile(new File(root + 'host/kinetix.jsx'));
  var log = [];
  function read(n) { var f = new File(root + 'scripts/out/' + n + '.json'); f.encoding = 'UTF-8'; f.open('r'); var s = f.read(); f.close(); return s; }
  function write(n, s) { var f = new File(root + 'scripts/out/' + n); f.encoding = 'UTF-8'; f.open('w'); f.write(s); f.close(); }
  function call(name, argsJson) {
    var t0 = new Date().getTime();
    var r = KXJSON.parse(kx_call(name, argsJson));
    var ms = new Date().getTime() - t0;
    log.push((r.ok ? 'OK   ' : 'FAIL ') + name + ' (' + ms + ' ms) ' + (r.ok ? KXJSON.stringify(r.r).substring(0, 160) : r.err));
    return r;
  }
  try {
    if (app.project && (app.project.file || app.project.numItems > 0)) {
      write('ae-log.txt', 'SKIPPED: a project with content is open - close it (or open a new empty project) and run again.');
      return;
    }
    var comp = app.project.items.addComp('KX Test', 1920, 1080, 1, 8, 30);
    comp.openInViewer();
    log.push('AE ' + app.version);

    call('getActiveComp', '[]');
    call('bounceExport', '[' + read('bounce-smart') + ']');
    call('bounceExport', '[' + read('bounce-expr') + ']');

    var names = ['shapes-sparse', 'shapes-morph', 'shapes-split', 'shapes-jelly'];
    for (var n = 0; n < names.length; n++) {
      var p = KXJSON.parse(read(names[n]));
      for (var i = 0; i < p.layers.length; i++) call('shapesExport', KXJSON.stringify([{ comp: p.comp, layer: p.layers[i], index: i, total: p.layers.length }]));
    }

    // selected-layer bounce: a solid driven through a deform null
    var solid = comp.layers.addSolid([1, 0.4, 0.2], 'Ball Solid', 120, 120, 1);
    for (var d = 1; d <= comp.numLayers; d++) comp.layer(d).selected = false;
    solid.selected = true;
    var bp = KXJSON.parse(read('bounce-smart'));
    bp.target = 'selected';
    bp.balls = [bp.balls[0]];
    call('bounceExport', KXJSON.stringify([bp]));

    // text: subtitle layers ? analyze (glyph outlines via Create Shapes from Text)
    var tcomp = app.project.items.addComp('KX Text Test', 1920, 1080, 1, 12, 30);
    tcomp.openInViewer();
    var subs = [[0.3, 1.6, 'Hello and welcome back'], [1.8, 3.1, 'Today we build something'], [3.1, 4.4, 'Today we build something amazing'], [4.3, 5.6, 'Something truly amazing'], [5.9, 7.1, 'Watch the letters move'], [7.1, 8.4, 'Watch the words morph']];
    var layers = [];
    for (var s = 0; s < subs.length; s++) {
      var L = tcomp.layers.addText(subs[s][2]);
      var tp = L.property('ADBE Text Properties').property('ADBE Text Document');
      var td = tp.value;
      td.fontSize = 84; td.fillColor = [1, 1, 1]; td.applyFill = true; td.justification = ParagraphJustification.CENTER_JUSTIFY;
      tp.setValue(td);
      L.property('ADBE Transform Group').property('ADBE Position').setValue([960, 700]);
      L.inPoint = subs[s][0]; L.outPoint = subs[s][1];
      layers.push(L);
    }
    for (var q = 1; q <= tcomp.numLayers; q++) tcomp.layer(q).selected = false;
    for (var q2 = 0; q2 < layers.length; q2++) layers[q2].selected = true;
    var an = call('textAnalyze', '[]');
    if (an.ok) write('analyze.json', KXJSON.stringify(an.r));

    var tm = call('listTemplates', '[]');
    app.project.save(new File(root + 'scripts/out/kx-test-phase1.aep'));
    log.push('saved project');
  } catch (e) {
    log.push('CRASH ' + e.toString() + ' line ' + e.line);
  }
  write('ae-log.txt', log.join('\n'));
})();
