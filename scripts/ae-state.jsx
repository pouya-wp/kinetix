(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  var o = ['items ' + app.project.numItems];
  for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); o.push(i + ' ' + it.name + (it instanceof CompItem ? ' [comp ' + it.numLayers + ' layers]' : '')); }
  var f = new File(root + 'scripts/out/state.txt'); f.encoding = 'UTF-8'; f.open('w'); f.write(o.join('\n')); f.close();
})();
