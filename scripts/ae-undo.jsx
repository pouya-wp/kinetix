// Probe: does an undo group opened in one script run stay open across later runs?
(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  function write(s) { var f = new File(root + 'scripts/out/ae-undo.txt'); f.open('a'); f.write(s + '\n'); f.close(); }
  var step = $.getenv('KXSTEP') || '';
  try {
    if (app.project.file) { write('SKIP saved project'); return; }
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === 'KX Undo Probe') comp = app.project.item(i);
    if (!comp) {
      if (app.project.numItems > 0) { write('SKIP project has items'); return; }
      app.beginUndoGroup('probe setup');
      comp = app.project.items.addComp('KX Undo Probe', 100, 100, 1, 1, 30);
      comp.layers.addNull();
      app.endUndoGroup();
      write('setup');
      return;
    }
    var p = comp.layer(1).property('ADBE Transform Group').property('ADBE Rotate Z');
    var mode = new File(root + 'scripts/out/undo-step.txt'); mode.open('r'); var m = mode.read(); mode.close();
    if (m === 'begin') { app.beginUndoGroup('KX drag'); p.setValue(10); write('begin -> ' + p.value); }
    else if (m === 'mid') { p.setValue(20); write('mid -> ' + p.value); }
    else if (m === 'end') { p.setValue(30); app.endUndoGroup(); write('end -> ' + p.value); }
    else if (m === 'undo') { app.executeCommand(app.findMenuCommandId('Undo KX drag') || 16); write('undo -> ' + p.value); }
    else if (m === 'clean') { comp.remove(); write('clean'); }
  } catch (e) { write('ERR ' + e.message + ' line ' + e.line); }
})();
