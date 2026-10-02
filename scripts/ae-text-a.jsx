// Text test phase A: subtitle layers -> textAnalyze (no outlines) -> scripts/out/analyze2.json
(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  $.evalFile(new File(root + 'host/kinetix.jsx'));
  function write(n, s) { var f = new File(root + 'scripts/out/' + n); f.encoding = 'UTF-8'; f.open('w'); f.write(s); f.close(); }
  if (app.project && (app.project.file || app.project.numItems > 0)) { write('ae-text-a.txt', 'SKIPPED: project with content is open'); return; }
  var c = app.project.items.addComp('KX Flow Test', 1920, 1080, 1, 10, 30);
  c.bgColor = [0, 0, 0];
  c.openInViewer();
  var subs = [[0.3, 1.8, 'Hello and welcome back'], [1.8, 3.3, 'Today we build something'], [3.3, 4.8, 'Something truly amazing'], [5.0, 6.6, 'Watch the words flow']];
  var layers = [];
  for (var s = 0; s < subs.length; s++) {
    var L = c.layers.addText(subs[s][2]);
    var tp = L.property('ADBE Text Properties').property('ADBE Text Document');
    var td = tp.value; td.fontSize = 110; td.fillColor = [1, 1, 1]; td.applyFill = true; td.justification = ParagraphJustification.CENTER_JUSTIFY;
    tp.setValue(td);
    L.property('ADBE Transform Group').property('ADBE Position').setValue([960, 580]);
    L.inPoint = subs[s][0]; L.outPoint = subs[s][1];
    layers.push(L);
  }
  for (var q = 1; q <= c.numLayers; q++) c.layer(q).selected = false;
  for (var q2 = 0; q2 < layers.length; q2++) layers[q2].selected = true;
  write('analyze2.json', kx_call('textAnalyze', '[{"outlines":false}]'));
  write('ae-text-a.txt', 'done');
})();
