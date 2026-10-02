(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  var log = [];
  try {
    var ids = ['Create Shapes from Text', 'Create Shapes from Vector Layer', 'Create Masks from Text'];
    for (var i = 0; i < ids.length; i++) log.push(ids[i] + ' = ' + app.findMenuCommandId(ids[i]));
    var comp = null;
    for (var k = 1; k <= app.project.numItems; k++) if (app.project.item(k).name === 'KX Text Test') comp = app.project.item(k);
    log.push('comp ' + (comp ? comp.numLayers : 'none'));
    comp.openInViewer();
    log.push('active ' + (app.project.activeItem ? app.project.activeItem.name : 'null'));
    var before = comp.numLayers;
    for (var d = 1; d <= comp.numLayers; d++) comp.layer(d).selected = false;
    var t = null;
    for (var d2 = 1; d2 <= comp.numLayers; d2++) if (comp.layer(d2) instanceof TextLayer) { t = comp.layer(d2); break; }
    t.selected = true;
    log.push('selected ' + comp.selectedLayers.length + ' ' + t.name);
    app.executeCommand(app.findMenuCommandId('Create Shapes from Text'));
    log.push('after cmd layers ' + comp.numLayers + ' (before ' + before + ')');
    for (var z = 1; z <= comp.numLayers; z++) log.push('  ' + z + ' ' + comp.layer(z).name);
  } catch (e) { log.push('ERR ' + e.toString() + ' line ' + e.line); }
  var o = new File(root + 'scripts/out/ae-debug.txt'); o.open('w'); o.write(log.join('\n')); o.close();
})();
