// Render the active Kinetix post comp to an H.264 preview next to the project (scripts/out).
(function () {
  var ROOT = new File($.fileName).parent.parent.parent.absoluteURI + '/';
  var out = [];
  try {
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.name.indexOf('POST ') === 0) comp = it; }
    if (!comp) throw new Error('no POST comp');
    while (app.project.renderQueue.numItems > 0) app.project.renderQueue.item(1).remove();
    var rq = app.project.renderQueue.items.add(comp);
    var om = rq.outputModule(1), tpl = om.templates, pick = null;
    for (var t = 0; t < tpl.length; t++) if (/H\.264/i.test(tpl[t])) { pick = tpl[t]; if (/40/.test(tpl[t])) break; }
    out.push('templates: ' + tpl.join(' | '));
    if (pick) om.applyTemplate(pick);
    om.file = new File(ROOT + 'scripts/out/post-preview.mp4');
    var t0 = new Date().getTime();
    app.project.renderQueue.render();
    out.push('rendered with ' + pick + ' in ' + Math.round((new Date().getTime() - t0) / 1000) + ' s');
  } catch (e) { out.push('ERR ' + e.message + ' line ' + e.line); }
  var f = new File(ROOT + 'scripts/out/render-log.txt'); f.encoding = 'UTF-8'; f.open('w'); f.write(out.join('\n')); f.close();
})();
