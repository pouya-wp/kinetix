// Text test phase B: build the Text Morph from scripts/out/text-payload.json exactly like the panel
(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  $.evalFile(new File(root + 'host/kinetix.jsx'));
  function read(n) { var f = new File(root + 'scripts/out/' + n); f.encoding = 'UTF-8'; f.open('r'); var s = f.read(); f.close(); return s; }
  function write(n, s) { var f = new File(root + 'scripts/out/' + n); f.encoding = 'UTF-8'; f.open('w'); f.write(s); f.close(); }
  var log = [];
  function call(name, args) { var r = KXJSON.parse(kx_call(name, KXJSON.stringify(args))); log.push((r.ok ? 'OK   ' : 'FAIL ') + name + ' ' + (r.ok ? KXJSON.stringify(r.r).substring(0, 120) : r.err)); return r.r; }
  try {
    var p = KXJSON.parse(read('text-payload.json'));
    for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === 'KX Flow Test') app.project.item(i).openInViewer();
    var head = p; var lines = p.lines, baked = p.baked, box = p.box;
    var ids = call('textBegin', [{ comp: head.comp, name: head.name, duration: head.duration, textColor: head.textColor, boxColor: head.boxColor, boxOpacity: head.boxOpacity }]);
    for (var l = 0; l < lines.length; l++) call('textLine', [ids.srcId, lines[l]]);
    for (var b = 0; b < baked.length; b++) call('textBaked', [ids.srcId, baked[b]]);
    if (box) call('textBox', [ids.compId, box, head]);
    head.lines = []; head.baked = []; head.box = null;
    call('textFinish', [ids.compId, head, ids.srcId]);
    app.project.save(new File(root + 'scripts/out/kx-flow-test.aep'));
    log.push('saved');
  } catch (e) { log.push('CRASH ' + e.toString() + ' line ' + e.line); }
  write('ae-text-b.txt', log.join('\n'));
})();
